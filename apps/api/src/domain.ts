import type { OutcomeReviewPolicy } from './auto-reply-outcome-review.js';
import type { PreSendReviewPolicyInput } from './auto-reply-pre-send-review.js';

export type AdminStatus = 'active' | 'disabled';
export type AccountStatus = 'pending' | 'connected' | 'degraded' | 'disconnected' | 'expired' | 'disabled';
export type ScopeStatus = 'active' | 'revoked' | 'expired';
export type LoginSessionStatus = 'created' | 'waiting' | 'scanned' | 'succeeded' | 'expired' | 'failed' | 'cancelled' | 'verification_required';
export type CredentialStatus = 'active' | 'expired' | 'revoked';
export type ProductStatus = 'draft' | 'ready' | 'publishing' | 'published' | 'failed' | 'archived';
export type ProductSkuStatus = 'active' | 'archived';
export type ProductAssetStatus = 'active' | 'archived' | 'failed';
export type ProductSource = 'local' | 'xianyu';
export type CouponBatchStatus = 'draft' | 'active' | 'paused' | 'closed' | 'voided';
export type CouponItemStatus = 'available' | 'reserved' | 'consumed';
export type CouponBindingStatus = 'active' | 'inactive';
export type CouponReservationPurpose = 'delivery' | 'gift';
export type CouponReservationStatus = 'reserved' | 'committed' | 'released' | 'expired';
export type ConversationHandlingMode = 'ai' | 'human';
export type MessageDirection = 'inbound' | 'outbound';
export type MessageSenderRole = 'buyer' | 'agent' | 'system';
export type MessageBodyType = 'text' | 'image' | 'system';
export type MessageStatus = 'created';
export type MessageReadStatus = 0 | 2;
export type MessageRedactionState = 'visible' | 'redacted';
export type ConversationEventType = 'chat.message.created' | 'chat.message.updated' | 'chat.conversation.updated' | 'chat.connection.changed';
export type InboundInboxStatus = 'pending' | 'processing' | 'succeeded' | 'retryable' | 'dead_lettered';

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

export type CouponAssetStatus = 'active' | 'archived';

export interface CouponAssetRecord {
  id: string;
  batchId: string;
  storageKey: string;
  mimeType: string;
  checksum?: string;
  caption?: string;
  status: CouponAssetStatus;
  createdAt: string;
  updatedAt: string;
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
  sourceUrl?: string;
  metadata?: Record<string, unknown>;
  status: ProductAssetStatus;
}

export interface XianyuItemDetailAssetInput {
  storageKey: string;
  mimeType: string;
  checksum?: string;
  sourceUrl?: string;
  metadata?: Record<string, unknown>;
  status?: ProductAssetStatus;
}

export interface XianyuItemDetailPersistenceInput {
  adminId: string;
  productId: string;
  itemId: string;
  summary: Record<string, unknown>;
  rawResponse: Record<string, unknown>;
  imageUrls: string[];
  assetUploadErrors?: Array<{ sourceUrl: string; message: string }>;
  syncedAt: string;
  sourcePayloadDigest: string;
  assets: XianyuItemDetailAssetInput[];
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
  knowledgeBase?: string;
  configVersion: number;
  priceMinor?: number;
  status: ProductStatus;
  source: ProductSource;
  lastSyncedAt?: string;
  xianyuUpdatedAt?: string;
  xianyuListRank?: number;
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
  /** All stable item id candidates seen in the list card. */
  externalProductRefs?: string[];
  title: string;
  description?: string;
  categoryCode?: string;
  priceMinor?: number;
  externalStatus?: string;
  xianyuUpdatedAt?: string;
  xianyuListRank?: number;
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
  sortBy?: 'createdAt' | 'updatedAt' | 'xianyuOrder' | 'title' | 'priceMinor';
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

/**
 * Minimal product context exposed to the auto-reply model.
 * Deliberately omits raw attributes, SKUs/assets, sync metadata and timestamps,
 * while retaining public engagement metrics that buyers may ask about.
 */
export interface AutoReplyProductContext {
  id: string;
  externalProductRef?: string;
  title: string;
  description?: string;
  browseCount?: number;
  wantCount?: number;
  collectCount?: number;
  defaultReplyTemplate?: string;
  knowledgeBase?: string;
  priceMinor?: number;
  status: ProductStatus;
}

export interface AutoReplyProductListQuery {
  accountId: string;
  productId?: string;
  keyword?: string;
  /** Core terms selected by the Agent after an exact phrase returns no rows. */
  keywords?: string[];
  limit?: number;
}

export interface AutoReplyProductLookup {
  accountId: string;
  productId?: string;
  externalProductRef?: string;
  title?: string;
}

export interface AutoReplyProductListResult {
  items: AutoReplyProductContext[];
  total: number;
  searchMode?: 'catalog' | 'exact_phrase' | 'core_terms';
}

export type AutomationRuleType = 'paid_auto_delivery' | 'unpaid_auto_reprice' | 'review_gift' | 'review_reminder';

export interface PaidAutoDeliveryRule {
  enabled: boolean;
  couponBatchIds: string[];
  autoConfirm: boolean;
  maxAttempts: number;
  retryBackoffSeconds: number;
}

export interface UnpaidAutoRepriceRule {
  enabled: boolean;
  mode: 'fixed';
  targetPriceMinor: number;
  message?: string;
  maxAttempts: number;
  retryBackoffSeconds: number;
}

export interface ReviewGiftRule {
  enabled: boolean;
  couponBatchIds: string[];
  maxAttempts: number;
  retryBackoffSeconds: number;
}

export interface ReviewReminderRule {
  enabled: boolean;
  firstDelayMinutes: number;
  repeatIntervalMinutes: number;
  maxReminders: number;
  message: string;
}

export interface ProductAutomationConfig {
  paidAutoDelivery: PaidAutoDeliveryRule;
  unpaidAutoReprice: UnpaidAutoRepriceRule;
  reviewGift: ReviewGiftRule;
  reviewReminder: ReviewReminderRule;
}

export interface ProductAutomationConfigRecord {
  id: string;
  productId: string;
  accountId: string;
  configVersion: number;
  config: ProductAutomationConfig;
  configDigest: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProductAutomationBatchResult {
  items: ProductAutomationConfigRecord[];
  updatedProductIds: string[];
}

export type PaymentStatus = 'unpaid' | 'paid' | 'closed' | 'unknown';
export type OrderStatus = 'open' | 'cancelling' | 'cancelled' | 'completed' | 'closed' | 'failed';
export type DeliveryStatus = 'pending' | 'reserving' | 'delivered' | 'partially_delivered' | 'failed' | 'cancelled';
export type AfterSalesStatus = 'none' | 'requested' | 'refunding' | 'refunded' | 'rejected' | 'closed';
export type OrderDeliveryType = 'manual' | 'no_logistics' | 'coupon_only' | 'mixed';
export type OrderSource = 'local' | 'xianyu';
export type DeliveryRecordStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'unknown' | 'cancelled';

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
  skuSpec?: string;
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
  reviewedAt?: string;
  reminderCount?: number;
  lastReminderAt?: string;
}

export interface DeliveryRecord {
  id: string;
  orderId: string;
  orderNo: string;
  accountId: string;
  deliveryType: OrderDeliveryType;
  status: DeliveryRecordStatus;
  idempotencyScope: string;
  idempotencyKey: string;
  attempt: number;
  couponItemId?: string;
  trackingRef?: string;
  deliveredAt?: string;
  failureCode?: string;
  failureMessage?: string;
  externalOutcome?: ExternalOutcome;
  externalRef?: string;
  createdAt: string;
  updatedAt: string;
}

export type AutomationExecutionLedgerStatus = 'running' | 'completed';

export interface AutomationExecutionLedgerRecord {
  executionKey: string;
  fingerprint: string;
  status: AutomationExecutionLedgerStatus;
  result?: unknown;
  retryable: boolean;
  ownerToken?: string;
  leaseUntil?: string;
  attemptCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface XianyuOrderItem {
  orderNo: string;
  buyerId: string;
  buyerName: string;
  buyerNickname?: string;
  buyerAvatarUrl?: string;
  itemId: string;
  itemTitle: string;
  skuSpec?: string;
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
  reviewedAt?: string;
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

/** Minimal order context exposed to the auto-reply model. */
export interface AutoReplyOrderContext {
  orderNo: string;
  itemId: string;
  itemTitle: string;
  paymentStatus: PaymentStatus;
  orderStatus: OrderStatus;
  deliveryStatus: DeliveryStatus;
  afterSalesStatus: AfterSalesStatus;
}

export interface AutoReplyOrderListQuery {
  accountId: string;
  buyerId?: string;
  conversationId?: string;
  limit?: number;
}

export interface AutoReplyOrderListResult {
  items: AutoReplyOrderContext[];
  total: number;
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
  sequenceId?: string;
  accountId: string;
  label?: string;
  purpose: string;
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
  assets?: CouponAssetRecord[];
  metadata?: CouponBatchMetadata;
}

export interface CouponBatchListQuery {
  accountId?: string;
  keyword?: string;
  status?: CouponBatchStatus;
  purpose?: 'text' | 'data' | 'api' | 'image';
  sortBy?: 'createdAt';
  sortOrder?: 'asc' | 'desc';
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

export interface CouponReservationItemRecord {
  itemId: string;
  content: string;
  batchId: string;
  batchLabel?: string;
}

export interface CouponReservationRecord {
  reservationId: string;
  adminId: string;
  accountId: string;
  executionKey: string;
  purpose: CouponReservationPurpose;
  batchIds: string[];
  fingerprint: string;
  quantity: number;
  status: CouponReservationStatus;
  leaseUntil: string;
  reason?: string;
  items: CouponReservationItemRecord[];
  createdAt: string;
  updatedAt: string;
  finalizedAt?: string;
}

export interface ProductPatch {
  title?: string;
  description?: string | null;
  categoryCode?: string | null;
  attributes?: Record<string, unknown>;
  defaultReplyTemplate?: string | null;
  knowledgeBase?: string | null;
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
  accountId?: string;
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

export interface ProductKnowledgeBaseMessageRecord {
  conversationId: string;
  conversationItemRef?: string;
  conversationItemTitle?: string;
  message: MessageRecord;
}

export interface InboundInboxRecord {
  id: string;
  adminId: string;
  accountId: string;
  conversationId: string;
  inboundMessageId: string;
  externalConversationRef: string;
  externalMessageRef: string;
  /** Best-effort platform event identity captured from the live push envelope. */
  sourceEventId?: string;
  /** Best-effort platform ordering token; absent when the envelope does not expose one. */
  sourceSequence?: number;
  status: InboundInboxStatus;
  attempt: number;
  availableAt: string;
  lockedAt?: string;
  leaseExpiresAt?: string;
  leaseOwner?: string;
  lastErrorCode?: string;
  lastErrorDigest?: string;
  lastErrorAt?: string;
  processedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface InboundQuarantineRecord {
  id: string;
  accountId: string;
  reasonCode: string;
  payloadDigest: string;
  payloadPreview?: string;
  payloadSize: number;
  receivedAt: string;
  resolvedAt?: string;
  createdAt: string;
}

export type AutoReplyDecision = 'replied' | 'handoff' | 'skipped' | 'failed';
export type AutoReplyRunStatus = 'received' | 'classified' | 'context_loaded' | 'generated' | 'simulated' | 'persisted' | 'handoff' | 'skipped' | 'failed';
export type AutoReplyRunStage = 'gateway_received' | 'intent_recognition' | 'context_read' | 'reply_generation' | 'sending' | 'persisted' | 'handoff' | 'skipped' | 'failed';

/** Canonical business actions used by the policy kernel. */
export const AUTO_REPLY_ACTION_KINDS = [
  'ANSWER_FACT',
  'GUIDE_NEXT_STEP',
  'CLARIFY',
  'ACKNOWLEDGE_CONTINUE',
  'REDIRECT',
  'SWITCH_GOAL',
  'RECOMMEND',
  'WAIT_FOR_USER',
  'HANDOFF',
  'REFUSE_SENSITIVE',
] as const;

export type ActionKind = (typeof AUTO_REPLY_ACTION_KINDS)[number];
export const AUTO_REPLY_ACTIVITY_NEXT_ACTIONS = [...AUTO_REPLY_ACTION_KINDS, 'FOLLOW_UP', 'RECONCILE_SEND'] as const;
export type AutoReplyNextAction = (typeof AUTO_REPLY_ACTIVITY_NEXT_ACTIONS)[number];
export type SafetyHandling = 'NONE' | 'PARTIAL_REFUSAL' | 'FULL_REFUSAL';
export type AutoReplyGoalStatus = 'active' | 'awaiting_user' | 'resolved' | 'needs_followup' | 'unresolved' | 'handoff';
export type AutoReplyPolicyStatus = 'DRAFT' | 'ACTIVE' | 'RETIRED' | 'ROLLBACK_TARGET';

export interface AutoReplyQuestionBudget {
  maxQuestionsPerTurn: 1;
  maxRounds: number;
}

export interface AutoReplyPolicyPredicate {
  [key: string]: boolean | number | string | readonly (boolean | number | string)[];
}

export interface AutoReplyPolicyRule {
  ruleId: string;
  predicate: AutoReplyPolicyPredicate;
  primaryAction: ActionKind;
  safetyHandling: SafetyHandling;
  nextState: Record<string, unknown>;
  priority: number;
  specificity: number;
  requiredEvidenceCount: number;
  successCriteria: string[];
  reasonCodes: string[];
}

export interface AutoReplyHandoffPolicy {
  allowedReasonCodes: string[];
  factUnavailable: {
    minAttempts: number;
    windowSeconds: number;
    deadlineSeconds: number;
    requiredSourceIds: string[];
    requiredErrorCodes: string[];
  };
}

export interface AutoReplyResolutionPolicy {
  reopenWindowSeconds: number;
  reopenEvidenceTypes: string[];
  closeRequiresWindow: true;
}

export interface AutoReplyReviewPolicy {
  leaseSeconds: number;
  maxAttempts: number;
  backoffSeconds: number[];
}

export interface PolicyConfig {
  policyVersion: string;
  policyHash: string;
  status: AutoReplyPolicyStatus;
  accountScope: string;
  effectiveFrom: string;
  effectiveTo?: string;
  publishedAt?: string;
  activatedAt?: string;
  previousPolicyVersion?: string;
  immutable: true;
  actionPriority: Record<ActionKind, number>;
  actionMutex: Array<{ left: ActionKind; right: ActionKind }>;
  precedenceRules: AutoReplyPolicyRule[];
  clarification: AutoReplyQuestionBudget & { awaitingUserTtlSeconds: number };
  handoff: AutoReplyHandoffPolicy;
  resolution: AutoReplyResolutionPolicy;
  review: AutoReplyReviewPolicy;
}

/**
 * Account-scoped repair policy bundle persisted as an immutable version.
 * The core PolicyConfig drives routing; the review policies keep the
 * pre-send and outcome-review gates on the same policy version.
 */
export interface AutoReplyRepairPolicyBundle {
  policyConfig: PolicyConfig;
  preSendPolicy: PreSendReviewPolicyInput;
  outcomePolicy: OutcomeReviewPolicy;
}

export interface Objective {
  objectiveId: string;
  accountId: string;
  conversationId: string;
  goalType: string;
  status: AutoReplyGoalStatus;
  successCriteria: string[];
  sourceMessageId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationState {
  stateId: string;
  accountId: string;
  conversationId: string;
  stateVersion: number;
  activeGoalId?: string;
  goalStatus: AutoReplyGoalStatus;
  observedStage?: string;
  targetStage?: string;
  emotionSnapshot?: Record<string, unknown>;
  topicRelation?: string;
  pendingQuestions: Array<Record<string, unknown>>;
  clarificationRound: number;
  clarificationAttemptId?: string;
  lastQuestionFingerprint?: string;
  recommendationState?: Record<string, unknown>;
  awaitingUser: boolean;
  awaitingUserSince?: string;
  awaitingUserTtl?: string;
  lastMessageId?: string;
  transitionAt: string;
  policyVersion?: string;
  lastSourceEventId?: string;
  lastSourceSequence: number;
  processedEventIds: string[];
  processedIdempotencyKeys: string[];
}

export interface ActionPlan {
  actionPlanId: string;
  primaryAction: ActionKind;
  primaryGoal: Objective;
  requiredFacts: string[];
  successCriteria: string[];
  allowedTools: string[];
  questionBudget: AutoReplyQuestionBudget;
  recommendationAllowed: boolean;
  handoffAllowed: boolean;
  nextState: Record<string, unknown>;
  safetyHandling: SafetyHandling;
  policyDecisionId: string;
  policyVersion: string;
  reasonCodes: string[];
  evidenceRefs: string[];
  supersedesActionPlanId?: string;
}

export interface PolicyDecisionTrace {
  policyDecisionId: string;
  policyVersion: string;
  ruleId: string;
  precedenceRule: string;
  primaryAction: ActionKind;
  safetyHandling: SafetyHandling;
  nextState: Record<string, unknown>;
  reasonCodes: string[];
  signalDigest: string;
  factDigest: string;
  accountScope: string;
  stateVersionBefore: number;
  stateVersionAfter: number;
  actionPlanId: string;
  createdAt: string;
}

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

export interface AutoReplyRunUpdate {
  intent?: string;
  decision?: AutoReplyDecision;
  status?: AutoReplyRunStatus;
  riskFlags?: string[];
  productId?: string;
  orderRefs?: string[];
  contextDigest?: string;
  replyDigest?: string;
  senderOutcome?: AutoReplyRunRecord['senderOutcome'];
  outboundMessageId?: string;
  failureCode?: string;
  /** Redacted event evidence written only when status changes. */
  eventPayload?: Record<string, unknown>;
  /** Correlation id for the status transition event. */
  eventTraceId?: string;
  /** Optional duration for the status transition itself. */
  eventDurationMs?: number;
}

export interface AutoReplyRunListQuery {
  accountId?: string;
  conversationId?: string;
  from?: string;
  to?: string;
  status?: AutoReplyRunStatus;
  decision?: AutoReplyDecision;
  processing?: boolean;
  stage?: AutoReplyRunStage;
  keyword?: string;
  page?: number;
  pageSize?: number;
}

export interface AutoReplyRunListItem extends AutoReplyRunRecord {
  stage: AutoReplyRunStage;
  durationMs: number;
  transportStatus?: 'generated' | 'simulated' | 'persisted' | 'known_failure' | 'unknown';
  resolutionStatus?: 'review_pending' | 'reviewing' | 'resolved' | 'needs_followup' | 'unresolved' | 'unknown' | 'review_failed' | 'closed';
  goalProgress?: 'unknown' | 'in_progress' | 'blocked' | 'completed';
  primaryAction?: ActionKind;
  nextAction?: AutoReplyNextAction;
  legacyActionKind?: string;
  legacyTransportStatus?: string;
  legacyHandoffReason?: string;
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
  /** Delay before the first automatic reply is sent. Zero disables the delay. */
  sendDelaySeconds: number;
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
  /** Skip the external Xianyu refresh when reconciling an already-running UI. */
  refreshExternal?: boolean;
}

export interface ConversationListResult {
  items: ConversationRecord[];
  nextCursor?: string;
  hasMore: boolean;
}

/** Minimal conversation context exposed to the auto-reply model. */
export interface AutoReplyConversationContext {
  id: string;
  itemRef?: string;
  itemTitle?: string;
}

export interface AutoReplyConversationListQuery {
  accountId: string;
  buyerRef: string;
  limit?: number;
}

export interface AutoReplyConversationListResult {
  items: AutoReplyConversationContext[];
}

export interface MessageListQuery {
  cursor?: number;
  /** Opaque cursor used to load messages older than the current timeline. */
  beforeCursor?: string;
  limit?: number;
  /** Controls whether the first page refreshes history from Xianyu. */
  refreshExternal?: boolean;
}

export interface MessageListResult {
  items: MessageRecord[];
  nextCursor?: number;
  hasMore: boolean;
  latestCursor: number;
  hasMoreHistory: boolean;
  historyCursor?: string;
}

/** Minimal message context exposed to the auto-reply model. */
export interface AutoReplyMessageContext {
  /** Internal deduplication key; never rendered into the model prompt. */
  messageId?: string;
  direction: MessageDirection;
  senderRole: MessageSenderRole;
  bodyType: MessageBodyType;
  bodyText?: string;
  bodyRef?: string;
}

export interface AutoReplyMessageListQuery {
  limit?: number;
}

export interface AutoReplyMessageListResult {
  items: AutoReplyMessageContext[];
  hasMoreHistory: boolean;
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

export interface CredentialRefSecretRecord {
  ref: CredentialRefRecord;
  secretCiphertext: string;
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

export type AutoReplyOutboxStatus = 'pending' | 'processing' | 'retryable' | 'succeeded' | 'dead_lettered';

export interface AutoReplyOutboxRecord {
  id: string;
  scope: string;
  aggregateType: string;
  aggregateId: string;
  operation: string;
  status: AutoReplyOutboxStatus;
  attempt: number;
  availableAt: string;
  lockedAt?: string;
  leaseExpiresAt?: string;
  leaseOwner?: string;
  lastErrorCode?: string;
  lastErrorDigest?: string;
  externalOutcome?: 'known_success' | 'known_failure' | 'unknown';
  idempotencyKey: string;
  payload: Record<string, unknown>;
  externalMessageRef?: string;
  outboundMessageId?: string;
  traceId?: string;
  createdAt: string;
  updatedAt: string;
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
export type WorkspaceConfirmationStatus = 'active' | 'confirmed' | 'expired' | 'rejected' | 'cancelled';
export type WorkspaceActionKind =
  | 'product_publish'
  | 'product_update'
  | 'coupon_create'
  | 'agent_settings_update'
  | 'product_knowledge_update'
  | 'product_automation_update'
  | 'coupon_update'
  | 'coupon_enable'
  | 'coupon_disable'
  | 'coupon_bind'
  | 'coupon_unbind'
  | 'coupon_void'
  | 'coupon_copy'
  | 'model_settings_update'
  | 'order_deliver'
  | 'order_retry'
  | 'order_cancel';

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

export interface WorkspaceConfirmationRecord {
  id: string;
  runId: string;
  stepId: string;
  accountId: string;
  requestedBy: string;
  action: WorkspaceActionKind;
  policyRef: string;
  manifest: Record<string, unknown>;
  status: WorkspaceConfirmationStatus;
  version: number;
  expiresAt: string;
  confirmedAt?: string;
  confirmedBy?: string;
  cancelledAt?: string;
  createdAt: string;
  updatedAt: string;
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
  getAccountForLogin(adminId: string, accountId: string): Promise<AccountRecord | undefined>;
  findAccountForLogin(input: { adminId: string; platform: string; sellerRef: string }): Promise<AccountRecord | undefined>;
  restoreAccountForLogin(adminId: string, accountId: string): Promise<AccountRecord | undefined>;
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
  getCredentialRefSecret(adminId: string, credentialId: string): Promise<CredentialRefSecretRecord | undefined>;
  createCredentialRef(input: { adminId: string; accountId: string; provider: string; alias: string; label?: string; secretCiphertext: string; fingerprint: string; metadata?: Record<string, string> }): Promise<CredentialRefRecord>;
  updateCredentialRef(input: { adminId: string; credentialId: string; expectedVersion: number; provider?: string; alias?: string; label?: string; metadata?: Record<string, string> }): Promise<CredentialRefRecord | undefined>;
  rotateCredentialRef(input: { adminId: string; credentialId: string; expectedVersion: number; secretCiphertext: string; fingerprint: string }): Promise<CredentialRefRecord | undefined>;
  updateCredentialRefStatus(input: { adminId: string; credentialId: string; expectedVersion: number; status: CredentialRefStatus }): Promise<CredentialRefRecord | undefined>;
  getAutoReplyAgentConfig(adminId: string, accountId: string): Promise<AutoReplyAgentConfigRecord | undefined>;
  upsertAutoReplyAgentConfig(input: { adminId: string; accountId: string; expectedVersion: number; patch: AutoReplyAgentConfigPatch; config: AutoReplyAgentConfig; configDigest: string }): Promise<AutoReplyAgentConfigRecord | undefined>;
  getActiveAutoReplyRepairPolicy(accountId: string, now?: string): Promise<AutoReplyRepairPolicyBundle | undefined>;
  publishAutoReplyRepairPolicy(input: { accountId: string; bundle: AutoReplyRepairPolicyBundle; expectedActiveVersion?: string }): Promise<AutoReplyRepairPolicyBundle>;
  rollbackAutoReplyRepairPolicy(input: { accountId: string; targetPolicyVersion: string; expectedActiveVersion?: string }): Promise<AutoReplyRepairPolicyBundle>;
  getIdempotency(scope: string, key: string): Promise<IdempotencyRecord | undefined>;
  beginIdempotency(record: IdempotencyRecord): Promise<void>;
  abortIdempotency(scope: string, key: string): Promise<void>;
  completeIdempotency(input: { scope: string; key: string; status: IdempotencyRecord['status']; responseEnvelope: unknown; statusCode: number; traceId: string }): Promise<void>;
  enqueueAutoReplyOutbox(input: { scope: string; aggregateType: string; aggregateId: string; operation: string; idempotencyKey: string; payload: Record<string, unknown>; traceId?: string; availableAt?: string }): Promise<{ record: AutoReplyOutboxRecord; created: boolean }>;
  getAutoReplyOutbox(scope: string, idempotencyKey: string): Promise<AutoReplyOutboxRecord | undefined>;
  listAutoReplyOutboxByAggregate(scope: string, aggregateId: string): Promise<AutoReplyOutboxRecord[]>;
  claimAutoReplyOutbox(input: { scope: string; workerId: string; limit: number; leaseMs: number; id?: string }): Promise<AutoReplyOutboxRecord[]>;
  completeAutoReplyOutbox(input: { id: string; workerId: string; externalOutcome: AutoReplyOutboxRecord['externalOutcome']; externalMessageRef?: string }): Promise<boolean>;
  persistAutoReplyOutbox(input: { id: string; outboundMessageId: string }): Promise<boolean>;
  retryAutoReplyOutbox(input: { id: string; workerId: string; errorCode: string; errorDigest: string; availableAt: string }): Promise<boolean>;
  deadLetterAutoReplyOutbox(input: { id: string; workerId: string; errorCode: string; errorDigest: string }): Promise<boolean>;
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
  createWorkspaceConfirmation(input: { adminId: string; runId: string; stepId: string; accountId: string; requestedBy: string; action: WorkspaceActionKind; policyRef: string; manifest: Record<string, unknown>; expiresAt: string }): Promise<WorkspaceConfirmationRecord>;
  getWorkspaceConfirmation(adminId: string, runId: string): Promise<WorkspaceConfirmationRecord | undefined>;
  transitionWorkspaceConfirmation(input: { adminId: string; confirmationId: string; expectedVersion: number; status: Exclude<WorkspaceConfirmationStatus, 'active'>; actorId: string }): Promise<WorkspaceConfirmationRecord | undefined>;
  getExecutionOutboxById(scope: string, id: string): Promise<AutoReplyOutboxRecord | undefined>;
  requeueExecutionOutbox(input: { scope: string; id: string; availableAt?: string }): Promise<AutoReplyOutboxRecord | undefined>;
  listProducts(adminId: string, query: ProductListQuery): Promise<ProductListResult>;
  getAutoReplyProduct(adminId: string, query: AutoReplyProductLookup): Promise<AutoReplyProductContext | undefined>;
  listAutoReplyProducts(adminId: string, query: AutoReplyProductListQuery): Promise<AutoReplyProductListResult>;
  getProduct(adminId: string, productId: string): Promise<ProductRecord | undefined>;
  getProductAutomation(adminId: string, productId: string): Promise<ProductAutomationConfigRecord | undefined>;
  updateProductAutomation(input: { adminId: string; productId: string; expectedConfigVersion: number; config: ProductAutomationConfig; configDigest: string; syncCouponBindings?: boolean }): Promise<ProductAutomationConfigRecord | undefined>;
  updateProductAutomationsBatch(input: { adminId: string; productIds: string[]; expectedConfigVersions: Record<string, number>; config?: ProductAutomationConfig; configDigest?: string; configByProductId?: Record<string, ProductAutomationConfig>; configDigests?: Record<string, string>; syncCouponBindingsByProduct?: Record<string, boolean> }): Promise<ProductAutomationBatchResult>;
  persistXianyuItemDetail(input: XianyuItemDetailPersistenceInput): Promise<ProductRecord | undefined>;
  listOrders(adminId: string, query: OrderListQuery): Promise<OrderListResult>;
  listAutoReplyOrders(adminId: string, query: AutoReplyOrderListQuery): Promise<AutoReplyOrderListResult>;
  getOrder(adminId: string, orderNo: string, accountId?: string): Promise<OrderRecord | undefined>;
  getAutomationExecution(executionKey: string): Promise<AutomationExecutionLedgerRecord | undefined>;
  claimAutomationExecution(input: { executionKey: string; fingerprint: string; ownerToken: string; leaseUntil: string; allowManualReviewRecovery?: boolean }): Promise<{ claimed: boolean; record: AutomationExecutionLedgerRecord }>;
  completeAutomationExecution(input: { executionKey: string; ownerToken: string; result: unknown; retryable: boolean }): Promise<void>;
  cleanupExpiredCouponReservations(): Promise<number>;
  recordReviewFact(input: { accountId: string; orderNo: string; eventId: string; reviewedAt?: string }): Promise<{ created: boolean }>;
  recordReviewReminderSent(input: { accountId: string; orderNo: string; sentAt: string; expectedReminderCount?: number }): Promise<OrderRecord | undefined>;
  markOrderDelivered(input: { adminId: string; accountId: string; orderNo: string }): Promise<OrderRecord | undefined>;
  updateOrderDelivery(input: { adminId: string; accountId: string; orderNo: string; deliveryStatus: DeliveryStatus; deliveryFailReason?: string; deliveryType?: OrderDeliveryType }): Promise<OrderRecord | undefined>;
  listDeliveryRecords(adminId: string, input: { accountId: string; orderNo: string }): Promise<DeliveryRecord[]>;
  getDeliveryRecordByIdempotency(adminId: string, input: { accountId: string; idempotencyKey: string }): Promise<DeliveryRecord | undefined>;
  createDeliveryRecord(input: { adminId: string; orderId: string; orderNo: string; accountId: string; deliveryType: OrderDeliveryType; idempotencyScope: string; idempotencyKey: string; attempt: number; trackingRef?: string }): Promise<DeliveryRecord>;
  updateDeliveryRecord(input: { adminId: string; id: string; status: DeliveryRecordStatus; externalOutcome?: ExternalOutcome; externalRef?: string; couponItemId?: string; trackingRef?: string; deliveredAt?: string; failureCode?: string; failureMessage?: string }): Promise<DeliveryRecord | undefined>;
  createOrder(input: { adminId: string; order: Omit<OrderRecord, 'id' | 'createdAt' | 'updatedAt' | 'configVersion' | 'source'> & { id?: string; createdAt?: string; updatedAt?: string; configVersion?: number; source?: OrderSource } }): Promise<OrderRecord>;
  upsertExternalOrder(input: { adminId: string; accountId: string; item: XianyuOrderItem; syncedAt: string; accountName?: string }): Promise<OrderUpsertResult>;
  deleteExternalOrdersNotInSnapshot(input: { adminId: string; accountId: string; orderNos: readonly string[] }): Promise<number>;
  createProduct(input: {
    adminId: string;
    accountId: string;
    externalProductRef?: string;
    title: string;
    description?: string;
    categoryCode?: string;
    attributes?: Record<string, unknown>;
    defaultReplyTemplate?: string;
    knowledgeBase?: string;
    priceMinor?: number;
    status?: ProductStatus;
  }): Promise<ProductRecord>;
  updateProduct(input: { adminId: string; productId: string; expectedConfigVersion: number; patch: ProductPatch }): Promise<ProductRecord | undefined>;
  upsertExternalProduct(input: { adminId: string; accountId: string; item: XianyuProductItem; syncedAt: string }): Promise<ProductUpsertResult>;
  resetXianyuListRanks(adminId: string, accountId: string): Promise<void>;
  listCouponBatches(adminId: string, query: CouponBatchListQuery): Promise<CouponBatchListResult>;
  getCouponBatch(adminId: string, batchId: string): Promise<CouponBatchRecord | undefined>;
  getCouponAsset(adminId: string, batchId: string, assetId: string): Promise<CouponAssetRecord | undefined>;
  replaceCouponAssets(input: { adminId: string; batchId: string; assets: Array<{ id: string; storageKey: string; mimeType: string; checksum?: string; caption?: string }> }): Promise<CouponAssetRecord[]>;
  createCouponBatch(input: {
    adminId: string;
    accountId: string;
    label?: string;
    purpose: string;
    metadata?: CouponBatchMetadata;
  }): Promise<CouponBatchRecord>;
  updateCouponBatch(input: { adminId: string; batchId: string; patch: { label?: string; purpose?: string; status?: CouponBatchStatus; metadata?: CouponBatchMetadata } }): Promise<CouponBatchRecord | undefined>;
  importCouponItems(input: { adminId: string; batchId: string; contents: string[] }): Promise<{ batch: CouponBatchRecord; items: CouponItemRecord[]; rejected: Array<{ index: number; code: string; message: string }> }>;
  bindCouponBatch(input: { adminId: string; batchId: string; productId: string }): Promise<CouponBindingRecord>;
  unbindCouponBatch(input: { adminId: string; batchId: string; productId: string }): Promise<CouponBindingRecord | undefined>;
  voidCouponBatch(input: { adminId: string; batchId: string }): Promise<CouponBatchRecord | undefined>;
  getCouponContent(adminId: string, itemId: string): Promise<{ batch: CouponBatchRecord; item: CouponItemRecord } | undefined>;
  reserveCoupon(input: { adminId: string; accountId: string; batchIds: string[]; quantity: number; executionKey: string; purpose: CouponReservationPurpose; leaseSeconds?: number }): Promise<CouponReservationRecord>;
  getCouponReservation(input: { adminId: string; reservationId: string; executionKey?: string }): Promise<CouponReservationRecord | undefined>;
  commitCouponReservation(input: { adminId: string; reservationId: string; executionKey: string }): Promise<CouponReservationRecord>;
  releaseCouponReservation(input: { adminId: string; reservationId: string; executionKey: string; reason: string }): Promise<CouponReservationRecord>;
  listConversations(adminId: string, query: ConversationListQuery): Promise<ConversationListResult>;
  listAutoReplyConversations(adminId: string, query: AutoReplyConversationListQuery): Promise<AutoReplyConversationListResult>;
  getConversation(adminId: string, conversationId: string): Promise<ConversationRecord | undefined>;
  markConversationRead(adminId: string, conversationId: string): Promise<ConversationRecord | undefined>;
  findConversationByExternalRef(adminId: string, accountId: string, externalConversationRef: string): Promise<ConversationRecord | undefined>;
  upsertExternalConversation(input: { adminId: string; accountId: string; externalConversationRef: string; buyerRef: string; buyerDisplayName?: string; buyerAvatarUrl?: string; itemRef?: string; itemTitle?: string; itemImageUrl?: string; unreadCount?: number; lastMessagePreview?: string; lastMessageAt?: string }): Promise<ConversationRecord>;
  listMessages(adminId: string, conversationId: string, query: MessageListQuery): Promise<MessageListResult>;
  listProductKnowledgeBaseMessages(adminId: string, productId: string): Promise<ProductKnowledgeBaseMessageRecord[]>;
  listAutoReplyMessages(adminId: string, conversationId: string, query: AutoReplyMessageListQuery): Promise<AutoReplyMessageListResult>;
  listConversationEvents(adminId: string, conversationId: string, afterCursor: number, limit: number): Promise<ConversationEventRecord[]>;
  findMessageByExternalRef(adminId: string, conversationId: string, externalMessageRef: string): Promise<MessageRecord | undefined>;
  reconcileExternalMessage(input: { adminId: string; conversationId: string; externalMessageRef: string; senderRole: MessageSenderRole; bodyType: MessageBodyType; source?: MessageRecord['source']; riskFlags?: string[]; traceId?: string }): Promise<{ message: MessageRecord; event?: ConversationEventRecord } | undefined>;
  createConversation(input: { adminId: string; accountId: string; buyerRef: string; buyerDisplayName?: string; buyerAvatarUrl?: string; itemRef?: string; itemTitle?: string; itemImageUrl?: string; externalConversationRef?: string }): Promise<ConversationRecord>;
  createMessage(input: { adminId: string; conversationId: string; direction: MessageDirection; senderRole: MessageSenderRole; bodyType: MessageBodyType; bodyText?: string; bodyRef?: string; externalMessageRef?: string; externalMessageRefAliases?: string[]; source?: MessageRecord['source']; orderRef?: string; productRef?: string; riskFlags?: string[]; createdAt?: string; traceId?: string }): Promise<{ message: MessageRecord; event: ConversationEventRecord }>;
  createAutoReplyRun(input: { adminId: string; accountId: string; conversationId: string; inboundMessageId: string; intent: string; decision: AutoReplyDecision; status: AutoReplyRunStatus; riskFlags?: string[]; productId?: string; orderRefs?: string[]; inputDigest: string; contextDigest?: string; replyDigest?: string; senderOutcome?: AutoReplyRunRecord['senderOutcome']; outboundMessageId?: string; failureCode?: string }): Promise<AutoReplyRunRecord>;
  updateAutoReplyRun(id: string, patch: AutoReplyRunUpdate): Promise<AutoReplyRunRecord | undefined>;
  getAutoReplyRun(adminId: string, id: string): Promise<AutoReplyRunRecord | undefined>;
  findAutoReplyRunByInboundMessage(adminId: string, inboundMessageId: string): Promise<AutoReplyRunRecord | undefined>;
  appendAutoReplyRunEvent(input: { runId: string; eventType: string; status: AutoReplyRunStatus; stage: AutoReplyRunStage; accountId: string; payload?: Record<string, unknown>; durationMs?: number; traceId?: string }): Promise<AutoReplyRunEventRecord>;
  listAutoReplyRunEvents(adminId: string, runId: string): Promise<AutoReplyRunEventRecord[]>;
  listAutoReplyRuns(adminId: string, query: AutoReplyRunListQuery): Promise<AutoReplyRunListResult>;
  getAutoReplyRunDetail(adminId: string, runId: string): Promise<AutoReplyRunDetailRecord | undefined>;
  getAutoReplyActivitySummary(adminId: string, query: { accountId?: string; from: string; to: string }): Promise<AutoReplyActivitySummary>;
  markMessagesReadByExternalRef(input: { adminId: string; conversationId: string; externalMessageRef: string; readAt?: string }): Promise<{ messages: MessageRecord[]; events: ConversationEventRecord[] }>;
  markLatestOutgoingRead(input: { adminId: string; conversationId: string; readAt?: string }): Promise<{ messages: MessageRecord[]; events: ConversationEventRecord[] }>;
  enqueueInboundInbox(input: { adminId: string; accountId: string; conversationId: string; inboundMessageId: string; externalConversationRef: string; externalMessageRef: string; sourceEventId?: string; sourceSequence?: number; availableAt?: string }): Promise<{ record: InboundInboxRecord; created: boolean }>;
  getInboundInbox(id: string): Promise<InboundInboxRecord | undefined>;
  claimInboundInbox(input: { workerId: string; limit: number; leaseMs: number }): Promise<InboundInboxRecord[]>;
  heartbeatInboundInbox(input: { id: string; workerId: string; leaseMs: number }): Promise<boolean>;
  ackInboundInbox(input: { id: string; workerId: string }): Promise<boolean>;
  retryInboundInbox(input: { id: string; workerId: string; errorCode: string; errorDigest: string; availableAt: string }): Promise<boolean>;
  deadLetterInboundInbox(input: { id: string; workerId: string; errorCode: string; errorDigest: string }): Promise<boolean>;
  reapExpiredInboundInbox(now?: string): Promise<number>;
  recordInboundQuarantine(input: { accountId: string; reasonCode: string; payloadDigest: string; payloadPreview?: string; payloadSize: number; receivedAt?: string }): Promise<InboundQuarantineRecord>;
}
