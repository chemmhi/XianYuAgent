export type AdminStatus = 'active' | 'disabled';
export type AccountStatus = 'pending' | 'connected' | 'degraded' | 'disconnected' | 'expired' | 'disabled';
export type ScopeStatus = 'active' | 'revoked' | 'expired';
export type LoginSessionStatus = 'created' | 'waiting' | 'scanned' | 'succeeded' | 'expired' | 'failed' | 'cancelled' | 'verification_required';
export type CredentialStatus = 'active' | 'expired' | 'revoked';
export type ProductStatus = 'draft' | 'ready' | 'publishing' | 'published' | 'failed' | 'archived';
export type ProductSkuStatus = 'active' | 'archived';
export type ProductAssetStatus = 'active' | 'archived' | 'failed';
export type ProductSource = 'local' | 'xianyu';

export interface ProductSkuRecord {
  id: string;
  productId: string;
  skuCode: string;
  externalSkuRef?: string;
  priceMinor: number;
  status: ProductSkuStatus;
}

export interface ProductAssetRecord {
  id: string;
  productId: string;
  storageKey: string;
  mimeType: string;
  checksum?: string;
  status: ProductAssetStatus;
}

export interface ProductRecord {
  id: string;
  accountId: string;
  externalProductRef?: string;
  title: string;
  description?: string;
  categoryCode?: string;
  attributes: Record<string, unknown>;
  defaultReplyTemplate?: string;
  aiPrompt?: string;
  configVersion: number;
  priceMinor?: number;
  status: ProductStatus;
  source: ProductSource;
  lastSyncedAt?: string;
  sourcePayloadDigest?: string;
  createdAt: string;
  updatedAt: string;
  skuCount?: number;
  assetCount?: number;
  skus?: ProductSkuRecord[];
  assets?: ProductAssetRecord[];
}

export interface XianyuProductItem {
  externalProductRef: string;
  title: string;
  description?: string;
  categoryCode?: string;
  priceMinor?: number;
  externalStatus?: string;
  detailUrl?: string;
  imageUrls: string[];
  attributes: Record<string, unknown>;
  sourcePayloadDigest: string;
}

export interface ProductSyncPageResult {
  items: XianyuProductItem[];
  pageNumber: number;
  pageSize: number;
  totalCount?: number;
  totalPages?: number;
  hasMore: boolean;
}

export interface ProductSyncResult {
  syncRunId: string;
  accountId: string;
  pageNumber: number;
  pageSize: number;
  pagesFetched: number;
  fetchedCount: number;
  createdCount: number;
  updatedCount: number;
  skippedLocalDraftCount: number;
  items: ProductRecord[];
  hasMore: boolean;
  nextPageNumber?: number;
}

export interface ProductUpsertResult {
  action: 'created' | 'updated' | 'skipped_local_draft';
  product: ProductRecord;
}

export interface ProductListQuery {
  keyword?: string;
  accountId?: string;
  status?: ProductStatus;
  sortBy?: 'createdAt' | 'updatedAt' | 'title' | 'priceMinor';
  sortOrder?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export interface ProductListResult {
  items: ProductRecord[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ProductPatch {
  title?: string;
  description?: string | null;
  categoryCode?: string | null;
  attributes?: Record<string, unknown>;
  defaultReplyTemplate?: string | null;
  aiPrompt?: string | null;
  priceMinor?: number | null;
}

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
  remark?: string;
  avatarUrl?: string;
  platformUserId?: string;
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
  adminId?: string;
  accountId?: string;
  provisionalAccountRef?: string;
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
  updateAccount(adminId: string, accountId: string, patch: { sellerRef?: string; displayName?: string; remark?: string; avatarUrl?: string; platformUserId?: string; status?: AccountStatus; lastConnectedAt?: string }): Promise<AccountRecord | undefined>;
  deleteAccount(adminId: string, accountId: string): Promise<AccountRecord | undefined>;
  createLoginSession(input: { adminId: string; accountId?: string; provisionalAccountRef?: string; loginMethod: string; expiresAt: string; qrTokenRef?: string }): Promise<LoginSessionRecord>;
  getLoginSession(adminId: string, accountId: string, sessionId: string): Promise<LoginSessionRecord | undefined>;
  getLoginSessionById(adminId: string, sessionId: string): Promise<LoginSessionRecord | undefined>;
  updateLoginSession(adminId: string, accountId: string | undefined, sessionId: string, patch: { accountId?: string; status?: LoginSessionStatus; expiresAt?: string; completedAt?: string; failureCode?: string }): Promise<LoginSessionRecord | undefined>;
  getCredential(adminId: string, accountId: string): Promise<CredentialRecord | undefined>;
  upsertCredential(input: { adminId: string; accountId: string; platform: string; cookieHeader?: string; accessToken?: string; deviceId?: string; metadata?: Record<string, string>; expiresAt?: string }): Promise<CredentialRecord>;
  revokeCredential(adminId: string, accountId: string): Promise<CredentialRecord | undefined>;
  markCredentialVerified(input: { adminId: string; accountId: string; status: CredentialStatus; expiresAt?: string }): Promise<CredentialRecord | undefined>;
  getIdempotency(scope: string, key: string): Promise<IdempotencyRecord | undefined>;
  beginIdempotency(record: IdempotencyRecord): Promise<void>;
  abortIdempotency(scope: string, key: string): Promise<void>;
  completeIdempotency(input: { scope: string; key: string; status: IdempotencyRecord['status']; responseEnvelope: unknown; statusCode: number; traceId: string }): Promise<void>;
  recordAudit(event: AuditEventRecord): Promise<void>;
  listProducts(adminId: string, query: ProductListQuery): Promise<ProductListResult>;
  getProduct(adminId: string, productId: string): Promise<ProductRecord | undefined>;
  createProduct(input: {
    adminId: string;
    accountId: string;
    externalProductRef?: string;
    title: string;
    description?: string;
    categoryCode?: string;
    attributes?: Record<string, unknown>;
    defaultReplyTemplate?: string;
    aiPrompt?: string;
    priceMinor?: number;
    status?: ProductStatus;
  }): Promise<ProductRecord>;
  updateProduct(input: { adminId: string; productId: string; expectedConfigVersion: number; patch: ProductPatch }): Promise<ProductRecord | undefined>;
  upsertExternalProduct(input: { adminId: string; accountId: string; item: XianyuProductItem; syncedAt: string }): Promise<ProductUpsertResult>;
}
