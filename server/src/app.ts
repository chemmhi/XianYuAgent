import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { loadConfig, type AppConfig } from './config.js';
import type { AuthContext } from './services.js';
import { AccountService, AuthService, CredentialService, ServiceError, idempotent } from './services.js';
import { createIds, failure, fingerprint, parseCookies, readJson, setCookie, success, writeJson, type RequestContext } from './http.js';
import { createStore } from './store.js';
import type { Store } from './domain.js';
import { createId, digestJson } from './security.js';
import { XianyuQrLoginAdapter, type XianyuQrPublicSession } from './xianyu-qr-login.js';
import { XianyuMtopClient } from './xianyu-mtop.js';

export interface AppRuntime {
  config: AppConfig;
  store: Store;
  auth: AuthService;
  accounts: AccountService;
  credentials: CredentialService;
  qrLogin: XianyuQrLoginAdapter;
  xianyu: XianyuMtopClient;
  server: Server;
  listen(): Promise<void>;
  close(): Promise<void>;
}

export function createApp(config: AppConfig = loadConfig()): AppRuntime {
  const store = createStore(config);
  const auth = new AuthService(store, config);
  const accounts = new AccountService(store, async (input) => {
    const auditId = createId();
    await store.recordAudit({ id: auditId, actorType: 'admin', actorId: input.actorId, action: input.action, targetRef: input.targetRef, requestId: input.requestId, traceId: input.traceId, payloadDigest: digestJson(input.payload), accountId: input.accountId, createdAt: new Date().toISOString() });
    return auditId;
  });
  const credentials = new CredentialService(store, async (input) => {
    const auditId = createId();
    await store.recordAudit({ id: auditId, actorType: 'admin', actorId: input.actorId, action: input.action, targetRef: input.targetRef, requestId: input.requestId, traceId: input.traceId, payloadDigest: digestJson(input.payload), accountId: input.accountId, createdAt: new Date().toISOString() });
    return auditId;
  });
  let xianyu: XianyuMtopClient;
  const qrLogin = new XianyuQrLoginAdapter({
    onStatus: async (status) => {
      const localStatus = mapQrStatusToLoginStatus(status.status);
      if (!localStatus) return;
      try {
        const current = await accounts.getLoginSessionById({ adminId: status.adminId, sessionId: status.sessionId });
        if (current.status === 'succeeded' && localStatus !== 'succeeded') return;
        await accounts.updateLoginSession({ adminId: status.adminId, accountId: status.accountId, sessionId: status.sessionId, patch: { status: localStatus, failureCode: status.errorCode, completedAt: ['succeeded', 'expired', 'failed', 'cancelled'].includes(localStatus) ? new Date().toISOString() : undefined }, requestId: `qr:${status.sessionId}`, traceId: `qr:${status.sessionId}` });
      } catch { /* QR 状态回写失败不影响外部轮询；下一次 GET 会重试 */ }
    },
    onSuccess: async ({ sessionId, adminId, accountId, cookieHeader, unb }) => {
      const account = await accounts.get(adminId, accountId);
      if (account.sellerRef && account.sellerRef !== unb) {
        await accounts.updateLoginSession({ adminId, accountId, sessionId, patch: { status: 'failed', failureCode: 'QR_ACCOUNT_MISMATCH', completedAt: new Date().toISOString() }, requestId: `qr:${sessionId}`, traceId: `qr:${sessionId}` });
        throw new Error('QR_ACCOUNT_MISMATCH');
      }
      await credentials.save({ adminId, accountId, cookieHeader, metadata: { unb, loginMethod: 'qr_http' }, requestId: `qr:${sessionId}`, traceId: `qr:${sessionId}` });
      const verification = await xianyu.verifyLogin(adminId, accountId);
      if (!verification.success) {
        const status = verification.accountInvalid ? (verification.errorCode === 'SESSION_EXPIRED' ? 'expired' : 'revoked') : 'expired';
        try { await credentials.verify({ adminId, accountId, status, requestId: `qr:${sessionId}`, traceId: `qr:${sessionId}` }); } catch { /* preserve original verification error */ }
        await accounts.updateLoginSession({ adminId, accountId, sessionId, patch: { status: 'failed', failureCode: verification.errorCode ?? 'LOGIN_STATE_VERIFY_FAILED', completedAt: new Date().toISOString() }, requestId: `qr:${sessionId}`, traceId: `qr:${sessionId}` });
        throw new Error(verification.errorCode ?? 'LOGIN_STATE_VERIFY_FAILED');
      }
      await credentials.verify({ adminId, accountId, status: 'active', requestId: `qr:${sessionId}`, traceId: `qr:${sessionId}` });
      await accounts.updateLoginSession({ adminId, accountId, sessionId, patch: { status: 'succeeded', completedAt: new Date().toISOString(), failureCode: undefined }, requestId: `qr:${sessionId}`, traceId: `qr:${sessionId}` });
    },
  });
  xianyu = new XianyuMtopClient({
    loadCredential: async (adminId, accountId) => store.getCredential(adminId, accountId),
    saveCookie: async (adminId, accountId, cookieHeader) => {
      const account = await store.getAccount(adminId, accountId);
      if (!account) return;
      await credentials.save({ adminId, accountId, cookieHeader, requestId: 'xianyu-mtop', traceId: 'xianyu-mtop' });
    },
  });

  const runtime: AppRuntime = {
    config, store, auth, accounts, credentials, qrLogin, xianyu,
    server: createServer((request, response) => { void handleRequest(runtime, request, response); }),
    async listen() { await new Promise<void>((resolve) => runtime.server.listen(config.port, config.host, resolve)); },
    async close() { await new Promise<void>((resolve, reject) => runtime.server.close((error) => error ? reject(error) : resolve())); const close = (store as Store & { close?: () => Promise<void> }).close; if (close) await close.call(store); },
  };
  return runtime;
}

async function handleRequest(runtime: AppRuntime, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const method = (request.method ?? 'GET').toUpperCase();
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  const ids = createIds();
  const ctx: RequestContext = { requestId: ids.requestId, traceId: ids.traceId, method, path: url.pathname, query: Object.fromEntries(url.searchParams.entries()), body: {}, headers: Object.fromEntries(Object.entries(request.headers).map(([key, value]) => [key.toLowerCase(), Array.isArray(value) ? value[0] : value])), cookies: parseCookies(request.headers.cookie) };
  try {
    if (method === 'OPTIONS') { response.statusCode = 204; response.end(); return; }
    if (method !== 'GET' && method !== 'HEAD') ctx.body = await readJson(request);
    const result = await dispatch(runtime, ctx, response);
    if (result) writeJson(response, result.statusCode, result.body);
  } catch (error) {
    const serviceError = error instanceof ServiceError ? error : undefined;
    const mapped = serviceError ?? new ServiceError(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : 'internal error');
    const body = failure(ctx, mapped.statusCode, mapped.code, mapped.message, mapped.details);
    writeJson(response, body.statusCode, body.body);
  }
}

async function dispatch(runtime: AppRuntime, ctx: RequestContext, response: ServerResponse): Promise<{ statusCode: number; body: unknown } | undefined> {
  const { auth, accounts, credentials, store, config } = runtime;
  if (ctx.path === '/healthz' && ctx.method === 'GET') {
    const health = await store.health();
    const body = success(ctx, { status: health.reachable ? 'ok' : 'degraded', services: { api: 'ok', database: health.reachable ? 'ok' : 'unavailable', redis: config.redisUrl ? 'configured' : 'not_configured' } });
    return { statusCode: health.reachable ? 200 : 503, body: body.body };
  }
  if (ctx.path === '/readyz' && ctx.method === 'GET') {
    const health = await store.health();
    const body = success(ctx, { ready: health.reachable, database: health.reachable ? 'ok' : 'unavailable' });
    return { statusCode: health.reachable ? 200 : 503, body: body.body };
  }
  if (ctx.path === '/api/v1/auth/session' && ctx.method === 'GET') {
    const authContext = await auth.contextFromSession(ctx.cookies.session_id);
    if (!authContext) return { statusCode: 200, body: success(ctx, { authenticated: false, bootstrapRequired: await auth.getBootstrapRequired() }).body };
    setSessionCookies(response, authContext.csrfToken, authContext.session.id, config.cookieSecure);
    return { statusCode: 200, body: success(ctx, { authenticated: true, bootstrapRequired: false, session: { id: authContext.session.id, expiresAt: authContext.session.expiresAt }, ...(await auth.sessionView(authContext)) }).body };
  }
  if (ctx.path === '/api/v1/auth/bootstrap' && ctx.method === 'POST') {
    const key = requireIdempotencyKey(ctx);
    const result = await idempotent(store, { scope: 'bootstrap:/api/v1/auth/bootstrap', key, fingerprint: fingerprint(ctx.method, ctx.path, ctx.body), traceId: ctx.traceId, handler: async () => {
      const input = { email: String(ctx.body.email ?? ''), password: String(ctx.body.password ?? ''), displayName: String(ctx.body.displayName ?? '') };
      if (!input.email || !input.password || !input.displayName || input.password.length < 8) throw new ServiceError(422, 'VALIDATION_FAILED', 'email, displayName and password (min 8 chars) are required');
      const result = await auth.bootstrap({ ...input, requestId: ctx.requestId, traceId: ctx.traceId });
      setSessionCookies(response, result.csrfToken, result.session.id, config.cookieSecure);
      return success(ctx, { session: { id: result.session.id, expiresAt: result.session.expiresAt }, profile: { id: result.admin.id, email: result.admin.email, displayName: result.admin.displayName, role: result.admin.role }, auditRef: result.auditRef });
    } });
    if (result.replayed) {
      const sessionId = (result.body as { data?: { session?: { id?: string } } })?.data?.session?.id;
      const csrfToken = sessionId ? auth.getCsrfToken(sessionId) : undefined;
      if (sessionId && csrfToken) setSessionCookies(response, csrfToken, sessionId, config.cookieSecure);
    }
    return { statusCode: result.statusCode, body: result.body };
  }
  if (ctx.path === '/api/v1/auth/password-login' && ctx.method === 'POST') {
    const result = await auth.login({ email: String(ctx.body.email ?? ''), password: String(ctx.body.password ?? '') });
    setSessionCookies(response, result.csrfToken, result.session.id, config.cookieSecure);
    return { statusCode: 200, body: success(ctx, { session: { id: result.session.id, expiresAt: result.session.expiresAt }, profile: { id: result.admin.id, email: result.admin.email, displayName: result.admin.displayName, role: result.admin.role } }).body };
  }

  const authContext = await requireAuth(auth, ctx);
  if (ctx.method !== 'GET' && ctx.path !== '/api/v1/auth/logout') await auth.validateCsrf(authContext, ctx.headers, ctx.cookies);
  if (ctx.path === '/api/v1/auth/logout' && ctx.method === 'POST') {
    await auth.validateCsrf(authContext, ctx.headers, ctx.cookies);
    await auth.logout(authContext);
    setCookie(response, 'session_id', '', { httpOnly: true, secure: config.cookieSecure, maxAge: 0 });
    setCookie(response, 'csrf_token', '', { secure: config.cookieSecure, maxAge: 0 });
    return { statusCode: 200, body: success(ctx, { loggedOut: true }).body };
  }

  const loginSessionMatch = ctx.path.match(/^\/api\/v1\/accounts\/([^/]+)\/login-sessions(?:\/([^/]+)(?:\/(cancel|renew|complete))?)?$/);
  if (ctx.path === '/api/v1/auth/qr-sessions' && ctx.method === 'POST') {
    const accountId = String(ctx.body.accountId ?? '');
    if (!accountId) throw new ServiceError(422, 'VALIDATION_FAILED', 'accountId is required');
    const result = await mutation(runtime, ctx, authContext, accountId, async () => {
      const loginSession = await accounts.createLoginSession({ adminId: authContext.admin.id, accountId, loginMethod: 'qr', requestId: ctx.requestId, traceId: ctx.traceId });
      if (config.xianyuQrMode === 'stub') return success(ctx, toQrSessionView(loginSession), 201);
      try {
        const qrSession = await runtime.qrLogin.create({ sessionId: loginSession.id, adminId: authContext.admin.id, accountId });
        return success(ctx, { ...toQrSessionView(loginSession), qrImageDataUrl: qrSession.qrImageDataUrl, pollAfterMs: qrSession.pollAfterMs, expiresAt: qrSession.expiresAt, status: qrSession.status, errorCode: qrSession.errorCode, verificationUrl: qrSession.verificationUrl }, 201);
      } catch (error) {
        await accounts.updateLoginSession({ adminId: authContext.admin.id, accountId, sessionId: loginSession.id, patch: { status: 'failed', failureCode: error instanceof Error ? error.message : 'QR_GENERATE_FAILED', completedAt: new Date().toISOString() }, requestId: ctx.requestId, traceId: ctx.traceId });
        throw new ServiceError(502, 'QR_GENERATE_FAILED', 'unable to generate xianyu qr session');
      }
    });
    return result;
  }
  if (ctx.path.startsWith('/api/v1/auth/qr-sessions/') && ctx.method === 'GET') {
    const sessionId = decodeURIComponent(ctx.path.split('/').pop() ?? '');
    const local = await accounts.getLoginSessionById({ adminId: authContext.admin.id, sessionId });
    const external = runtime.qrLogin.get(sessionId);
    const terminal = ['succeeded', 'cancelled', 'failed', 'expired'].includes(local.status);
    return { statusCode: 200, body: success(ctx, external ? { ...toQrSessionView(local), qrImageDataUrl: external.qrImageDataUrl, pollAfterMs: external.pollAfterMs, expiresAt: external.expiresAt, status: terminal ? local.status : external.status, errorCode: terminal ? local.failureCode : external.errorCode, verificationUrl: external.verificationUrl } : toQrSessionView(local)).body };
  }

  const credentialMatch = ctx.path.match(/^\/api\/v1\/accounts\/([^/]+)\/credential(?:\/(verify|revoke))?$/);
  if (credentialMatch) {
    const accountId = decodeURIComponent(credentialMatch[1]);
    const action = credentialMatch[2];
    if (!action && ctx.method === 'GET') return { statusCode: 200, body: success(ctx, await credentials.get(authContext.admin.id, accountId)).body };
    if (!action && (ctx.method === 'PUT' || ctx.method === 'POST')) {
      const result = await mutation(runtime, ctx, authContext, accountId, async () => {
        const credential = await credentials.save({
          adminId: authContext.admin.id,
          accountId,
          cookieHeader: typeof ctx.body.cookieHeader === 'string' ? ctx.body.cookieHeader : undefined,
          accessToken: typeof ctx.body.accessToken === 'string' ? ctx.body.accessToken : undefined,
          deviceId: typeof ctx.body.deviceId === 'string' ? ctx.body.deviceId : undefined,
          metadata: readCredentialMetadata(ctx.body.metadata),
          expiresAt: typeof ctx.body.expiresAt === 'string' ? ctx.body.expiresAt : undefined,
          requestId: ctx.requestId,
          traceId: ctx.traceId,
        });
        return success(ctx, credentialMutationView(credential));
      });
      return result;
    }
    if (action === 'revoke' && (ctx.method === 'POST' || ctx.method === 'DELETE')) return mutation(runtime, ctx, authContext, accountId, async () => success(ctx, credentialMutationView(await credentials.revoke({ adminId: authContext.admin.id, accountId, requestId: ctx.requestId, traceId: ctx.traceId }))));
    if (action === 'verify' && ctx.method === 'POST') return mutation(runtime, ctx, authContext, accountId, async () => success(ctx, credentialMutationView(await credentials.verify({ adminId: authContext.admin.id, accountId, status: (typeof ctx.body.status === 'string' ? ctx.body.status : 'active') as never, expiresAt: typeof ctx.body.expiresAt === 'string' ? ctx.body.expiresAt : undefined, requestId: ctx.requestId, traceId: ctx.traceId }))));
  }
  if (loginSessionMatch) {
    const accountId = decodeURIComponent(loginSessionMatch[1]);
    const sessionId = loginSessionMatch[2] ? decodeURIComponent(loginSessionMatch[2]) : undefined;
    if (!sessionId && ctx.method === 'POST') {
      const result = await mutation(runtime, ctx, authContext, accountId, async () => {
        const loginMethod = String(ctx.body.loginMethod ?? 'qr');
        const loginSession = await accounts.createLoginSession({ adminId: authContext.admin.id, accountId, loginMethod, requestId: ctx.requestId, traceId: ctx.traceId });
        if (loginMethod !== 'qr' || config.xianyuQrMode === 'stub') return success(ctx, loginSession, 201);
        try {
          const qrSession = await runtime.qrLogin.create({ sessionId: loginSession.id, adminId: authContext.admin.id, accountId });
          return success(ctx, { ...toQrSessionView(loginSession), qrImageDataUrl: qrSession.qrImageDataUrl, pollAfterMs: qrSession.pollAfterMs, expiresAt: qrSession.expiresAt, status: qrSession.status, errorCode: qrSession.errorCode, verificationUrl: qrSession.verificationUrl }, 201);
        } catch (error) {
          await accounts.updateLoginSession({ adminId: authContext.admin.id, accountId, sessionId: loginSession.id, patch: { status: 'failed', failureCode: error instanceof Error ? error.message : 'QR_GENERATE_FAILED', completedAt: new Date().toISOString() }, requestId: ctx.requestId, traceId: ctx.traceId });
          throw new ServiceError(502, 'QR_GENERATE_FAILED', 'unable to generate xianyu qr session');
        }
      });
      return result;
    }
    if (sessionId && ctx.method === 'GET') {
      const local = await accounts.getLoginSession({ adminId: authContext.admin.id, accountId, sessionId });
      const external = runtime.qrLogin.get(sessionId);
      const terminal = ['succeeded', 'cancelled', 'failed', 'expired'].includes(local.status);
      return { statusCode: 200, body: success(ctx, external ? { ...toQrSessionView(local), qrImageDataUrl: external.qrImageDataUrl, pollAfterMs: external.pollAfterMs, expiresAt: external.expiresAt, status: terminal ? local.status : external.status, errorCode: terminal ? local.failureCode : external.errorCode, verificationUrl: external.verificationUrl } : local).body };
    }
    if (sessionId && loginSessionMatch[3] === 'cancel' && ctx.method === 'POST') return mutation(runtime, ctx, authContext, accountId, async () => { runtime.qrLogin.cancel(sessionId); return success(ctx, await accounts.updateLoginSession({ adminId: authContext.admin.id, accountId, sessionId, patch: { status: 'cancelled', completedAt: new Date().toISOString() }, requestId: ctx.requestId, traceId: ctx.traceId })); });
    if (sessionId && loginSessionMatch[3] === 'renew' && ctx.method === 'POST') return mutation(runtime, ctx, authContext, accountId, async () => {
      const renewed = await accounts.updateLoginSession({ adminId: authContext.admin.id, accountId, sessionId, patch: { status: 'waiting', expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(), failureCode: undefined }, requestId: ctx.requestId, traceId: ctx.traceId });
      if (config.xianyuQrMode === 'stub') return success(ctx, renewed);
      const qrSession = await runtime.qrLogin.create({ sessionId, adminId: authContext.admin.id, accountId });
      return success(ctx, { ...toQrSessionView(renewed), qrImageDataUrl: qrSession.qrImageDataUrl, pollAfterMs: qrSession.pollAfterMs, expiresAt: qrSession.expiresAt, status: qrSession.status, errorCode: qrSession.errorCode, verificationUrl: qrSession.verificationUrl });
    });
    if (sessionId && loginSessionMatch[3] === 'complete' && ctx.method === 'POST') return mutation(runtime, ctx, authContext, accountId, async () => {
      const result = await credentials.completeLoginSession({
        adminId: authContext.admin.id,
        accountId,
        sessionId,
        cookieHeader: typeof ctx.body.cookieHeader === 'string' ? ctx.body.cookieHeader : undefined,
        accessToken: typeof ctx.body.accessToken === 'string' ? ctx.body.accessToken : undefined,
        deviceId: typeof ctx.body.deviceId === 'string' ? ctx.body.deviceId : undefined,
        metadata: readCredentialMetadata(ctx.body.metadata),
        expiresAt: typeof ctx.body.expiresAt === 'string' ? ctx.body.expiresAt : undefined,
        requestId: ctx.requestId,
        traceId: ctx.traceId,
      });
      return success(ctx, { session: result.session, credential: credentialMutationView(result.credential) });
    });
  }

  const accountMatch = ctx.path.match(/^\/api\/v1\/accounts\/([^/]+)(?:\/(scopes|connection|connection\/verify))?$/);
  if (ctx.path === '/api/v1/accounts' && ctx.method === 'GET') return { statusCode: 200, body: success(ctx, { items: await accounts.list(authContext.admin.id) }).body };
  if (ctx.path === '/api/v1/accounts' && ctx.method === 'POST') {
    const result = await mutation(runtime, ctx, authContext, undefined, async () => {
      const account = await accounts.create({ adminId: authContext.admin.id, platform: String(ctx.body.platform ?? ''), sellerRef: String(ctx.body.sellerRef ?? ''), displayName: typeof ctx.body.displayName === 'string' ? ctx.body.displayName : undefined, requestId: ctx.requestId, traceId: ctx.traceId });
      return success(ctx, account, 201);
    });
    return result;
  }
  if (accountMatch) {
    const accountId = decodeURIComponent(accountMatch[1]);
    if (!accountMatch[2] && ctx.method === 'GET') return { statusCode: 200, body: success(ctx, await accounts.get(authContext.admin.id, accountId)).body };
    if (!accountMatch[2] && ctx.method === 'PATCH') return mutation(runtime, ctx, authContext, accountId, async () => success(ctx, await accounts.update({ adminId: authContext.admin.id, accountId, patch: { displayName: typeof ctx.body.displayName === 'string' ? ctx.body.displayName : undefined, status: typeof ctx.body.status === 'string' ? ctx.body.status as never : undefined }, requestId: ctx.requestId, traceId: ctx.traceId })));
    if (accountMatch[2] === 'connection' && ctx.method === 'GET') {
      const account = await accounts.get(authContext.admin.id, accountId);
      return { statusCode: 200, body: success(ctx, connectionView(account)).body };
    }
    if (accountMatch[2] === 'connection/verify' && ctx.method === 'POST') {
      const result = await mutation(runtime, ctx, authContext, accountId, async () => {
        const verification = await runtime.xianyu.verifyLogin(authContext.admin.id, accountId);
        if (verification.success) {
          await credentials.verify({ adminId: authContext.admin.id, accountId, status: 'active', requestId: ctx.requestId, traceId: ctx.traceId });
        } else if (verification.accountInvalid) {
          const status = verification.errorCode === 'SESSION_EXPIRED' ? 'expired' : 'revoked';
          try { await credentials.verify({ adminId: authContext.admin.id, accountId, status, requestId: ctx.requestId, traceId: ctx.traceId }); } catch { /* missing credential remains a verification failure */ }
        }
        return success(ctx, { success: verification.success, accountInvalid: verification.accountInvalid, errorCode: verification.errorCode, message: verification.message, response: verification.response });
      });
      return result;
    }
    if (accountMatch[2] && ctx.method === 'GET') return { statusCode: 200, body: success(ctx, { items: await accounts.scopes(authContext.admin.id, accountId) }).body };
    if (accountMatch[2] && ctx.method === 'POST') return mutation(runtime, ctx, authContext, accountId, async () => success(ctx, await accounts.grantScope({ adminId: authContext.admin.id, accountId, scope: String(ctx.body.scope ?? 'read'), requestId: ctx.requestId, traceId: ctx.traceId }), 201));
    if (accountMatch[2] && ctx.method === 'DELETE') return mutation(runtime, ctx, authContext, accountId, async () => { await accounts.revokeScope({ adminId: authContext.admin.id, accountId, scope: String(ctx.body.scope ?? 'manage'), requestId: ctx.requestId, traceId: ctx.traceId }); return success(ctx, { revoked: true }); });
  }

  return { statusCode: 404, body: failure(ctx, 404, 'NOT_FOUND', 'route not found').body };
}

async function requireAuth(auth: AuthService, ctx: RequestContext): Promise<AuthContext> { const context = await auth.contextFromSession(ctx.cookies.session_id); if (!context) throw new ServiceError(401, 'UNAUTHENTICATED', 'session required'); return context; }
function requireIdempotencyKey(ctx: RequestContext): string { const key = ctx.headers['idempotency-key']; if (!key) throw new ServiceError(400, 'VALIDATION_FAILED', 'Idempotency-Key header is required'); return key; }
async function mutation(runtime: AppRuntime, ctx: RequestContext, authContext: AuthContext, accountId: string | undefined, handler: () => Promise<{ statusCode: number; body: unknown }>): Promise<{ statusCode: number; body: unknown }> {
  const key = requireIdempotencyKey(ctx);
  const scope = `${authContext.admin.id}:${accountId ?? 'global'}:${ctx.method}:${ctx.path}`;
  const result = await idempotent(runtime.store, { scope, key, fingerprint: fingerprint(ctx.method, ctx.path, ctx.body), traceId: ctx.traceId, handler });
  return { statusCode: result.statusCode, body: result.body };
}
function setSessionCookies(response: ServerResponse, csrfToken: string, sessionId: string, secure: boolean): void { setCookie(response, 'session_id', sessionId, { httpOnly: true, secure }); setCookie(response, 'csrf_token', csrfToken, { secure }); }

function connectionView(account: { status: string; lastConnectedAt?: string }) {
  const status = account.status === 'connected'
    ? 'online'
    : account.status === 'pending'
      ? 'connecting'
      : account.status === 'expired'
        ? 'expired'
        : account.status === 'degraded'
          ? 'unknown'
          : 'offline';
  return {
    status,
    lastConnectedAt: account.lastConnectedAt,
    failureCode: account.status === 'degraded' ? 'ADAPTER_UNKNOWN' : undefined,
    failureMessage: account.status === 'degraded' ? '外部闲鱼连接结果未知，需要人工复核。' : undefined,
  };
}

function toQrSessionView(session: { id: string; accountId: string; status: string; expiresAt: string; failureCode?: string }) {
  // Keep the historical login-session `id` field while exposing the
  // canonical QR-specific alias used by the new auth entry point.
  return { id: session.id, qrSessionId: session.id, accountId: session.accountId, status: session.status, expiresAt: session.expiresAt, pollAfterMs: 1500, errorCode: session.failureCode };
}

function readCredentialMetadata(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([, item]) => typeof item === 'string').map(([key, item]) => [key, String(item)]));
}

function mapQrStatusToLoginStatus(status: string): 'waiting' | 'scanned' | 'succeeded' | 'expired' | 'failed' | 'cancelled' | 'verification_required' | undefined {
  if (['waiting', 'scanned', 'succeeded', 'expired', 'failed', 'cancelled', 'verification_required'].includes(status)) return status as 'waiting' | 'scanned' | 'succeeded' | 'expired' | 'failed' | 'cancelled' | 'verification_required';
  return undefined;
}

function credentialMutationView(credential: { id: string; accountId: string; platform: string; status: string; cookieHeader?: string; accessToken?: string; deviceId?: string; metadata: Record<string, string>; expiresAt?: string; lastVerifiedAt?: string; createdAt: string; updatedAt: string }) {
  return {
    id: credential.id,
    accountId: credential.accountId,
    platform: credential.platform,
    status: credential.status,
    fields: { cookieHeader: Boolean(credential.cookieHeader), accessToken: Boolean(credential.accessToken), deviceId: Boolean(credential.deviceId), metadataKeys: Object.keys(credential.metadata) },
    expiresAt: credential.expiresAt,
    lastVerifiedAt: credential.lastVerifiedAt,
    createdAt: credential.createdAt,
    updatedAt: credential.updatedAt,
  };
}
