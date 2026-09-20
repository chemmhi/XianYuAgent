export type AdminStatus = 'active' | 'disabled';
export type AccountStatus = 'pending' | 'connected' | 'degraded' | 'disconnected' | 'expired' | 'disabled';
export type ScopeStatus = 'active' | 'revoked' | 'expired';
export type LoginSessionStatus = 'created' | 'waiting' | 'scanned' | 'succeeded' | 'expired' | 'failed' | 'cancelled' | 'verification_required';
export type CredentialStatus = 'active' | 'expired' | 'revoked';
export type ProductStatus = 'draft' | 'ready' | 'publishing' | 'published' | 'failed' | 'archived';
export type ProductSkuStatus = 'active' | 'archived';
export type ProductAssetStatus = 'active' | 'archived' | 'failed';
export type ProductSource = 'local' | 'xianyu';
export type CouponBatchStatus = 'draft' | 'active' | 'paused' | 'closed' | 'exhausted' | 'voided';
export type CouponDeliveryScope = 'system_only' | 'operator_only' | 'buyer_deliverable';
export type CouponItemStatus = 'available' | 'reserved' | 'consumed';
export type CouponBindingStatus = 'active' | 'inactive';
export type ConversationHandlingMode = 'ai' | 'human';
export type MessageDirection = 'inbound' | 'outbound';
export type MessageSenderRole = 'buyer' | 'agent' | 'system';
export type MessageBodyType = 'text' | 'image' | 'system';
export type MessageStatus = 'created';
export type MessageRedactionState = 'visible' | 'redacted';
export type ConversationEventType = 'chat.message.created' | 'chat.conversation.updated' | 'chat.connection.changed';

export interface CouponApiConfig {
  url: string;
  method: 'GET' | 'POST';
  timeout?: number;
  headers?: string;
  params?: string;
  responseField?: string;
}

export interface CouponBatchMetadata {
  description?: string;
  delaySeconds?: number;
  deliveryCount?: number;
  useNoLogisticsForm?: boolean;
  dockable?: boolean;
  price?: string;
  feePayer?: 'distributor' | 'dealer';
  minPrice?: string;
  dockVisibility?: 'public' | 'dealer_only';
  multiSpec?: boolean;
  specName?: string;
  specValue?: string;
  textContent?: string;
  dataContent?: string;
  apiConfig?: CouponApiConfig;
  imageUrls?: string[];
}

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

export interface CouponItemRecord {
  id: string;
  batchId: string;
  /** Internal plaintext representation for the memory store; never included in list/detail view models. */
  content: string;
  status: CouponItemStatus;
  reservedUntil?: string;
  consumedAt?: string;
  createdAt: string;
}

export interface CouponBindingRecord {
  id: string;
  batchId: string;
  productId: string;
  priority: number;
  status: CouponBindingStatus;
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CouponBatchRecord {
  id: string;
  accountId: string;
  label?: string;
  purpose: string;
  deliveryScope: CouponDeliveryScope;
  quarkUrl?: string;
  extractionCode?: string;
  totalCount: number;
  status: CouponBatchStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
  availableCount?: number;
  reservedCount?: number;
  consumedCount?: number;
  items?: CouponItemRecord[];
  bindings?: CouponBindingRecord[];
  metadata?: CouponBatchMetadata;
}

export interface CouponBatchListQuery {
  accountId?: string;
  keyword?: string;
  status?: CouponBatchStatus;
  stockAlert?: 'normal' | 'low_stock' | 'exhausted';
  purpose?: 'text' | 'data' | 'api' | 'image';
  page?: number;
  pageSize?: number;
}

export interface CouponBatchListResult {
  items: CouponBatchRecord[];
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

export interface ConversationRecord {
  id: string;
  accountId: string;
  externalConversationRef?: string;
  buyerRef: string;
  buyerDisplayName?: string;
  itemRef?: string;
  itemTitle?: string;
  unreadCount: number;
  lastMessagePreview?: string;
  lastMessageAt?: string;
  handlingMode: ConversationHandlingMode;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface MessageRecord {
  id: string;
  conversationId: string;
  accountId: string;
  direction: MessageDirection;
  senderRole: MessageSenderRole;
  bodyType: MessageBodyType;
  bodyText?: string;
  bodyRef?: string;
  redactionState: MessageRedactionState;
  status: MessageStatus;
  externalMessageRef?: string;
  source?: 'human' | 'ai' | 'system';
  orderRef?: string;
  productRef?: string;
  riskFlags: string[];
  handlingMode: ConversationHandlingMode;
  createdAt: string;
}

export interface ConversationEventRecord {
  eventId: string;
  conversationId: string;
  accountId: string;
  cursor: number;
  type: ConversationEventType;
  occurredAt: string;
  traceId: string;
  payload: Record<string, unknown>;
}

export interface ConversationListQuery {
  accountId?: string;
  cursor?: string;
  limit?: number;
}

export interface ConversationListResult {
  items: ConversationRecord[];
  nextCursor?: string;
  hasMore: boolean;
}

export interface MessageListQuery {
  cursor?: number;
  limit?: number;
}

export interface MessageListResult {
  items: MessageRecord[];
  nextCursor?: number;
  hasMore: boolean;
  latestCursor: number;
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
  listCouponBatches(adminId: string, query: CouponBatchListQuery): Promise<CouponBatchListResult>;
  getCouponBatch(adminId: string, batchId: string): Promise<CouponBatchRecord | undefined>;
  createCouponBatch(input: {
    adminId: string;
    accountId: string;
    label?: string;
    purpose: string;
    deliveryScope: CouponDeliveryScope;
    quarkUrl?: string;
    extractionCode?: string;
    metadata?: CouponBatchMetadata;
  }): Promise<CouponBatchRecord>;
  updateCouponBatch(input: { adminId: string; batchId: string; patch: { label?: string; purpose?: string; deliveryScope?: CouponDeliveryScope; quarkUrl?: string; extractionCode?: string; status?: CouponBatchStatus; metadata?: CouponBatchMetadata } }): Promise<CouponBatchRecord | undefined>;
  importCouponItems(input: { adminId: string; batchId: string; contents: string[] }): Promise<{ batch: CouponBatchRecord; items: CouponItemRecord[]; rejected: Array<{ index: number; code: string; message: string }> }>;
  bindCouponBatch(input: { adminId: string; batchId: string; productId: string }): Promise<CouponBindingRecord>;
  unbindCouponBatch(input: { adminId: string; batchId: string; productId: string }): Promise<CouponBindingRecord | undefined>;
  voidCouponBatch(input: { adminId: string; batchId: string }): Promise<CouponBatchRecord | undefined>;
  getCouponContent(adminId: string, itemId: string): Promise<{ batch: CouponBatchRecord; item: CouponItemRecord } | undefined>;
  listConversations(adminId: string, query: ConversationListQuery): Promise<ConversationListResult>;
  getConversation(adminId: string, conversationId: string): Promise<ConversationRecord | undefined>;
  listMessages(adminId: string, conversationId: string, query: MessageListQuery): Promise<MessageListResult>;
  listConversationEvents(adminId: string, conversationId: string, afterCursor: number, limit: number): Promise<ConversationEventRecord[]>;
  createConversation(input: { adminId: string; accountId: string; buyerRef: string; buyerDisplayName?: string; itemRef?: string; itemTitle?: string; externalConversationRef?: string }): Promise<ConversationRecord>;
  createMessage(input: { adminId: string; conversationId: string; direction: MessageDirection; senderRole: MessageSenderRole; bodyType: MessageBodyType; bodyText?: string; bodyRef?: string; externalMessageRef?: string; source?: MessageRecord['source']; orderRef?: string; productRef?: string; riskFlags?: string[]; traceId?: string }): Promise<{ message: MessageRecord; event: ConversationEventRecord }>;
}
