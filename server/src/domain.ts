export type AdminStatus = 'active' | 'disabled';
export type AccountStatus = 'pending' | 'connected' | 'degraded' | 'disconnected' | 'expired' | 'disabled';
export type ScopeStatus = 'active' | 'revoked' | 'expired';

export interface AdminRecord {
  id: string;
  email: string;
  passwordHash: string;
  displayName: string;
  role: string;
  status: AdminStatus;
  createdAt: string;
  lastLoginAt?: string;
}

export interface SessionRecord {
  id: string;
  adminId: string;
  issuedAt: string;
  lastSeenAt: string;
  expiresAt: string;
  csrfTokenHash: string;
  revokedAt?: string;
}

export interface AccountRecord {
  id: string;
  platform: string;
  sellerRef: string;
  displayName?: string;
  status: AccountStatus;
  createdAt: string;
  updatedAt: string;
  lastConnectedAt?: string;
}

export interface AccountScopeRecord {
  id: string;
  adminId: string;
  accountId: string;
  scope: string;
  status: ScopeStatus;
  expiresAt?: string;
  revokedAt?: string;
}

export interface IdempotencyRecord {
  scope: string;
  key: string;
  requestFingerprint: string;
  status: 'processing' | 'succeeded' | 'failed';
  responseEnvelope?: unknown;
  statusCode?: number;
  traceId?: string;
  expiresAt: string;
}

export interface AuditEventRecord {
  id: string;
  actorType: string;
  actorId?: string;
  action: string;
  targetRef?: string;
  requestId: string;
  traceId: string;
  payloadDigest: string;
  accountId?: string;
  reason?: string;
  createdAt: string;
}

export interface Store {
  kind: 'memory' | 'postgres';
  health(): Promise<{ kind: string; reachable: boolean }>;
  countAdmins(): Promise<number>;
  findAdminById(id: string): Promise<AdminRecord | undefined>;
  findAdminByEmail(email: string): Promise<AdminRecord | undefined>;
  createAdmin(input: { email: string; passwordHash: string; displayName: string }): Promise<AdminRecord>;
  touchAdminLogin(adminId: string): Promise<void>;
  createSession(input: { adminId: string; csrfTokenHash: string; expiresAt: string }): Promise<SessionRecord>;
  findSession(id: string): Promise<SessionRecord | undefined>;
  touchSession(id: string, lastSeenAt: string): Promise<void>;
  rotateSessionCsrf(id: string, csrfTokenHash: string): Promise<void>;
  revokeSession(id: string, reason: string): Promise<void>;
  listScopes(adminId: string): Promise<AccountScopeRecord[]>;
  hasAccountScope(adminId: string, accountId: string): Promise<boolean>;
  grantScope(input: { adminId: string; accountId: string; scope: string }): Promise<AccountScopeRecord>;
  revokeScope(adminId: string, accountId: string, scope: string): Promise<void>;
  listAccounts(adminId: string): Promise<AccountRecord[]>;
  getAccount(adminId: string, accountId: string): Promise<AccountRecord | undefined>;
  createAccount(input: { platform: string; sellerRef: string; displayName?: string; adminId: string }): Promise<AccountRecord>;
  updateAccount(adminId: string, accountId: string, patch: { displayName?: string; status?: AccountStatus }): Promise<AccountRecord | undefined>;
  getIdempotency(scope: string, key: string): Promise<IdempotencyRecord | undefined>;
  beginIdempotency(record: IdempotencyRecord): Promise<void>;
  abortIdempotency(scope: string, key: string): Promise<void>;
  completeIdempotency(input: { scope: string; key: string; status: IdempotencyRecord['status']; responseEnvelope: unknown; statusCode: number; traceId: string }): Promise<void>;
  recordAudit(event: AuditEventRecord): Promise<void>;
}
