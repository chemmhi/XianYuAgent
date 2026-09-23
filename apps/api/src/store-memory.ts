import type { AccountListQuery, AccountListResult, AccountRecord, AccountScopeRecord, AdminRecord, AuditEventRecord, AutoReplyActivitySummary, AutoReplyAgentConfig, AutoReplyAgentConfigPatch, AutoReplyAgentConfigRecord, AutoReplyOutboxRecord, AutoReplyRepairPolicyBundle, AutoReplyRunDetailRecord, AutoReplyRunEventRecord, AutoReplyRunListItem, AutoReplyRunListQuery, AutoReplyRunListResult, AutoReplyRunRecord, AutoReplyRunUpdate, AutoReplyDecision, AutoReplyRunStage, AutoReplyRunStatus, AutoReplyConversationContext, AutoReplyConversationListQuery, AutoReplyConversationListResult, AutoReplyMessageContext, AutoReplyMessageListQuery, AutoReplyMessageListResult, AutoReplyOrderContext, AutoReplyOrderListQuery, AutoReplyOrderListResult, AutoReplyProductContext, AutoReplyProductListQuery, AutoReplyProductListResult, ConversationEventRecord, ConversationListQuery, ConversationListResult, ConversationRecord, CouponBatchListQuery, CouponBatchListResult, CouponBatchMetadata, CouponBatchRecord, CouponBatchStatus, CouponBindingRecord, CouponDeliveryScope, CouponItemRecord, CouponReservationItemRecord, CouponReservationPurpose, CouponReservationRecord, CredentialRecord, CredentialRefRecord, CredentialRefStatus, IdempotencyRecord, InboundInboxRecord, InboundQuarantineRecord, LoginSessionRecord, MessageListQuery, MessageListResult, MessageRecord, OrderListQuery, OrderListResult, OrderRecord, OrderSource, OrderUpsertResult, ProductAutomationBatchResult, ProductAutomationConfig, ProductAutomationConfigRecord, ProductListQuery, ProductListResult, ProductPatch, ProductRecord, ProductStatus, SessionRecord, Store, XianyuItemDetailPersistenceInput, XianyuOrderItem, XianyuProductItem, ProductUpsertResult, AutomationExecutionLedgerRecord } from './domain.js';
import { autoReplyStageForStatus } from './domain.js';
import { projectAutoReplyRun } from './auto-reply-activity-projection.js';
import { createId } from './security.js';
import { decodeConversationCursor, encodeConversationCursor, isAfterConversationCursor } from './conversation-cursor.js';
import { decodeMessageHistoryCursor } from './message-history-cursor.js';
import type { AgentSessionRecord, RunEventRecord, RunRecord, RunStatus, StepRecord, StepStatus, WorkspaceMessageRecord, WorkspaceMessageType } from './domain.js';
import { cloneCouponReservation, normalizeCouponReservationInput, normalizeLeaseSeconds, reservationFingerprint } from './coupon-reservation.js';
import { validatePersistedAutoReplyRepairPolicyBundle } from './auto-reply-repair-config.js';
import { readAutoReplyProductMetrics } from './auto-reply-product-metrics.js';

function meaningfulOrderTitle(value: string | undefined, references: Array<string | undefined>): string | undefined {
  const title = value?.trim();
  if (!title) return undefined;
  const normalizedReferences = references.map((reference) => reference?.trim()).filter(Boolean);
  return normalizedReferences.some((reference) => reference === title) ? undefined : title;
}
function firstImageUrl(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (Array.isArray(value)) return value.map((item) => firstImageUrl(item)).find(Boolean);
  return undefined;
}
function productImageUrl(product: ProductRecord | undefined): string | undefined {
  const attributes = product?.attributes ?? {};
  const xianyu = attributes.xianyu && typeof attributes.xianyu === 'object' && !Array.isArray(attributes.xianyu) ? attributes.xianyu as Record<string, unknown> : {};
  return firstImageUrl(xianyu.imageUrls) ?? firstImageUrl(xianyu.imageUrl) ?? firstImageUrl(attributes.imageUrls) ?? firstImageUrl(attributes.imageUrl);
}

function toAutoReplyProductContext(product: ProductRecord): AutoReplyProductContext {
  return {
    id: product.id,
    externalProductRef: product.externalProductRef,
    title: product.title,
    description: product.description,
    ...readAutoReplyProductMetrics(product.attributes),
    defaultReplyTemplate: product.defaultReplyTemplate,
    knowledgeBase: product.knowledgeBase,
    priceMinor: product.priceMinor,
    status: product.status,
  };
}

function toAutoReplyOrderContext(order: OrderRecord): AutoReplyOrderContext {
  return {
    orderNo: order.orderNo,
    itemId: order.itemId,
    itemTitle: order.itemTitle || order.itemId,
    paymentStatus: order.paymentStatus,
    orderStatus: order.orderStatus,
    deliveryStatus: order.deliveryStatus,
    afterSalesStatus: order.afterSalesStatus,
  };
}

function toAutoReplyConversationContext(conversation: ConversationRecord): AutoReplyConversationContext {
  return {
    id: conversation.id,
    itemRef: conversation.itemRef,
    itemTitle: conversation.itemTitle,
  };
}

function toAutoReplyMessageContext(message: MessageRecord): AutoReplyMessageContext {
  return {
    messageId: message.id,
    direction: message.direction,
    senderRole: message.senderRole,
    bodyType: message.bodyType,
    bodyText: message.bodyText,
    bodyRef: message.bodyRef,
  };
}

function cloneOutbox(record: AutoReplyOutboxRecord): AutoReplyOutboxRecord {
  return { ...record, payload: { ...record.payload } };
}

function conversationSortKey(conversation: ConversationRecord): string { return conversation.lastMessageAt ?? conversation.updatedAt; }

type MemoryRepairPolicyRecord = {
  accountId: string;
  policyVersion: string;
  status: 'ACTIVE' | 'RETIRED' | 'ROLLBACK_TARGET';
  bundle: AutoReplyRepairPolicyBundle;
  createdAt: string;
  updatedAt: string;
};

function cloneRepairPolicy(bundle: AutoReplyRepairPolicyBundle): AutoReplyRepairPolicyBundle {
  return JSON.parse(JSON.stringify(bundle)) as AutoReplyRepairPolicyBundle;
}

export class MemoryStore implements Store {
  readonly kind = 'memory' as const;
  private readonly admins = new Map<string, AdminRecord>();
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly accounts = new Map<string, AccountRecord>();
  private readonly loginSessions = new Map<string, LoginSessionRecord>();
  private readonly credentials = new Map<string, CredentialRecord>();
  private readonly credentialRefs = new Map<string, CredentialRefRecord>();
  private readonly credentialRefSecrets = new Map<string, string>();
  private readonly autoReplyAgentConfigs = new Map<string, AutoReplyAgentConfigRecord>();
  private readonly autoReplyRepairPolicies = new Map<string, Map<string, MemoryRepairPolicyRecord>>();
  private readonly products = new Map<string, ProductRecord>();
  private readonly productAutomations = new Map<string, ProductAutomationConfigRecord>();
  private readonly orders = new Map<string, OrderRecord>();
  private readonly automationExecutions = new Map<string, AutomationExecutionLedgerRecord>();
  private readonly reviewFacts = new Map<string, { accountId: string; orderNo: string; eventId: string; reviewedAt: string }>();
  private readonly couponBatches = new Map<string, CouponBatchRecord>();
  private readonly couponItems = new Map<string, CouponItemRecord>();
  private readonly couponBindings = new Map<string, CouponBindingRecord>();
  private readonly couponReservations = new Map<string, CouponReservationRecord>();
  private readonly couponReservationByExecutionKey = new Map<string, string>();
  private couponReservationMutex: Promise<void> = Promise.resolve();
  private readonly conversations = new Map<string, ConversationRecord>();
  private readonly messages = new Map<string, MessageRecord>();
  private readonly autoReplyRuns = new Map<string, AutoReplyRunRecord>();
  private readonly autoReplyRunEvents = new Map<string, AutoReplyRunEventRecord[]>();
  private readonly autoReplyRunEventSequences = new Map<string, number>();
  private readonly inboundInbox = new Map<string, InboundInboxRecord>();
  private readonly inboundMessageAliases = new Map<string, string>();
  private readonly inboundQuarantine = new Map<string, InboundQuarantineRecord>();
  private readonly conversationEvents = new Map<string, ConversationEventRecord[]>();
  private readonly conversationCursors = new Map<string, number>();
  private readonly scopes = new Map<string, AccountScopeRecord>();
  private readonly idempotency = new Map<string, IdempotencyRecord>();
  private readonly autoReplyOutbox = new Map<string, AutoReplyOutboxRecord>();
  private readonly agentSessions = new Map<string, AgentSessionRecord>();
  private readonly runs = new Map<string, RunRecord>();
  private readonly steps = new Map<string, StepRecord>();
  private readonly runEvents = new Map<string, RunEventRecord[]>();
  private readonly workspaceMessages = new Map<string, WorkspaceMessageRecord[]>();
  private runEventSequence = 0;
  readonly audits: AuditEventRecord[] = [];

  async health(): Promise<{ kind: string; reachable: boolean }> { return { kind: this.kind, reachable: true }; }
  async countAdmins(): Promise<number> { return this.admins.size; }
  async listAdminIds(): Promise<string[]> { return [...this.admins.keys()]; }
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
  async hasAccountScope(adminId: string, accountId: string): Promise<boolean> { const account = this.accounts.get(accountId); return account?.status !== 'disabled' && (await this.listScopes(adminId)).some((scope) => scope.accountId === accountId); }
  async grantScope(input: { adminId: string; accountId: string; scope: string }): Promise<AccountScopeRecord> {
    const existing = [...this.scopes.values()].find((item) => item.adminId === input.adminId && item.accountId === input.accountId && item.scope === input.scope);
    if (existing) { existing.status = 'active'; existing.revokedAt = undefined; return existing; }
    const row: AccountScopeRecord = { id: createId(), adminId: input.adminId, accountId: input.accountId, scope: input.scope, status: 'active' };
    this.scopes.set(row.id, row);
    return row;
  }
  async revokeScope(adminId: string, accountId: string, scope: string): Promise<void> { const item = [...this.scopes.values()].find((row) => row.adminId === adminId && row.accountId === accountId && row.scope === scope); if (item) { item.status = 'revoked'; item.revokedAt = new Date().toISOString(); } }
  async listAccounts(adminId: string, query: AccountListQuery = {}): Promise<AccountListResult> {
    const ids = new Set((await this.listScopes(adminId)).map((scope) => scope.accountId));
    const search = query.search?.trim().toLowerCase();
    const connectionStatus = (status: AccountRecord['status']): AccountListQuery['connectionStatus'] => status === 'connected' ? 'online' : status === 'pending' ? 'connecting' : status === 'expired' ? 'expired' : status === 'degraded' ? 'unknown' : 'offline';
    const filtered = [...this.accounts.values()].filter((account) => ids.has(account.id) && account.status !== 'disabled')
      .filter((account) => !query.accountId || account.id === query.accountId)
      .filter((account) => !search || [account.id, account.sellerRef, account.displayName ?? '', account.remark ?? ''].some((value) => value.toLowerCase().includes(search)))
      .filter((account) => !query.status || account.status === query.status)
      .filter((account) => !query.connectionStatus || connectionStatus(account.status) === query.connectionStatus);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const total = filtered.length;
    return { items: filtered.slice((page - 1) * pageSize, page * pageSize), page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
  }
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
  async deleteAccount(adminId: string, accountId: string): Promise<AccountRecord | undefined> { const account = await this.getAccount(adminId, accountId); if (!account) return undefined; account.status = 'disabled'; account.updatedAt = new Date().toISOString(); const credential = this.credentials.get(accountId); if (credential && credential.status === 'active') { credential.status = 'revoked'; credential.updatedAt = account.updatedAt; } for (const scope of this.scopes.values()) { if (scope.accountId === accountId && scope.status === 'active') { scope.status = 'revoked'; scope.revokedAt = account.updatedAt; } } return { ...account }; }
  async listProducts(adminId: string, query: ProductListQuery): Promise<ProductListResult> {
    const scopedAccountIds = new Set((await this.listScopes(adminId)).map((scope) => scope.accountId));
    const normalizedKeyword = query.keyword?.trim().toLowerCase();
    const filtered = [...this.products.values()].filter((product) => {
      if (!scopedAccountIds.has(product.accountId)) return false;
      if (query.accountId && product.accountId !== query.accountId) return false;
      if (query.status && product.status !== query.status) return false;
      if (normalizedKeyword && ![product.title, product.externalProductRef ?? '', product.description ?? ''].some((value) => value.toLowerCase().includes(normalizedKeyword))) return false;
      return true;
    });
    const sortBy = query.sortBy ?? 'xianyuOrder';
    const sortOrder = query.sortOrder === 'desc' ? -1 : sortBy === 'xianyuOrder' ? 1 : -1;
    filtered.sort((left, right) => {
      if (sortBy === 'xianyuOrder') {
        if (left.xianyuListRank === undefined && right.xianyuListRank === undefined) return left.id.localeCompare(right.id);
        if (left.xianyuListRank === undefined) return 1;
        if (right.xianyuListRank === undefined) return -1;
        return (left.xianyuListRank - right.xianyuListRank || left.id.localeCompare(right.id)) * sortOrder;
      }
      if (sortBy === 'updatedAt') {
        if (!left.xianyuUpdatedAt && !right.xianyuUpdatedAt) return 0;
        if (!left.xianyuUpdatedAt) return 1;
        if (!right.xianyuUpdatedAt) return -1;
        return (left.xianyuUpdatedAt < right.xianyuUpdatedAt ? -1 : left.xianyuUpdatedAt > right.xianyuUpdatedAt ? 1 : 0) * sortOrder;
      }
      const leftValue = sortBy === 'title' ? left.title.toLowerCase() : sortBy === 'priceMinor' ? (left.priceMinor ?? 0) : left.createdAt;
      const rightValue = sortBy === 'title' ? right.title.toLowerCase() : sortBy === 'priceMinor' ? (right.priceMinor ?? 0) : right.createdAt;
      return (leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0) * sortOrder;
    });
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const start = (page - 1) * pageSize;
    const items = filtered.slice(start, start + pageSize).map((product) => this.productSummary(product));
    return { items, page, pageSize, total: filtered.length, totalPages: Math.max(1, Math.ceil(filtered.length / pageSize)) };
  }
  async listAutoReplyProducts(adminId: string, query: AutoReplyProductListQuery): Promise<AutoReplyProductListResult> {
    const scopedAccountIds = new Set((await this.listScopes(adminId)).map((scope) => scope.accountId));
    const normalizedKeyword = query.keyword?.trim().toLowerCase();
    const filtered = [...this.products.values()].filter((product) => {
      if (!scopedAccountIds.has(product.accountId) || product.accountId !== query.accountId) return false;
      if (query.productId && product.id !== query.productId) return false;
      if (normalizedKeyword && ![product.title, product.externalProductRef ?? '', product.description ?? ''].some((value) => value.toLowerCase().includes(normalizedKeyword))) return false;
      return true;
    }).sort((left, right) => left.title.localeCompare(right.title) || left.id.localeCompare(right.id));
    const limit = Math.min(50, Math.max(1, query.limit ?? 10));
    return { items: filtered.slice(0, limit).map(toAutoReplyProductContext), total: filtered.length };
  }
  async getProduct(adminId: string, productId: string): Promise<ProductRecord | undefined> {
    const product = this.products.get(productId);
    if (!product || !(await this.hasAccountScope(adminId, product.accountId))) return undefined;
    return this.productDetail(product);
  }

  async getProductAutomation(adminId: string, productId: string): Promise<ProductAutomationConfigRecord | undefined> {
    const product = this.products.get(productId);
    if (!product || !(await this.hasAccountScope(adminId, product.accountId))) return undefined;
    const record = this.productAutomations.get(productId);
    return record ? this.cloneProductAutomation(record) : undefined;
  }

  async updateProductAutomation(input: { adminId: string; productId: string; expectedConfigVersion: number; config: ProductAutomationConfig; configDigest: string }): Promise<ProductAutomationConfigRecord | undefined> {
    const product = this.products.get(input.productId);
    if (!product) return undefined;
    if (!(await this.hasAccountScope(input.adminId, product.accountId))) throw new Error('ACCOUNT_SCOPE_FORBIDDEN');
    const current = this.productAutomations.get(input.productId);
    if (current && current.configVersion !== input.expectedConfigVersion) throw new Error('AUTOMATION_VERSION_CONFLICT');
    if (!current && input.expectedConfigVersion !== 1) throw new Error('AUTOMATION_VERSION_CONFLICT');
    const now = new Date().toISOString();
    const record: ProductAutomationConfigRecord = {
      id: current?.id ?? createId(),
      productId: input.productId,
      accountId: product.accountId,
      configVersion: current ? current.configVersion + 1 : 1,
      config: structuredClone(input.config),
      configDigest: input.configDigest,
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
    };
    this.productAutomations.set(input.productId, record);
    return this.cloneProductAutomation(record);
  }

  async updateProductAutomationsBatch(input: { adminId: string; productIds: string[]; expectedConfigVersions: Record<string, number>; config?: ProductAutomationConfig; configDigest?: string; configByProductId?: Record<string, ProductAutomationConfig>; configDigests?: Record<string, string> }): Promise<ProductAutomationBatchResult> {
    const uniqueProductIds = [...new Set(input.productIds)];
    const products = uniqueProductIds.map((productId) => this.products.get(productId));
    if (products.some((product) => !product)) throw new Error('PRODUCT_NOT_FOUND');
    if (products.some((product) => product && product.accountId !== products[0]!.accountId)) throw new Error('AUTOMATION_BATCH_ACCOUNT_MISMATCH');
    if (!(await this.hasAccountScope(input.adminId, products[0]!.accountId))) throw new Error('ACCOUNT_SCOPE_FORBIDDEN');
    for (const productId of uniqueProductIds) {
      const current = this.productAutomations.get(productId);
      const expected = input.expectedConfigVersions[productId];
      if (!Number.isSafeInteger(expected) || (current ? current.configVersion !== expected : expected !== 1)) throw new Error('AUTOMATION_VERSION_CONFLICT');
    }
    const now = new Date().toISOString();
    const staged = uniqueProductIds.map((productId) => {
      const current = this.productAutomations.get(productId);
      return {
        id: current?.id ?? createId(),
        productId,
        accountId: products.find((product) => product?.id === productId)!.accountId,
        configVersion: current ? current.configVersion + 1 : 1,
        config: structuredClone(input.configByProductId?.[productId] ?? input.config!),
        configDigest: input.configDigests?.[productId] ?? input.configDigest ?? '',
        createdAt: current?.createdAt ?? now,
        updatedAt: now,
      } satisfies ProductAutomationConfigRecord;
    });
    for (const record of staged) this.productAutomations.set(record.productId, record);
    return { items: staged.map((record) => this.cloneProductAutomation(record)), updatedProductIds: uniqueProductIds };
  }

  async persistXianyuItemDetail(input: XianyuItemDetailPersistenceInput): Promise<ProductRecord | undefined> {
    const product = this.products.get(input.productId);
    if (!product) return undefined;
    if (!(await this.hasAccountScope(input.adminId, product.accountId))) throw new Error('ACCOUNT_SCOPE_FORBIDDEN');
    const existingXianyu = product.attributes.xianyu && typeof product.attributes.xianyu === 'object' && !Array.isArray(product.attributes.xianyu)
      ? product.attributes.xianyu as Record<string, unknown>
      : {};
    const detail = { itemId: input.itemId, summary: { ...input.summary }, rawResponse: { ...input.rawResponse }, imageUrls: [...input.imageUrls], assetUploadErrors: input.assetUploadErrors ? input.assetUploadErrors.map((entry) => ({ ...entry })) : [], syncedAt: input.syncedAt };
    product.attributes = { ...product.attributes, xianyu: { ...existingXianyu, imageUrls: [...input.imageUrls], detail } };
    const summary = input.summary;
    if (typeof summary.title === 'string' && summary.title.trim()) product.title = summary.title.trim();
    if (typeof summary.description === 'string') product.description = summary.description;
    if (typeof summary.priceMinor === 'number' && Number.isSafeInteger(summary.priceMinor)) product.priceMinor = summary.priceMinor;
    if (typeof summary.xianyuUpdatedAt === 'string' && summary.xianyuUpdatedAt.trim()) product.xianyuUpdatedAt = summary.xianyuUpdatedAt;
    product.externalProductRef = product.externalProductRef ?? input.itemId;
    product.source = 'xianyu';
    product.lastSyncedAt = input.syncedAt;
    product.sourcePayloadDigest = input.sourcePayloadDigest;
    product.configVersion += 1;
    product.updatedAt = input.syncedAt;
    const assets = product.assets ?? [];
    const currentStorageKeys = new Set(input.assets.map((asset) => asset.storageKey));
    const previousImageUrls = Array.isArray((existingXianyu.detail as Record<string, unknown> | undefined)?.imageUrls)
      ? ((existingXianyu.detail as Record<string, unknown>).imageUrls as unknown[]).filter((value): value is string => typeof value === 'string')
      : [];
    for (const existing of assets) {
      const metadata = existing.metadata ?? {};
      const isDetailAsset = metadata.source === 'xianyu-detail'
        || existing.storageKey.startsWith(`products/${product.id}/xianyu/${input.itemId}/images/`)
        || Boolean(existing.sourceUrl && previousImageUrls.includes(existing.sourceUrl));
      if (isDetailAsset && !currentStorageKeys.has(existing.storageKey)) existing.status = 'archived';
    }
    for (const inputAsset of input.assets) {
      const existing = assets.find((asset) => asset.storageKey === inputAsset.storageKey);
      const next = { id: existing?.id ?? createId(), productId: product.id, storageKey: inputAsset.storageKey, mimeType: inputAsset.mimeType, checksum: inputAsset.checksum, sourceUrl: inputAsset.sourceUrl, metadata: inputAsset.metadata ? { ...inputAsset.metadata } : undefined, status: inputAsset.status ?? 'active' as const };
      if (existing) Object.assign(existing, next);
      else assets.push(next);
    }
    product.assets = assets;
    return this.productDetail(product);
  }
  async listOrders(adminId: string, query: OrderListQuery): Promise<OrderListResult> {
    const scopedAccountIds = new Set((await this.listScopes(adminId)).map((scope) => scope.accountId));
    const normalizedKeyword = query.keyword?.trim().toLowerCase();
    const filtered = [...this.orders.values()].filter((order) => {
      if (!scopedAccountIds.has(order.accountId)) return false;
      if (query.accountId && order.accountId !== query.accountId) return false;
      if (query.paymentStatus && order.paymentStatus !== query.paymentStatus) return false;
      if (query.orderStatus && order.orderStatus !== query.orderStatus) return false;
      if (query.deliveryStatus && order.deliveryStatus !== query.deliveryStatus) return false;
      if (query.afterSalesStatus && order.afterSalesStatus !== query.afterSalesStatus) return false;
      const displayOrder = this.enrichOrder(order);
      if (normalizedKeyword && ![displayOrder.orderNo, displayOrder.buyerNickname ?? '', displayOrder.itemTitle].some((value) => value.toLowerCase().includes(normalizedKeyword))) return false;
      return true;
    });
    const sortBy = query.sortBy ?? 'createdAt';
    const sortOrder = query.sortOrder === 'asc' ? 1 : -1;
    filtered.sort((left, right) => {
      const leftValue = sortBy === 'amountMinor' ? left.amountMinor : left.createdAt;
      const rightValue = sortBy === 'amountMinor' ? right.amountMinor : right.createdAt;
      return (leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0) * sortOrder;
    });
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const start = (page - 1) * pageSize;
    return { items: filtered.slice(start, start + pageSize).map((order) => this.enrichOrder(order)), page, pageSize, total: filtered.length, totalPages: Math.max(1, Math.ceil(filtered.length / pageSize)) };
  }
  async listAutoReplyOrders(adminId: string, query: AutoReplyOrderListQuery): Promise<AutoReplyOrderListResult> {
    if (!query.buyerId && !query.conversationId) return { items: [], total: 0 };
    const scopedAccountIds = new Set((await this.listScopes(adminId)).map((scope) => scope.accountId));
    const filtered = [...this.orders.values()]
      .filter((order) => scopedAccountIds.has(order.accountId) && order.accountId === query.accountId)
      .filter((order) => Boolean((query.buyerId && order.buyerId === query.buyerId) || (query.conversationId && order.conversationId === query.conversationId)))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.orderNo.localeCompare(left.orderNo));
    const limit = Math.min(50, Math.max(1, query.limit ?? 20));
    return { items: filtered.slice(0, limit).map(toAutoReplyOrderContext), total: filtered.length };
  }
  async getOrder(adminId: string, orderNo: string, accountId?: string): Promise<OrderRecord | undefined> {
    const order = [...this.orders.values()].find((item) => item.orderNo === orderNo && (!accountId || item.accountId === accountId));
    if (!order || !(await this.hasAccountScope(adminId, order.accountId))) return undefined;
    return this.enrichOrder(order);
  }
  async createOrder(input: { adminId: string; order: Omit<OrderRecord, 'id' | 'createdAt' | 'updatedAt' | 'configVersion' | 'source'> & { id?: string; createdAt?: string; updatedAt?: string; configVersion?: number; source?: OrderSource } }): Promise<OrderRecord> {
    if (!(await this.hasAccountScope(input.adminId, input.order.accountId))) throw new Error('ACCOUNT_SCOPE_FORBIDDEN');
    const duplicate = [...this.orders.values()].find((order) => order.orderNo === input.order.orderNo && order.accountId === input.order.accountId);
    if (duplicate) throw new Error('ORDER_DUPLICATE');
    const now = new Date().toISOString();
    const order: OrderRecord = { ...input.order, id: input.order.id ?? createId(), createdAt: input.order.createdAt ?? now, updatedAt: input.order.updatedAt ?? now, configVersion: input.order.configVersion ?? 1, source: input.order.source ?? 'local' };
    this.orders.set(order.id, order);
    return this.enrichOrder(order);
  }
  async upsertExternalOrder(input: { adminId: string; accountId: string; item: XianyuOrderItem; syncedAt: string; accountName?: string }): Promise<OrderUpsertResult> {
    if (!(await this.hasAccountScope(input.adminId, input.accountId))) throw new Error('ACCOUNT_SCOPE_FORBIDDEN');
    const linkedProductId = input.item.productId ?? [...this.products.values()].find((product) => product.accountId === input.accountId && product.externalProductRef === input.item.itemId)?.id;
    const existing = [...this.orders.values()].find((order) => order.accountId === input.accountId && order.orderNo === input.item.orderNo);
    const now = input.syncedAt;
    if (existing) {
      Object.assign(existing, { ...input.item, productId: linkedProductId ?? existing.productId, accountId: input.accountId, accountName: input.accountName ?? existing.accountName, updatedAt: now, source: 'xianyu' as const, sourcePayloadDigest: input.item.sourcePayloadDigest, configVersion: existing.configVersion + 1 });
      return { action: 'updated', order: this.enrichOrder(existing) };
    }
    const order: OrderRecord = { ...input.item, productId: linkedProductId, id: createId(), accountId: input.accountId, accountName: input.accountName, updatedAt: input.item.updatedAt ?? now, configVersion: 1, source: 'xianyu' };
    this.orders.set(order.id, order);
    return { action: 'created', order: this.enrichOrder(order) };
  }
  async createProduct(input: { adminId: string; accountId: string; externalProductRef?: string; title: string; description?: string; categoryCode?: string; attributes?: Record<string, unknown>; defaultReplyTemplate?: string; knowledgeBase?: string; priceMinor?: number; status?: ProductStatus }): Promise<ProductRecord> {
    if (!(await this.hasAccountScope(input.adminId, input.accountId))) throw new Error('ACCOUNT_SCOPE_FORBIDDEN');
    const duplicate = [...this.products.values()].find((product) => product.accountId === input.accountId && input.externalProductRef && product.externalProductRef === input.externalProductRef);
    if (duplicate) throw new Error('PRODUCT_DUPLICATE');
    const now = new Date().toISOString();
    const product: ProductRecord = { id: createId(), accountId: input.accountId, externalProductRef: input.externalProductRef, title: input.title, description: input.description, categoryCode: input.categoryCode, attributes: input.attributes ?? {}, defaultReplyTemplate: input.defaultReplyTemplate, knowledgeBase: input.knowledgeBase, configVersion: 1, priceMinor: input.priceMinor, status: input.status ?? 'draft', source: 'local', createdAt: now, updatedAt: now, skuCount: 0, assetCount: 0, skus: [], assets: [] };
    this.products.set(product.id, product);
    return this.productDetail(product);
  }

  async upsertExternalProduct(input: { adminId: string; accountId: string; item: XianyuProductItem; syncedAt: string }): Promise<ProductUpsertResult> {
    if (!(await this.hasAccountScope(input.adminId, input.accountId))) throw new Error('ACCOUNT_SCOPE_FORBIDDEN');
    const existing = [...this.products.values()].find((product) => product.accountId === input.accountId && product.externalProductRef === input.item.externalProductRef);
    if (existing?.source === 'local' && existing.status === 'draft') return { action: 'skipped_local_draft', product: this.productDetail(existing) };
    const now = new Date().toISOString();
    const existingAttributes = existing?.attributes && typeof existing.attributes === 'object' ? existing.attributes : {};
    const existingXianyu = existingAttributes.xianyu && typeof existingAttributes.xianyu === 'object' && !Array.isArray(existingAttributes.xianyu) ? existingAttributes.xianyu as Record<string, unknown> : {};
    const incomingXianyu = input.item.attributes?.xianyu && typeof input.item.attributes.xianyu === 'object' && !Array.isArray(input.item.attributes.xianyu) ? input.item.attributes.xianyu as Record<string, unknown> : {};
    const attributes = {
      ...existingAttributes,
      ...input.item.attributes,
      xianyu: {
        ...existingXianyu,
        ...incomingXianyu,
        detailUrl: input.item.detailUrl,
        externalStatus: input.item.externalStatus,
        imageUrls: input.item.imageUrls,
        ...(input.item.xianyuUpdatedAt ? { updatedAt: input.item.xianyuUpdatedAt } : {}),
        ...(existingXianyu.detail !== undefined ? { detail: existingXianyu.detail } : incomingXianyu.detail !== undefined ? { detail: incomingXianyu.detail } : {}),
      },
    };
    if (existing) {
      existing.title = input.item.title;
      existing.description = input.item.description;
      existing.categoryCode = input.item.categoryCode;
      existing.priceMinor = input.item.priceMinor;
      existing.attributes = attributes;
      existing.source = 'xianyu';
      existing.sourcePayloadDigest = input.item.sourcePayloadDigest;
      existing.lastSyncedAt = input.syncedAt;
      existing.xianyuUpdatedAt = input.item.xianyuUpdatedAt ?? existing.xianyuUpdatedAt;
      existing.xianyuListRank = input.item.xianyuListRank ?? existing.xianyuListRank;
      existing.status = 'published';
      existing.configVersion += 1;
      existing.updatedAt = now;
      return { action: 'updated', product: this.productDetail(existing) };
    }
    const product: ProductRecord = { id: createId(), accountId: input.accountId, externalProductRef: input.item.externalProductRef, title: input.item.title, description: input.item.description, categoryCode: input.item.categoryCode, attributes, configVersion: 1, priceMinor: input.item.priceMinor, status: 'published', source: 'xianyu', lastSyncedAt: input.syncedAt, xianyuUpdatedAt: input.item.xianyuUpdatedAt, xianyuListRank: input.item.xianyuListRank, sourcePayloadDigest: input.item.sourcePayloadDigest, createdAt: now, updatedAt: now, skuCount: 0, assetCount: 0, skus: [], assets: [] };
    this.products.set(product.id, product);
    return { action: 'created', product: this.productDetail(product) };
  }
  async resetXianyuListRanks(adminId: string, accountId: string): Promise<void> {
    if (!(await this.hasAccountScope(adminId, accountId))) throw new Error('ACCOUNT_SCOPE_FORBIDDEN');
    for (const product of this.products.values()) {
      if (product.accountId === accountId && product.source === 'xianyu') product.xianyuListRank = undefined;
    }
  }
  async updateProduct(input: { adminId: string; productId: string; expectedConfigVersion: number; patch: ProductPatch }): Promise<ProductRecord | undefined> {
    const product = this.products.get(input.productId);
    if (!product) return undefined;
    if (!(await this.hasAccountScope(input.adminId, product.accountId))) throw new Error('ACCOUNT_SCOPE_FORBIDDEN');
    if (product.configVersion !== input.expectedConfigVersion) throw new Error('PRODUCT_VERSION_CONFLICT');
    if (input.patch.title !== undefined) product.title = input.patch.title;
    if (input.patch.description !== undefined) product.description = input.patch.description ?? undefined;
    if (input.patch.categoryCode !== undefined) product.categoryCode = input.patch.categoryCode ?? undefined;
    if (input.patch.attributes !== undefined) product.attributes = { ...input.patch.attributes };
    if (input.patch.defaultReplyTemplate !== undefined) product.defaultReplyTemplate = input.patch.defaultReplyTemplate ?? undefined;
    if (input.patch.knowledgeBase !== undefined) product.knowledgeBase = input.patch.knowledgeBase ?? undefined;
    if (input.patch.priceMinor !== undefined) product.priceMinor = input.patch.priceMinor ?? undefined;
    product.configVersion += 1;
    product.updatedAt = new Date().toISOString();
    return this.productDetail(product);
  }
  async listCouponBatches(adminId: string, query: CouponBatchListQuery): Promise<CouponBatchListResult> {
    const scopedAccounts = new Set((await this.listScopes(adminId)).map((scope) => scope.accountId));
    const normalizedKeyword = query.keyword?.trim().toLowerCase();
    const sortDirection = query.sortOrder === 'asc' ? 1 : -1;
    const activeSequenceIds = new Set([...this.couponBatches.values()].filter((batch) => batch.status !== 'voided' && batch.sequenceId).map((batch) => batch.sequenceId!));
    const filtered = [...this.couponBatches.values()].filter((batch) => {
      if (!scopedAccounts.has(batch.accountId)) return false;
      if (query.accountId && batch.accountId !== query.accountId) return false;
      if (!query.status && batch.status === 'voided') return false;
      if (query.status && batch.status !== query.status) return false;
      if (query.status === 'voided' && batch.sequenceId && activeSequenceIds.has(batch.sequenceId)) return false;
      if (query.purpose && batch.purpose !== query.purpose) return false;
      if (normalizedKeyword && !`${batch.sequenceId ?? ''} ${batch.id} ${batch.label ?? ''} ${batch.purpose}`.toLowerCase().includes(normalizedKeyword)) return false;
      if (query.stockAlert) {
        const items = [...this.couponItems.values()].filter((item) => item.batchId === batch.id);
        const available = items.filter((item) => item.status === 'available').length;
        const stockAlert = batch.status === 'voided' || available === 0 ? 'exhausted' : available <= 5 ? 'low_stock' : 'normal';
        if (stockAlert !== query.stockAlert) return false;
      }
      return true;
    }).sort((left, right) => (left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)) * sortDirection);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const start = (page - 1) * pageSize;
    return { items: filtered.slice(start, start + pageSize).map((batch) => this.couponSummary(batch)), page, pageSize, total: filtered.length, totalPages: Math.max(1, Math.ceil(filtered.length / pageSize)) };
  }
  async getCouponBatch(adminId: string, batchId: string): Promise<CouponBatchRecord | undefined> {
    const batch = this.findCouponBatch(batchId);
    if (!batch || !(await this.hasAccountScope(adminId, batch.accountId))) return undefined;
    const items = [...this.couponItems.values()].filter((item) => item.batchId === batch.id).map((item) => ({ ...item }));
    const bindings = [...this.couponBindings.values()].filter((binding) => binding.batchId === batch.id).map((binding) => ({ ...binding }));
    return { ...batch, items, bindings };
  }
  async createCouponBatch(input: { adminId: string; accountId: string; label?: string; purpose: string; deliveryScope: CouponDeliveryScope; quarkUrl?: string; extractionCode?: string; metadata?: CouponBatchMetadata }): Promise<CouponBatchRecord> {
    if (!(await this.hasAccountScope(input.adminId, input.accountId))) throw new Error('ACCOUNT_SCOPE_FORBIDDEN');
    const now = new Date().toISOString();
    const batch: CouponBatchRecord = { id: createId(), sequenceId: this.nextCouponBatchSequence(), accountId: input.accountId, label: input.label, purpose: input.purpose, deliveryScope: input.deliveryScope, quarkUrl: input.quarkUrl, extractionCode: input.extractionCode, metadata: input.metadata ?? {}, totalCount: 0, status: 'active', version: 1, createdAt: now, updatedAt: now };
    this.couponBatches.set(batch.id, batch);
    return { ...batch };
  }
  async updateCouponBatch(input: { adminId: string; batchId: string; patch: { label?: string; purpose?: string; deliveryScope?: CouponDeliveryScope; quarkUrl?: string; extractionCode?: string; status?: CouponBatchStatus; metadata?: CouponBatchMetadata } }): Promise<CouponBatchRecord | undefined> {
    const batch = this.findCouponBatch(input.batchId);
    if (!batch || !(await this.hasAccountScope(input.adminId, batch.accountId))) return undefined;
    if (batch.status === 'voided') throw new Error('COUPON_BATCH_VOIDED');
    if (input.patch.label !== undefined) batch.label = input.patch.label;
    if (input.patch.purpose !== undefined) batch.purpose = input.patch.purpose;
    if (input.patch.deliveryScope !== undefined) batch.deliveryScope = input.patch.deliveryScope;
    if (input.patch.quarkUrl !== undefined) batch.quarkUrl = input.patch.quarkUrl || undefined;
    if (input.patch.extractionCode !== undefined) batch.extractionCode = input.patch.extractionCode || undefined;
    if (input.patch.status !== undefined) batch.status = input.patch.status;
    if (input.patch.metadata !== undefined) batch.metadata = input.patch.metadata;
    batch.version += 1;
    batch.updatedAt = new Date().toISOString();
    return { ...batch };
  }
  async importCouponItems(input: { adminId: string; batchId: string; contents: string[] }): Promise<{ batch: CouponBatchRecord; items: CouponItemRecord[]; rejected: Array<{ index: number; code: string; message: string }> }> {
    const batch = this.findCouponBatch(input.batchId);
    if (!batch || !(await this.hasAccountScope(input.adminId, batch.accountId))) throw new Error('COUPON_NOT_FOUND');
    if (batch.status === 'voided' || batch.status === 'closed') throw new Error('COUPON_BATCH_VOIDED');
    const existingContent = new Set([...this.couponItems.values()].filter((item) => item.batchId === batch.id).map((item) => item.content));
    const created: CouponItemRecord[] = [];
    const rejected: Array<{ index: number; code: string; message: string }> = [];
    input.contents.forEach((raw, index) => {
      const content = raw.trim();
      if (!content) { rejected.push({ index, code: 'VALIDATION_FAILED', message: 'coupon content is required' }); return; }
      if (existingContent.has(content)) { rejected.push({ index, code: 'CONFLICT', message: 'duplicate coupon content' }); return; }
      const item: CouponItemRecord = { id: createId(), batchId: batch.id, content, status: 'available', createdAt: new Date().toISOString() };
      existingContent.add(content);
      this.couponItems.set(item.id, item);
      created.push({ ...item });
    });
    batch.totalCount = [...this.couponItems.values()].filter((item) => item.batchId === batch.id).length;
    batch.version += 1;
    batch.updatedAt = new Date().toISOString();
    if (batch.totalCount > 0 && batch.status === 'exhausted') batch.status = 'active';
    return { batch: { ...batch }, items: created, rejected };
  }
  async bindCouponBatch(input: { adminId: string; batchId: string; productId: string }): Promise<CouponBindingRecord> {
    const batch = this.findCouponBatch(input.batchId);
    if (!batch || !(await this.hasAccountScope(input.adminId, batch.accountId))) throw new Error('COUPON_NOT_FOUND');
    if (batch.status === 'voided' || batch.status === 'closed') throw new Error('COUPON_BATCH_VOIDED');
    const product = await this.getProduct(input.adminId, input.productId);
    if (!product) throw new Error('PRODUCT_NOT_FOUND');
    if (product.accountId !== batch.accountId) throw new Error('ACCOUNT_SCOPE_FORBIDDEN');
    const existing = [...this.couponBindings.values()].find((binding) => binding.batchId === batch.id && binding.productId === product.id);
    if (existing) { existing.status = 'active'; existing.updatedAt = new Date().toISOString(); return { ...existing }; }
    const now = new Date().toISOString();
    const binding: CouponBindingRecord = { id: createId(), batchId: batch.id, productId: product.id, priority: 0, status: 'active', createdAt: now, updatedAt: now };
    this.couponBindings.set(binding.id, binding);
    batch.version += 1;
    batch.updatedAt = now;
    return { ...binding };
  }
  async unbindCouponBatch(input: { adminId: string; batchId: string; productId: string }): Promise<CouponBindingRecord | undefined> {
    const batch = this.findCouponBatch(input.batchId);
    if (!batch || !(await this.hasAccountScope(input.adminId, batch.accountId))) throw new Error('COUPON_NOT_FOUND');
    const binding = [...this.couponBindings.values()].find((row) => row.batchId === batch.id && row.productId === input.productId);
    if (!binding) return undefined;
    binding.status = 'inactive';
    binding.updatedAt = new Date().toISOString();
    batch.version += 1;
    batch.updatedAt = binding.updatedAt;
    return { ...binding };
  }
  async voidCouponBatch(input: { adminId: string; batchId: string }): Promise<CouponBatchRecord | undefined> {
    const batch = this.findCouponBatch(input.batchId);
    if (!batch || !(await this.hasAccountScope(input.adminId, batch.accountId))) return undefined;
    if (batch.status === 'voided') return { ...batch };
    batch.status = 'voided';
    batch.version += 1;
    batch.updatedAt = new Date().toISOString();
    return { ...batch };
  }
  async getCouponContent(adminId: string, itemId: string): Promise<{ batch: CouponBatchRecord; item: CouponItemRecord } | undefined> {
    const item = this.couponItems.get(itemId);
    if (!item) return undefined;
    const batch = this.couponBatches.get(item.batchId);
    if (!batch || !(await this.hasAccountScope(adminId, batch.accountId))) return undefined;
    return { batch: { ...batch }, item: { ...item } };
  }

  async reserveCoupon(input: { adminId: string; accountId: string; batchIds: string[]; quantity: number; executionKey: string; purpose: CouponReservationPurpose; leaseSeconds?: number }): Promise<CouponReservationRecord> {
    return this.withCouponReservationLock(async () => {
      const normalized = normalizeCouponReservationInput(input);
      const leaseSeconds = normalizeLeaseSeconds(input.leaseSeconds);
      await this.expireCouponReservations();
      if (!(await this.hasAccountScope(input.adminId, input.accountId))) throw new Error('ACCOUNT_SCOPE_FORBIDDEN');
      const batches = normalized.batchIds.map((batchId) => this.findCouponBatch(batchId));
      if (batches.some((batch) => !batch)) throw new Error('COUPON_BATCH_NOT_FOUND');
      const resolvedBatches = batches as CouponBatchRecord[];
      if (resolvedBatches.some((batch) => batch.accountId !== input.accountId)) throw new Error('COUPON_BATCH_ACCOUNT_MISMATCH');
      const uniqueBatches = [...new Map(resolvedBatches.map((batch) => [batch.id, batch])).values()];
      if (uniqueBatches.some((batch) => batch.status !== 'active' && batch.status !== 'exhausted')) throw new Error('COUPON_BATCH_UNAVAILABLE');
      if (uniqueBatches.some((batch) => batch.deliveryScope !== 'buyer_deliverable')) throw new Error('COUPON_BATCH_NOT_DELIVERABLE');
      const batchIds = uniqueBatches.map((batch) => batch.id);
      const fingerprint = reservationFingerprint({ adminId: input.adminId, accountId: input.accountId, batchIds, quantity: normalized.quantity, purpose: normalized.purpose });
      const existingId = this.couponReservationByExecutionKey.get(normalized.executionKey);
      const existing = existingId ? this.couponReservations.get(existingId) : undefined;
      if (existing) {
        if (existing.fingerprint !== fingerprint || existing.adminId !== input.adminId || existing.accountId !== input.accountId) throw new Error('COUPON_RESERVATION_KEY_CONFLICT');
        if (existing.status === 'committed' || existing.status === 'reserved') return cloneCouponReservation(existing);
      }
      const selected = this.selectAvailableCouponItems(uniqueBatches, normalized.quantity);
      if (selected.length < normalized.quantity) throw new Error('COUPON_INSUFFICIENT_INVENTORY');
      const now = new Date();
      const nowIso = now.toISOString();
      const leaseUntil = new Date(now.getTime() + leaseSeconds * 1000).toISOString();
      for (const item of selected) { item.status = 'reserved'; item.reservedUntil = leaseUntil; }
      const reservation: CouponReservationRecord = existing ?? {
        reservationId: createId(),
        adminId: input.adminId,
        accountId: input.accountId,
        executionKey: normalized.executionKey,
        purpose: normalized.purpose,
        batchIds,
        fingerprint,
        quantity: normalized.quantity,
        status: 'reserved',
        leaseUntil,
        items: [],
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      reservation.adminId = input.adminId;
      reservation.accountId = input.accountId;
      reservation.purpose = normalized.purpose;
      reservation.batchIds = batchIds;
      reservation.fingerprint = fingerprint;
      reservation.quantity = normalized.quantity;
      reservation.status = 'reserved';
      reservation.leaseUntil = leaseUntil;
      reservation.reason = undefined;
      reservation.finalizedAt = undefined;
      reservation.updatedAt = nowIso;
      reservation.items = selected.map((item) => {
        const batch = this.couponBatches.get(item.batchId)!;
        return { itemId: item.id, content: item.content, batchId: batch.id, batchLabel: batch.label, quarkUrl: batch.quarkUrl, extractionCode: batch.extractionCode };
      });
      this.couponReservations.set(reservation.reservationId, reservation);
      this.couponReservationByExecutionKey.set(normalized.executionKey, reservation.reservationId);
      return cloneCouponReservation(reservation);
    });
  }

  async getCouponReservation(input: { adminId: string; reservationId: string; executionKey?: string }): Promise<CouponReservationRecord | undefined> {
    return this.withCouponReservationLock(async () => {
      await this.expireCouponReservations();
      const reservation = this.couponReservations.get(input.reservationId);
      if (!reservation || !(await this.hasAccountScope(input.adminId, reservation.accountId))) return undefined;
      if (reservation.adminId !== input.adminId) return undefined;
      if (input.executionKey !== undefined && input.executionKey !== reservation.executionKey) throw new Error('COUPON_RESERVATION_KEY_CONFLICT');
      return cloneCouponReservation(reservation);
    });
  }

  async commitCouponReservation(input: { adminId: string; reservationId: string; executionKey: string }): Promise<CouponReservationRecord> {
    return this.withCouponReservationLock(async () => {
      await this.expireCouponReservations();
      const reservation = this.couponReservations.get(input.reservationId);
      if (!reservation || !(await this.hasAccountScope(input.adminId, reservation.accountId)) || reservation.adminId !== input.adminId) throw new Error('COUPON_RESERVATION_NOT_FOUND');
      if (reservation.executionKey !== input.executionKey) throw new Error('COUPON_RESERVATION_KEY_CONFLICT');
      if (reservation.status === 'committed') return cloneCouponReservation(reservation);
      if (reservation.status === 'expired') throw new Error('COUPON_RESERVATION_EXPIRED');
      if (reservation.status !== 'reserved') throw new Error('COUPON_RESERVATION_NOT_ACTIVE');
      if (Date.parse(reservation.leaseUntil) <= Date.now()) {
        await this.expireCouponReservations();
        throw new Error('COUPON_RESERVATION_EXPIRED');
      }
      const selected = reservation.items.map((item) => this.couponItems.get(item.itemId));
      if (selected.some((item) => !item || item.status !== 'reserved')) throw new Error('COUPON_RESERVATION_INCONSISTENT');
      const nowIso = new Date().toISOString();
      for (const item of selected as CouponItemRecord[]) { item.status = 'consumed'; item.reservedUntil = undefined; item.consumedAt = nowIso; }
      reservation.status = 'committed';
      reservation.updatedAt = nowIso;
      reservation.finalizedAt = nowIso;
      reservation.reason = undefined;
      for (const batchId of reservation.batchIds) {
        const batch = this.couponBatches.get(batchId);
        if (!batch) continue;
        const available = [...this.couponItems.values()].some((item) => item.batchId === batch.id && item.status === 'available');
        if (!available && batch.status === 'active') { batch.status = 'exhausted'; batch.updatedAt = nowIso; batch.version += 1; }
      }
      return cloneCouponReservation(reservation);
    });
  }

  async releaseCouponReservation(input: { adminId: string; reservationId: string; executionKey: string; reason: string }): Promise<CouponReservationRecord> {
    return this.withCouponReservationLock(async () => {
      await this.expireCouponReservations();
      const reservation = this.couponReservations.get(input.reservationId);
      if (!reservation || !(await this.hasAccountScope(input.adminId, reservation.accountId)) || reservation.adminId !== input.adminId) throw new Error('COUPON_RESERVATION_NOT_FOUND');
      if (reservation.executionKey !== input.executionKey) throw new Error('COUPON_RESERVATION_KEY_CONFLICT');
      if (reservation.status === 'committed') throw new Error('COUPON_RESERVATION_FINALIZED');
      if (reservation.status === 'released' || reservation.status === 'expired') return cloneCouponReservation(reservation);
      const nowIso = new Date().toISOString();
      for (const itemRef of reservation.items) {
        const item = this.couponItems.get(itemRef.itemId);
        if (!item) throw new Error('COUPON_RESERVATION_INCONSISTENT');
        if (item.status === 'reserved') { item.status = 'available'; item.reservedUntil = undefined; }
      }
      reservation.status = 'released';
      reservation.reason = input.reason.trim() || 'released';
      reservation.updatedAt = nowIso;
      reservation.finalizedAt = nowIso;
      for (const batchId of reservation.batchIds) {
        const batch = this.couponBatches.get(batchId);
        if (batch?.status === 'exhausted') { batch.status = 'active'; batch.updatedAt = nowIso; batch.version += 1; }
      }
      return cloneCouponReservation(reservation);
    });
  }

  async listConversations(adminId: string, query: ConversationListQuery): Promise<ConversationListResult> {
    const scoped = new Set((await this.listScopes(adminId)).map((scope) => scope.accountId));
    if (query.accountId && !scoped.has(query.accountId)) throw new Error('ACCOUNT_SCOPE_FORBIDDEN');
    const limit = Math.min(100, Math.max(1, query.limit ?? 50));
    const cursor = query.cursor ? decodeConversationCursor(query.cursor) : undefined;
    const filtered = [...this.conversations.values()]
      .filter((item) => scoped.has(item.accountId) && (!query.accountId || item.accountId === query.accountId))
      .sort((left, right) => conversationSortKey(right).localeCompare(conversationSortKey(left)) || right.id.localeCompare(left.id));
    const candidates = filtered.filter((item) => !cursor || isAfterConversationCursor(conversationSortKey(item), item.id, cursor));
    const page = candidates.slice(0, limit);
    const hasMore = candidates.length > page.length;
    const nextCursor = hasMore ? encodeConversationCursor({ updatedAt: conversationSortKey(page[page.length - 1]!), id: page[page.length - 1]!.id }) : undefined;
    return { items: page.map((item) => ({ ...item })), nextCursor, hasMore };
  }
  async listAutoReplyConversations(adminId: string, query: AutoReplyConversationListQuery): Promise<AutoReplyConversationListResult> {
    const scopedAccountIds = new Set((await this.listScopes(adminId)).map((scope) => scope.accountId));
    if (!scopedAccountIds.has(query.accountId)) return { items: [] };
    const limit = Math.min(50, Math.max(1, query.limit ?? 20));
    const items = [...this.conversations.values()]
      .filter((conversation) => conversation.accountId === query.accountId && conversation.buyerRef === query.buyerRef)
      .sort((left, right) => conversationSortKey(right).localeCompare(conversationSortKey(left)) || right.id.localeCompare(left.id))
      .slice(0, limit);
    return { items: items.map(toAutoReplyConversationContext) };
  }

  async getConversation(adminId: string, conversationId: string): Promise<ConversationRecord | undefined> {
    const conversation = this.conversations.get(conversationId);
    if (!conversation || !(await this.hasAccountScope(adminId, conversation.accountId))) return undefined;
    return { ...conversation };
  }

  async markConversationRead(adminId: string, conversationId: string): Promise<ConversationRecord | undefined> {
    const conversation = this.conversations.get(conversationId);
    if (!conversation || !(await this.hasAccountScope(adminId, conversation.accountId))) return undefined;
    conversation.unreadCount = 0;
    conversation.version += 1;
    return { ...conversation };
  }

  async findConversationByExternalRef(adminId: string, accountId: string, externalConversationRef: string): Promise<ConversationRecord | undefined> {
    if (!(await this.hasAccountScope(adminId, accountId))) return undefined;
    const conversation = [...this.conversations.values()].find((item) => item.accountId === accountId && item.externalConversationRef === externalConversationRef);
    return conversation ? { ...conversation } : undefined;
  }

  async upsertExternalConversation(input: { adminId: string; accountId: string; externalConversationRef: string; buyerRef: string; buyerDisplayName?: string; buyerAvatarUrl?: string; itemRef?: string; itemTitle?: string; itemImageUrl?: string; unreadCount?: number; lastMessagePreview?: string; lastMessageAt?: string }): Promise<ConversationRecord> {
    if (!(await this.hasAccountScope(input.adminId, input.accountId))) throw new Error('ACCOUNT_SCOPE_FORBIDDEN');
    const existing = await this.findConversationByExternalRef(input.adminId, input.accountId, input.externalConversationRef);
    if (existing) {
      const current = this.conversations.get(existing.id)!;
      current.buyerRef = input.buyerRef || current.buyerRef;
      current.buyerDisplayName = input.buyerDisplayName ?? current.buyerDisplayName;
      current.buyerAvatarUrl = input.buyerAvatarUrl ?? current.buyerAvatarUrl;
      current.itemRef = input.itemRef ?? current.itemRef;
      current.itemTitle = input.itemTitle ?? current.itemTitle;
      current.itemImageUrl = input.itemImageUrl ?? current.itemImageUrl;
      if (input.unreadCount !== undefined) current.unreadCount = Math.max(0, Math.trunc(input.unreadCount));
      if (input.lastMessageAt && (!current.lastMessageAt || input.lastMessageAt >= current.lastMessageAt)) {
        current.lastMessagePreview = input.lastMessagePreview ?? current.lastMessagePreview;
        current.lastMessageAt = input.lastMessageAt;
      } else if (!current.lastMessageAt && input.lastMessagePreview !== undefined) {
        current.lastMessagePreview = input.lastMessagePreview;
      }
      if (input.lastMessageAt && input.lastMessageAt > current.updatedAt) current.updatedAt = input.lastMessageAt;
      current.version += 1;
      return { ...current };
    }
    const created = await this.createConversation({ adminId: input.adminId, accountId: input.accountId, buyerRef: input.buyerRef, buyerDisplayName: input.buyerDisplayName, buyerAvatarUrl: input.buyerAvatarUrl, itemRef: input.itemRef, itemTitle: input.itemTitle, itemImageUrl: input.itemImageUrl, externalConversationRef: input.externalConversationRef });
    const current = this.conversations.get(created.id)!;
    current.unreadCount = Math.max(0, Math.trunc(input.unreadCount ?? 0));
    current.lastMessagePreview = input.lastMessagePreview;
    current.lastMessageAt = input.lastMessageAt;
    current.updatedAt = input.lastMessageAt ?? current.updatedAt;
    return { ...current };
  }

  async listMessages(adminId: string, conversationId: string, query: MessageListQuery): Promise<MessageListResult> {
    const conversation = await this.getConversation(adminId, conversationId);
    if (!conversation) return { items: [], hasMore: false, latestCursor: 0, hasMoreHistory: false };
    const limit = Math.min(200, Math.max(1, query.limit ?? 100));
    const latestCursor = this.conversationCursors.get(conversationId) ?? 0;
    const cursor = query.cursor ?? latestCursor;
    const items = [...this.messages.values()]
      .filter((item) => item.conversationId === conversationId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
    const history = decodeMessageHistoryCursor(query.beforeCursor);
    const olderItems = history?.beforeCreatedAt
      ? items.filter((item) => item.createdAt < history.beforeCreatedAt! || (item.createdAt === history.beforeCreatedAt && (!history.beforeMessageId || item.id < history.beforeMessageId)))
      : items;
    const selected = query.beforeCursor !== undefined
      ? olderItems.slice(Math.max(0, olderItems.length - limit))
      : query.cursor === undefined
        ? items.slice(Math.max(0, items.length - limit))
        : items.filter((item) => (this.eventForMessage(conversationId, item.id)?.cursor ?? 0) > cursor).slice(0, limit);
    const hasMoreHistory = query.beforeCursor !== undefined ? olderItems.length > selected.length : items.length > selected.length;
    const nextCursor = selected.length === limit ? this.eventForMessage(conversationId, selected[selected.length - 1]!.id)?.cursor : undefined;
    return { items: selected.map((item) => ({ ...item, riskFlags: [...item.riskFlags] })), nextCursor, hasMore: nextCursor !== undefined, latestCursor, hasMoreHistory };
  }
  async listAutoReplyMessages(adminId: string, conversationId: string, query: AutoReplyMessageListQuery): Promise<AutoReplyMessageListResult> {
    const conversation = this.conversations.get(conversationId);
    if (!conversation || !(await this.hasAccountScope(adminId, conversation.accountId))) return { items: [], hasMoreHistory: false };
    const limit = Math.min(50, Math.max(1, query.limit ?? 20));
    const items = [...this.messages.values()]
      .filter((message) => message.conversationId === conversationId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id));
    const hasMoreHistory = items.length > limit;
    return { items: items.slice(0, limit).reverse().map(toAutoReplyMessageContext), hasMoreHistory };
  }

  async listConversationEvents(adminId: string, conversationId: string, afterCursor: number, limit: number): Promise<ConversationEventRecord[]> {
    const conversation = await this.getConversation(adminId, conversationId);
    if (!conversation) return [];
    return (this.conversationEvents.get(conversationId) ?? []).filter((event) => event.cursor > afterCursor).slice(0, Math.min(limit, 200)).map((event) => ({ ...event, payload: { ...event.payload } }));
  }

  async findMessageByExternalRef(adminId: string, conversationId: string, externalMessageRef: string): Promise<MessageRecord | undefined> {
    const conversation = await this.getConversation(adminId, conversationId);
    if (!conversation) return undefined;
    const aliasMessageId = this.inboundMessageAliases.get(`${conversation.accountId}:${conversationId}:${externalMessageRef}`);
    const message = [...this.messages.values()].find((item) => item.conversationId === conversationId && (item.externalMessageRef === externalMessageRef || item.id === aliasMessageId));
    return message ? { ...message, riskFlags: [...message.riskFlags] } : undefined;
  }

  async createConversation(input: { adminId: string; accountId: string; buyerRef: string; buyerDisplayName?: string; buyerAvatarUrl?: string; itemRef?: string; itemTitle?: string; itemImageUrl?: string; externalConversationRef?: string }): Promise<ConversationRecord> {
    if (!(await this.hasAccountScope(input.adminId, input.accountId))) throw new Error('ACCOUNT_SCOPE_FORBIDDEN');
    const now = new Date().toISOString();
    const conversation: ConversationRecord = { id: createId(), accountId: input.accountId, externalConversationRef: input.externalConversationRef, buyerRef: input.buyerRef, buyerDisplayName: input.buyerDisplayName, buyerAvatarUrl: input.buyerAvatarUrl, itemRef: input.itemRef, itemTitle: input.itemTitle, itemImageUrl: input.itemImageUrl, unreadCount: 0, handlingMode: 'ai', version: 1, createdAt: now, updatedAt: now };
    this.conversations.set(conversation.id, conversation);
    this.conversationEvents.set(conversation.id, []);
    this.conversationCursors.set(conversation.id, 0);
    return { ...conversation };
  }

  async createMessage(input: { adminId: string; conversationId: string; direction: MessageRecord['direction']; senderRole: MessageRecord['senderRole']; bodyType: MessageRecord['bodyType']; bodyText?: string; bodyRef?: string; externalMessageRef?: string; externalMessageRefAliases?: string[]; source?: MessageRecord['source']; orderRef?: string; productRef?: string; riskFlags?: string[]; createdAt?: string; traceId?: string }): Promise<{ message: MessageRecord; event: ConversationEventRecord }> {
    const conversation = this.conversations.get(input.conversationId);
    if (!conversation || !(await this.hasAccountScope(input.adminId, conversation.accountId))) throw new Error('CONVERSATION_NOT_FOUND');
    if (input.externalMessageRef) {
      const refs = new Set([input.externalMessageRef, ...(input.externalMessageRefAliases ?? [])].filter((value): value is string => Boolean(value)));
      const existing = [...this.messages.values()].find((item) => item.conversationId === input.conversationId && (refs.has(item.externalMessageRef ?? '') || [...refs].some((ref) => this.inboundMessageAliases.get(`${conversation.accountId}:${input.conversationId}:${ref}`) === item.id)));
      if (existing) {
        const event = this.eventForMessage(input.conversationId, existing.id);
        if (event) return { message: { ...existing, riskFlags: [...existing.riskFlags] }, event: { ...event, payload: { ...event.payload } } };
      }
    }
    const now = input.createdAt ?? new Date().toISOString();
    const message: MessageRecord = { id: createId(), conversationId: conversation.id, accountId: conversation.accountId, direction: input.direction, senderRole: input.senderRole, bodyType: input.bodyType, bodyText: input.bodyText, bodyRef: input.bodyRef, redactionState: 'visible', status: 'created', readStatus: 0, externalMessageRef: input.externalMessageRef, source: input.source, orderRef: input.orderRef, productRef: input.productRef, riskFlags: [...(input.riskFlags ?? [])], handlingMode: conversation.handlingMode, createdAt: now };
    this.messages.set(message.id, message);
    for (const alias of input.externalMessageRefAliases ?? []) {
      if (alias && alias !== input.externalMessageRef) this.inboundMessageAliases.set(`${conversation.accountId}:${conversation.id}:${alias}`, message.id);
    }
    if (!conversation.lastMessageAt || now >= conversation.lastMessageAt) {
      conversation.lastMessagePreview = message.bodyText?.slice(0, 180);
      conversation.lastMessageAt = now;
    }
    if (now > conversation.updatedAt) conversation.updatedAt = now;
    conversation.version += 1;
    if (message.direction === 'inbound') conversation.unreadCount += 1;
    const cursor = (this.conversationCursors.get(conversation.id) ?? 0) + 1;
    this.conversationCursors.set(conversation.id, cursor);
    const event: ConversationEventRecord = { eventId: createId(), conversationId: conversation.id, accountId: conversation.accountId, cursor, type: 'chat.message.created', occurredAt: now, traceId: input.traceId ?? `memory:${message.id}`, payload: { message: { ...message, riskFlags: [...message.riskFlags] }, conversation: { ...conversation } } };
    this.conversationEvents.get(conversation.id)?.push(event);
    return { message: { ...message, riskFlags: [...message.riskFlags] }, event: { ...event, payload: { ...event.payload } } };
  }

  async createAutoReplyRun(input: { adminId: string; accountId: string; conversationId: string; inboundMessageId: string; intent: string; decision: AutoReplyDecision; status: AutoReplyRunStatus; riskFlags?: string[]; productId?: string; orderRefs?: string[]; inputDigest: string; contextDigest?: string; replyDigest?: string; senderOutcome?: AutoReplyRunRecord['senderOutcome']; outboundMessageId?: string; failureCode?: string }): Promise<AutoReplyRunRecord> {
    const existing = [...this.autoReplyRuns.values()].find((run) => run.adminId === input.adminId && run.inboundMessageId === input.inboundMessageId);
    if (existing) return { ...existing, riskFlags: [...existing.riskFlags], orderRefs: [...existing.orderRefs] };
    const now = new Date().toISOString();
    const run: AutoReplyRunRecord = { id: createId(), adminId: input.adminId, accountId: input.accountId, conversationId: input.conversationId, inboundMessageId: input.inboundMessageId, intent: input.intent, decision: input.decision, status: input.status, riskFlags: [...(input.riskFlags ?? [])], productId: input.productId, orderRefs: [...(input.orderRefs ?? [])], inputDigest: input.inputDigest, contextDigest: input.contextDigest, replyDigest: input.replyDigest, senderOutcome: input.senderOutcome, outboundMessageId: input.outboundMessageId, failureCode: input.failureCode, createdAt: now, updatedAt: now };
    this.autoReplyRuns.set(run.id, run);
    await this.appendAutoReplyRunEvent({ runId: run.id, accountId: run.accountId, eventType: 'run.created', status: run.status, stage: autoReplyStageForStatus(run.status), payload: {
      decision: run.decision,
      intent: run.intent,
      failureCode: run.failureCode,
      log: { phase: 'gateway', state: 'received', message: '已接收买家消息，准备开始处理' },
      input: { kind: 'inbound_message', messageId: run.inboundMessageId, digest: run.inputDigest },
      output: { status: run.status, decision: run.decision, intent: run.intent },
    } });
    return { ...run, riskFlags: [...run.riskFlags], orderRefs: [...run.orderRefs] };
  }

  async updateAutoReplyRun(id: string, patch: AutoReplyRunUpdate): Promise<AutoReplyRunRecord | undefined> {
    const run = this.autoReplyRuns.get(id);
    if (!run) return undefined;
    if (Object.keys(patch).length === 0) return { ...run, riskFlags: [...run.riskFlags], orderRefs: [...run.orderRefs] };
    const { eventPayload, eventTraceId, eventDurationMs, ...runPatch } = patch;
    Object.assign(run, runPatch, { updatedAt: new Date().toISOString() });
    if (patch.status !== undefined) await this.appendAutoReplyRunEvent({ runId: run.id, accountId: run.accountId, eventType: `run.${patch.status}`, status: run.status, stage: autoReplyStageForStatus(run.status), durationMs: eventDurationMs, traceId: eventTraceId, payload: { decision: run.decision, intent: run.intent, failureCode: run.failureCode, ...(eventPayload ?? {}), output: { status: run.status, decision: run.decision, intent: run.intent, ...(eventPayload?.output && typeof eventPayload.output === 'object' && !Array.isArray(eventPayload.output) ? eventPayload.output as Record<string, unknown> : {}) } } });
    return { ...run, riskFlags: [...run.riskFlags], orderRefs: [...run.orderRefs] };
  }

  async getAutoReplyRun(adminId: string, id: string): Promise<AutoReplyRunRecord | undefined> {
    const run = this.autoReplyRuns.get(id);
    if (!run || run.adminId !== adminId) return undefined;
    return { ...run, riskFlags: [...run.riskFlags], orderRefs: [...run.orderRefs] };
  }

  async findAutoReplyRunByInboundMessage(adminId: string, inboundMessageId: string): Promise<AutoReplyRunRecord | undefined> {
    const run = [...this.autoReplyRuns.values()].find((candidate) => candidate.adminId === adminId && candidate.inboundMessageId === inboundMessageId);
    return run ? { ...run, riskFlags: [...run.riskFlags], orderRefs: [...run.orderRefs] } : undefined;
  }

  async appendAutoReplyRunEvent(input: { runId: string; eventType: string; status: AutoReplyRunStatus; stage: AutoReplyRunStage; accountId: string; payload?: Record<string, unknown>; durationMs?: number; traceId?: string }): Promise<AutoReplyRunEventRecord> {
    const run = this.autoReplyRuns.get(input.runId);
    if (!run || run.accountId !== input.accountId) throw new Error('AUTO_REPLY_RUN_NOT_FOUND');
    const sequence = (this.autoReplyRunEventSequences.get(input.runId) ?? 0) + 1;
    this.autoReplyRunEventSequences.set(input.runId, sequence);
    const event: AutoReplyRunEventRecord = { id: createId(), runId: input.runId, accountId: input.accountId, sequence, eventType: input.eventType, stage: input.stage, status: input.status, occurredAt: new Date().toISOString(), durationMs: input.durationMs, traceId: input.traceId, payload: { ...(input.payload ?? {}) } };
    const events = this.autoReplyRunEvents.get(input.runId) ?? [];
    events.push(event);
    this.autoReplyRunEvents.set(input.runId, events);
    return { ...event, payload: { ...event.payload } };
  }

  async listAutoReplyRunEvents(adminId: string, runId: string): Promise<AutoReplyRunEventRecord[]> {
    const run = await this.getAutoReplyRun(adminId, runId);
    if (!run || !(await this.hasAccountScope(adminId, run.accountId))) return [];
    return (this.autoReplyRunEvents.get(runId) ?? []).map((event) => ({ ...event, payload: { ...event.payload } }));
  }

  async listAutoReplyRuns(adminId: string, query: AutoReplyRunListQuery): Promise<AutoReplyRunListResult> {
    const scoped = new Set((await this.listScopes(adminId)).map((scope) => scope.accountId));
    const from = query.from ? Date.parse(query.from) : Number.NEGATIVE_INFINITY;
    const to = query.to ? Date.parse(query.to) : Number.POSITIVE_INFINITY;
    const keyword = query.keyword?.trim().toLowerCase();
    const processing = new Set<AutoReplyRunStatus>(['received', 'classified', 'context_loaded', 'generated', 'simulated']);
    const filtered = [...this.autoReplyRuns.values()]
      .filter((run) => run.adminId === adminId && scoped.has(run.accountId))
      .filter((run) => !query.accountId || run.accountId === query.accountId)
      .filter((run) => Date.parse(run.createdAt) >= from && Date.parse(run.createdAt) <= to)
      .filter((run) => !query.status || run.status === query.status)
      .filter((run) => !query.decision || run.decision === query.decision)
      .filter((run) => !query.processing || processing.has(run.status))
      .filter((run) => !query.stage || autoReplyStageForStatus(run.status) === query.stage)
      .filter((run) => !keyword || `${run.id} ${run.intent} ${run.failureCode ?? ''} ${run.inputDigest}`.toLowerCase().includes(keyword))
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt) || right.id.localeCompare(left.id));
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const items = filtered.slice((page - 1) * pageSize, page * pageSize).map((run) => this.autoReplyRunListItem(run));
    return { items, page, pageSize, total: filtered.length, totalPages: Math.max(1, Math.ceil(filtered.length / pageSize)) };
  }

  async getAutoReplyRunDetail(adminId: string, runId: string): Promise<AutoReplyRunDetailRecord | undefined> {
    const run = await this.getAutoReplyRun(adminId, runId);
    if (!run || !(await this.hasAccountScope(adminId, run.accountId))) return undefined;
    const conversation = await this.getConversation(adminId, run.conversationId);
    const inboundMessage = [...this.messages.values()].find((message) => message.id === run.inboundMessageId && message.conversationId === run.conversationId);
    const outboundMessages = [...this.messages.values()].filter((message) => message.conversationId === run.conversationId && message.direction === 'outbound' && (!run.outboundMessageId || message.id === run.outboundMessageId)).sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    const product = run.productId ? await this.getProduct(adminId, run.productId) : undefined;
    return { run: this.autoReplyRunListItem(run), events: await this.listAutoReplyRunEvents(adminId, runId), conversation, inboundMessage, outboundMessages, product };
  }

  async getAutoReplyActivitySummary(adminId: string, query: { accountId?: string; from: string; to: string }): Promise<AutoReplyActivitySummary> {
    const scoped = new Set((await this.listScopes(adminId)).map((scope) => scope.accountId));
    const from = Date.parse(query.from);
    const to = Date.parse(query.to);
    const runs = [...this.autoReplyRuns.values()]
      .filter((run) => run.adminId === adminId && scoped.has(run.accountId))
      .filter((run) => !query.accountId || run.accountId === query.accountId)
      .filter((run) => Date.parse(run.createdAt) >= from && Date.parse(run.createdAt) <= to)
      .map((run) => this.autoReplyRunListItem(run));
    const terminal = new Set<AutoReplyRunStatus>(['persisted', 'handoff', 'skipped', 'failed']);
    const processing = new Set<AutoReplyRunStatus>(['received', 'classified', 'context_loaded', 'generated', 'simulated']);
    const counts = new Map<AutoReplyRunStatus, number>();
    const stageCounts = new Map<AutoReplyRunStage, { count: number; duration: number }>();
    const exceptions = new Map<string, { count: number; status: AutoReplyRunStatus }>();
    for (const item of runs) {
      counts.set(item.status, (counts.get(item.status) ?? 0) + 1);
      const current = stageCounts.get(item.stage) ?? { count: 0, duration: 0 };
      current.count += 1; current.duration += item.durationMs; stageCounts.set(item.stage, current);
      if (item.failureCode) { const currentException = exceptions.get(item.failureCode) ?? { count: 0, status: item.status }; currentException.count += 1; currentException.status = item.status; exceptions.set(item.failureCode, currentException); }
    }
    const durations = runs.map((item) => item.durationMs).sort((a, b) => a - b);
    const p95 = durations.length ? durations[Math.min(durations.length - 1, Math.ceil(durations.length * 0.95) - 1)] : 0;
    const seconds = Math.max(1, (Date.parse(query.to) - Date.parse(query.from)) / 1000);
    return { from: query.from, to: query.to, asOf: new Date().toISOString(), inboundCount: runs.length, processingCount: runs.filter((run) => processing.has(run.status)).length, persistedCount: counts.get('persisted') ?? 0, handoffCount: counts.get('handoff') ?? 0, failedCount: counts.get('failed') ?? 0, skippedCount: counts.get('skipped') ?? 0, completionRate: runs.length ? runs.filter((run) => terminal.has(run.status)).length / runs.length : 0, throughputPerSecond: runs.length / seconds, p95DurationMs: p95, byStatus: [...counts.entries()].map(([status, count]) => ({ status, count })), byStage: [...stageCounts.entries()].map(([stage, value]) => ({ stage, count: value.count, averageDurationMs: value.count ? Math.round(value.duration / value.count) : 0 })), exceptions: [...exceptions.entries()].map(([code, value]) => ({ code, count: value.count, status: value.status })), health: [] };
  }

  private autoReplyRunListItem(run: AutoReplyRunRecord): AutoReplyRunListItem {
    const conversation = this.conversations.get(run.conversationId);
    const inbound = this.messages.get(run.inboundMessageId);
    const product = run.productId ? this.products.get(run.productId) : undefined;
    const durationMs = Math.max(0, Date.parse(run.updatedAt) - Date.parse(run.createdAt));
    return { ...run, ...projectAutoReplyRun(run), riskFlags: [...run.riskFlags], orderRefs: [...run.orderRefs], stage: autoReplyStageForStatus(run.status), durationMs, buyerDisplayName: conversation?.buyerDisplayName, productTitle: product?.title, inboundMessagePreview: inbound?.bodyText?.slice(0, 180) };
  }

  async markMessagesReadByExternalRef(input: { adminId: string; conversationId: string; externalMessageRef: string; readAt?: string }): Promise<{ messages: MessageRecord[]; events: ConversationEventRecord[] }> {
    const conversation = await this.getConversation(input.adminId, input.conversationId);
    if (!conversation) return { messages: [], events: [] };
    const target = [...this.messages.values()].find((message) => message.conversationId === input.conversationId && message.externalMessageRef === input.externalMessageRef && message.direction === 'outbound');
    if (!target) return { messages: [], events: [] };
    return this.markOutgoingReadUntil(conversation, target.createdAt, input.readAt);
  }

  async markLatestOutgoingRead(input: { adminId: string; conversationId: string; readAt?: string }): Promise<{ messages: MessageRecord[]; events: ConversationEventRecord[] }> {
    const conversation = await this.getConversation(input.adminId, input.conversationId);
    if (!conversation) return { messages: [], events: [] };
    const target = [...this.messages.values()]
      .filter((message) => message.conversationId === input.conversationId && message.direction === 'outbound' && message.readStatus !== 2)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))[0];
    if (!target) return { messages: [], events: [] };
    return this.markOutgoingReadUntil(conversation, target.createdAt, input.readAt);
  }

  async enqueueInboundInbox(input: { adminId: string; accountId: string; conversationId: string; inboundMessageId: string; externalConversationRef: string; externalMessageRef: string; sourceEventId?: string; sourceSequence?: number; availableAt?: string }): Promise<{ record: InboundInboxRecord; created: boolean }> {
    if (!(await this.hasAccountScope(input.adminId, input.accountId))) throw new Error('ACCOUNT_SCOPE_FORBIDDEN');
    const existing = [...this.inboundInbox.values()].find((item) => item.accountId === input.accountId && (item.externalMessageRef === input.externalMessageRef || item.inboundMessageId === input.inboundMessageId));
    if (existing) return { record: { ...existing }, created: false };
    const now = new Date().toISOString();
    const sourceSequence = input.sourceSequence;
    const record: InboundInboxRecord = {
      id: createId(), adminId: input.adminId, accountId: input.accountId, conversationId: input.conversationId,
      inboundMessageId: input.inboundMessageId, externalConversationRef: input.externalConversationRef, externalMessageRef: input.externalMessageRef,
      sourceEventId: input.sourceEventId?.trim() || undefined,
      sourceSequence: typeof sourceSequence === 'number' && Number.isSafeInteger(sourceSequence) && sourceSequence > 0 ? sourceSequence : undefined,
      status: 'pending', attempt: 0, availableAt: input.availableAt ?? now, createdAt: now, updatedAt: now,
    };
    this.inboundInbox.set(record.id, record);
    return { record: { ...record }, created: true };
  }

  async getInboundInbox(id: string): Promise<InboundInboxRecord | undefined> {
    const record = this.inboundInbox.get(id);
    return record ? { ...record } : undefined;
  }

  async claimInboundInbox(input: { workerId: string; limit: number; leaseMs: number }): Promise<InboundInboxRecord[]> {
    const limit = Math.max(1, Math.min(100, Math.trunc(input.limit)));
    const now = Date.now();
    const activeProcessing = (conversationId: string, excludeId: string): boolean => [...this.inboundInbox.values()].some((other) => other.id !== excludeId && other.conversationId === conversationId && other.status === 'processing' && Boolean(other.leaseExpiresAt) && Date.parse(other.leaseExpiresAt!) > now);
    const candidates = [...this.inboundInbox.values()]
      .filter((item) => {
        const available = Date.parse(item.availableAt) <= now;
        const stale = item.status === 'processing' && Boolean(item.leaseExpiresAt) && Date.parse(item.leaseExpiresAt!) <= now;
        return ((item.status === 'pending' || item.status === 'retryable') && available) || stale;
      })
      .filter((item) => !activeProcessing(item.conversationId, item.id))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
    const claimed: InboundInboxRecord[] = [];
    const conversations = new Set<string>();
    for (const item of candidates) {
      if (claimed.length >= limit || conversations.has(item.conversationId)) continue;
      const nowIso = new Date().toISOString();
      item.status = 'processing';
      item.attempt += 1;
      item.lockedAt = nowIso;
      item.leaseExpiresAt = new Date(now + Math.max(5_000, Math.min(300_000, Math.trunc(input.leaseMs)))).toISOString();
      item.leaseOwner = input.workerId;
      item.updatedAt = nowIso;
      claimed.push({ ...item });
      conversations.add(item.conversationId);
    }
    return claimed;
  }

  async heartbeatInboundInbox(input: { id: string; workerId: string; leaseMs: number }): Promise<boolean> {
    const item = this.inboundInbox.get(input.id);
    if (!item || item.status !== 'processing' || item.leaseOwner !== input.workerId || !item.leaseExpiresAt || Date.parse(item.leaseExpiresAt) <= Date.now()) return false;
    item.lockedAt = new Date().toISOString();
    item.leaseExpiresAt = new Date(Date.now() + Math.max(5_000, Math.min(300_000, Math.trunc(input.leaseMs)))).toISOString();
    item.updatedAt = item.lockedAt;
    return true;
  }

  async ackInboundInbox(input: { id: string; workerId: string }): Promise<boolean> {
    const item = this.inboundInbox.get(input.id);
    if (!item || item.status !== 'processing' || item.leaseOwner !== input.workerId) return false;
    const now = new Date().toISOString();
    item.status = 'succeeded'; item.processedAt = now; item.lockedAt = undefined; item.leaseExpiresAt = undefined; item.leaseOwner = undefined; item.updatedAt = now;
    return true;
  }

  async retryInboundInbox(input: { id: string; workerId: string; errorCode: string; errorDigest: string; availableAt: string }): Promise<boolean> {
    const item = this.inboundInbox.get(input.id);
    if (!item || item.status !== 'processing' || item.leaseOwner !== input.workerId) return false;
    const now = new Date().toISOString();
    Object.assign(item, { status: 'retryable' as const, availableAt: input.availableAt, lockedAt: undefined, leaseExpiresAt: undefined, leaseOwner: undefined, lastErrorCode: input.errorCode, lastErrorDigest: input.errorDigest, lastErrorAt: now, updatedAt: now });
    return true;
  }

  async deadLetterInboundInbox(input: { id: string; workerId: string; errorCode: string; errorDigest: string }): Promise<boolean> {
    const item = this.inboundInbox.get(input.id);
    if (!item || item.status !== 'processing' || item.leaseOwner !== input.workerId) return false;
    const now = new Date().toISOString();
    Object.assign(item, { status: 'dead_lettered' as const, lockedAt: undefined, leaseExpiresAt: undefined, leaseOwner: undefined, lastErrorCode: input.errorCode, lastErrorDigest: input.errorDigest, lastErrorAt: now, updatedAt: now });
    return true;
  }

  async reapExpiredInboundInbox(now?: string): Promise<number> {
    const availableAt = now ?? new Date().toISOString();
    let count = 0;
    for (const item of this.inboundInbox.values()) {
      if (item.status === 'processing' && item.leaseExpiresAt && Date.parse(item.leaseExpiresAt) <= Date.now()) {
        const updatedAt = new Date().toISOString();
        Object.assign(item, { status: 'retryable' as const, availableAt, lockedAt: undefined, leaseExpiresAt: undefined, leaseOwner: undefined, lastErrorCode: 'INBOX_LEASE_EXPIRED', lastErrorAt: updatedAt, updatedAt });
        count += 1;
      }
    }
    return count;
  }

  async recordInboundQuarantine(input: { accountId: string; reasonCode: string; payloadDigest: string; payloadPreview?: string; payloadSize: number; receivedAt?: string }): Promise<InboundQuarantineRecord> {
    const now = new Date().toISOString();
    const record: InboundQuarantineRecord = { id: createId(), accountId: input.accountId, reasonCode: input.reasonCode, payloadDigest: input.payloadDigest, payloadPreview: input.payloadPreview?.slice(0, 500), payloadSize: Math.max(0, Math.trunc(input.payloadSize)), receivedAt: input.receivedAt ?? now, createdAt: now };
    this.inboundQuarantine.set(record.id, record);
    return { ...record };
  }

  private markOutgoingReadUntil(conversation: ConversationRecord, createdAt: string, readAt?: string): { messages: MessageRecord[]; events: ConversationEventRecord[] } {
    const effectiveReadAt = readAt ?? new Date().toISOString();
    const changed = [...this.messages.values()]
      .filter((message) => message.conversationId === conversation.id && message.direction === 'outbound' && message.readStatus !== 2 && message.createdAt <= createdAt)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
    const events: ConversationEventRecord[] = [];
    for (const message of changed) {
      message.readStatus = 2;
      message.readAt = effectiveReadAt;
      conversation.version += 1;
      const cursor = (this.conversationCursors.get(conversation.id) ?? 0) + 1;
      this.conversationCursors.set(conversation.id, cursor);
      const event: ConversationEventRecord = { eventId: createId(), conversationId: conversation.id, accountId: conversation.accountId, cursor, type: 'chat.message.updated', occurredAt: effectiveReadAt, traceId: `read:${message.id}`, payload: { message: { ...message, riskFlags: [...message.riskFlags] }, conversation: { ...conversation } } };
      this.conversationEvents.get(conversation.id)?.push(event);
      events.push({ ...event, payload: { ...event.payload } });
    }
    return { messages: changed.map((message) => ({ ...message, riskFlags: [...message.riskFlags] })), events };
  }

  private eventForMessage(conversationId: string, messageId: string): ConversationEventRecord | undefined {
    const events = this.conversationEvents.get(conversationId) ?? [];
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index];
      if ((event?.payload.message as { id?: string } | undefined)?.id === messageId) return event;
    }
    return undefined;
  }

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
  async listCredentialRefs(adminId: string, accountId: string): Promise<CredentialRefRecord[]> {
    if (!(await this.hasAccountScope(adminId, accountId))) throw new Error('ACCOUNT_SCOPE_FORBIDDEN');
    return [...this.credentialRefs.values()]
      .filter((row) => row.accountId === accountId)
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
      .map((row) => ({ ...row, metadata: { ...row.metadata }, canReveal: false as const }));
  }
  async getCredentialRef(adminId: string, credentialId: string): Promise<CredentialRefRecord | undefined> {
    const row = this.credentialRefs.get(credentialId);
    if (!row || !(await this.hasAccountScope(adminId, row.accountId))) return undefined;
    return { ...row, metadata: { ...row.metadata }, canReveal: false as const };
  }
  async getCredentialRefSecret(adminId: string, credentialId: string): Promise<import('./domain.js').CredentialRefSecretRecord | undefined> {
    const ref = await this.getCredentialRef(adminId, credentialId);
    if (!ref) return undefined;
    const secretCiphertext = this.credentialRefSecrets.get(credentialId);
    if (!secretCiphertext) return undefined;
    return { ref, secretCiphertext };
  }
  async createCredentialRef(input: { adminId: string; accountId: string; provider: string; alias: string; label?: string; secretCiphertext: string; fingerprint: string; metadata?: Record<string, string> }): Promise<CredentialRefRecord> {
    if (!(await this.hasAccountScope(input.adminId, input.accountId))) throw new Error('ACCOUNT_SCOPE_FORBIDDEN');
    const role = input.metadata?.role === 'backup' ? 'backup' : 'primary';
    const duplicate = [...this.credentialRefs.values()].find((row) => row.accountId === input.accountId && row.kind === 'api_key' && row.purpose === 'model_client' && row.status !== 'revoked' && (row.metadata.role === role || (!row.metadata.role && role === 'primary')));
    if (duplicate) throw new Error('CREDENTIAL_ALREADY_EXISTS');
    const now = new Date().toISOString();
    const row: CredentialRefRecord = { id: createId(), accountId: input.accountId, kind: 'api_key', purpose: 'model_client', label: input.label?.trim() || undefined, status: 'active', version: 1, provider: input.provider.trim(), alias: input.alias.trim(), fingerprint: input.fingerprint, metadata: { ...(input.metadata ?? {}) }, createdAt: now, updatedAt: now, lastRotatedAt: now, canReveal: false };
    this.credentialRefs.set(row.id, row);
    this.credentialRefSecrets.set(row.id, input.secretCiphertext);
    return { ...row, metadata: { ...row.metadata }, canReveal: false };
  }
  async updateCredentialRef(input: { adminId: string; credentialId: string; expectedVersion: number; provider?: string; alias?: string; label?: string; metadata?: Record<string, string> }): Promise<CredentialRefRecord | undefined> {
    const row = this.credentialRefs.get(input.credentialId);
    if (!row || !(await this.hasAccountScope(input.adminId, row.accountId))) return undefined;
    if (row.version !== input.expectedVersion) throw new Error('CREDENTIAL_VERSION_CONFLICT');
    if (input.provider !== undefined) row.provider = input.provider.trim();
    if (input.alias !== undefined) row.alias = input.alias.trim();
    if (input.label !== undefined) row.label = input.label.trim() || undefined;
    if (input.metadata !== undefined) row.metadata = { ...input.metadata };
    row.version += 1;
    row.updatedAt = new Date().toISOString();
    return { ...row, metadata: { ...row.metadata }, canReveal: false };
  }
  async rotateCredentialRef(input: { adminId: string; credentialId: string; expectedVersion: number; secretCiphertext: string; fingerprint: string }): Promise<CredentialRefRecord | undefined> {
    const row = this.credentialRefs.get(input.credentialId);
    if (!row || !(await this.hasAccountScope(input.adminId, row.accountId))) return undefined;
    if (row.version !== input.expectedVersion) throw new Error('CREDENTIAL_VERSION_CONFLICT');
    row.status = 'active';
    row.fingerprint = input.fingerprint;
    row.version += 1;
    row.lastRotatedAt = new Date().toISOString();
    row.updatedAt = row.lastRotatedAt;
    this.credentialRefSecrets.set(row.id, input.secretCiphertext);
    return { ...row, metadata: { ...row.metadata }, canReveal: false };
  }
  async updateCredentialRefStatus(input: { adminId: string; credentialId: string; expectedVersion: number; status: CredentialRefStatus }): Promise<CredentialRefRecord | undefined> {
    const row = this.credentialRefs.get(input.credentialId);
    if (!row || !(await this.hasAccountScope(input.adminId, row.accountId))) return undefined;
    if (row.version !== input.expectedVersion) throw new Error('CREDENTIAL_VERSION_CONFLICT');
    if (row.status === 'revoked' && input.status !== 'revoked') throw new Error('CREDENTIAL_REVOKED');
    row.status = input.status;
    row.version += 1;
    row.updatedAt = new Date().toISOString();
    return { ...row, metadata: { ...row.metadata }, canReveal: false };
  }
  async getAutoReplyAgentConfig(adminId: string, accountId: string): Promise<AutoReplyAgentConfigRecord | undefined> {
    if (!(await this.hasAccountScope(adminId, accountId))) return undefined;
    const row = this.autoReplyAgentConfigs.get(accountId);
    return row ? { ...row } : undefined;
  }
  async upsertAutoReplyAgentConfig(input: { adminId: string; accountId: string; expectedVersion: number; patch: AutoReplyAgentConfigPatch; config: AutoReplyAgentConfig; configDigest: string }): Promise<AutoReplyAgentConfigRecord | undefined> {
    if (!(await this.hasAccountScope(input.adminId, input.accountId))) return undefined;
    const now = new Date().toISOString();
    const current = this.autoReplyAgentConfigs.get(input.accountId);
    if (current && current.configVersion !== input.expectedVersion) throw new Error('AUTO_REPLY_AGENT_CONFIG_VERSION_CONFLICT');
    const row: AutoReplyAgentConfigRecord = {
      ...input.config,
      accountId: input.accountId,
      updatedByAdminId: input.adminId,
      configVersion: current ? current.configVersion + 1 : 1,
      configDigest: input.configDigest,
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
    };
    this.autoReplyAgentConfigs.set(input.accountId, row);
    return { ...row };
  }
  async getActiveAutoReplyRepairPolicy(accountId: string, now = new Date().toISOString()): Promise<AutoReplyRepairPolicyBundle | undefined> {
    const records = this.autoReplyRepairPolicies.get(accountId);
    const active = [...(records?.values() ?? [])].find((record) => record.status === 'ACTIVE');
    if (!active) return undefined;
    try {
      return cloneRepairPolicy(validatePersistedAutoReplyRepairPolicyBundle(active.bundle, accountId, new Date(now)));
    } catch {
      return undefined;
    }
  }
  async publishAutoReplyRepairPolicy(input: { accountId: string; bundle: AutoReplyRepairPolicyBundle; expectedActiveVersion?: string }): Promise<AutoReplyRepairPolicyBundle> {
    const account = this.accounts.get(input.accountId);
    if (!account || account.status === 'disabled') throw new Error('AUTO_REPLY_POLICY_ACCOUNT_NOT_FOUND');
    const now = new Date().toISOString();
    const bundle = validatePersistedAutoReplyRepairPolicyBundle(input.bundle, input.accountId, new Date(now));
    const records = this.autoReplyRepairPolicies.get(input.accountId) ?? new Map<string, MemoryRepairPolicyRecord>();
    const active = [...records.values()].find((record) => record.status === 'ACTIVE');
    if (input.expectedActiveVersion && active?.policyVersion !== input.expectedActiveVersion) throw new Error('AUTO_REPLY_POLICY_VERSION_CONFLICT');
    if (records.has(bundle.policyConfig.policyVersion)) throw new Error('AUTO_REPLY_POLICY_VERSION_EXISTS');
    if (active) active.status = 'RETIRED';
    const record: MemoryRepairPolicyRecord = { accountId: input.accountId, policyVersion: bundle.policyConfig.policyVersion, status: 'ACTIVE', bundle: cloneRepairPolicy(bundle), createdAt: now, updatedAt: now };
    records.set(record.policyVersion, record);
    this.autoReplyRepairPolicies.set(input.accountId, records);
    return cloneRepairPolicy(bundle);
  }
  async rollbackAutoReplyRepairPolicy(input: { accountId: string; targetPolicyVersion: string; expectedActiveVersion?: string }): Promise<AutoReplyRepairPolicyBundle> {
    const records = this.autoReplyRepairPolicies.get(input.accountId);
    const target = records?.get(input.targetPolicyVersion);
    const active = [...(records?.values() ?? [])].find((record) => record.status === 'ACTIVE');
    if (!target) throw new Error('AUTO_REPLY_POLICY_ROLLBACK_TARGET_NOT_FOUND');
    if (input.expectedActiveVersion && active?.policyVersion !== input.expectedActiveVersion) throw new Error('AUTO_REPLY_POLICY_VERSION_CONFLICT');
    const bundle = validatePersistedAutoReplyRepairPolicyBundle(target.bundle, input.accountId, new Date());
    if (active && active.policyVersion !== target.policyVersion) active.status = 'RETIRED';
    target.status = 'ACTIVE';
    target.updatedAt = new Date().toISOString();
    return cloneRepairPolicy(bundle);
  }
  async getIdempotency(scope: string, key: string): Promise<IdempotencyRecord | undefined> { const row = this.idempotency.get(`${scope}:${key}`); if (row && Date.parse(row.expiresAt) <= Date.now()) { this.idempotency.delete(`${scope}:${key}`); return undefined; } return row; }
  async beginIdempotency(record: IdempotencyRecord): Promise<void> { this.idempotency.set(`${record.scope}:${record.key}`, record); }
  async abortIdempotency(scope: string, key: string): Promise<void> { this.idempotency.delete(`${scope}:${key}`); }
  async completeIdempotency(input: { scope: string; key: string; status: IdempotencyRecord['status']; responseEnvelope: unknown; statusCode: number; traceId: string }): Promise<void> { const row = this.idempotency.get(`${input.scope}:${input.key}`); if (row) Object.assign(row, input); }
  async enqueueAutoReplyOutbox(input: { scope: string; aggregateType: string; aggregateId: string; operation: string; idempotencyKey: string; payload: Record<string, unknown>; traceId?: string; availableAt?: string }): Promise<{ record: AutoReplyOutboxRecord; created: boolean }> {
    const key = `${input.scope}:${input.idempotencyKey}`;
    const existing = this.autoReplyOutbox.get(key);
    if (existing) return { record: cloneOutbox(existing), created: false };
    const now = new Date().toISOString();
    const record: AutoReplyOutboxRecord = { id: createId(), scope: input.scope, aggregateType: input.aggregateType, aggregateId: input.aggregateId, operation: input.operation, status: 'pending', attempt: 0, availableAt: input.availableAt ?? now, idempotencyKey: input.idempotencyKey, payload: { ...input.payload }, traceId: input.traceId, createdAt: now, updatedAt: now };
    this.autoReplyOutbox.set(key, record);
    return { record: cloneOutbox(record), created: true };
  }
  async getAutoReplyOutbox(scope: string, idempotencyKey: string): Promise<AutoReplyOutboxRecord | undefined> { const record = this.autoReplyOutbox.get(`${scope}:${idempotencyKey}`); return record ? cloneOutbox(record) : undefined; }
  async listAutoReplyOutboxByAggregate(scope: string, aggregateId: string): Promise<AutoReplyOutboxRecord[]> { return [...this.autoReplyOutbox.values()].filter((record) => record.scope === scope && record.aggregateId === aggregateId).sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)).map(cloneOutbox); }
  async claimAutoReplyOutbox(input: { scope: string; workerId: string; limit: number; leaseMs: number; id?: string }): Promise<AutoReplyOutboxRecord[]> {
    const limit = Math.max(1, Math.min(100, Math.trunc(input.limit)));
    const leaseMs = Math.max(5_000, Math.min(300_000, Math.trunc(input.leaseMs)));
    const now = Date.now();
    const candidates = [...this.autoReplyOutbox.values()]
      .filter((record) => record.scope === input.scope && (!input.id || record.id === input.id))
      .filter((record) => ((record.status === 'pending' || record.status === 'retryable') && Date.parse(record.availableAt) <= now) || (record.status === 'processing' && Boolean(record.leaseExpiresAt) && Date.parse(record.leaseExpiresAt!) <= now))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
      .slice(0, limit);
    const claimed: AutoReplyOutboxRecord[] = [];
    for (const record of candidates) {
      const nowIso = new Date().toISOString();
      record.status = 'processing';
      record.attempt += 1;
      record.lockedAt = nowIso;
      record.leaseExpiresAt = new Date(Date.now() + leaseMs).toISOString();
      record.leaseOwner = input.workerId;
      record.updatedAt = nowIso;
      claimed.push(cloneOutbox(record));
    }
    return claimed;
  }
  async completeAutoReplyOutbox(input: { id: string; workerId: string; externalOutcome: AutoReplyOutboxRecord['externalOutcome']; externalMessageRef?: string }): Promise<boolean> {
    const record = [...this.autoReplyOutbox.values()].find((item) => item.id === input.id);
    if (!record || record.status !== 'processing' || record.leaseOwner !== input.workerId) return false;
    const now = new Date().toISOString();
    Object.assign(record, { status: 'succeeded' as const, externalOutcome: input.externalOutcome, externalMessageRef: input.externalMessageRef, lockedAt: undefined, leaseExpiresAt: undefined, leaseOwner: undefined, updatedAt: now });
    return true;
  }
  async persistAutoReplyOutbox(input: { id: string; outboundMessageId: string }): Promise<boolean> { const record = [...this.autoReplyOutbox.values()].find((item) => item.id === input.id); if (!record || record.status !== 'succeeded') return false; record.outboundMessageId = input.outboundMessageId; record.updatedAt = new Date().toISOString(); return true; }
  async retryAutoReplyOutbox(input: { id: string; workerId: string; errorCode: string; errorDigest: string; availableAt: string }): Promise<boolean> {
    const record = [...this.autoReplyOutbox.values()].find((item) => item.id === input.id);
    if (!record || record.status !== 'processing' || record.leaseOwner !== input.workerId) return false;
    const now = new Date().toISOString();
    Object.assign(record, { status: 'retryable' as const, availableAt: input.availableAt, lastErrorCode: input.errorCode, lastErrorDigest: input.errorDigest, lockedAt: undefined, leaseExpiresAt: undefined, leaseOwner: undefined, updatedAt: now });
    return true;
  }
  async deadLetterAutoReplyOutbox(input: { id: string; workerId: string; errorCode: string; errorDigest: string }): Promise<boolean> {
    const record = [...this.autoReplyOutbox.values()].find((item) => item.id === input.id);
    if (!record || record.status !== 'processing' || record.leaseOwner !== input.workerId) return false;
    const now = new Date().toISOString();
    Object.assign(record, { status: 'dead_lettered' as const, lastErrorCode: input.errorCode, lastErrorDigest: input.errorDigest, lockedAt: undefined, leaseExpiresAt: undefined, leaseOwner: undefined, updatedAt: now });
    return true;
  }
  async recordAudit(event: AuditEventRecord): Promise<void> { this.audits.push(event); }

  async listAgentSessions(adminId: string, query: { accountId?: string; search?: string } = {}): Promise<AgentSessionRecord[]> {
    const scopedAccountIds = new Set((await this.listScopes(adminId)).map((scope) => scope.accountId));
    const needle = query.search?.trim().toLowerCase();
    return [...this.agentSessions.values()]
      .filter((session) => scopedAccountIds.has(session.accountId))
      .filter((session) => !query.accountId || session.accountId === query.accountId)
      .filter((session) => !needle || `${session.title} ${session.summary ?? ''}`.toLowerCase().includes(needle))
      .sort((left, right) => Date.parse(right.lastActiveAt) - Date.parse(left.lastActiveAt))
      .map((session) => ({ ...session }));
  }

  async createAgentSession(input: { adminId: string; accountId: string; title: string; summary?: string }): Promise<AgentSessionRecord> {
    if (!(await this.hasAccountScope(input.adminId, input.accountId))) throw new Error('ACCOUNT_SCOPE_FORBIDDEN');
    const now = new Date().toISOString();
    const session: AgentSessionRecord = { id: createId(), accountId: input.accountId, title: input.title, status: 'active', summary: input.summary, lastActiveAt: now, createdAt: now, updatedAt: now };
    this.agentSessions.set(session.id, session);
    return { ...session };
  }

  async getAgentSession(adminId: string, sessionId: string): Promise<AgentSessionRecord | undefined> {
    const session = this.agentSessions.get(sessionId);
    if (!session || !(await this.hasAccountScope(adminId, session.accountId))) return undefined;
    return { ...session };
  }

  async archiveAgentSession(adminId: string, sessionId: string): Promise<AgentSessionRecord | undefined> {
    const session = this.agentSessions.get(sessionId);
    if (!session || !(await this.hasAccountScope(adminId, session.accountId))) return undefined;
    const now = new Date().toISOString();
    session.status = 'archived';
    session.archivedAt = now;
    session.updatedAt = now;
    return { ...session };
  }

  async createRun(input: { adminId: string; accountId: string; sessionId: string; instruction: string; clientRunRef?: string; route?: string }): Promise<{ run: RunRecord; steps: StepRecord[] }> {
    if (!(await this.hasAccountScope(input.adminId, input.accountId))) throw new Error('ACCOUNT_SCOPE_FORBIDDEN');
    const session = this.agentSessions.get(input.sessionId);
    if (!session || session.accountId !== input.accountId) throw new Error('SESSION_NOT_FOUND');
    if (session.status !== 'active') throw new Error('SESSION_ARCHIVED');
    if (input.clientRunRef) {
      const existing = await this.findRunByClientRef(input.adminId, input.accountId, input.clientRunRef);
      if (existing) return existing;
    }
    const now = new Date().toISOString();
    const run: RunRecord = { id: createId(), accountId: input.accountId, sessionId: input.sessionId, route: input.route ?? 'workspace', instruction: input.instruction, status: 'queued', requestedBy: input.adminId, clientRunRef: input.clientRunRef, createdAt: now, updatedAt: now };
    const step: StepRecord = { id: createId(), runId: run.id, stepNo: 1, kind: 'plan', label: '解析指令并准备执行上下文', status: 'pending', attempt: 1, inputSummary: input.instruction.slice(0, 200), createdAt: now };
    this.runs.set(run.id, run);
    this.steps.set(step.id, step);
    this.runEvents.set(run.id, []);
    session.lastActiveAt = now;
    session.updatedAt = now;
    return { run: { ...run }, steps: [{ ...step }] };
  }

  async findRunByClientRef(adminId: string, accountId: string, clientRunRef: string): Promise<{ run: RunRecord; steps: StepRecord[] } | undefined> {
    if (!(await this.hasAccountScope(adminId, accountId))) return undefined;
    const run = [...this.runs.values()].find((candidate) => candidate.accountId === accountId && candidate.clientRunRef === clientRunRef);
    if (!run) return undefined;
    return { run: { ...run }, steps: [...this.steps.values()].filter((step) => step.runId === run.id).sort((left, right) => left.stepNo - right.stepNo || left.attempt - right.attempt).map((step) => ({ ...step })) };
  }

  async getRun(adminId: string, runId: string): Promise<{ run: RunRecord; steps: StepRecord[] } | undefined> {
    const run = this.runs.get(runId);
    if (!run || !(await this.hasAccountScope(adminId, run.accountId))) return undefined;
    return { run: { ...run }, steps: [...this.steps.values()].filter((step) => step.runId === run.id).sort((left, right) => left.stepNo - right.stepNo || left.attempt - right.attempt).map((step) => ({ ...step })) };
  }

  async updateRun(runId: string, patch: { status?: RunStatus; resultSummary?: string; errorCode?: string; startedAt?: string; finishedAt?: string }): Promise<RunRecord | undefined> {
    const run = this.runs.get(runId);
    if (!run) return undefined;
    Object.assign(run, patch, { updatedAt: new Date().toISOString() });
    return { ...run };
  }

  async updateRunStep(stepId: string, patch: { status?: StepStatus; inputSummary?: string; outputSummary?: string; errorCode?: string; startedAt?: string; finishedAt?: string }): Promise<StepRecord | undefined> {
    const step = this.steps.get(stepId);
    if (!step) return undefined;
    Object.assign(step, patch);
    return { ...step };
  }

  async appendRunEvent(input: { runId: string; eventType: string; payload: Record<string, unknown> }): Promise<RunEventRecord> {
    const event: RunEventRecord = { sequence: ++this.runEventSequence, runId: input.runId, eventType: input.eventType, payload: { ...input.payload }, createdAt: new Date().toISOString() };
    const events = this.runEvents.get(input.runId) ?? [];
    events.push(event);
    this.runEvents.set(input.runId, events);
    return { ...event, payload: { ...event.payload } };
  }

  async listRunEvents(adminId: string, runId: string, afterSequence = 0): Promise<RunEventRecord[]> {
    const run = this.runs.get(runId);
    if (!run || !(await this.hasAccountScope(adminId, run.accountId))) return [];
    return (this.runEvents.get(runId) ?? []).filter((event) => event.sequence > afterSequence).map((event) => ({ ...event, payload: { ...event.payload } }));
  }

  async appendWorkspaceMessage(input: { adminId: string; sessionId: string; runId?: string; type: WorkspaceMessageType; content: string; summary?: string }): Promise<WorkspaceMessageRecord> {
    const session = await this.getAgentSession(input.adminId, input.sessionId);
    if (!session) throw new Error('SESSION_NOT_FOUND');
    const messages = this.workspaceMessages.get(input.sessionId) ?? [];
    const message: WorkspaceMessageRecord = { id: createId(), sessionId: input.sessionId, runId: input.runId, type: input.type, content: input.content, summary: input.summary, createdAt: new Date().toISOString(), sequence: messages.length + 1 };
    messages.push(message);
    this.workspaceMessages.set(input.sessionId, messages);
    return { ...message };
  }

  async listWorkspaceMessages(adminId: string, sessionId: string, limit = 100): Promise<WorkspaceMessageRecord[]> {
    const session = await this.getAgentSession(adminId, sessionId);
    if (!session) return [];
    const messages = this.workspaceMessages.get(sessionId) ?? [];
    return messages.slice(-Math.max(1, Math.min(limit, 500))).map((message) => ({ ...message }));
  }

  private async withCouponReservationLock<T>(work: () => Promise<T>): Promise<T> {
    let release!: () => void;
    const previous = this.couponReservationMutex;
    this.couponReservationMutex = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try { return await work(); } finally { release(); }
  }

  private async expireCouponReservations(): Promise<void> {
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    for (const reservation of this.couponReservations.values()) {
      if (reservation.status !== 'reserved' || Date.parse(reservation.leaseUntil) > now) continue;
      for (const itemRef of reservation.items) {
        const item = this.couponItems.get(itemRef.itemId);
        if (item?.status === 'reserved') { item.status = 'available'; item.reservedUntil = undefined; }
      }
      reservation.status = 'expired';
      reservation.reason = 'reservation_expired';
      reservation.updatedAt = nowIso;
      reservation.finalizedAt = nowIso;
      for (const batchId of reservation.batchIds) {
        const batch = this.couponBatches.get(batchId);
        if (batch?.status === 'exhausted') { batch.status = 'active'; batch.updatedAt = nowIso; batch.version += 1; }
      }
    }
  }

  private selectAvailableCouponItems(batches: CouponBatchRecord[], quantity: number): CouponItemRecord[] {
    const available: CouponItemRecord[] = [];
    for (const batch of batches) {
      const items = [...this.couponItems.values()]
        .filter((item) => item.batchId === batch.id && item.status === 'available')
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
      available.push(...items);
      if (available.length >= quantity) break;
    }
    return available.slice(0, quantity);
  }

  private productSummary(product: ProductRecord): ProductRecord {
    return { ...product, attributes: { ...product.attributes }, skuCount: product.skus?.filter((sku) => sku.status !== 'archived').length ?? product.skuCount ?? 0, assetCount: product.assets?.filter((asset) => asset.status !== 'archived').length ?? product.assetCount ?? 0, couponBatches: this.productCouponBatches(product.id), skus: undefined, assets: undefined };
  }

  private enrichOrder(order: OrderRecord): OrderRecord {
    const product = (order.productId ? this.products.get(order.productId) : undefined);
    const scopedProduct = product?.accountId === order.accountId ? product : undefined;
    const matchedProduct = scopedProduct
      ?? [...this.products.values()].find((candidate) => candidate.accountId === order.accountId && candidate.externalProductRef === order.itemId);
    const conversation = (order.conversationId ? this.conversations.get(order.conversationId) : undefined);
    const scopedConversation = conversation?.accountId === order.accountId ? conversation : undefined;
    const matchedConversation = scopedConversation
      ?? [...this.conversations.values()].find((candidate) => candidate.accountId === order.accountId && candidate.buyerRef === order.buyerId);
    const matchedItemConversation = [...this.conversations.values()].find((candidate) => candidate.accountId === order.accountId && candidate.itemRef === order.itemId && Boolean(candidate.itemTitle?.trim()));
    const itemTitle = meaningfulOrderTitle(order.itemTitle, [order.itemId])
      ?? meaningfulOrderTitle(matchedProduct?.title, [order.itemId, matchedProduct?.externalProductRef])
      ?? meaningfulOrderTitle(matchedItemConversation?.itemTitle, [order.itemId, matchedItemConversation?.itemRef])
      ?? meaningfulOrderTitle(matchedConversation?.itemTitle, [order.itemId, matchedConversation?.itemRef])
      ?? '';
    const itemImageUrl = matchedItemConversation?.itemImageUrl?.trim()
      || matchedConversation?.itemImageUrl?.trim()
      || productImageUrl(matchedProduct);
    const buyerNickname = order.buyerNickname?.trim() || matchedConversation?.buyerDisplayName?.trim() || undefined;
    const buyerAvatarUrl = order.buyerAvatarUrl?.trim() || matchedConversation?.buyerAvatarUrl?.trim() || undefined;
    return { ...order, productId: order.productId ?? matchedProduct?.id, buyerNickname, buyerAvatarUrl, itemTitle, itemImageUrl };
  }
  async getAutomationExecution(executionKey: string): Promise<AutomationExecutionLedgerRecord | undefined> {
    const record = this.automationExecutions.get(executionKey);
    return record ? structuredClone(record) : undefined;
  }
  async claimAutomationExecution(input: { executionKey: string; fingerprint: string; ownerToken: string; leaseUntil: string }): Promise<{ claimed: boolean; record: AutomationExecutionLedgerRecord }> {
    const now = new Date().toISOString();
    const existing = this.automationExecutions.get(input.executionKey);
    if (!existing) {
      const record: AutomationExecutionLedgerRecord = { executionKey: input.executionKey, fingerprint: input.fingerprint, status: 'running', retryable: false, ownerToken: input.ownerToken, leaseUntil: input.leaseUntil, attemptCount: 1, createdAt: now, updatedAt: now };
      this.automationExecutions.set(input.executionKey, record);
      return { claimed: true, record: structuredClone(record) };
    }
    if (existing.fingerprint !== input.fingerprint) throw new Error('AUTOMATION_EXECUTION_FINGERPRINT_CONFLICT');
    const expired = existing.status === 'running' && (!existing.leaseUntil || Date.parse(existing.leaseUntil) <= Date.now());
    if ((existing.status === 'completed' && existing.retryable) || expired) {
      existing.status = 'running';
      existing.result = undefined;
      existing.retryable = false;
      existing.ownerToken = input.ownerToken;
      existing.leaseUntil = input.leaseUntil;
      existing.attemptCount += 1;
      existing.updatedAt = now;
      return { claimed: true, record: structuredClone(existing) };
    }
    return { claimed: false, record: structuredClone(existing) };
  }
  async completeAutomationExecution(input: { executionKey: string; ownerToken: string; result: unknown; retryable: boolean }): Promise<void> {
    const record = this.automationExecutions.get(input.executionKey);
    if (!record || record.ownerToken !== input.ownerToken) throw new Error('AUTOMATION_EXECUTION_OWNER_CONFLICT');
    record.status = 'completed';
    record.result = structuredClone(input.result);
    record.retryable = input.retryable;
    record.leaseUntil = undefined;
    record.updatedAt = new Date().toISOString();
  }
  async recordReviewFact(input: { accountId: string; orderNo: string; eventId: string; reviewedAt?: string }): Promise<{ created: boolean }> {
    const key = `${input.accountId}:${input.orderNo}`;
    if (this.reviewFacts.has(key)) return { created: false };
    const reviewedAt = input.reviewedAt ?? new Date().toISOString();
    this.reviewFacts.set(key, { accountId: input.accountId, orderNo: input.orderNo, eventId: input.eventId, reviewedAt });
    const order = [...this.orders.values()].find((candidate) => candidate.accountId === input.accountId && candidate.orderNo === input.orderNo);
    if (order) { order.reviewedAt = reviewedAt; order.updatedAt = reviewedAt; order.configVersion += 1; }
    return { created: true };
  }
  async recordReviewReminderSent(input: { accountId: string; orderNo: string; sentAt: string }): Promise<OrderRecord | undefined> {
    const order = [...this.orders.values()].find((candidate) => candidate.accountId === input.accountId && candidate.orderNo === input.orderNo);
    if (!order) return undefined;
    order.reminderCount = (order.reminderCount ?? 0) + 1;
    order.lastReminderAt = input.sentAt;
    order.updatedAt = input.sentAt;
    order.configVersion += 1;
    return this.enrichOrder(order);
  }

  private productDetail(product: ProductRecord): ProductRecord {
    return { ...product, attributes: { ...product.attributes }, couponBatches: this.productCouponBatches(product.id), skus: product.skus?.map((sku) => ({ ...sku })), assets: product.assets?.map((asset) => ({ ...asset })), skuCount: product.skus?.filter((sku) => sku.status !== 'archived').length ?? product.skuCount ?? 0, assetCount: product.assets?.filter((asset) => asset.status !== 'archived').length ?? product.assetCount ?? 0 };
  }

  private cloneProductAutomation(record: ProductAutomationConfigRecord): ProductAutomationConfigRecord {
    return { ...record, config: structuredClone(record.config) };
  }

  private productCouponBatches(productId: string): Array<{ id: string; label?: string }> {
    return [...this.couponBindings.values()]
      .filter((binding) => binding.productId === productId && binding.status === 'active')
      .sort((left, right) => right.priority - left.priority || left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
      .flatMap((binding) => {
        const batch = this.couponBatches.get(binding.batchId);
        return batch && batch.status !== 'voided' ? [{ id: batch.sequenceId ?? batch.id, label: batch.label }] : [];
      });
  }

  private couponSummary(batch: CouponBatchRecord): CouponBatchRecord {
    const items = [...this.couponItems.values()].filter((item) => item.batchId === batch.id);
    return { ...batch, items: undefined, bindings: undefined, totalCount: items.length, availableCount: items.filter((item) => item.status === 'available').length, reservedCount: items.filter((item) => item.status === 'reserved').length, consumedCount: items.filter((item) => item.status === 'consumed').length };
  }

  private findCouponBatch(batchId: string): CouponBatchRecord | undefined {
    const direct = this.couponBatches.get(batchId);
    if (direct) return direct;
    if (!/^\d+$/.test(batchId)) return undefined;
    const matches = [...this.couponBatches.values()].filter((batch) => batch.sequenceId === batchId);
    return matches.find((batch) => batch.status !== 'voided') ?? matches.sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  }

  private nextCouponBatchSequence(): string {
    const used = new Set([...this.couponBatches.values()]
      .filter((batch) => batch.status !== 'voided')
      .map((batch) => Number(batch.sequenceId))
      .filter((value) => Number.isSafeInteger(value) && value > 0));
    let candidate = 1;
    while (used.has(candidate)) candidate += 1;
    return String(candidate);
  }
}
