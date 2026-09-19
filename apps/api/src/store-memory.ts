import type { AccountRecord, AccountScopeRecord, AdminRecord, AuditEventRecord, CouponBatchListQuery, CouponBatchListResult, CouponBatchMetadata, CouponBatchRecord, CouponBatchStatus, CouponBindingRecord, CouponDeliveryScope, CouponItemRecord, CredentialRecord, IdempotencyRecord, LoginSessionRecord, ProductListQuery, ProductListResult, ProductPatch, ProductRecord, ProductStatus, SessionRecord, Store, XianyuProductItem, ProductUpsertResult } from './domain.js';
import { createId } from './security.js';

export class MemoryStore implements Store {
  readonly kind = 'memory' as const;
  private readonly admins = new Map<string, AdminRecord>();
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly accounts = new Map<string, AccountRecord>();
  private readonly loginSessions = new Map<string, LoginSessionRecord>();
  private readonly credentials = new Map<string, CredentialRecord>();
  private readonly products = new Map<string, ProductRecord>();
  private readonly couponBatches = new Map<string, CouponBatchRecord>();
  private readonly couponItems = new Map<string, CouponItemRecord>();
  private readonly couponBindings = new Map<string, CouponBindingRecord>();
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
  async hasAccountScope(adminId: string, accountId: string): Promise<boolean> { const account = this.accounts.get(accountId); return account?.status !== 'disabled' && (await this.listScopes(adminId)).some((scope) => scope.accountId === accountId); }
  async grantScope(input: { adminId: string; accountId: string; scope: string }): Promise<AccountScopeRecord> {
    const existing = [...this.scopes.values()].find((item) => item.adminId === input.adminId && item.accountId === input.accountId && item.scope === input.scope);
    if (existing) { existing.status = 'active'; existing.revokedAt = undefined; return existing; }
    const row: AccountScopeRecord = { id: createId(), adminId: input.adminId, accountId: input.accountId, scope: input.scope, status: 'active' };
    this.scopes.set(row.id, row);
    return row;
  }
  async revokeScope(adminId: string, accountId: string, scope: string): Promise<void> { const item = [...this.scopes.values()].find((row) => row.adminId === adminId && row.accountId === accountId && row.scope === scope); if (item) { item.status = 'revoked'; item.revokedAt = new Date().toISOString(); } }
  async listAccounts(adminId: string): Promise<AccountRecord[]> { const ids = new Set((await this.listScopes(adminId)).map((scope) => scope.accountId)); return [...this.accounts.values()].filter((account) => ids.has(account.id) && account.status !== 'disabled'); }
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
  async createProduct(input: { adminId: string; accountId: string; externalProductRef?: string; title: string; description?: string; categoryCode?: string; attributes?: Record<string, unknown>; defaultReplyTemplate?: string; aiPrompt?: string; priceMinor?: number; status?: ProductStatus }): Promise<ProductRecord> {
    if (!(await this.hasAccountScope(input.adminId, input.accountId))) throw new Error('ACCOUNT_SCOPE_FORBIDDEN');
    const duplicate = [...this.products.values()].find((product) => product.accountId === input.accountId && input.externalProductRef && product.externalProductRef === input.externalProductRef);
    if (duplicate) throw new Error('PRODUCT_DUPLICATE');
    const now = new Date().toISOString();
    const product: ProductRecord = { id: createId(), accountId: input.accountId, externalProductRef: input.externalProductRef, title: input.title, description: input.description, categoryCode: input.categoryCode, attributes: input.attributes ?? {}, defaultReplyTemplate: input.defaultReplyTemplate, aiPrompt: input.aiPrompt, configVersion: 1, priceMinor: input.priceMinor, status: input.status ?? 'draft', source: 'local', createdAt: now, updatedAt: now, skuCount: 0, assetCount: 0, skus: [], assets: [] };
    this.products.set(product.id, product);
    return product;
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

  private productSummary(product: ProductRecord): ProductRecord {
    return { ...product, attributes: { ...product.attributes }, skuCount: product.skus?.filter((sku) => sku.status !== 'archived').length ?? product.skuCount ?? 0, assetCount: product.assets?.filter((asset) => asset.status !== 'archived').length ?? product.assetCount ?? 0, skus: undefined, assets: undefined };
  }

  private productDetail(product: ProductRecord): ProductRecord {
    return { ...product, attributes: { ...product.attributes }, skus: product.skus?.map((sku) => ({ ...sku })), assets: product.assets?.map((asset) => ({ ...asset })), skuCount: product.skus?.filter((sku) => sku.status !== 'archived').length ?? product.skuCount ?? 0, assetCount: product.assets?.filter((asset) => asset.status !== 'archived').length ?? product.assetCount ?? 0 };
  }

  private couponSummary(batch: CouponBatchRecord): CouponBatchRecord {
    const items = [...this.couponItems.values()].filter((item) => item.batchId === batch.id);
    return { ...batch, items: undefined, bindings: undefined, totalCount: items.length, availableCount: items.filter((item) => item.status === 'available').length, reservedCount: items.filter((item) => item.status === 'reserved').length, consumedCount: items.filter((item) => item.status === 'consumed').length };
  }
}
