export type AdminStatus = 'active' | 'disabled';
export type AccountStatus = 'pending' | 'connected' | 'degraded' | 'disconnected' | 'expired' | 'disabled';
export type ScopeStatus = 'active' | 'revoked' | 'expired';
export type LoginSessionStatus = 'created' | 'waiting' | 'scanned' | 'succeeded' | 'expired' | 'failed' | 'cancelled' | 'verification_required';
export type CredentialStatus = 'active' | 'expired' | 'revoked';

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

export interface LoginSessionRecord {
  id: string;
  accountId: string;
  loginMethod: string;
  status: LoginSessionStatus;
  startedAt: string;
  expiresAt: string;
  completedAt?: string;
  failureCode?: string;
  qrTokenRef?: string;
}

export interface CredentialRecord {
  id: string;
  accountId: string;
  platform: string;
  status: CredentialStatus;
  cookieHeader?: string;
  accessToken?: string;
  deviceId?: string;
  metadata: Record<string, string>;
  expiresAt?: string;
  lastVerifiedAt?: string;
  createdAt: string;
  updatedAt: string;
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
  updateAccount(adminId: string, accountId: string, patch: { displayName?: string; status?: AccountStatus; lastConnectedAt?: string }): Promise<AccountRecord | undefined>;
  createLoginSession(input: { adminId: string; accountId: string; loginMethod: string; expiresAt: string; qrTokenRef?: string }): Promise<LoginSessionRecord>;
  getLoginSession(adminId: string, accountId: string, sessionId: string): Promise<LoginSessionRecord | undefined>;
  getLoginSessionById(adminId: string, sessionId: string): Promise<LoginSessionRecord | undefined>;
  updateLoginSession(adminId: string, accountId: string, sessionId: string, patch: { status?: LoginSessionStatus; expiresAt?: string; completedAt?: string; failureCode?: string }): Promise<LoginSessionRecord | undefined>;
  getCredential(adminId: string, accountId: string): Promise<CredentialRecord | undefined>;
  upsertCredential(input: { adminId: string; accountId: string; platform: string; cookieHeader?: string; accessToken?: string; deviceId?: string; metadata?: Record<string, string>; expiresAt?: string }): Promise<CredentialRecord>;
  revokeCredential(adminId: string, accountId: string): Promise<CredentialRecord | undefined>;
  markCredentialVerified(input: { adminId: string; accountId: string; status: CredentialStatus; expiresAt?: string }): Promise<CredentialRecord | undefined>;
  getIdempotency(scope: string, key: string): Promise<IdempotencyRecord | undefined>;
  beginIdempotency(record: IdempotencyRecord): Promise<void>;
  abortIdempotency(scope: string, key: string): Promise<void>;
  completeIdempotency(input: { scope: string; key: string; status: IdempotencyRecord['status']; responseEnvelope: unknown; statusCode: number; traceId: string }): Promise<void>;
  recordAudit(event: AuditEventRecord): Promise<void>;
}
