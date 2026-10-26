import { fingerprint, success, type RequestContext } from './http.js';
import { idempotent, ServiceError, type AuthContext } from './services.js';
import { VerificationError, type VerificationSubject } from './verification-domain.js';
import type { VerificationRuntime } from './verification-runtime.js';
import { VerificationRealtime, verificationClientId } from './verification-realtime.js';
import { verificationNativeHttp } from './verification-native-http.js';

export async function verificationHttp(runtime: VerificationRuntime, realtime: VerificationRealtime, ctx: RequestContext, auth: AuthContext) {
  const root = '/api/v1/verification-sessions';
  if (ctx.path !== root && !ctx.path.startsWith(`${root}/`)) return;
  const native = await verificationNativeHttp(runtime, ctx, auth);
  if (native) return native;
  if (ctx.method === 'GET') {
    const assertSession = async () => {
      if (!await runtime.auth.accessFromSession(auth.session.id)) throw new VerificationError('VERIFICATION_SESSION_EXPIRED', 401);
    };
    if (ctx.path === root) {
      const data = await runtime.list(auth.admin.id, ctx.query.active === 'true');
      // DTO construction reads storage. Permission/session evidence collected
      // before that wait cannot authorize the eventual HTTP response.
      const sessions = await Promise.all(data.sessions.map(async session => {
        try { await runtime.coordinator.snapshot(session.id, auth.admin.id); return session; }
        catch (error) { if (error instanceof VerificationError && [403, 404, 410].includes(error.statusCode)) return undefined; throw error; }
      }));
      await assertSession();
      return success(ctx, { ...data, sessions: sessions.filter(session => session !== undefined) });
    }
    const id = ctx.path.slice(root.length + 1);
    if (id.includes('/')) throw new VerificationError('VERIFICATION_NOT_FOUND', 404);
    const session = await runtime.dto(await runtime.coordinator.snapshot(id, auth.admin.id));
    await runtime.coordinator.snapshot(id, auth.admin.id);
    await assertSession();
    return success(ctx, { session });
  }
  if (ctx.method !== 'POST') throw new VerificationError('VERIFICATION_NOT_FOUND', 404);
  await runtime.auth.validateCsrf(auth, ctx.headers, ctx.cookies);
  const key = ctx.headers['idempotency-key'];
  if (!key || key.length > 200) throw new ServiceError(400, 'VALIDATION_FAILED', 'Idempotency-Key header is required');
  // Access and live transport checks run on every request, including a
  // persisted idempotency replay. Cached grants never confer new authority.
  const assertCurrentAccess = async () => {
    if (!await runtime.auth.accessFromSession(auth.session.id)) throw new VerificationError('VERIFICATION_SESSION_EXPIRED', 401);
  if (ctx.path === `${root}/retry`) {
    const accountId = typeof ctx.body.accountId === 'string' ? ctx.body.accountId : undefined;
    const loginSessionId = typeof ctx.body.loginSessionId === 'string' ? ctx.body.loginSessionId : undefined;
    if (!!accountId === !!loginSessionId || !await runtime.authorize({ adminId: auth.admin.id, accountId, loginSessionId }, auth.admin.id)) throw new VerificationError('VERIFICATION_NOT_FOUND', 404);
  } else {
    const match = /^([^/]+)\/(presentation|claim|release|auto|request-human)$/.exec(ctx.path.slice(root.length + 1));
    if (!match) throw new VerificationError('VERIFICATION_NOT_FOUND', 404);
    const [, id, action] = match;
    const row = await runtime.coordinator.snapshot(id, auth.admin.id);
    const clientId = verificationClientId(ctx.body.clientInstanceId);
    if (action !== 'request-human' && !(action === 'presentation' && ctx.body.action === 'reserve')) {
      const stream = realtime.bound(ctx.body.connectionId, id, auth.admin.id, auth.session.id, clientId);
      if (action === 'presentation' || action === 'claim') realtime.displayed(stream, ctx.body.frameId);
      if (action === 'claim' && row.state !== 'priority_wait' && !(row.state === 'human_active' && row.controller?.authSessionId === auth.session.id
        && row.controller.clientId === clientId && (row.controller.connectionId === stream.id || ctx.body.action === 'resume' && row.reconnectDeadline !== undefined))) throw new VerificationError('VERIFICATION_CONTROL_EXPIRED');
      if (action === 'release' && row.state === 'human_active' && row.controller?.connectionId !== stream.id) throw new VerificationError('VERIFICATION_CONNECTION_CHANGED');
    }
  }
  };
  await assertCurrentAccess();
  const result = await idempotent(runtime.store, { scope: `${auth.admin.id}:${auth.session.id}:verification:${ctx.path}`, key,
    fingerprint: fingerprint(ctx.method, ctx.path, ctx.body), traceId: ctx.traceId, handler: async () => {
      if (ctx.path === `${root}/retry`) {
        const accountId = typeof ctx.body.accountId === 'string' ? ctx.body.accountId : undefined;
        const loginSessionId = typeof ctx.body.loginSessionId === 'string' ? ctx.body.loginSessionId : undefined;
        if (!!accountId === !!loginSessionId || !['manual_only', 'manual_then_auto'].includes(String(ctx.body.mode))) throw new VerificationError('VERIFICATION_SUBJECT_INVALID', 422);
        const subject: VerificationSubject = { adminId: auth.admin.id, accountId, loginSessionId };
        const data = await runtime.retry(subject, ctx.body.mode as 'manual_only' | 'manual_then_auto');
        return success(ctx, data, data.pending ? 202 : 200);
      }
      const match = /^([^/]+)\/(presentation|claim|release|auto|request-human)$/.exec(ctx.path.slice(root.length + 1));
      if (!match) throw new VerificationError('VERIFICATION_NOT_FOUND', 404);
      const [, id, action] = match;
      // Reauthorize even for methods that later return a conflict. Ownership
      // comes from the authenticated session and actual stream registry.
      await runtime.coordinator.snapshot(id, auth.admin.id);
      const clientId = verificationClientId(ctx.body.clientInstanceId);
      let row;
      if (action === 'request-human') row = await runtime.coordinator.requestHuman(id, auth.admin.id);
      else if (action === 'presentation' && ctx.body.action === 'reserve') row = await runtime.coordinator.presentation(id, auth.admin.id, clientId);
      else {
        const stream = realtime.bound(ctx.body.connectionId, id, auth.admin.id, auth.session.id, clientId);
        if (action === 'presentation' && ctx.body.action === 'ack') row = await runtime.coordinator.presentation(id, auth.admin.id, clientId, realtime.displayed(stream, ctx.body.frameId));
        else if (action === 'claim') {
          if (!['claim', 'resume'].includes(String(ctx.body.action)) || !Number.isSafeInteger(ctx.body.expectedVersion)) throw new VerificationError('VERIFICATION_INPUT_INVALID', 422);
          row = await runtime.coordinator.claim(id, { adminId: auth.admin.id, authSessionId: auth.session.id, clientId, connectionId: stream.id,
            version: Number(ctx.body.expectedVersion), frameId: realtime.displayed(stream, ctx.body.frameId), resume: ctx.body.action === 'resume' });
        } else if (action === 'release') row = await runtime.coordinator.release(id, auth.admin.id, clientId, ctx.body.toAuto !== false);
        else if (action === 'auto') row = await runtime.coordinator.auto(id, auth.admin.id);
        else if (action === 'request-human') row = await runtime.coordinator.requestHuman(id, auth.admin.id);
        else throw new VerificationError('VERIFICATION_INPUT_INVALID', 422);
      }
      return success(ctx, { session: await runtime.dto(row) });
    } });
  await assertCurrentAccess();
  return { statusCode: result.statusCode, body: result.body };
}
