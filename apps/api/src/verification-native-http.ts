import { success, type RequestContext } from './http.js';
import type { AuthContext } from './services.js';
import type { VerificationRuntime } from './verification-runtime.js';
import { VerificationError } from './verification-domain.js';
import { verificationClientId } from './verification-realtime.js';
import type { NativeVerificationControl } from './verification-native-candidate.js';

/** Signed URLs and candidates are ephemeral: do not use the persistent
 * idempotency cache. Coordinator leases/operations provide bounded replay. */
export async function verificationNativeHttp(runtime: VerificationRuntime, ctx: RequestContext, auth: AuthContext) {
  const match = /^\/api\/v1\/verification-sessions\/([^/]+)\/native\/(presentation|claim|result|cancel)$/.exec(ctx.path);
  if (!match) return;
  if (ctx.method !== 'POST') throw new VerificationError('VERIFICATION_NOT_FOUND', 404);
  if (runtime.config.xianyuVerificationNativeEnabled !== true) throw new VerificationError('VERIFICATION_NATIVE_UNAVAILABLE', 404);
  await runtime.auth.validateCsrf(auth, ctx.headers, ctx.cookies);
  const current = async () => !!await runtime.auth.accessFromSession(auth.session.id);
  if (!await current()) throw new VerificationError('VERIFICATION_SESSION_EXPIRED', 401);
  const [ , id, action] = match;
  const clientId = verificationClientId(ctx.body.clientInstanceId);
  if (!Number.isSafeInteger(ctx.body.challengeGeneration) || Number(ctx.body.challengeGeneration) < 1) throw new VerificationError('VERIFICATION_INPUT_INVALID', 422);
  const base = { adminId: auth.admin.id, authSessionId: auth.session.id, clientId, challengeGeneration: Number(ctx.body.challengeGeneration) };
  let data, claimFence: NativeVerificationControl | undefined;
  if (action === 'presentation') {
    const result = await runtime.coordinator.nativePresentation(id, base);
    data = { session: await runtime.dto(result.row), leaseId: result.leaseId };
  } else {
    if (typeof ctx.body.leaseId !== 'string' || ctx.body.leaseId.length > 100) throw new VerificationError('VERIFICATION_INPUT_INVALID', 422);
    const control = { ...base, leaseId: ctx.body.leaseId };
    if (action === 'claim') {
      if (!Number.isSafeInteger(ctx.body.expectedVersion)) throw new VerificationError('VERIFICATION_INPUT_INVALID', 422);
      const result = await runtime.coordinator.nativeClaim(id, { ...control, version: Number(ctx.body.expectedVersion) });
      claimFence = { ...control, controlEpoch: result.row.controlEpoch };
      data = { session: await runtime.dto(result.row), leaseId: result.leaseId, url: result.url, origin: result.origin };
    } else {
      if (!Number.isSafeInteger(ctx.body.controlEpoch)) throw new VerificationError('VERIFICATION_INPUT_INVALID', 422);
      const row = action === 'cancel'
        ? await runtime.coordinator.nativeCancel(id, { ...control, controlEpoch: Number(ctx.body.controlEpoch) })
        : await runtime.coordinator.nativeResult(id, { ...control, controlEpoch: Number(ctx.body.controlEpoch) }, ctx.body.candidate, current);
      data = { session: await runtime.dto(row) };
    }
  }
  await runtime.coordinator.snapshot(id, auth.admin.id);
  if (!await current()) throw new VerificationError('VERIFICATION_SESSION_EXPIRED', 401);
  if (claimFence) runtime.coordinator.assertNativeClaimCurrent(id, claimFence);
  return success(ctx, data);
}
