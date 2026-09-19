import type { AccountRecord, AccountScopeRecord, AdminRecord, AuditEventRecord, CredentialRecord, IdempotencyRecord, LoginSessionRecord, SessionRecord, Store } from './domain.js';
import { createId } from './security.js';

export class MemoryStore implements Store {
  readonly kind = 'memory' as const;
  private readonly admins = new Map<string, AdminRecord>();
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly accounts = new Map<string, AccountRecord>();
  private readonly loginSessions = new Map<string, LoginSessionRecord>();
  private readonly credentials = new Map<string, CredentialRecord>();
  private readonly scopes = new Map<string, AccountScopeRecord>();
  private readonly idempotency = new Map<string, IdempotencyRecord>();
  readonly audits: AuditEventRecord[] = [];

  async health(): Promise<{ kind: string; reachable: boolean }> { return { kind: this.kind, reachable: true }; }
  async countAdmins(): Promise<number> { return this.admins.size; }
  async findAdminById(id: string): Promise<AdminRecord | undefined> { return this.admins.get(id); }
  async findAdminByEmail(email: string): Promise<AdminRecord | undefined> { return [...this.admins.values()].find((admin) => admin.email === email.toLowerCase()); }
  async createAdmin(input: { email: string; passwordHash: string; displayName: string }): Promise<AdminRecord> {
    const now = new Date().toISOString();
    const admin: AdminRecord = { id: createId(), email: input.email.toLowerCase(), passwordHash: input.passwordHash, displayName: input.displayName, role: 'admin', status: 'active', createdAt: now };
    this.admins.set(admin.id, admin);
    return admin;
  }
  async touchAdminLogin(adminId: string): Promise<void> { const admin = this.admins.get(adminId); if (admin) admin.lastLoginAt = new Date().toISOString(); }
  async createSession(input: { adminId: string; csrfTokenHash: string; expiresAt: string }): Promise<SessionRecord> {
    const now = new Date().toISOString();
    const session: SessionRecord = { id: createId(), adminId: input.adminId, issuedAt: now, lastSeenAt: now, expiresAt: input.expiresAt, csrfTokenHash: input.csrfTokenHash };
    this.sessions.set(session.id, session);
    return session;
  }
  async findSession(id: string): Promise<SessionRecord | undefined> { return this.sessions.get(id); }
  async touchSession(id: string, lastSeenAt: string): Promise<void> { const session = this.sessions.get(id); if (session) session.lastSeenAt = lastSeenAt; }
  async rotateSessionCsrf(id: string, csrfTokenHash: string): Promise<void> { const session = this.sessions.get(id); if (session) session.csrfTokenHash = csrfTokenHash; }
  async revokeSession(id: string, reason: string): Promise<void> { const session = this.sessions.get(id); if (session) session.revokedAt = new Date().toISOString(); void reason; }
  async listScopes(adminId: string): Promise<AccountScopeRecord[]> { return [...this.scopes.values()].filter((scope) => scope.adminId === adminId && scope.status === 'active' && (!scope.expiresAt || Date.parse(scope.expiresAt) > Date.now())); }
  async hasAccountScope(adminId: string, accountId: string): Promise<boolean> { return (await this.listScopes(adminId)).some((scope) => scope.accountId === accountId); }
  async grantScope(input: { adminId: string; accountId: string; scope: string }): Promise<AccountScopeRecord> {
    const existing = [...this.scopes.values()].find((item) => item.adminId === input.adminId && item.accountId === input.accountId && item.scope === input.scope);
    if (existing) { existing.status = 'active'; existing.revokedAt = undefined; return existing; }
    const row: AccountScopeRecord = { id: createId(), adminId: input.adminId, accountId: input.accountId, scope: input.scope, status: 'active' };
    this.scopes.set(row.id, row);
    return row;
  }
  async revokeScope(adminId: string, accountId: string, scope: string): Promise<void> { const item = [...this.scopes.values()].find((row) => row.adminId === adminId && row.accountId === accountId && row.scope === scope); if (item) { item.status = 'revoked'; item.revokedAt = new Date().toISOString(); } }
  async listAccounts(adminId: string): Promise<AccountRecord[]> { const ids = new Set((await this.listScopes(adminId)).map((scope) => scope.accountId)); return [...this.accounts.values()].filter((account) => ids.has(account.id)); }
  async getAccount(adminId: string, accountId: string): Promise<AccountRecord | undefined> { if (!(await this.hasAccountScope(adminId, accountId))) return undefined; return this.accounts.get(accountId); }
  async createAccount(input: { platform: string; sellerRef: string; displayName?: string; adminId: string }): Promise<AccountRecord> {
    const duplicate = [...this.accounts.values()].find((account) => account.platform === input.platform && account.sellerRef === input.sellerRef);
    if (duplicate) throw new Error('ACCOUNT_DUPLICATE');
    const now = new Date().toISOString();
    const account: AccountRecord = { id: createId(), platform: input.platform, sellerRef: input.sellerRef, displayName: input.displayName, status: 'pending', createdAt: now, updatedAt: now };
    this.accounts.set(account.id, account);
    await this.grantScope({ adminId: input.adminId, accountId: account.id, scope: 'manage' });
    return account;
  }
  async updateAccount(adminId: string, accountId: string, patch: { sellerRef?: string; displayName?: string; remark?: string; avatarUrl?: string; platformUserId?: string; status?: AccountRecord['status']; lastConnectedAt?: string }): Promise<AccountRecord | undefined> { const account = await this.getAccount(adminId, accountId); if (!account) return undefined; if (patch.sellerRef !== undefined) account.sellerRef = patch.sellerRef; if (patch.displayName !== undefined) account.displayName = patch.displayName; if (patch.remark !== undefined) account.remark = patch.remark; if (patch.avatarUrl !== undefined) account.avatarUrl = patch.avatarUrl; if (patch.platformUserId !== undefined) account.platformUserId = patch.platformUserId; if (patch.status !== undefined) account.status = patch.status; if (patch.lastConnectedAt !== undefined) account.lastConnectedAt = patch.lastConnectedAt; account.updatedAt = new Date().toISOString(); return account; }
  async createLoginSession(input: { adminId: string; accountId?: string; provisionalAccountRef?: string; loginMethod: string; expiresAt: string; qrTokenRef?: string }): Promise<LoginSessionRecord> {
    if (input.accountId && !(await this.hasAccountScope(input.adminId, input.accountId))) throw new Error('ACCOUNT_SCOPE_FORBIDDEN');
    const now = new Date().toISOString();
    const session: LoginSessionRecord = { id: createId(), adminId: input.adminId, accountId: input.accountId, provisionalAccountRef: input.provisionalAccountRef, loginMethod: input.loginMethod, status: 'waiting', startedAt: now, expiresAt: input.expiresAt, qrTokenRef: input.qrTokenRef };
    this.loginSessions.set(session.id, session);
    return session;
  }
  async getLoginSession(adminId: string, accountId: string, sessionId: string): Promise<LoginSessionRecord | undefined> {
    if (!(await this.hasAccountScope(adminId, accountId))) return undefined;
    const session = this.loginSessions.get(sessionId);
    if (!session || session.accountId !== accountId) return undefined;
    if (session.status === 'waiting' && Date.parse(session.expiresAt) <= Date.now()) session.status = 'expired';
    return session;
  }
  async getLoginSessionById(adminId: string, sessionId: string): Promise<LoginSessionRecord | undefined> {
    const session = this.loginSessions.get(sessionId);
    if (!session || (session.adminId !== adminId && (!session.accountId || !(await this.hasAccountScope(adminId, session.accountId))))) return undefined;
    if (session.status === 'waiting' && Date.parse(session.expiresAt) <= Date.now()) session.status = 'expired';
    return session;
  }
  async updateLoginSession(adminId: string, accountId: string | undefined, sessionId: string, patch: { accountId?: string; status?: LoginSessionRecord['status']; expiresAt?: string; completedAt?: string; failureCode?: string }): Promise<LoginSessionRecord | undefined> {
    const session = accountId ? await this.getLoginSession(adminId, accountId, sessionId) : await this.getLoginSessionById(adminId, sessionId);
    if (!session) return undefined;
    Object.assign(session, patch);
    return session;
  }
  async getCredential(adminId: string, accountId: string): Promise<CredentialRecord | undefined> {
    if (!(await this.hasAccountScope(adminId, accountId))) return undefined;
    const credential = this.credentials.get(accountId);
    if (!credential) return undefined;
    if (credential.status === 'active' && credential.expiresAt && Date.parse(credential.expiresAt) <= Date.now()) {
      credential.status = 'expired';
      const account = this.accounts.get(accountId);
      if (account && account.status === 'connected') { account.status = 'expired'; account.updatedAt = new Date().toISOString(); }
    }
    return credential;
  }
  async upsertCredential(input: { adminId: string; accountId: string; platform: string; cookieHeader?: string; accessToken?: string; deviceId?: string; metadata?: Record<string, string>; expiresAt?: string }): Promise<CredentialRecord> {
    if (!(await this.hasAccountScope(input.adminId, input.accountId))) throw new Error('ACCOUNT_SCOPE_FORBIDDEN');
    const now = new Date().toISOString();
    const existing = this.credentials.get(input.accountId);
    const credential: CredentialRecord = existing
      ? Object.assign(existing, {
          platform: input.platform,
          status: 'active' as const,
          cookieHeader: input.cookieHeader,
          accessToken: input.accessToken,
          deviceId: input.deviceId,
          metadata: input.metadata ?? {},
          expiresAt: input.expiresAt,
          updatedAt: now,
        })
      : {
          id: createId(), accountId: input.accountId, platform: input.platform, status: 'active',
          cookieHeader: input.cookieHeader, accessToken: input.accessToken, deviceId: input.deviceId,
          metadata: input.metadata ?? {}, expiresAt: input.expiresAt, createdAt: now, updatedAt: now,
        };
    this.credentials.set(input.accountId, credential);
    return credential;
  }
  async revokeCredential(adminId: string, accountId: string): Promise<CredentialRecord | undefined> {
    const credential = await this.getCredential(adminId, accountId);
    if (!credential) return undefined;
    credential.status = 'revoked';
    credential.updatedAt = new Date().toISOString();
    return credential;
  }
  async markCredentialVerified(input: { adminId: string; accountId: string; status: CredentialRecord['status']; expiresAt?: string }): Promise<CredentialRecord | undefined> {
    const credential = await this.getCredential(input.adminId, input.accountId);
    if (!credential) return undefined;
    credential.status = input.status;
    credential.expiresAt = input.expiresAt ?? credential.expiresAt;
    credential.lastVerifiedAt = new Date().toISOString();
    credential.updatedAt = credential.lastVerifiedAt;
    return credential;
  }
  async getIdempotency(scope: string, key: string): Promise<IdempotencyRecord | undefined> { const row = this.idempotency.get(`${scope}:${key}`); if (row && Date.parse(row.expiresAt) <= Date.now()) { this.idempotency.delete(`${scope}:${key}`); return undefined; } return row; }
  async beginIdempotency(record: IdempotencyRecord): Promise<void> { this.idempotency.set(`${record.scope}:${record.key}`, record); }
  async abortIdempotency(scope: string, key: string): Promise<void> { this.idempotency.delete(`${scope}:${key}`); }
  async completeIdempotency(input: { scope: string; key: string; status: IdempotencyRecord['status']; responseEnvelope: unknown; statusCode: number; traceId: string }): Promise<void> { const row = this.idempotency.get(`${input.scope}:${input.key}`); if (row) Object.assign(row, input); }
  async recordAudit(event: AuditEventRecord): Promise<void> { this.audits.push(event); }
}
