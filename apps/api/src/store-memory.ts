import type { AccountListQuery, AccountListResult, AccountRecord, AccountScopeRecord, AdminRecord, AuditEventRecord, AutoReplyAgentConfig, AutoReplyAgentConfigPatch, AutoReplyAgentConfigRecord, AutoReplyRunRecord, AutoReplyDecision, AutoReplyRunStatus, ConversationEventRecord, ConversationListQuery, ConversationListResult, ConversationRecord, CouponBatchListQuery, CouponBatchListResult, CouponBatchMetadata, CouponBatchRecord, CouponBatchStatus, CouponBindingRecord, CouponDeliveryScope, CouponItemRecord, CredentialRecord, CredentialRefRecord, CredentialRefStatus, IdempotencyRecord, LoginSessionRecord, MessageListQuery, MessageListResult, MessageRecord, OrderListQuery, OrderListResult, OrderRecord, OrderSource, OrderUpsertResult, ProductListQuery, ProductListResult, ProductPatch, ProductRecord, ProductStatus, SessionRecord, Store, XianyuOrderItem, XianyuProductItem, ProductUpsertResult } from './domain.js';
import { createId } from './security.js';
import { decodeConversationCursor, encodeConversationCursor, isAfterConversationCursor } from './conversation-cursor.js';
import { decodeMessageHistoryCursor } from './message-history-cursor.js';
import type { AgentSessionRecord, RunEventRecord, RunRecord, RunStatus, StepRecord, StepStatus, WorkspaceMessageRecord, WorkspaceMessageType } from './domain.js';

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

function conversationSortKey(conversation: ConversationRecord): string { return conversation.lastMessageAt ?? conversation.updatedAt; }

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
  private readonly products = new Map<string, ProductRecord>();
  private readonly orders = new Map<string, OrderRecord>();
  private readonly couponBatches = new Map<string, CouponBatchRecord>();
  private readonly couponItems = new Map<string, CouponItemRecord>();
  private readonly couponBindings = new Map<string, CouponBindingRecord>();
  private readonly conversations = new Map<string, ConversationRecord>();
  private readonly messages = new Map<string, MessageRecord>();
  private readonly autoReplyRuns = new Map<string, AutoReplyRunRecord>();
  private readonly conversationEvents = new Map<string, ConversationEventRecord[]>();
  private readonly conversationCursors = new Map<string, number>();
  private readonly scopes = new Map<string, AccountScopeRecord>();
  private readonly idempotency = new Map<string, IdempotencyRecord>();
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
    const sortBy = query.sortBy ?? 'updatedAt';
    const sortOrder = query.sortOrder === 'asc' ? 1 : -1;
    filtered.sort((left, right) => {
      const leftValue = sortBy === 'title' ? left.title.toLowerCase() : sortBy === 'priceMinor' ? (left.priceMinor ?? 0) : sortBy === 'createdAt' ? left.createdAt : left.updatedAt;
      const rightValue = sortBy === 'title' ? right.title.toLowerCase() : sortBy === 'priceMinor' ? (right.priceMinor ?? 0) : sortBy === 'createdAt' ? right.createdAt : right.updatedAt;
      return (leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0) * sortOrder;
    });
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const start = (page - 1) * pageSize;
    const items = filtered.slice(start, start + pageSize).map((product) => this.productSummary(product));
    return { items, page, pageSize, total: filtered.length, totalPages: Math.max(1, Math.ceil(filtered.length / pageSize)) };
  }
  async getProduct(adminId: string, productId: string): Promise<ProductRecord | undefined> {
    const product = this.products.get(productId);
    if (!product || !(await this.hasAccountScope(adminId, product.accountId))) return undefined;
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
    const existing = [...this.orders.values()].find((order) => order.accountId === input.accountId && order.orderNo === input.item.orderNo);
    const now = input.syncedAt;
    if (existing) {
      Object.assign(existing, { ...input.item, accountId: input.accountId, accountName: input.accountName ?? existing.accountName, updatedAt: now, source: 'xianyu' as const, sourcePayloadDigest: input.item.sourcePayloadDigest, configVersion: existing.configVersion + 1 });
      return { action: 'updated', order: this.enrichOrder(existing) };
    }
    const order: OrderRecord = { ...input.item, id: createId(), accountId: input.accountId, accountName: input.accountName, updatedAt: input.item.updatedAt ?? now, configVersion: 1, source: 'xianyu' };
    this.orders.set(order.id, order);
    return { action: 'created', order: this.enrichOrder(order) };
  }
  async createProduct(input: { adminId: string; accountId: string; externalProductRef?: string; title: string; description?: string; categoryCode?: string; attributes?: Record<string, unknown>; defaultReplyTemplate?: string; aiPrompt?: string; priceMinor?: number; status?: ProductStatus }): Promise<ProductRecord> {
    if (!(await this.hasAccountScope(input.adminId, input.accountId))) throw new Error('ACCOUNT_SCOPE_FORBIDDEN');
    const duplicate = [...this.products.values()].find((product) => product.accountId === input.accountId && input.externalProductRef && product.externalProductRef === input.externalProductRef);
    if (duplicate) throw new Error('PRODUCT_DUPLICATE');
    const now = new Date().toISOString();
    const product: ProductRecord = { id: createId(), accountId: input.accountId, externalProductRef: input.externalProductRef, title: input.title, description: input.description, categoryCode: input.categoryCode, attributes: input.attributes ?? {}, defaultReplyTemplate: input.defaultReplyTemplate, aiPrompt: input.aiPrompt, configVersion: 1, priceMinor: input.priceMinor, status: input.status ?? 'draft', source: 'local', createdAt: now, updatedAt: now, skuCount: 0, assetCount: 0, skus: [], assets: [] };
    this.products.set(product.id, product);
    return this.productDetail(product);
  }

  async upsertExternalProduct(input: { adminId: string; accountId: string; item: XianyuProductItem; syncedAt: string }): Promise<ProductUpsertResult> {
    if (!(await this.hasAccountScope(input.adminId, input.accountId))) throw new Error('ACCOUNT_SCOPE_FORBIDDEN');
    const existing = [...this.products.values()].find((product) => product.accountId === input.accountId && product.externalProductRef === input.item.externalProductRef);
    if (existing?.source === 'local' && existing.status === 'draft') return { action: 'skipped_local_draft', product: this.productDetail(existing) };
    const now = new Date().toISOString();
    const attributes = { ...input.item.attributes, xianyu: { detailUrl: input.item.detailUrl, externalStatus: input.item.externalStatus, imageUrls: input.item.imageUrls } };
    if (existing) {
      existing.title = input.item.title;
      existing.description = input.item.description;
      existing.categoryCode = input.item.categoryCode;
      existing.priceMinor = input.item.priceMinor;
      existing.attributes = attributes;
      existing.source = 'xianyu';
      existing.sourcePayloadDigest = input.item.sourcePayloadDigest;
      existing.lastSyncedAt = input.syncedAt;
      existing.status = 'published';
      existing.configVersion += 1;
      existing.updatedAt = now;
      return { action: 'updated', product: this.productDetail(existing) };
    }
    const product: ProductRecord = { id: createId(), accountId: input.accountId, externalProductRef: input.item.externalProductRef, title: input.item.title, description: input.item.description, categoryCode: input.item.categoryCode, attributes, configVersion: 1, priceMinor: input.item.priceMinor, status: 'published', source: 'xianyu', lastSyncedAt: input.syncedAt, sourcePayloadDigest: input.item.sourcePayloadDigest, createdAt: now, updatedAt: now, skuCount: 0, assetCount: 0, skus: [], assets: [] };
    this.products.set(product.id, product);
    return { action: 'created', product: this.productDetail(product) };
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
    if (input.patch.aiPrompt !== undefined) product.aiPrompt = input.patch.aiPrompt ?? undefined;
    if (input.patch.priceMinor !== undefined) product.priceMinor = input.patch.priceMinor ?? undefined;
    product.configVersion += 1;
    product.updatedAt = new Date().toISOString();
    return this.productDetail(product);
  }
  async listCouponBatches(adminId: string, query: CouponBatchListQuery): Promise<CouponBatchListResult> {
    const scopedAccounts = new Set((await this.listScopes(adminId)).map((scope) => scope.accountId));
    const normalizedKeyword = query.keyword?.trim().toLowerCase();
    const filtered = [...this.couponBatches.values()].filter((batch) => {
      if (!scopedAccounts.has(batch.accountId)) return false;
      if (query.accountId && batch.accountId !== query.accountId) return false;
      if (query.status && batch.status !== query.status) return false;
      if (query.purpose && batch.purpose !== query.purpose) return false;
      if (normalizedKeyword && !`${batch.id} ${batch.label ?? ''} ${batch.purpose}`.toLowerCase().includes(normalizedKeyword)) return false;
      if (query.stockAlert) {
        const items = [...this.couponItems.values()].filter((item) => item.batchId === batch.id);
        const available = items.filter((item) => item.status === 'available').length;
        const stockAlert = batch.status === 'voided' || available === 0 ? 'exhausted' : available <= 5 ? 'low_stock' : 'normal';
        if (stockAlert !== query.stockAlert) return false;
      }
      return true;
    }).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const start = (page - 1) * pageSize;
    return { items: filtered.slice(start, start + pageSize).map((batch) => this.couponSummary(batch)), page, pageSize, total: filtered.length, totalPages: Math.max(1, Math.ceil(filtered.length / pageSize)) };
  }
  async getCouponBatch(adminId: string, batchId: string): Promise<CouponBatchRecord | undefined> {
    const batch = this.couponBatches.get(batchId);
    if (!batch || !(await this.hasAccountScope(adminId, batch.accountId))) return undefined;
    const items = [...this.couponItems.values()].filter((item) => item.batchId === batchId).map((item) => ({ ...item }));
    const bindings = [...this.couponBindings.values()].filter((binding) => binding.batchId === batchId).map((binding) => ({ ...binding }));
    return { ...batch, items, bindings };
  }
  async createCouponBatch(input: { adminId: string; accountId: string; label?: string; purpose: string; deliveryScope: CouponDeliveryScope; quarkUrl?: string; extractionCode?: string; metadata?: CouponBatchMetadata }): Promise<CouponBatchRecord> {
    if (!(await this.hasAccountScope(input.adminId, input.accountId))) throw new Error('ACCOUNT_SCOPE_FORBIDDEN');
    const now = new Date().toISOString();
    const batch: CouponBatchRecord = { id: createId(), accountId: input.accountId, label: input.label, purpose: input.purpose, deliveryScope: input.deliveryScope, quarkUrl: input.quarkUrl, extractionCode: input.extractionCode, metadata: input.metadata ?? {}, totalCount: 0, status: 'active', version: 1, createdAt: now, updatedAt: now };
    this.couponBatches.set(batch.id, batch);
    return { ...batch };
  }
  async updateCouponBatch(input: { adminId: string; batchId: string; patch: { label?: string; purpose?: string; deliveryScope?: CouponDeliveryScope; quarkUrl?: string; extractionCode?: string; status?: CouponBatchStatus; metadata?: CouponBatchMetadata } }): Promise<CouponBatchRecord | undefined> {
    const batch = this.couponBatches.get(input.batchId);
    if (!batch || !(await this.hasAccountScope(input.adminId, batch.accountId))) return undefined;
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
    const batch = this.couponBatches.get(input.batchId);
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
    const batch = this.couponBatches.get(input.batchId);
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
    const batch = this.couponBatches.get(input.batchId);
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
    const batch = this.couponBatches.get(input.batchId);
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

  async listConversationEvents(adminId: string, conversationId: string, afterCursor: number, limit: number): Promise<ConversationEventRecord[]> {
    const conversation = await this.getConversation(adminId, conversationId);
    if (!conversation) return [];
    return (this.conversationEvents.get(conversationId) ?? []).filter((event) => event.cursor > afterCursor).slice(0, Math.min(limit, 200)).map((event) => ({ ...event, payload: { ...event.payload } }));
  }

  async findMessageByExternalRef(adminId: string, conversationId: string, externalMessageRef: string): Promise<MessageRecord | undefined> {
    const conversation = await this.getConversation(adminId, conversationId);
    if (!conversation) return undefined;
    const message = [...this.messages.values()].find((item) => item.conversationId === conversationId && item.externalMessageRef === externalMessageRef);
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

  async createMessage(input: { adminId: string; conversationId: string; direction: MessageRecord['direction']; senderRole: MessageRecord['senderRole']; bodyType: MessageRecord['bodyType']; bodyText?: string; bodyRef?: string; externalMessageRef?: string; source?: MessageRecord['source']; orderRef?: string; productRef?: string; riskFlags?: string[]; createdAt?: string; traceId?: string }): Promise<{ message: MessageRecord; event: ConversationEventRecord }> {
    const conversation = this.conversations.get(input.conversationId);
    if (!conversation || !(await this.hasAccountScope(input.adminId, conversation.accountId))) throw new Error('CONVERSATION_NOT_FOUND');
    if (input.externalMessageRef) {
      const existing = [...this.messages.values()].find((item) => item.conversationId === input.conversationId && item.externalMessageRef === input.externalMessageRef);
      if (existing) {
        const event = this.eventForMessage(input.conversationId, existing.id);
        if (event) return { message: { ...existing, riskFlags: [...existing.riskFlags] }, event: { ...event, payload: { ...event.payload } } };
      }
    }
    const now = input.createdAt ?? new Date().toISOString();
    const message: MessageRecord = { id: createId(), conversationId: conversation.id, accountId: conversation.accountId, direction: input.direction, senderRole: input.senderRole, bodyType: input.bodyType, bodyText: input.bodyText, bodyRef: input.bodyRef, redactionState: 'visible', status: 'created', readStatus: 0, externalMessageRef: input.externalMessageRef, source: input.source, orderRef: input.orderRef, productRef: input.productRef, riskFlags: [...(input.riskFlags ?? [])], handlingMode: conversation.handlingMode, createdAt: now };
    this.messages.set(message.id, message);
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
    return { ...run, riskFlags: [...run.riskFlags], orderRefs: [...run.orderRefs] };
  }

  async updateAutoReplyRun(id: string, patch: { intent?: string; decision?: AutoReplyDecision; status?: AutoReplyRunStatus; riskFlags?: string[]; productId?: string; orderRefs?: string[]; contextDigest?: string; replyDigest?: string; senderOutcome?: AutoReplyRunRecord['senderOutcome']; outboundMessageId?: string; failureCode?: string }): Promise<AutoReplyRunRecord | undefined> {
    const run = this.autoReplyRuns.get(id);
    if (!run) return undefined;
    Object.assign(run, patch, { updatedAt: new Date().toISOString() });
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
  async createCredentialRef(input: { adminId: string; accountId: string; provider: string; alias: string; label?: string; secretCiphertext: string; fingerprint: string; metadata?: Record<string, string> }): Promise<CredentialRefRecord> {
    if (!(await this.hasAccountScope(input.adminId, input.accountId))) throw new Error('ACCOUNT_SCOPE_FORBIDDEN');
    const duplicate = [...this.credentialRefs.values()].find((row) => row.accountId === input.accountId && row.kind === 'api_key' && row.purpose === 'model_client');
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
  async getIdempotency(scope: string, key: string): Promise<IdempotencyRecord | undefined> { const row = this.idempotency.get(`${scope}:${key}`); if (row && Date.parse(row.expiresAt) <= Date.now()) { this.idempotency.delete(`${scope}:${key}`); return undefined; } return row; }
  async beginIdempotency(record: IdempotencyRecord): Promise<void> { this.idempotency.set(`${record.scope}:${record.key}`, record); }
  async abortIdempotency(scope: string, key: string): Promise<void> { this.idempotency.delete(`${scope}:${key}`); }
  async completeIdempotency(input: { scope: string; key: string; status: IdempotencyRecord['status']; responseEnvelope: unknown; statusCode: number; traceId: string }): Promise<void> { const row = this.idempotency.get(`${input.scope}:${input.key}`); if (row) Object.assign(row, input); }
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
    return { ...order, buyerNickname, buyerAvatarUrl, itemTitle, itemImageUrl };
  }

  private productDetail(product: ProductRecord): ProductRecord {
    return { ...product, attributes: { ...product.attributes }, couponBatches: this.productCouponBatches(product.id), skus: product.skus?.map((sku) => ({ ...sku })), assets: product.assets?.map((asset) => ({ ...asset })), skuCount: product.skus?.filter((sku) => sku.status !== 'archived').length ?? product.skuCount ?? 0, assetCount: product.assets?.filter((asset) => asset.status !== 'archived').length ?? product.assetCount ?? 0 };
  }

  private productCouponBatches(productId: string): Array<{ id: string; label?: string }> {
    return [...this.couponBindings.values()]
      .filter((binding) => binding.productId === productId && binding.status === 'active')
      .sort((left, right) => right.priority - left.priority || left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
      .flatMap((binding) => {
        const batch = this.couponBatches.get(binding.batchId);
        return batch ? [{ id: batch.id, label: batch.label }] : [];
      });
  }

  private couponSummary(batch: CouponBatchRecord): CouponBatchRecord {
    const items = [...this.couponItems.values()].filter((item) => item.batchId === batch.id);
    return { ...batch, items: undefined, bindings: undefined, totalCount: items.length, availableCount: items.filter((item) => item.status === 'available').length, reservedCount: items.filter((item) => item.status === 'reserved').length, consumedCount: items.filter((item) => item.status === 'consumed').length };
  }
}
