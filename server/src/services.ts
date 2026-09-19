import type { AppConfig } from './config.js';
import type { AccountRecord, AccountScopeRecord, AdminRecord, AuditEventRecord, IdempotencyRecord, SessionRecord, Store } from './domain.js';
import { createId, createToken, digestJson, hashPassword, isSessionFresh, sha256, verifyPassword } from './security.js';

export interface AuthContext {
  admin: AdminRecord;
  session: SessionRecord;
  csrfToken: string;
  scopes: AccountScopeRecord[];
}

export class AuthService {
  constructor(private readonly store: Store, private readonly config: AppConfig) {}

  async bootstrap(input: { email: string; password: string; displayName: string; requestId?: string; traceId?: string }): Promise<{ admin: AdminRecord; session: SessionRecord; csrfToken: string; auditRef: string }> {
    if (await this.store.countAdmins() > 0) throw new ServiceError(409, 'CONFLICT', 'bootstrap_already_completed', { reason: 'bootstrap_already_completed' });
    const admin = await this.store.createAdmin({ email: input.email, passwordHash: await hashPassword(input.password), displayName: input.displayName });
    const session = await this.createSession(admin.id);
    const auditRef = await this.audit({ actorType: 'admin', actorId: admin.id, action: 'auth.bootstrap.completed', requestId: input.requestId ?? 'bootstrap', traceId: input.traceId ?? 'bootstrap', payload: { email: admin.email } });
    return { admin, session, csrfToken: this.sessionTokens.get(session.id)!, auditRef };
  }

  async login(input: { email: string; password: string }): Promise<{ admin: AdminRecord; session: SessionRecord; csrfToken: string }> {
    const admin = await this.store.findAdminByEmail(input.email);
    if (!admin || !(await verifyPassword(input.password, admin.passwordHash)) || admin.status !== 'active') throw new ServiceError(401, 'UNAUTHENTICATED', 'invalid_credentials');
    await this.store.touchAdminLogin(admin.id);
    const session = await this.createSession(admin.id);
    return { admin, session, csrfToken: this.sessionTokens.get(session.id)! };
  }

  async contextFromSession(sessionId: string | undefined): Promise<AuthContext | undefined> {
    if (!sessionId) return undefined;
    const session = await this.store.findSession(sessionId);
    if (!session || session.revokedAt || !isSessionFresh(session, this.config.sessionIdleMs, this.config.sessionAbsoluteMs)) return undefined;
    const admin = await this.findAdminById(session.adminId);
    if (!admin || admin.status !== 'active') return undefined;
    await this.store.touchSession(session.id, new Date().toISOString());
    let csrfToken = this.sessionTokens.get(session.id);
    if (!csrfToken) { csrfToken = createToken(); await this.store.rotateSessionCsrf(session.id, sha256(csrfToken)); }
    this.sessionTokens.set(session.id, csrfToken);
    return { admin, session, csrfToken, scopes: await this.store.listScopes(admin.id) };
  }

  async validateCsrf(context: AuthContext, headers: Record<string, string | undefined>, cookies: Record<string, string>): Promise<void> {
    const suppliedHeader = headers['x-csrf-token'];
    const suppliedCookie = cookies.csrf_token;
    if (!suppliedHeader || !suppliedCookie || suppliedHeader !== suppliedCookie || sha256(suppliedHeader) !== context.session.csrfTokenHash) throw new ServiceError(403, 'CSRF_INVALID', 'csrf token invalid');
  }

  async logout(context: AuthContext): Promise<void> { await this.store.revokeSession(context.session.id, 'logout'); this.sessionTokens.delete(context.session.id); }

  async sessionView(context: AuthContext): Promise<{ admin: { id: string; email: string; displayName: string; role: string }; scopes: AccountScopeRecord[] }> {
    return { admin: { id: context.admin.id, email: context.admin.email, displayName: context.admin.displayName, role: context.admin.role }, scopes: context.scopes };
  }

  async getBootstrapRequired(): Promise<boolean> { return (await this.store.countAdmins()) === 0; }
  getCsrfToken(sessionId: string): string | undefined { return this.sessionTokens.get(sessionId); }

  private readonly sessionTokens = new Map<string, string>();
  private async createSession(adminId: string): Promise<SessionRecord> { const csrfToken = createToken(); const issuedAt = Date.now(); const session = await this.store.createSession({ adminId, csrfTokenHash: sha256(csrfToken), expiresAt: new Date(issuedAt + this.config.sessionAbsoluteMs).toISOString() }); this.sessionTokens.set(session.id, csrfToken); return session; }
  private async findAdminById(adminId: string): Promise<AdminRecord> { const admin = await this.store.findAdminById(adminId); if (!admin) throw new ServiceError(401, 'UNAUTHENTICATED', 'session admin not found'); return admin; }
  private async audit(input: { actorType: string; actorId?: string; action: string; targetRef?: string; requestId: string; traceId: string; payload: unknown; accountId?: string; reason?: string }): Promise<string> { const id = createId(); const event: AuditEventRecord = { id, actorType: input.actorType, actorId: input.actorId, action: input.action, targetRef: input.targetRef, requestId: input.requestId, traceId: input.traceId, payloadDigest: digestJson(input.payload), accountId: input.accountId, reason: input.reason, createdAt: new Date().toISOString() }; await this.store.recordAudit(event); return id; }
}

export class AccountService {
  constructor(private readonly store: Store, private readonly audit: (input: { actorId: string; action: string; targetRef?: string; requestId: string; traceId: string; payload: unknown; accountId?: string }) => Promise<string>) {}
  async list(adminId: string): Promise<AccountRecord[]> { return this.store.listAccounts(adminId); }
  async get(adminId: string, accountId: string): Promise<AccountRecord> { const account = await this.store.getAccount(adminId, accountId); if (!account) throw new ServiceError(404, 'NOT_FOUND', 'account not found'); return account; }
  async create(input: { adminId: string; platform: string; sellerRef: string; displayName?: string; requestId: string; traceId: string }): Promise<AccountRecord> { if (!input.platform || !input.sellerRef) throw new ServiceError(422, 'VALIDATION_FAILED', 'platform and sellerRef are required'); try { const account = await this.store.createAccount(input); await this.audit({ actorId: input.adminId, action: 'account.created', targetRef: account.id, requestId: input.requestId, traceId: input.traceId, payload: { platform: account.platform, sellerRef: account.sellerRef }, accountId: account.id }); return account; } catch (error) { if (error instanceof Error && error.message === 'ACCOUNT_DUPLICATE') throw new ServiceError(409, 'CONFLICT', 'account already exists'); const code = (error as { code?: string }).code; if (code === '23505') throw new ServiceError(409, 'CONFLICT', 'account already exists'); throw error; } }
  async update(input: { adminId: string; accountId: string; patch: { displayName?: string; status?: AccountRecord['status'] }; requestId: string; traceId: string }): Promise<AccountRecord> { const account = await this.store.updateAccount(input.adminId, input.accountId, input.patch); if (!account) throw new ServiceError(404, 'NOT_FOUND', 'account not found'); await this.audit({ actorId: input.adminId, action: 'account.updated', targetRef: account.id, requestId: input.requestId, traceId: input.traceId, payload: input.patch, accountId: account.id }); return account; }
  async scopes(adminId: string, accountId: string): Promise<AccountScopeRecord[]> { if (!(await this.store.hasAccountScope(adminId, accountId))) throw new ServiceError(404, 'NOT_FOUND', 'account not found'); return this.store.listScopes(adminId).then((items) => items.filter((item) => item.accountId === accountId)); }
  async grantScope(input: { adminId: string; accountId: string; scope: string; requestId: string; traceId: string }): Promise<AccountScopeRecord> { await this.get(input.adminId, input.accountId); const row = await this.store.grantScope(input); await this.audit({ actorId: input.adminId, action: 'account.scope.granted', targetRef: row.id, requestId: input.requestId, traceId: input.traceId, payload: { scope: input.scope }, accountId: input.accountId }); return row; }
  async revokeScope(input: { adminId: string; accountId: string; scope: string; requestId: string; traceId: string }): Promise<void> { await this.get(input.adminId, input.accountId); await this.store.revokeScope(input.adminId, input.accountId, input.scope); await this.audit({ actorId: input.adminId, action: 'account.scope.revoked', requestId: input.requestId, traceId: input.traceId, payload: { scope: input.scope }, accountId: input.accountId }); }
}

export class ServiceError extends Error {
  constructor(readonly statusCode: number, readonly code: string, message: string, readonly details?: unknown) { super(message); }
}

export async function idempotent<T>(store: Store, input: { scope: string; key: string; fingerprint: string; traceId: string; handler: () => Promise<{ statusCode: number; body: unknown }> }): Promise<{ statusCode: number; body: unknown; replayed: boolean }> {
  const existing = await store.getIdempotency(input.scope, input.key);
  if (existing) {
    if (existing.requestFingerprint !== input.fingerprint) throw new ServiceError(409, 'IDEMPOTENCY_CONFLICT', 'idempotency key reused with a different request');
    if (existing.status === 'processing') throw new ServiceError(202, 'IDEMPOTENCY_IN_PROGRESS', 'request is already processing');
    return { statusCode: existing.statusCode ?? 200, body: existing.responseEnvelope, replayed: true };
  }
  const record: IdempotencyRecord = { scope: input.scope, key: input.key, requestFingerprint: input.fingerprint, status: 'processing', expiresAt: new Date(Date.now() + 30 * 24 * 3_600_000).toISOString() };
  await store.beginIdempotency(record);
  const result = await input.handler();
  await store.completeIdempotency({ scope: input.scope, key: input.key, status: result.statusCode >= 400 ? 'failed' : 'succeeded', responseEnvelope: result.body, statusCode: result.statusCode, traceId: input.traceId });
  return { ...result, replayed: false };
}
