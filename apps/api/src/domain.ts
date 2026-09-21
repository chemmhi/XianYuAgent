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
export type MessageReadStatus = 0 | 2;
export type MessageRedactionState = 'visible' | 'redacted';
export type ConversationEventType = 'chat.message.created' | 'chat.message.updated' | 'chat.conversation.updated' | 'chat.connection.changed';

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

export interface ProductCouponBatchSummary {
  id: string;
  label?: string;
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
  couponBatches?: ProductCouponBatchSummary[];
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

export type PaymentStatus = 'unpaid' | 'paid' | 'closed' | 'unknown';
export type OrderStatus = 'open' | 'cancelling' | 'cancelled' | 'completed' | 'closed' | 'failed';
export type DeliveryStatus = 'pending' | 'reserving' | 'delivered' | 'partially_delivered' | 'failed' | 'cancelled';
export type AfterSalesStatus = 'none' | 'requested' | 'refunding' | 'refunded' | 'rejected' | 'closed';
export type OrderDeliveryType = 'manual' | 'no_logistics' | 'coupon_only' | 'mixed';
export type OrderSource = 'local' | 'xianyu';

export interface OrderRecord {
  id: string;
  orderNo: string;
  accountId: string;
  accountName?: string;
  buyerId: string;
  buyerName: string;
  buyerNickname?: string;
  buyerAvatarUrl?: string;
  itemId: string;
  itemTitle: string;
  itemImageUrl?: string;
  amountMinor: number;
  paymentStatus: PaymentStatus;
  orderStatus: OrderStatus;
  deliveryStatus: DeliveryStatus;
  afterSalesStatus: AfterSalesStatus;
  deliveryType: OrderDeliveryType;
  createdAt: string;
  updatedAt: string;
  deliveryFailReason?: string;
  conversationId?: string;
  productId?: string;
  configVersion: number;
  source: OrderSource;
  sourcePayloadDigest?: string;
}

export interface XianyuOrderItem {
  orderNo: string;
  buyerId: string;
  buyerName: string;
  buyerNickname?: string;
  buyerAvatarUrl?: string;
  itemId: string;
  itemTitle: string;
  itemImageUrl?: string;
  amountMinor: number;
  paymentStatus: PaymentStatus;
  orderStatus: OrderStatus;
  deliveryStatus: DeliveryStatus;
  afterSalesStatus: AfterSalesStatus;
  deliveryType: OrderDeliveryType;
  createdAt: string;
  updatedAt?: string;
  deliveryFailReason?: string;
  conversationId?: string;
  productId?: string;
  sourcePayloadDigest: string;
}

export interface OrderListQuery {
  accountId?: string;
  keyword?: string;
  paymentStatus?: PaymentStatus;
  orderStatus?: OrderStatus;
  deliveryStatus?: DeliveryStatus;
  afterSalesStatus?: AfterSalesStatus;
  sortBy?: 'createdAt' | 'amountMinor';
  sortOrder?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export interface OrderListResult {
  items: OrderRecord[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface OrderUpsertResult {
  action: 'created' | 'updated';
  order: OrderRecord;
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

export interface AccountListQuery {
  search?: string;
  status?: AccountStatus;
  connectionStatus?: 'online' | 'offline' | 'connecting' | 'expired' | 'unknown';
  page?: number;
  pageSize?: number;
}

export interface AccountListResult {
  items: AccountRecord[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
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
  buyerAvatarUrl?: string;
  itemRef?: string;
  itemTitle?: string;
  itemImageUrl?: string;
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
  readStatus: MessageReadStatus;
  readAt?: string;
  externalMessageRef?: string;
  source?: 'human' | 'ai' | 'system';
  orderRef?: string;
  productRef?: string;
  riskFlags: string[];
  handlingMode: ConversationHandlingMode;
  createdAt: string;
}

export type AutoReplyDecision = 'replied' | 'handoff' | 'skipped' | 'failed';
export type AutoReplyRunStatus = 'received' | 'classified' | 'context_loaded' | 'generated' | 'simulated' | 'persisted' | 'handoff' | 'skipped' | 'failed';
export type AutoReplyRunStage = 'gateway_received' | 'intent_recognition' | 'context_read' | 'reply_generation' | 'sending' | 'persisted' | 'handoff' | 'skipped' | 'failed';

/**
 * Persisted, redacted evidence for one automatic-reply attempt.
 * Raw buyer text and prompt/context bodies are intentionally not stored here.
 */
export interface AutoReplyRunRecord {
  id: string;
  adminId: string;
  accountId: string;
  conversationId: string;
  inboundMessageId: string;
  intent: string;
  decision: AutoReplyDecision;
  status: AutoReplyRunStatus;
  riskFlags: string[];
  productId?: string;
  orderRefs: string[];
  inputDigest: string;
  contextDigest?: string;
  replyDigest?: string;
  senderOutcome?: 'simulated' | 'known_success' | 'known_failure' | 'unknown';
  outboundMessageId?: string;
  failureCode?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AutoReplyRunEventRecord {
  id: string;
  runId: string;
  accountId: string;
  sequence: number;
  eventType: string;
  stage: AutoReplyRunStage;
  status: AutoReplyRunStatus;
  occurredAt: string;
  durationMs?: number;
  traceId?: string;
  payload: Record<string, unknown>;
}

export interface AutoReplyRunListQuery {
  accountId?: string;
  from?: string;
  to?: string;
  status?: AutoReplyRunStatus;
  stage?: AutoReplyRunStage;
  keyword?: string;
  page?: number;
  pageSize?: number;
}

export interface AutoReplyRunListItem extends AutoReplyRunRecord {
  stage: AutoReplyRunStage;
  durationMs: number;
  buyerDisplayName?: string;
  productTitle?: string;
  inboundMessagePreview?: string;
}

export interface AutoReplyRunListResult {
  items: AutoReplyRunListItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface AutoReplyRunDetailRecord {
  run: AutoReplyRunListItem;
  events: AutoReplyRunEventRecord[];
  conversation?: ConversationRecord;
  inboundMessage?: MessageRecord;
  outboundMessages: MessageRecord[];
  product?: ProductRecord;
}

export interface AutoReplyActivitySummary {
  from: string;
  to: string;
  asOf: string;
  inboundCount: number;
  processingCount: number;
  persistedCount: number;
  handoffCount: number;
  failedCount: number;
  skippedCount: number;
  completionRate: number;
  throughputPerSecond: number;
  p95DurationMs: number;
  byStatus: Array<{ status: AutoReplyRunStatus; count: number }>;
  byStage: Array<{ stage: AutoReplyRunStage; count: number; averageDurationMs: number }>;
  exceptions: Array<{ code: string; count: number; status: AutoReplyRunStatus }>;
  health: Array<{ component: string; status: string; observedAt: string; details: Record<string, unknown> }>;
}

export function autoReplyStageForStatus(status: AutoReplyRunStatus): AutoReplyRunStage {
  switch (status) {
    case 'received': return 'gateway_received';
    case 'classified': return 'intent_recognition';
    case 'context_loaded': return 'context_read';
    case 'generated': return 'reply_generation';
    case 'simulated': return 'sending';
    case 'persisted': return 'persisted';
    case 'handoff': return 'handoff';
    case 'skipped': return 'skipped';
    case 'failed': return 'failed';
  }
}

/**
 * Admin-configurable buyer-facing Auto Reply Agent settings.
 * This type is intentionally separate from Workspace Agent settings.
 */
export type AutoReplyAgentSendMode = 'simulate' | 'live';

export interface AutoReplyAgentConfig {
  enabled: boolean;
  systemPrompt: string;
  userPromptTemplate: string;
  maxLoops: number;
  maxToolCalls: number;
  toolTimeoutMs: number;
  totalTimeoutMs: number;
  maxHistory: number;
  maxReplyLength: number;
  replySegmentDelayMs: number;
  debounceMs: number;
  sendMode: AutoReplyAgentSendMode;
}

export interface AutoReplyAgentConfigRecord extends AutoReplyAgentConfig {
  accountId: string;
  updatedByAdminId?: string;
  configVersion: number;
  configDigest: string;
  createdAt: string;
  updatedAt: string;
}

export type AutoReplyAgentConfigPatch = Partial<AutoReplyAgentConfig>;

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
  /** Opaque cursor used to load messages older than the current timeline. */
  beforeCursor?: string;
  limit?: number;
}

export interface MessageListResult {
  items: MessageRecord[];
  nextCursor?: number;
  hasMore: boolean;
  latestCursor: number;
  hasMoreHistory: boolean;
  historyCursor?: string;
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

export type CredentialRefStatus = 'active' | 'disabled' | 'rotating' | 'revoked';

/** Redacted credential reference returned to Settings and other admin surfaces. */
export interface CredentialRefRecord {
  id: string;
  accountId: string;
  kind: 'api_key';
  purpose: 'model_client';
  label?: string;
  status: CredentialRefStatus;
  version: number;
  provider: string;
  alias: string;
  fingerprint: string;
  metadata: Record<string, string>;
  lastRotatedAt?: string;
  createdAt: string;
  updatedAt: string;
  canReveal: false;
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

export type AgentSessionStatus = 'active' | 'archived';
export type RunStatus = 'queued' | 'running' | 'waiting_confirmation' | 'executing' | 'retrying' | 'cancelling' | 'succeeded' | 'partially_succeeded' | 'failed' | 'cancelled' | 'expired';
export type StepStatus = 'pending' | 'running' | 'waiting_confirmation' | 'executing' | 'retrying' | 'succeeded' | 'partially_succeeded' | 'failed' | 'skipped' | 'cancelled';
export type StepKind = 'plan' | 'tool_call' | 'policy_check' | 'mutation' | 'observation';
export type ExternalOutcome = 'known_success' | 'known_failure' | 'unknown';
export type WorkspaceMessageType = 'user_message' | 'reasoning_summary' | 'tool_event' | 'final_answer';

export interface AgentSessionRecord {
  id: string;
  accountId: string;
  title: string;
  status: AgentSessionStatus;
  summary?: string;
  lastActiveAt: string;
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RunRecord {
  id: string;
  accountId: string;
  sessionId: string;
  route: string;
  instruction: string;
  status: RunStatus;
  requestedBy: string;
  clientRunRef?: string;
  resultSummary?: string;
  errorCode?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface StepRecord {
  id: string;
  runId: string;
  stepNo: number;
  kind: StepKind;
  label: string;
  status: StepStatus;
  attempt: number;
  inputSummary?: string;
  outputSummary?: string;
  errorCode?: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface RunEventRecord {
  sequence: number;
  runId: string;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface WorkspaceMessageRecord {
  id: string;
  sessionId: string;
  runId?: string;
  type: WorkspaceMessageType;
  content: string;
  summary?: string;
  createdAt: string;
  sequence: number;
}

export interface Store {
  kind: 'memory' | 'postgres';
  health(): Promise<{ kind: string; reachable: boolean }>;
  countAdmins(): Promise<number>;
  listAdminIds(): Promise<string[]>;
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
  listAccounts(adminId: string, query?: AccountListQuery): Promise<AccountListResult>;
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
  listCredentialRefs(adminId: string, accountId: string): Promise<CredentialRefRecord[]>;
  getCredentialRef(adminId: string, credentialId: string): Promise<CredentialRefRecord | undefined>;
  createCredentialRef(input: { adminId: string; accountId: string; provider: string; alias: string; label?: string; secretCiphertext: string; fingerprint: string; metadata?: Record<string, string> }): Promise<CredentialRefRecord>;
  updateCredentialRef(input: { adminId: string; credentialId: string; expectedVersion: number; provider?: string; alias?: string; label?: string; metadata?: Record<string, string> }): Promise<CredentialRefRecord | undefined>;
  rotateCredentialRef(input: { adminId: string; credentialId: string; expectedVersion: number; secretCiphertext: string; fingerprint: string }): Promise<CredentialRefRecord | undefined>;
  updateCredentialRefStatus(input: { adminId: string; credentialId: string; expectedVersion: number; status: CredentialRefStatus }): Promise<CredentialRefRecord | undefined>;
  getAutoReplyAgentConfig(adminId: string, accountId: string): Promise<AutoReplyAgentConfigRecord | undefined>;
  upsertAutoReplyAgentConfig(input: { adminId: string; accountId: string; expectedVersion: number; patch: AutoReplyAgentConfigPatch; config: AutoReplyAgentConfig; configDigest: string }): Promise<AutoReplyAgentConfigRecord | undefined>;
  getIdempotency(scope: string, key: string): Promise<IdempotencyRecord | undefined>;
  beginIdempotency(record: IdempotencyRecord): Promise<void>;
  abortIdempotency(scope: string, key: string): Promise<void>;
  completeIdempotency(input: { scope: string; key: string; status: IdempotencyRecord['status']; responseEnvelope: unknown; statusCode: number; traceId: string }): Promise<void>;
  recordAudit(event: AuditEventRecord): Promise<void>;
  listAgentSessions(adminId: string, query?: { accountId?: string; search?: string }): Promise<AgentSessionRecord[]>;
  createAgentSession(input: { adminId: string; accountId: string; title: string; summary?: string }): Promise<AgentSessionRecord>;
  getAgentSession(adminId: string, sessionId: string): Promise<AgentSessionRecord | undefined>;
  archiveAgentSession(adminId: string, sessionId: string): Promise<AgentSessionRecord | undefined>;
  createRun(input: { adminId: string; accountId: string; sessionId: string; instruction: string; clientRunRef?: string; route?: string }): Promise<{ run: RunRecord; steps: StepRecord[] }>;
  findRunByClientRef(adminId: string, accountId: string, clientRunRef: string): Promise<{ run: RunRecord; steps: StepRecord[] } | undefined>;
  getRun(adminId: string, runId: string): Promise<{ run: RunRecord; steps: StepRecord[] } | undefined>;
  updateRun(runId: string, patch: { status?: RunStatus; resultSummary?: string; errorCode?: string; startedAt?: string; finishedAt?: string }): Promise<RunRecord | undefined>;
  updateRunStep(stepId: string, patch: { status?: StepStatus; inputSummary?: string; outputSummary?: string; errorCode?: string; startedAt?: string; finishedAt?: string }): Promise<StepRecord | undefined>;
  appendRunEvent(input: { runId: string; eventType: string; payload: Record<string, unknown> }): Promise<RunEventRecord>;
  listRunEvents(adminId: string, runId: string, afterSequence?: number): Promise<RunEventRecord[]>;
  appendWorkspaceMessage(input: { adminId: string; sessionId: string; runId?: string; type: WorkspaceMessageType; content: string; summary?: string }): Promise<WorkspaceMessageRecord>;
  listWorkspaceMessages(adminId: string, sessionId: string, limit?: number): Promise<WorkspaceMessageRecord[]>;
  listProducts(adminId: string, query: ProductListQuery): Promise<ProductListResult>;
  getProduct(adminId: string, productId: string): Promise<ProductRecord | undefined>;
  listOrders(adminId: string, query: OrderListQuery): Promise<OrderListResult>;
  getOrder(adminId: string, orderNo: string, accountId?: string): Promise<OrderRecord | undefined>;
  createOrder(input: { adminId: string; order: Omit<OrderRecord, 'id' | 'createdAt' | 'updatedAt' | 'configVersion' | 'source'> & { id?: string; createdAt?: string; updatedAt?: string; configVersion?: number; source?: OrderSource } }): Promise<OrderRecord>;
  upsertExternalOrder(input: { adminId: string; accountId: string; item: XianyuOrderItem; syncedAt: string; accountName?: string }): Promise<OrderUpsertResult>;
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
  markConversationRead(adminId: string, conversationId: string): Promise<ConversationRecord | undefined>;
  findConversationByExternalRef(adminId: string, accountId: string, externalConversationRef: string): Promise<ConversationRecord | undefined>;
  upsertExternalConversation(input: { adminId: string; accountId: string; externalConversationRef: string; buyerRef: string; buyerDisplayName?: string; buyerAvatarUrl?: string; itemRef?: string; itemTitle?: string; itemImageUrl?: string; unreadCount?: number; lastMessagePreview?: string; lastMessageAt?: string }): Promise<ConversationRecord>;
  listMessages(adminId: string, conversationId: string, query: MessageListQuery): Promise<MessageListResult>;
  listConversationEvents(adminId: string, conversationId: string, afterCursor: number, limit: number): Promise<ConversationEventRecord[]>;
  findMessageByExternalRef(adminId: string, conversationId: string, externalMessageRef: string): Promise<MessageRecord | undefined>;
  createConversation(input: { adminId: string; accountId: string; buyerRef: string; buyerDisplayName?: string; buyerAvatarUrl?: string; itemRef?: string; itemTitle?: string; itemImageUrl?: string; externalConversationRef?: string }): Promise<ConversationRecord>;
  createMessage(input: { adminId: string; conversationId: string; direction: MessageDirection; senderRole: MessageSenderRole; bodyType: MessageBodyType; bodyText?: string; bodyRef?: string; externalMessageRef?: string; source?: MessageRecord['source']; orderRef?: string; productRef?: string; riskFlags?: string[]; createdAt?: string; traceId?: string }): Promise<{ message: MessageRecord; event: ConversationEventRecord }>;
  createAutoReplyRun(input: { adminId: string; accountId: string; conversationId: string; inboundMessageId: string; intent: string; decision: AutoReplyDecision; status: AutoReplyRunStatus; riskFlags?: string[]; productId?: string; orderRefs?: string[]; inputDigest: string; contextDigest?: string; replyDigest?: string; senderOutcome?: AutoReplyRunRecord['senderOutcome']; outboundMessageId?: string; failureCode?: string }): Promise<AutoReplyRunRecord>;
  updateAutoReplyRun(id: string, patch: { intent?: string; decision?: AutoReplyDecision; status?: AutoReplyRunStatus; riskFlags?: string[]; productId?: string; orderRefs?: string[]; contextDigest?: string; replyDigest?: string; senderOutcome?: AutoReplyRunRecord['senderOutcome']; outboundMessageId?: string; failureCode?: string }): Promise<AutoReplyRunRecord | undefined>;
  getAutoReplyRun(adminId: string, id: string): Promise<AutoReplyRunRecord | undefined>;
  findAutoReplyRunByInboundMessage(adminId: string, inboundMessageId: string): Promise<AutoReplyRunRecord | undefined>;
  appendAutoReplyRunEvent(input: { runId: string; eventType: string; status: AutoReplyRunStatus; stage: AutoReplyRunStage; accountId: string; payload?: Record<string, unknown>; durationMs?: number; traceId?: string }): Promise<AutoReplyRunEventRecord>;
  listAutoReplyRunEvents(adminId: string, runId: string): Promise<AutoReplyRunEventRecord[]>;
  listAutoReplyRuns(adminId: string, query: AutoReplyRunListQuery): Promise<AutoReplyRunListResult>;
  getAutoReplyRunDetail(adminId: string, runId: string): Promise<AutoReplyRunDetailRecord | undefined>;
  getAutoReplyActivitySummary(adminId: string, query: { accountId?: string; from: string; to: string }): Promise<AutoReplyActivitySummary>;
  markMessagesReadByExternalRef(input: { adminId: string; conversationId: string; externalMessageRef: string; readAt?: string }): Promise<{ messages: MessageRecord[]; events: ConversationEventRecord[] }>;
  markLatestOutgoingRead(input: { adminId: string; conversationId: string; readAt?: string }): Promise<{ messages: MessageRecord[]; events: ConversationEventRecord[] }>;
}
