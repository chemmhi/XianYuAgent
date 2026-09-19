import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { loadConfig, type AppConfig } from './config.js';
import type { AuthContext } from './services.js';
import { AccountService, AuthService, ServiceError, idempotent } from './services.js';
import { createIds, failure, fingerprint, parseCookies, readJson, setCookie, success, writeJson, type RequestContext } from './http.js';
import { createStore } from './store.js';
import type { Store } from './domain.js';
import { createId, digestJson } from './security.js';

export interface AppRuntime {
  config: AppConfig;
  store: Store;
  auth: AuthService;
  accounts: AccountService;
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

  const runtime: AppRuntime = {
    config, store, auth, accounts,
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
  const ctx: RequestContext = { requestId: ids.requestId, traceId: ids.traceId, method, path: url.pathname, body: {}, headers: Object.fromEntries(Object.entries(request.headers).map(([key, value]) => [key.toLowerCase(), Array.isArray(value) ? value[0] : value])), cookies: parseCookies(request.headers.cookie) };
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
  const { auth, accounts, store, config } = runtime;
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

  const accountMatch = ctx.path.match(/^\/api\/v1\/accounts\/([^/]+)(?:\/(scopes|connection))?$/);
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
