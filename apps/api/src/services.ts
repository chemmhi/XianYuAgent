import type { AppConfig } from './config.js';
import type { AccountRecord, AccountScopeRecord, AdminRecord, AuditEventRecord, CredentialRecord, IdempotencyRecord, LoginSessionRecord, ProductListQuery, ProductListResult, ProductPatch, ProductRecord, ProductSyncResult, SessionRecord, Store } from './domain.js';
import { createId, createToken, digestJson, hashPassword, isSessionFresh, sha256, verifyPassword } from './security.js';
import type { XianyuMtopClient } from './xianyu-mtop.js';

export interface AuthContext {
  admin: AdminRecord;
  session: SessionRecord;
  csrfToken: string;
  scopes: AccountScopeRecord[];
}

export class AuthService {
  constructor(private readonly store: Store, private readonly config: AppConfig) {}

  async bootstrap(input: { email: string; password: string; displayName: string; requestId?: string; traceId?: string }): Promise<{ admin: AdminRecord; session: SessionRecord; csrfToken: string; auditRef: string }> {
    if (await this.store.countAdmins() > 0) throw new ServiceError(409, 'CONFLICT', 'bootstrap_already_completed', { reason: 'bootstrap_already_completed' });
    const admin = await this.store.createAdmin({ email: input.email, passwordHash: await hashPassword(input.password), displayName: input.displayName });
    const session = await this.createSession(admin.id);
    const auditRef = await this.audit({ actorType: 'admin', actorId: admin.id, action: 'auth.bootstrap.completed', requestId: input.requestId ?? 'bootstrap', traceId: input.traceId ?? 'bootstrap', payload: { email: admin.email } });
    return { admin, session, csrfToken: this.sessionTokens.get(session.id)!, auditRef };
  }

  async login(input: { email: string; password: string }): Promise<{ admin: AdminRecord; session: SessionRecord; csrfToken: string }> {
    const admin = await this.store.findAdminByEmail(input.email);
    if (!admin || !(await verifyPassword(input.password, admin.passwordHash)) || admin.status !== 'active') throw new ServiceError(401, 'UNAUTHENTICATED', 'invalid_credentials');
    await this.store.touchAdminLogin(admin.id);
    const session = await this.createSession(admin.id);
    return { admin, session, csrfToken: this.sessionTokens.get(session.id)! };
  }

  async contextFromSession(sessionId: string | undefined): Promise<AuthContext | undefined> {
    if (!sessionId) return undefined;
    const session = await this.store.findSession(sessionId);
    if (!session || session.revokedAt || !isSessionFresh(session, this.config.sessionIdleMs, this.config.sessionAbsoluteMs)) return undefined;
    const admin = await this.findAdminById(session.adminId);
    if (!admin || admin.status !== 'active') return undefined;
    await this.store.touchSession(session.id, new Date().toISOString());
    let csrfToken = this.sessionTokens.get(session.id);
    if (!csrfToken) { csrfToken = createToken(); await this.store.rotateSessionCsrf(session.id, sha256(csrfToken)); }
    this.sessionTokens.set(session.id, csrfToken);
    return { admin, session, csrfToken, scopes: await this.store.listScopes(admin.id) };
  }

  async validateCsrf(context: AuthContext, headers: Record<string, string | undefined>, cookies: Record<string, string>): Promise<void> {
    const suppliedHeader = headers['x-csrf-token'];
    const suppliedCookie = cookies.csrf_token;
    if (!suppliedHeader || !suppliedCookie || suppliedHeader !== suppliedCookie || sha256(suppliedHeader) !== context.session.csrfTokenHash) throw new ServiceError(403, 'CSRF_INVALID', 'csrf token invalid');
  }

  async logout(context: AuthContext): Promise<void> { await this.store.revokeSession(context.session.id, 'logout'); this.sessionTokens.delete(context.session.id); }

  async sessionView(context: AuthContext): Promise<{ admin: { id: string; email: string; displayName: string; role: string }; scopes: AccountScopeRecord[] }> {
    return { admin: { id: context.admin.id, email: context.admin.email, displayName: context.admin.displayName, role: context.admin.role }, scopes: context.scopes };
  }

  async getBootstrapRequired(): Promise<boolean> { return (await this.store.countAdmins()) === 0; }
  getCsrfToken(sessionId: string): string | undefined { return this.sessionTokens.get(sessionId); }

  private readonly sessionTokens = new Map<string, string>();
  private async createSession(adminId: string): Promise<SessionRecord> { const csrfToken = createToken(); const issuedAt = Date.now(); const session = await this.store.createSession({ adminId, csrfTokenHash: sha256(csrfToken), expiresAt: new Date(issuedAt + this.config.sessionAbsoluteMs).toISOString() }); this.sessionTokens.set(session.id, csrfToken); return session; }
  private async findAdminById(adminId: string): Promise<AdminRecord> { const admin = await this.store.findAdminById(adminId); if (!admin) throw new ServiceError(401, 'UNAUTHENTICATED', 'session admin not found'); return admin; }
  private async audit(input: { actorType: string; actorId?: string; action: string; targetRef?: string; requestId: string; traceId: string; payload: unknown; accountId?: string; reason?: string }): Promise<string> { const id = createId(); const event: AuditEventRecord = { id, actorType: input.actorType, actorId: input.actorId, action: input.action, targetRef: input.targetRef, requestId: input.requestId, traceId: input.traceId, payloadDigest: digestJson(input.payload), accountId: input.accountId, reason: input.reason, createdAt: new Date().toISOString() }; await this.store.recordAudit(event); return id; }
}

export class AccountService {
  constructor(private readonly store: Store, private readonly audit: (input: { actorId: string; action: string; targetRef?: string; requestId: string; traceId: string; payload: unknown; accountId?: string }) => Promise<string>) {}
  async list(adminId: string): Promise<AccountRecord[]> { return this.store.listAccounts(adminId); }
  async get(adminId: string, accountId: string): Promise<AccountRecord> { const account = await this.store.getAccount(adminId, accountId); if (!account) throw new ServiceError(404, 'NOT_FOUND', 'account not found'); return account; }
  async create(input: { adminId: string; platform: string; sellerRef: string; displayName?: string; requestId: string; traceId: string }): Promise<AccountRecord> { if (!input.platform || !input.sellerRef) throw new ServiceError(422, 'VALIDATION_FAILED', 'platform and sellerRef are required'); try { const account = await this.store.createAccount(input); await this.audit({ actorId: input.adminId, action: 'account.created', targetRef: account.id, requestId: input.requestId, traceId: input.traceId, payload: { platform: account.platform, sellerRef: account.sellerRef }, accountId: account.id }); return account; } catch (error) { if (error instanceof Error && error.message === 'ACCOUNT_DUPLICATE') throw new ServiceError(409, 'CONFLICT', 'account already exists'); const code = (error as { code?: string }).code; if (code === '23505') throw new ServiceError(409, 'CONFLICT', 'account already exists'); throw error; } }
  async update(input: { adminId: string; accountId: string; patch: { sellerRef?: string; displayName?: string; remark?: string; avatarUrl?: string; platformUserId?: string; status?: AccountRecord['status'] }; requestId: string; traceId: string }): Promise<AccountRecord> { const account = await this.store.updateAccount(input.adminId, input.accountId, input.patch); if (!account) throw new ServiceError(404, 'NOT_FOUND', 'account not found'); await this.audit({ actorId: input.adminId, action: 'account.updated', targetRef: account.id, requestId: input.requestId, traceId: input.traceId, payload: input.patch, accountId: account.id }); return account; }
  async createLoginSession(input: { adminId: string; accountId?: string; loginMethod: string; requestId: string; traceId: string }): Promise<LoginSessionRecord> { if (input.accountId) await this.get(input.adminId, input.accountId); const session = await this.store.createLoginSession({ adminId: input.adminId, accountId: input.accountId, provisionalAccountRef: input.accountId ? undefined : `provisional_${createId()}`, loginMethod: input.loginMethod, expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(), qrTokenRef: `qr_ref_${createId()}` }); await this.audit({ actorId: input.adminId, action: 'account.login_session.created', targetRef: session.id, requestId: input.requestId, traceId: input.traceId, payload: { loginMethod: session.loginMethod, status: session.status, provisional: !input.accountId }, accountId: input.accountId }); return session; }
  async getLoginSession(input: { adminId: string; accountId: string; sessionId: string }): Promise<LoginSessionRecord> { const session = await this.store.getLoginSession(input.adminId, input.accountId, input.sessionId); if (!session) throw new ServiceError(404, 'NOT_FOUND', 'login session not found'); return session; }
  async getLoginSessionById(input: { adminId: string; sessionId: string }): Promise<LoginSessionRecord> { const session = await this.store.getLoginSessionById(input.adminId, input.sessionId); if (!session) throw new ServiceError(404, 'NOT_FOUND', 'login session not found'); return session; }
  async updateLoginSession(input: { adminId: string; accountId?: string; sessionId: string; patch: { accountId?: string; status?: LoginSessionRecord['status']; expiresAt?: string; completedAt?: string; failureCode?: string }; requestId: string; traceId: string }): Promise<LoginSessionRecord> { const session = await this.store.updateLoginSession(input.adminId, input.accountId, input.sessionId, input.patch); if (!session) throw new ServiceError(404, 'NOT_FOUND', 'login session not found'); await this.audit({ actorId: input.adminId, action: `account.login_session.${input.patch.status ?? 'updated'}`, targetRef: session.id, requestId: input.requestId, traceId: input.traceId, payload: input.patch, accountId: input.patch.accountId ?? input.accountId }); return session; }
  async scopes(adminId: string, accountId: string): Promise<AccountScopeRecord[]> { if (!(await this.store.hasAccountScope(adminId, accountId))) throw new ServiceError(404, 'NOT_FOUND', 'account not found'); return this.store.listScopes(adminId).then((items) => items.filter((item) => item.accountId === accountId)); }
  async grantScope(input: { adminId: string; accountId: string; scope: string; requestId: string; traceId: string }): Promise<AccountScopeRecord> { await this.get(input.adminId, input.accountId); const row = await this.store.grantScope(input); await this.audit({ actorId: input.adminId, action: 'account.scope.granted', targetRef: row.id, requestId: input.requestId, traceId: input.traceId, payload: { scope: input.scope }, accountId: input.accountId }); return row; }
  async revokeScope(input: { adminId: string; accountId: string; scope: string; requestId: string; traceId: string }): Promise<void> { await this.get(input.adminId, input.accountId); await this.store.revokeScope(input.adminId, input.accountId, input.scope); await this.audit({ actorId: input.adminId, action: 'account.scope.revoked', requestId: input.requestId, traceId: input.traceId, payload: { scope: input.scope }, accountId: input.accountId }); }
}

export class ProductService {
  constructor(private readonly store: Store, private readonly audit: (input: { actorId: string; action: string; targetRef?: string; requestId: string; traceId: string; payload: unknown; accountId?: string }) => Promise<string>) {}

  async list(adminId: string, query: ProductListQuery): Promise<ProductListResult> {
    if (query.accountId && (!isUuid(query.accountId) || !(await this.store.hasAccountScope(adminId, query.accountId)))) throw new ServiceError(403, 'FORBIDDEN', 'account scope required');
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    if (!Number.isInteger(page) || page < 1) throw new ServiceError(422, 'VALIDATION_FAILED', 'page must be a positive integer');
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new ServiceError(422, 'VALIDATION_FAILED', 'pageSize must be between 1 and 100');
    if (query.status && !['draft', 'ready', 'publishing', 'published', 'failed', 'archived'].includes(query.status)) throw new ServiceError(422, 'VALIDATION_FAILED', 'invalid product status');
    if (query.sortBy && !['createdAt', 'updatedAt', 'title', 'priceMinor'].includes(query.sortBy)) throw new ServiceError(422, 'VALIDATION_FAILED', 'invalid product sort field');
    if (query.sortOrder && !['asc', 'desc'].includes(query.sortOrder)) throw new ServiceError(422, 'VALIDATION_FAILED', 'invalid product sort order');
    return this.store.listProducts(adminId, { ...query, page, pageSize });
  }

  async get(adminId: string, productId: string): Promise<ProductRecord> {
    if (!isUuid(productId)) throw new ServiceError(404, 'NOT_FOUND', 'product not found');
    const product = await this.store.getProduct(adminId, productId);
    if (!product) throw new ServiceError(404, 'NOT_FOUND', 'product not found');
    return product;
  }

  async create(input: { adminId: string; accountId: string; externalProductRef?: string; title: unknown; description?: unknown; categoryCode?: unknown; attributesJson?: unknown; defaultReplyTemplate?: unknown; aiPrompt?: unknown; priceMinor?: unknown; requestId: string; traceId: string }): Promise<ProductRecord> {
    if (!isUuid(input.accountId) || !(await this.store.hasAccountScope(input.adminId, input.accountId))) throw new ServiceError(403, 'FORBIDDEN', 'account scope required');
    const normalized = validateProductWrite(input, false);
    if (!normalized.title) throw new ServiceError(422, 'VALIDATION_FAILED', 'title must be between 1 and 200 characters');
    try {
      const product = await this.store.createProduct({ adminId: input.adminId, accountId: input.accountId, externalProductRef: normalizeOptionalString(input.externalProductRef), title: normalized.title, description: normalized.description ?? undefined, categoryCode: normalized.categoryCode ?? undefined, attributes: normalized.attributes, defaultReplyTemplate: normalized.defaultReplyTemplate ?? undefined, aiPrompt: normalized.aiPrompt ?? undefined, priceMinor: normalized.priceMinor ?? undefined, status: 'draft' });
      await this.audit({ actorId: input.adminId, action: 'product.created', targetRef: product.id, requestId: input.requestId, traceId: input.traceId, payload: { accountId: product.accountId, title: product.title, externalProductRef: product.externalProductRef, status: product.status }, accountId: product.accountId });
      return product;
    } catch (error) {
      throw mapProductStoreError(error);
    }
  }

  async update(input: { adminId: string; productId: string; accountId?: string; expectedConfigVersion: unknown; patch: Record<string, unknown>; requestId: string; traceId: string }): Promise<ProductRecord> {
    if (!isUuid(input.productId)) throw new ServiceError(404, 'NOT_FOUND', 'product not found');
    if (!Number.isSafeInteger(input.expectedConfigVersion) || Number(input.expectedConfigVersion) < 1) throw new ServiceError(422, 'VALIDATION_FAILED', 'expectedConfigVersion must be a positive integer');
    if (input.accountId !== undefined) {
      if (!isUuid(input.accountId) || !(await this.store.hasAccountScope(input.adminId, input.accountId))) throw new ServiceError(403, 'FORBIDDEN', 'account scope required');
      const scopedProduct = await this.store.getProduct(input.adminId, input.productId);
      if (!scopedProduct) throw new ServiceError(404, 'NOT_FOUND', 'product not found');
      if (scopedProduct.accountId !== input.accountId) throw new ServiceError(403, 'FORBIDDEN', 'account scope required');
    }
    const patch = validateProductWrite(input.patch, true);
    if (Object.keys(patch).length === 0) throw new ServiceError(422, 'VALIDATION_FAILED', 'product patch must contain at least one editable field');
    try {
      const product = await this.store.updateProduct({ adminId: input.adminId, productId: input.productId, expectedConfigVersion: Number(input.expectedConfigVersion), patch });
      if (!product) throw new ServiceError(404, 'NOT_FOUND', 'product not found');
      await this.audit({ actorId: input.adminId, action: 'product.updated', targetRef: product.id, requestId: input.requestId, traceId: input.traceId, payload: { fields: Object.keys(patch), expectedConfigVersion: input.expectedConfigVersion, configVersion: product.configVersion }, accountId: product.accountId });
      return product;
    } catch (error) {
      throw mapProductStoreError(error);
    }
  }
}

export class ProductSyncService {
  constructor(private readonly store: Store, private readonly xianyu: XianyuMtopClient, private readonly audit: (input: { actorId: string; action: string; targetRef?: string; requestId: string; traceId: string; payload: unknown; accountId?: string }) => Promise<string>) {}

  async sync(input: { adminId: string; accountId: string; pageSize?: unknown; maxPages?: unknown; requestId: string; traceId: string }): Promise<ProductSyncResult> {
    if (!isUuid(input.accountId) || !(await this.store.hasAccountScope(input.adminId, input.accountId))) throw new ServiceError(403, 'FORBIDDEN', 'account scope required');
    const pageSize = normalizeBoundedInteger(input.pageSize, 20, 1, 100);
    const maxPages = normalizeBoundedInteger(input.maxPages, 20, 1, 100);
    const syncRunId = createId();
    const fetched = await this.xianyu.fetchItemsAll(input.adminId, input.accountId, pageSize, maxPages);
    const firstFailure = fetched.pages.find((page) => !page.success);
    if (firstFailure) {
      if (firstFailure.accountInvalid) throw new ServiceError(409, 'ACCOUNT_REAUTH_REQUIRED', firstFailure.message ?? 'xianyu credential is invalid', { errorCode: firstFailure.errorCode });
      throw new ServiceError(502, 'XIANYU_SYNC_FAILED', firstFailure.message ?? 'xianyu product sync failed', { errorCode: firstFailure.errorCode });
    }
    let createdCount = 0;
    let updatedCount = 0;
    let skippedLocalDraftCount = 0;
    const products: ProductRecord[] = [];
    const syncedAt = new Date().toISOString();
    for (const item of fetched.items) {
      const upserted = await this.store.upsertExternalProduct({ adminId: input.adminId, accountId: input.accountId, item, syncedAt });
      products.push(upserted.product);
      if (upserted.action === 'created') createdCount += 1;
      else if (upserted.action === 'updated') updatedCount += 1;
      else skippedLocalDraftCount += 1;
    }
    await this.audit({ actorId: input.adminId, action: 'product.sync.completed', targetRef: syncRunId, requestId: input.requestId, traceId: input.traceId, accountId: input.accountId, payload: { pagesFetched: fetched.pages.length, fetchedCount: fetched.items.length, createdCount, updatedCount, skippedLocalDraftCount, hasMore: fetched.hasMore } });
    return { syncRunId, accountId: input.accountId, pageNumber: 1, pageSize, pagesFetched: fetched.pages.length, fetchedCount: fetched.items.length, createdCount, updatedCount, skippedLocalDraftCount, items: products, hasMore: fetched.hasMore, nextPageNumber: fetched.hasMore ? fetched.pages.length + 1 : undefined };
  }
}

function isUuid(value: string): boolean { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }

function normalizeBoundedInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(numeric)) return fallback;
  return Math.min(maximum, Math.max(minimum, numeric));
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}

function validateProductWrite(input: Record<string, unknown>, patch: boolean): ProductPatch {
  const result: ProductPatch = {};
  if (!patch || Object.prototype.hasOwnProperty.call(input, 'title')) {
    if (typeof input.title !== 'string' || input.title.trim().length < 1 || input.title.trim().length > 200) throw new ServiceError(422, 'VALIDATION_FAILED', 'title must be between 1 and 200 characters');
    result.title = input.title.trim();
  }
  if (Object.prototype.hasOwnProperty.call(input, 'description') && input.description !== undefined) {
    if (input.description !== null && typeof input.description !== 'string') throw new ServiceError(422, 'VALIDATION_FAILED', 'description must be a string or null');
    if (typeof input.description === 'string' && input.description.trim().length > 5000) throw new ServiceError(422, 'VALIDATION_FAILED', 'description must be at most 5000 characters');
    result.description = input.description === null ? null : input.description.trim();
  }
  if (Object.prototype.hasOwnProperty.call(input, 'categoryCode') && input.categoryCode !== undefined) {
    if (input.categoryCode !== null && typeof input.categoryCode !== 'string') throw new ServiceError(422, 'VALIDATION_FAILED', 'categoryCode must be a string or null');
    if (typeof input.categoryCode === 'string' && input.categoryCode.trim().length > 64) throw new ServiceError(422, 'VALIDATION_FAILED', 'categoryCode must be at most 64 characters');
    result.categoryCode = input.categoryCode === null ? null : (input.categoryCode.trim() || null);
  }
  if (Object.prototype.hasOwnProperty.call(input, 'attributesJson') && input.attributesJson !== undefined) {
    if (!input.attributesJson || typeof input.attributesJson !== 'object' || Array.isArray(input.attributesJson)) throw new ServiceError(422, 'VALIDATION_FAILED', 'attributesJson must be an object');
    result.attributes = { ...(input.attributesJson as Record<string, unknown>) };
  } else if (Object.prototype.hasOwnProperty.call(input, 'attributes') && input.attributes !== undefined) {
    if (!input.attributes || typeof input.attributes !== 'object' || Array.isArray(input.attributes)) throw new ServiceError(422, 'VALIDATION_FAILED', 'attributesJson must be an object');
    result.attributes = { ...(input.attributes as Record<string, unknown>) };
  }
  for (const key of ['defaultReplyTemplate', 'aiPrompt'] as const) {
    if (!Object.prototype.hasOwnProperty.call(input, key)) continue;
    const value = input[key];
    if (value === undefined) continue;
    if (value !== null && typeof value !== 'string') throw new ServiceError(422, 'VALIDATION_FAILED', `${key} must be a string or null`);
    result[key] = value === null ? null : value.trim();
  }
  if (Object.prototype.hasOwnProperty.call(input, 'priceMinor') && input.priceMinor !== undefined) {
    if (input.priceMinor !== null && (!Number.isSafeInteger(input.priceMinor) || Number(input.priceMinor) < 0)) throw new ServiceError(422, 'VALIDATION_FAILED', 'priceMinor must be a non-negative integer');
    result.priceMinor = input.priceMinor === null ? null : Number(input.priceMinor);
  }
  return result;
}

function mapProductStoreError(error: unknown): ServiceError {
  const code = error instanceof Error ? error.message : String(error);
  if (code === 'ACCOUNT_SCOPE_FORBIDDEN') return new ServiceError(403, 'FORBIDDEN', 'account scope required');
  if (code === 'PRODUCT_VERSION_CONFLICT') return new ServiceError(409, 'PRODUCT_VERSION_CONFLICT', 'product config version conflict');
  if (code === 'PRODUCT_DUPLICATE' || (error as { code?: string })?.code === '23505') return new ServiceError(409, 'CONFLICT', 'product already exists');
  if (code === 'PRODUCT_PATCH_EMPTY') return new ServiceError(422, 'VALIDATION_FAILED', 'product patch must contain at least one editable field');
  if (error instanceof ServiceError) return error;
  throw error;
}

export class CredentialService {
  constructor(private readonly store: Store, private readonly audit: (input: { actorId: string; action: string; targetRef?: string; requestId: string; traceId: string; payload: unknown; accountId?: string }) => Promise<string>) {}

  async get(adminId: string, accountId: string): Promise<CredentialRecord> {
    const credential = await this.store.getCredential(adminId, accountId);
    if (!credential) throw new ServiceError(404, 'NOT_FOUND', 'credential not found');
    return credential;
  }

  async save(input: { adminId: string; accountId: string; cookieHeader?: string; accessToken?: string; deviceId?: string; metadata?: Record<string, string>; expiresAt?: string; requestId: string; traceId: string }): Promise<CredentialRecord> {
    const account = await this.store.getAccount(input.adminId, input.accountId);
    if (!account) throw new ServiceError(404, 'NOT_FOUND', 'account not found');
    const current = await this.store.getCredential(input.adminId, input.accountId);
    const cookieHeader = input.cookieHeader?.trim() || current?.cookieHeader;
    const accessToken = input.accessToken?.trim() || current?.accessToken;
    const deviceId = input.deviceId?.trim() || current?.deviceId;
    const metadata = { ...(current?.metadata ?? {}), ...(input.metadata ?? {}) };
    if (!cookieHeader && !accessToken && !deviceId && Object.keys(metadata).length === 0) throw new ServiceError(422, 'VALIDATION_FAILED', 'at least one credential field is required');
    if (input.expiresAt && !Number.isFinite(Date.parse(input.expiresAt))) throw new ServiceError(422, 'VALIDATION_FAILED', 'expiresAt must be an ISO timestamp');
    const credential = await this.store.upsertCredential({ adminId: input.adminId, accountId: input.accountId, platform: account.platform, cookieHeader, accessToken, deviceId, metadata, expiresAt: input.expiresAt ?? current?.expiresAt });
    await this.store.updateAccount(input.adminId, input.accountId, { status: 'connected', lastConnectedAt: new Date().toISOString() });
    await this.audit({ actorId: input.adminId, action: current ? 'account.credential.updated' : 'account.credential.created', targetRef: credential.id, requestId: input.requestId, traceId: input.traceId, payload: { fields: Object.keys({ cookieHeader: input.cookieHeader, accessToken: input.accessToken, deviceId: input.deviceId, metadata: input.metadata, expiresAt: input.expiresAt }).filter((key) => input[key as keyof typeof input] !== undefined) }, accountId: input.accountId });
    return credential;
  }

  async revoke(input: { adminId: string; accountId: string; requestId: string; traceId: string }): Promise<CredentialRecord> {
    const credential = await this.store.revokeCredential(input.adminId, input.accountId);
    if (!credential) throw new ServiceError(404, 'NOT_FOUND', 'credential not found');
    await this.store.updateAccount(input.adminId, input.accountId, { status: 'disconnected' });
    await this.audit({ actorId: input.adminId, action: 'account.credential.revoked', targetRef: credential.id, requestId: input.requestId, traceId: input.traceId, payload: { status: credential.status }, accountId: input.accountId });
    return credential;
  }

  async verify(input: { adminId: string; accountId: string; status: CredentialRecord['status']; expiresAt?: string; requestId: string; traceId: string }): Promise<CredentialRecord> {
    if (!['active', 'expired', 'revoked'].includes(input.status)) throw new ServiceError(422, 'VALIDATION_FAILED', 'invalid credential status');
    const credential = await this.store.markCredentialVerified(input);
    if (!credential) throw new ServiceError(404, 'NOT_FOUND', 'credential not found');
    await this.store.updateAccount(input.adminId, input.accountId, { status: input.status === 'active' ? 'connected' : input.status === 'revoked' ? 'disconnected' : 'expired', ...(input.status === 'active' ? { lastConnectedAt: new Date().toISOString() } : {}) });
    await this.audit({ actorId: input.adminId, action: 'account.credential.verified', targetRef: credential.id, requestId: input.requestId, traceId: input.traceId, payload: { status: credential.status }, accountId: input.accountId });
    return credential;
  }

  async completeLoginSession(input: { adminId: string; accountId: string; sessionId: string; cookieHeader?: string; accessToken?: string; deviceId?: string; metadata?: Record<string, string>; expiresAt?: string; requestId: string; traceId: string }): Promise<{ session: LoginSessionRecord; credential: CredentialRecord }> {
    const loginSession = await this.store.getLoginSession(input.adminId, input.accountId, input.sessionId);
    if (!loginSession) throw new ServiceError(404, 'NOT_FOUND', 'login session not found');
    if (!['waiting', 'scanned'].includes(loginSession.status)) throw new ServiceError(409, 'CONFLICT', `login session cannot complete from ${loginSession.status}`);
    const credential = await this.save(input);
    const session = await this.store.updateLoginSession(input.adminId, input.accountId, input.sessionId, { status: 'succeeded', completedAt: new Date().toISOString(), failureCode: undefined });
    if (!session) throw new ServiceError(404, 'NOT_FOUND', 'login session not found');
    await this.audit({ actorId: input.adminId, action: 'account.login_session.succeeded', targetRef: session.id, requestId: input.requestId, traceId: input.traceId, payload: { status: session.status, credentialId: credential.id }, accountId: input.accountId });
    return { session, credential };
  }
}

export class ServiceError extends Error {
  constructor(readonly statusCode: number, readonly code: string, message: string, readonly details?: unknown) { super(message); }
}

export async function idempotent<T>(store: Store, input: { scope: string; key: string; fingerprint: string; traceId: string; handler: () => Promise<{ statusCode: number; body: unknown }> }): Promise<{ statusCode: number; body: unknown; replayed: boolean }> {
  const existing = await store.getIdempotency(input.scope, input.key);
  if (existing) {
    if (existing.requestFingerprint !== input.fingerprint) throw new ServiceError(409, 'IDEMPOTENCY_CONFLICT', 'idempotency key reused with a different request');
    if (existing.status === 'processing') throw new ServiceError(202, 'IDEMPOTENCY_IN_PROGRESS', 'request is already processing');
    return { statusCode: existing.statusCode ?? 200, body: existing.responseEnvelope, replayed: true };
  }
  const record: IdempotencyRecord = { scope: input.scope, key: input.key, requestFingerprint: input.fingerprint, status: 'processing', expiresAt: new Date(Date.now() + 30 * 24 * 3_600_000).toISOString() };
  try {
    await store.beginIdempotency(record);
  } catch (error) {
    if ((error as { code?: string }).code === '23505') {
      const concurrent = await store.getIdempotency(input.scope, input.key);
      if (concurrent) {
        if (concurrent.requestFingerprint !== input.fingerprint) throw new ServiceError(409, 'IDEMPOTENCY_CONFLICT', 'idempotency key reused with a different request');
        if (concurrent.status === 'processing') throw new ServiceError(202, 'IDEMPOTENCY_IN_PROGRESS', 'request is already processing');
        return { statusCode: concurrent.statusCode ?? 200, body: concurrent.responseEnvelope, replayed: true };
      }
    }
    throw error;
  }
  let result: { statusCode: number; body: unknown };
  try {
    result = await input.handler();
  } catch (error) {
    await store.abortIdempotency(input.scope, input.key);
    throw error;
  }
  await store.completeIdempotency({ scope: input.scope, key: input.key, status: result.statusCode >= 400 ? 'failed' : 'succeeded', responseEnvelope: result.body, statusCode: result.statusCode, traceId: input.traceId });
  return { ...result, replayed: false };
}
