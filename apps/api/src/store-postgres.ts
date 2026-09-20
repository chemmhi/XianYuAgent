import { Pool } from 'pg';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { AccountListQuery, AccountListResult, AccountRecord, AccountScopeRecord, AgentSessionRecord, AdminRecord, AuditEventRecord, ConversationEventRecord, ConversationListQuery, ConversationListResult, ConversationRecord, CouponBatchListQuery, CouponBatchListResult, CouponBatchMetadata, CouponBatchRecord, CouponBatchStatus, CouponBindingRecord, CouponDeliveryScope, CouponItemRecord, CredentialRecord, IdempotencyRecord, LoginSessionRecord, MessageListQuery, MessageListResult, MessageRecord, ProductAssetRecord, ProductListQuery, ProductListResult, ProductPatch, ProductRecord, ProductSkuRecord, ProductStatus, RunEventRecord, RunRecord, RunStatus, SessionRecord, StepRecord, StepStatus, Store, WorkspaceMessageRecord, WorkspaceMessageType, XianyuProductItem, ProductUpsertResult } from './domain.js';
import { createId } from './security.js';
import { decodeConversationCursor, encodeConversationCursor } from './conversation-cursor.js';
import { decodeMessageHistoryCursor } from './message-history-cursor.js';

type Row = Record<string, unknown>;
const PRODUCT_COUPON_BATCHES_SELECT = `(select coalesce(json_agg(json_build_object('id', cb.id, 'label', cb.label) order by binding.priority desc, binding.created_at, cb.id), '[]'::json) from coupons.coupon_bindings binding join coupons.coupon_batches cb on cb.id=binding.coupon_batch_id where binding.product_id=p.id and binding.status='active') as coupon_batches`;
function dateIso(value: unknown): string {
  // node-postgres returns timestamptz columns as Date objects. Date#toString()
  // drops milliseconds, so never stringify a Date before serializing it.
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}
function iso(value: unknown): string | undefined { return value ? dateIso(value) : undefined; }

export class PostgresStore implements Store {
  readonly kind = 'postgres' as const;
  readonly pool: Pool;
  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl });
    // A database restart emits errors on idle clients. Keep the process alive
    // so subsequent pool queries can reconnect and the runtime can recover.
    this.pool.on('error', () => undefined);
  }
  async health(): Promise<{ kind: string; reachable: boolean }> { try { await this.pool.query('select 1'); return { kind: this.kind, reachable: true }; } catch { return { kind: this.kind, reachable: false }; } }
  async countAdmins(): Promise<number> { const result = await this.pool.query('select count(*)::int as count from auth.admins'); return Number(result.rows[0].count); }
  async findAdminById(id: string): Promise<AdminRecord | undefined> { const result = await this.pool.query('select * from auth.admins where id=$1 limit 1', [id]); return result.rows[0] ? this.toAdmin(result.rows[0]) : undefined; }
  async findAdminByEmail(email: string): Promise<AdminRecord | undefined> { const result = await this.pool.query('select * from auth.admins where lower(email)=lower($1) limit 1', [email]); return result.rows[0] ? this.toAdmin(result.rows[0]) : undefined; }
  async createAdmin(input: { email: string; passwordHash: string; displayName: string }): Promise<AdminRecord> { const result = await this.pool.query('insert into auth.admins (id,email,password_hash,display_name) values ($1,$2,$3,$4) returning *', [createId(), input.email.toLowerCase(), input.passwordHash, input.displayName]); return this.toAdmin(result.rows[0]); }
  async touchAdminLogin(adminId: string): Promise<void> { await this.pool.query('update auth.admins set last_login_at=now() where id=$1', [adminId]); }
  async createSession(input: { adminId: string; csrfTokenHash: string; expiresAt: string }): Promise<SessionRecord> { const id = createId(); const result = await this.pool.query('insert into auth.sessions (id,admin_id,expires_at,csrf_token_hash) values ($1,$2,$3,$4) returning *', [id, input.adminId, input.expiresAt, input.csrfTokenHash]); return this.toSession(result.rows[0]); }
  async findSession(id: string): Promise<SessionRecord | undefined> { const result = await this.pool.query('select * from auth.sessions where id=$1 limit 1', [id]); return result.rows[0] ? this.toSession(result.rows[0]) : undefined; }
  async touchSession(id: string, lastSeenAt: string): Promise<void> { await this.pool.query('update auth.sessions set last_seen_at=$2 where id=$1', [id, lastSeenAt]); }
  async rotateSessionCsrf(id: string, csrfTokenHash: string): Promise<void> { await this.pool.query('update auth.sessions set csrf_token_hash=$2 where id=$1', [id, csrfTokenHash]); }
  async revokeSession(id: string, reason: string): Promise<void> { await this.pool.query('update auth.sessions set revoked_at=now(), revoke_reason=$2 where id=$1', [id, reason]); }
  async listScopes(adminId: string): Promise<AccountScopeRecord[]> { const result = await this.pool.query('select * from auth.account_scopes where admin_id=$1 and status=\'active\' and (expires_at is null or expires_at>now())', [adminId]); return result.rows.map(this.toScope); }
  async hasAccountScope(adminId: string, accountId: string): Promise<boolean> { const result = await this.pool.query('select 1 from auth.account_scopes scope join accounts.accounts account on account.id=scope.account_id where scope.admin_id=$1 and scope.account_id=$2 and scope.status=\'active\' and account.status<>\'disabled\' and (scope.expires_at is null or scope.expires_at>now())', [adminId, accountId]); return (result.rowCount ?? 0) > 0; }
  async grantScope(input: { adminId: string; accountId: string; scope: string }): Promise<AccountScopeRecord> { const result = await this.pool.query('insert into auth.account_scopes (id,admin_id,account_id,scope,status) values ($1,$2,$3,$4,\'active\') on conflict (admin_id,account_id,scope) do update set status=\'active\', revoked_at=null returning *', [createId(), input.adminId, input.accountId, input.scope]); return this.toScope(result.rows[0]); }
  async revokeScope(adminId: string, accountId: string, scope: string): Promise<void> { await this.pool.query('update auth.account_scopes set status=\'revoked\', revoked_at=now() where admin_id=$1 and account_id=$2 and scope=$3', [adminId, accountId, scope]); }
  async listAccounts(adminId: string, query: AccountListQuery = {}): Promise<AccountListResult> {
    const params: unknown[] = [adminId];
    const conditions = ["EXISTS (SELECT 1 FROM auth.account_scopes scope WHERE scope.account_id=a.id AND scope.admin_id=$1 AND scope.status='active' AND (scope.expires_at IS NULL OR scope.expires_at>now()))", "a.status <> 'disabled'"];
    const addParam = (value: unknown) => { params.push(value); return `$${params.length}`; };
    const search = query.search?.trim();
    if (search) { const param = addParam(`%${search}%`); conditions.push(`(a.id ILIKE ${param} OR a.seller_ref ILIKE ${param} OR a.display_name ILIKE ${param} OR a.remark ILIKE ${param})`); }
    if (query.status) conditions.push(`a.status = ${addParam(query.status)}`);
    if (query.connectionStatus) {
      const statusByConnection: Record<NonNullable<AccountListQuery['connectionStatus']>, AccountRecord['status']> = { online: 'connected', connecting: 'pending', expired: 'expired', unknown: 'degraded', offline: 'disconnected' };
      conditions.push(`a.status = ${addParam(statusByConnection[query.connectionStatus])}`);
    }
    const where = conditions.join(' AND ');
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const totalResult = await this.pool.query(`select count(*)::int as total from accounts.accounts a where ${where}`, params);
    const total = Number(totalResult.rows[0]?.total ?? 0);
    const rows = await this.pool.query(`select a.* from accounts.accounts a where ${where} order by a.created_at desc limit $${params.length + 1} offset $${params.length + 2}`, [...params, pageSize, (page - 1) * pageSize]);
    return { items: rows.rows.map(this.toAccount), page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
  }
  async getAccount(adminId: string, accountId: string): Promise<AccountRecord | undefined> { const result = await this.pool.query('select a.* from accounts.accounts a join auth.account_scopes s on s.account_id=a.id where a.id=$1 and s.admin_id=$2 and s.status=\'active\' and a.status<>\'disabled\' and (s.expires_at is null or s.expires_at>now())', [accountId, adminId]); return result.rows[0] ? this.toAccount(result.rows[0]) : undefined; }
  async createAccount(input: { platform: string; sellerRef: string; displayName?: string; adminId: string }): Promise<AccountRecord> { const client = await this.pool.connect(); try { await client.query('begin'); const accountResult = await client.query('insert into accounts.accounts (id,platform,seller_ref,display_name,status) values ($1,$2,$3,$4,\'pending\') returning *', [createId(), input.platform, input.sellerRef, input.displayName ?? null]); const account = this.toAccount(accountResult.rows[0]); await client.query('insert into auth.account_scopes (id,admin_id,account_id,scope,status) values ($1,$2,$3,\'manage\',\'active\')', [createId(), input.adminId, account.id]); await client.query('commit'); return account; } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); } }
  async updateAccount(adminId: string, accountId: string, patch: { sellerRef?: string; displayName?: string; remark?: string; avatarUrl?: string; platformUserId?: string; status?: AccountRecord['status']; lastConnectedAt?: string }): Promise<AccountRecord | undefined> { const current = await this.getAccount(adminId, accountId); if (!current) return undefined; const result = await this.pool.query('update accounts.accounts set seller_ref=coalesce($2,seller_ref), display_name=coalesce($3,display_name), remark=coalesce($4,remark), avatar_url=coalesce($5,avatar_url), platform_user_id=coalesce($6,platform_user_id), status=coalesce($7,status), last_connected_at=coalesce($8,last_connected_at), updated_at=now() where id=$1 returning *', [accountId, patch.sellerRef ?? null, patch.displayName ?? null, patch.remark ?? null, patch.avatarUrl ?? null, patch.platformUserId ?? null, patch.status ?? null, patch.lastConnectedAt ?? null]); return result.rows[0] ? this.toAccount(result.rows[0]) : undefined; }
  async deleteAccount(adminId: string, accountId: string): Promise<AccountRecord | undefined> { const client = await this.pool.connect(); try { await client.query('begin'); const current = await client.query('select a.* from accounts.accounts a join auth.account_scopes s on s.account_id=a.id where a.id=$1 and s.admin_id=$2 and s.status=\'active\' and a.status<>\'disabled\' and (s.expires_at is null or s.expires_at>now()) for update', [accountId, adminId]); if (!current.rows[0]) { await client.query('rollback'); return undefined; } const result = await client.query('update accounts.accounts set status=\'disabled\', updated_at=now() where id=$1 returning *', [accountId]); await client.query('update auth.account_credentials set status=\'revoked\', updated_at=now() where account_id=$1 and status=\'active\'', [accountId]); await client.query('update auth.account_scopes set status=\'revoked\', revoked_at=now() where account_id=$1 and status=\'active\'', [accountId]); await client.query('commit'); return result.rows[0] ? this.toAccount(result.rows[0]) : undefined; } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); } }
  async listProducts(adminId: string, query: ProductListQuery): Promise<ProductListResult> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const params: unknown[] = [adminId];
    const conditions = ["EXISTS (SELECT 1 FROM auth.account_scopes scope WHERE scope.account_id=p.account_id AND scope.admin_id=$1 AND scope.status='active' AND (scope.expires_at IS NULL OR scope.expires_at>now()))"];
    if (query.accountId) { params.push(query.accountId); conditions.push(`p.account_id=$${params.length}`); }
    if (query.status) { params.push(query.status); conditions.push(`p.status=$${params.length}`); }
    if (query.keyword) { params.push(`%${query.keyword.trim().toLowerCase()}%`); conditions.push(`(lower(p.title) like $${params.length} or lower(coalesce(p.external_product_ref,'')) like $${params.length} or lower(coalesce(p.description,'')) like $${params.length})`); }
    const where = conditions.join(' AND ');
    const count = await this.pool.query(`select count(*)::int as count from products.products p where ${where}`, params);
    const total = Number(count.rows[0]?.count ?? 0);
    const sortColumn = query.sortBy === 'title' ? 'p.title' : query.sortBy === 'priceMinor' ? 'p.price_minor' : query.sortBy === 'createdAt' ? 'p.created_at' : 'p.updated_at';
    const sortOrder = query.sortOrder === 'asc' ? 'ASC' : 'DESC';
    const limitIndex = params.length + 1;
    const offsetIndex = params.length + 2;
    const rows = await this.pool.query(`select p.*, (select count(*)::int from products.product_skus sku where sku.product_id=p.id and sku.status <> 'archived') as sku_count, (select count(*)::int from products.asset_refs asset where asset.product_id=p.id and asset.status <> 'archived') as asset_count, ${PRODUCT_COUPON_BATCHES_SELECT} from products.products p where ${where} order by ${sortColumn} ${sortOrder}, p.id limit $${limitIndex} offset $${offsetIndex}`, [...params, pageSize, (page - 1) * pageSize]);
    return { items: rows.rows.map((row) => this.toProduct(row)), page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
  }
  async getProduct(adminId: string, productId: string): Promise<ProductRecord | undefined> {
    const result = await this.pool.query(`select p.*, (select count(*)::int from products.product_skus sku where sku.product_id=p.id and sku.status <> 'archived') as sku_count, (select count(*)::int from products.asset_refs asset where asset.product_id=p.id and asset.status <> 'archived') as asset_count, ${PRODUCT_COUPON_BATCHES_SELECT} from products.products p where p.id=$1 and exists (select 1 from auth.account_scopes scope where scope.account_id=p.account_id and scope.admin_id=$2 and scope.status='active' and (scope.expires_at is null or scope.expires_at>now()))`, [productId, adminId]);
    if (!result.rows[0]) return undefined;
    const product = this.toProduct(result.rows[0]);
    const [skuRows, assetRows] = await Promise.all([
      this.pool.query('select * from products.product_skus where product_id=$1 order by sku_code', [productId]),
      this.pool.query('select * from products.asset_refs where product_id=$1 order by id', [productId]),
    ]);
    product.skus = skuRows.rows.map((row) => this.toProductSku(row));
    product.assets = assetRows.rows.map((row) => this.toProductAsset(row));
    return product;
  }
  async createProduct(input: { adminId: string; accountId: string; externalProductRef?: string; title: string; description?: string; categoryCode?: string; attributes?: Record<string, unknown>; defaultReplyTemplate?: string; aiPrompt?: string; priceMinor?: number; status?: ProductStatus }): Promise<ProductRecord> {
    if (!(await this.hasAccountScope(input.adminId, input.accountId))) throw new Error('ACCOUNT_SCOPE_FORBIDDEN');
    const id = createId();
    await this.pool.query('insert into products.products (id,account_id,external_product_ref,title,description,category_code,attributes_json,default_reply_template,ai_prompt,price_minor,status,source) values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,\'local\')', [id, input.accountId, input.externalProductRef ?? null, input.title, input.description ?? null, input.categoryCode ?? null, JSON.stringify(input.attributes ?? {}), input.defaultReplyTemplate ?? null, input.aiPrompt ?? null, input.priceMinor ?? null, input.status ?? 'draft']);
    const product = await this.getProduct(input.adminId, id);
    if (!product) throw new Error('PRODUCT_CREATE_READBACK_FAILED');
    return product;
  }
  async updateProduct(input: { adminId: string; productId: string; expectedConfigVersion: number; patch: ProductPatch }): Promise<ProductRecord | undefined> {
    const current = await this.pool.query('select account_id from products.products where id=$1', [input.productId]);
    if (!current.rows[0]) return undefined;
    const accountId = String(current.rows[0].account_id);
    if (!(await this.hasAccountScope(input.adminId, accountId))) throw new Error('ACCOUNT_SCOPE_FORBIDDEN');
    const fields: string[] = [];
    const values: unknown[] = [input.productId, input.expectedConfigVersion];
    const add = (column: string, value: unknown) => { values.push(value); fields.push(`${column}=$${values.length}`); };
    if (input.patch.title !== undefined) add('title', input.patch.title);
    if (input.patch.description !== undefined) add('description', input.patch.description);
    if (input.patch.categoryCode !== undefined) add('category_code', input.patch.categoryCode);
    if (input.patch.attributes !== undefined) { values.push(JSON.stringify(input.patch.attributes)); fields.push(`attributes_json=$${values.length}::jsonb`); }
    if (input.patch.defaultReplyTemplate !== undefined) add('default_reply_template', input.patch.defaultReplyTemplate);
    if (input.patch.aiPrompt !== undefined) add('ai_prompt', input.patch.aiPrompt);
    if (input.patch.priceMinor !== undefined) add('price_minor', input.patch.priceMinor);
    if (fields.length === 0) throw new Error('PRODUCT_PATCH_EMPTY');
    fields.push('config_version=config_version+1', 'updated_at=now()');
    const result = await this.pool.query(`update products.products set ${fields.join(', ')} where id=$1 and config_version=$2 returning *`, values);
    if (!result.rows[0]) throw new Error('PRODUCT_VERSION_CONFLICT');
    return this.getProduct(input.adminId, input.productId);
  }

  async upsertExternalProduct(input: { adminId: string; accountId: string; item: XianyuProductItem; syncedAt: string }): Promise<ProductUpsertResult> {
    if (!(await this.hasAccountScope(input.adminId, input.accountId))) throw new Error('ACCOUNT_SCOPE_FORBIDDEN');
    const existingResult = await this.pool.query('select id,source,status from products.products where account_id=$1 and external_product_ref=$2 limit 1', [input.accountId, input.item.externalProductRef]);
    const existing = existingResult.rows[0] as Row | undefined;
    if (existing && String(existing.source ?? 'local') === 'local' && String(existing.status) === 'draft') {
      const product = await this.getProduct(input.adminId, String(existing.id));
      if (!product) throw new Error('PRODUCT_SYNC_READBACK_FAILED');
      return { action: 'skipped_local_draft', product };
    }
    const attributes = { ...input.item.attributes, xianyu: { detailUrl: input.item.detailUrl, externalStatus: input.item.externalStatus, imageUrls: input.item.imageUrls } };
    const id = existing ? String(existing.id) : createId();
    await this.pool.query(`insert into products.products (id,account_id,external_product_ref,title,description,category_code,attributes_json,price_minor,status,source,last_synced_at,source_payload_digest)
      values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,'published','xianyu',$9,$10)
      on conflict (account_id,external_product_ref) where external_product_ref is not null do update set title=excluded.title,description=excluded.description,category_code=excluded.category_code,attributes_json=excluded.attributes_json,price_minor=excluded.price_minor,status='published',source='xianyu',last_synced_at=excluded.last_synced_at,source_payload_digest=excluded.source_payload_digest,config_version=products.products.config_version+1,updated_at=now()
      returning id`, [id, input.accountId, input.item.externalProductRef, input.item.title, input.item.description ?? null, input.item.categoryCode ?? null, JSON.stringify(attributes), input.item.priceMinor ?? null, input.syncedAt, input.item.sourcePayloadDigest]);
    const product = await this.getProduct(input.adminId, id);
    if (!product) throw new Error('PRODUCT_SYNC_READBACK_FAILED');
    return { action: existing ? 'updated' : 'created', product };
  }
  async listCouponBatches(adminId: string, query: CouponBatchListQuery): Promise<CouponBatchListResult> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const params: unknown[] = [adminId];
    const conditions = ["EXISTS (SELECT 1 FROM auth.account_scopes scope WHERE scope.account_id=b.account_id AND scope.admin_id=$1 AND scope.status='active' AND (scope.expires_at IS NULL OR scope.expires_at>now()))"];
    if (query.accountId) { params.push(query.accountId); conditions.push(`b.account_id=$${params.length}`); }
    if (query.status) { params.push(query.status); conditions.push(`b.status=$${params.length}`); }
    if (query.purpose) { params.push(query.purpose); conditions.push(`b.purpose=$${params.length}`); }
    if (query.keyword) { params.push(`%${query.keyword.trim().toLowerCase()}%`); conditions.push(`(lower(b.id) like $${params.length} or lower(coalesce(b.label,'')) like $${params.length} or lower(b.purpose) like $${params.length})`); }
    if (query.stockAlert) {
      const alertIndex = params.length + 1;
      const availableExpr = `(select count(*) from coupons.coupon_items ci where ci.batch_id=b.id and ci.status='available')`;
      const alertExpr = `case when b.status='voided' or ${availableExpr}=0 then 'exhausted' when ${availableExpr}<=5 then 'low_stock' else 'normal' end`;
      params.push(query.stockAlert);
      conditions.push(`${alertExpr}=$${alertIndex}`);
    }
    const where = conditions.join(' AND ');
    const count = await this.pool.query(`select count(*)::int as count from coupons.coupon_batches b where ${where}`, params);
    const total = Number(count.rows[0]?.count ?? 0);
    const limitIndex = params.length + 1;
    const offsetIndex = params.length + 2;
    const rows = await this.pool.query(`select b.*, count(i.id)::int as computed_total_count, count(i.id) filter (where i.status='available')::int as computed_available_count, count(i.id) filter (where i.status='reserved')::int as computed_reserved_count, count(i.id) filter (where i.status='consumed')::int as computed_consumed_count from coupons.coupon_batches b left join coupons.coupon_items i on i.batch_id=b.id where ${where} group by b.id order by b.updated_at desc limit $${limitIndex} offset $${offsetIndex}`, [...params, pageSize, (page - 1) * pageSize]);
    return { items: rows.rows.map((row) => this.toCouponBatch(row)), page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
  }
  async getCouponBatch(adminId: string, batchId: string): Promise<CouponBatchRecord | undefined> {
    const result = await this.pool.query("select b.* from coupons.coupon_batches b where b.id=$1 and exists (select 1 from auth.account_scopes scope where scope.account_id=b.account_id and scope.admin_id=$2 and scope.status='active' and (scope.expires_at is null or scope.expires_at>now()))", [batchId, adminId]);
    if (!result.rows[0]) return undefined;
    const [items, bindings] = await Promise.all([
      this.pool.query('select * from coupons.coupon_items where batch_id=$1 order by created_at,id', [batchId]),
      this.pool.query('select * from coupons.coupon_bindings where coupon_batch_id=$1 order by priority desc, created_at,id', [batchId]),
    ]);
    const batch = this.toCouponBatch(result.rows[0]);
    batch.items = items.rows.map((row) => this.toCouponItem(row));
    batch.bindings = bindings.rows.map((row) => this.toCouponBinding(row));
    return batch;
  }
  async createCouponBatch(input: { adminId: string; accountId: string; label?: string; purpose: string; deliveryScope: CouponDeliveryScope; quarkUrl?: string; extractionCode?: string; metadata?: CouponBatchMetadata }): Promise<CouponBatchRecord> {
    if (!(await this.hasAccountScope(input.adminId, input.accountId))) throw new Error('ACCOUNT_SCOPE_FORBIDDEN');
    const result = await this.pool.query('insert into coupons.coupon_batches (id,account_id,label,purpose,delivery_scope,quark_url,extract_code_ciphertext,total_count,status,version,metadata_json) values ($1,$2,$3,$4,$5,$6,$7,$8,\'active\',1,$9::jsonb) returning *', [createId(), input.accountId, input.label ?? null, input.purpose, input.deliveryScope, input.quarkUrl ?? null, input.extractionCode ? encryptCouponValue(input.extractionCode) : null, 0, JSON.stringify(input.metadata ?? {})]);
    return this.toCouponBatch(result.rows[0]);
  }
  async updateCouponBatch(input: { adminId: string; batchId: string; patch: { label?: string; purpose?: string; deliveryScope?: CouponDeliveryScope; quarkUrl?: string; extractionCode?: string; status?: CouponBatchStatus; metadata?: CouponBatchMetadata } }): Promise<CouponBatchRecord | undefined> {
    const current = await this.getCouponBatch(input.adminId, input.batchId);
    if (!current) return undefined;
    const nextMetadata = input.patch.metadata ?? current.metadata ?? {};
    const extractionCode = input.patch.extractionCode === undefined ? current.extractionCode : input.patch.extractionCode;
    const result = await this.pool.query('update coupons.coupon_batches set label=$2,purpose=$3,delivery_scope=$4,quark_url=$5,extract_code_ciphertext=$6,status=$7,metadata_json=$8::jsonb,version=version+1,updated_at=now() where id=$1 returning *', [input.batchId, input.patch.label ?? current.label ?? null, input.patch.purpose ?? current.purpose, input.patch.deliveryScope ?? current.deliveryScope, input.patch.quarkUrl ?? current.quarkUrl ?? null, extractionCode ? encryptCouponValue(extractionCode) : null, input.patch.status ?? current.status, JSON.stringify(nextMetadata)]);
    return result.rows[0] ? this.toCouponBatch(result.rows[0]) : current;
  }
  async importCouponItems(input: { adminId: string; batchId: string; contents: string[] }): Promise<{ batch: CouponBatchRecord; items: CouponItemRecord[]; rejected: Array<{ index: number; code: string; message: string }> }> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const batchResult = await client.query("select b.* from coupons.coupon_batches b where b.id=$1 and exists (select 1 from auth.account_scopes scope where scope.account_id=b.account_id and scope.admin_id=$2 and scope.status='active' and (scope.expires_at is null or scope.expires_at>now())) for update", [input.batchId, input.adminId]);
      if (!batchResult.rows[0]) throw new Error('COUPON_NOT_FOUND');
      const batch = this.toCouponBatch(batchResult.rows[0]);
      if (batch.status === 'voided' || batch.status === 'closed') throw new Error('COUPON_BATCH_VOIDED');
      const existingRows = await client.query('select * from coupons.coupon_items where batch_id=$1', [batch.id]);
      const existingContent = new Set(existingRows.rows.map((row) => decryptCouponValue(row.content_ciphertext)));
      const created: CouponItemRecord[] = [];
      const rejected: Array<{ index: number; code: string; message: string }> = [];
      for (const [index, raw] of input.contents.entries()) {
        const content = raw.trim();
        if (!content) { rejected.push({ index, code: 'VALIDATION_FAILED', message: 'coupon content is required' }); continue; }
        if (existingContent.has(content)) { rejected.push({ index, code: 'CONFLICT', message: 'duplicate coupon content' }); continue; }
        const row = await client.query('insert into coupons.coupon_items (id,batch_id,content_ciphertext,status) values ($1,$2,$3,\'available\') returning *', [createId(), batch.id, encryptCouponValue(content)]);
        existingContent.add(content);
        created.push(this.toCouponItem(row.rows[0]));
      }
      const countResult = await client.query('select count(*)::int as count from coupons.coupon_items where batch_id=$1', [batch.id]);
      const count = Number(countResult.rows[0]?.count ?? 0);
      const updated = await client.query("update coupons.coupon_batches set total_count=$2,status=case when status='exhausted' and $2>0 then 'active' else status end,version=version+1,updated_at=now() where id=$1 returning *", [batch.id, count]);
      await client.query('commit');
      return { batch: this.toCouponBatch(updated.rows[0]), items: created, rejected };
    } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
  }
  async bindCouponBatch(input: { adminId: string; batchId: string; productId: string }): Promise<CouponBindingRecord> {
    const batch = await this.getCouponBatch(input.adminId, input.batchId);
    if (!batch) throw new Error('COUPON_NOT_FOUND');
    if (batch.status === 'voided' || batch.status === 'closed') throw new Error('COUPON_BATCH_VOIDED');
    const product = await this.getProduct(input.adminId, input.productId);
    if (!product) throw new Error('PRODUCT_NOT_FOUND');
    if (product.accountId !== batch.accountId) throw new Error('ACCOUNT_SCOPE_FORBIDDEN');
    const result = await this.pool.query("insert into coupons.coupon_bindings (id,coupon_batch_id,product_id,priority,status) values ($1,$2,$3,0,'active') on conflict (coupon_batch_id,product_id) do update set status='active',updated_at=now() returning *", [createId(), batch.id, product.id]);
    await this.pool.query('update coupons.coupon_batches set version=version+1,updated_at=now() where id=$1', [batch.id]);
    return this.toCouponBinding(result.rows[0]);
  }
  async unbindCouponBatch(input: { adminId: string; batchId: string; productId: string }): Promise<CouponBindingRecord | undefined> {
    const batch = await this.getCouponBatch(input.adminId, input.batchId);
    if (!batch) throw new Error('COUPON_NOT_FOUND');
    const result = await this.pool.query("update coupons.coupon_bindings set status='inactive',updated_at=now() where coupon_batch_id=$1 and product_id=$2 returning *", [batch.id, input.productId]);
    if (!result.rows[0]) return undefined;
    await this.pool.query('update coupons.coupon_batches set version=version+1,updated_at=now() where id=$1', [batch.id]);
    return this.toCouponBinding(result.rows[0]);
  }
  async voidCouponBatch(input: { adminId: string; batchId: string }): Promise<CouponBatchRecord | undefined> {
    const batch = await this.getCouponBatch(input.adminId, input.batchId);
    if (!batch) return undefined;
    const result = await this.pool.query("update coupons.coupon_batches set status='voided',version=version+1,updated_at=now() where id=$1 returning *", [batch.id]);
    return result.rows[0] ? this.toCouponBatch(result.rows[0]) : batch;
  }
  async getCouponContent(adminId: string, itemId: string): Promise<{ batch: CouponBatchRecord; item: CouponItemRecord } | undefined> {
    const result = await this.pool.query("select i.id as item_id, i.batch_id as item_batch_id, i.content_ciphertext, i.status as item_status, i.reserved_until, i.consumed_at, i.created_at as item_created_at, b.id as batch_id, b.account_id, b.label, b.purpose, b.delivery_scope, b.quark_url, b.extract_code_ciphertext, b.total_count, b.status as batch_status, b.version, b.created_at as batch_created_at, b.updated_at as batch_updated_at from coupons.coupon_items i join coupons.coupon_batches b on b.id=i.batch_id where i.id=$1 and exists (select 1 from auth.account_scopes scope where scope.account_id=b.account_id and scope.admin_id=$2 and scope.status='active' and (scope.expires_at is null or scope.expires_at>now()))", [itemId, adminId]);
    if (!result.rows[0]) return undefined;
    const row = result.rows[0];
    const item = this.toCouponItem({ id: row.item_id, batch_id: row.item_batch_id, content_ciphertext: row.content_ciphertext, status: row.item_status, reserved_until: row.reserved_until, consumed_at: row.consumed_at, created_at: row.item_created_at });
    const batch = this.toCouponBatch({ id: row.batch_id, account_id: row.account_id, label: row.label, purpose: row.purpose, delivery_scope: row.delivery_scope, quark_url: row.quark_url, extract_code_ciphertext: row.extract_code_ciphertext, total_count: row.total_count, status: row.batch_status, version: row.version, created_at: row.batch_created_at, updated_at: row.batch_updated_at });
    return { batch, item };
  }

  async listConversations(adminId: string, query: ConversationListQuery): Promise<ConversationListResult> {
    const params: unknown[] = [adminId];
    const conditions = ["exists (select 1 from auth.account_scopes scope where scope.account_id=c.account_id and scope.admin_id=$1 and scope.status='active' and (scope.expires_at is null or scope.expires_at>now()))"];
    if (query.accountId) { params.push(query.accountId); conditions.push(`c.account_id=$${params.length}`); }
    const cursor = query.cursor ? decodeConversationCursor(query.cursor) : undefined;
    if (cursor) {
      const updatedAtIndex = params.length + 1;
      params.push(cursor.updatedAt);
      const idIndex = params.length + 1;
      params.push(cursor.id);
      conditions.push(`(date_trunc('milliseconds', coalesce(c.last_message_at, c.updated_at)) < $${updatedAtIndex} or (date_trunc('milliseconds', coalesce(c.last_message_at, c.updated_at)) = $${updatedAtIndex} and c.id < $${idIndex}))`);
    }
    const limit = Math.min(100, Math.max(1, query.limit ?? 50));
    const limitIndex = params.length + 1;
    const result = await this.pool.query(`select c.* from messages.conversations c where ${conditions.join(' and ')} order by date_trunc('milliseconds', coalesce(c.last_message_at, c.updated_at)) desc, c.id desc limit $${limitIndex}`, [...params, limit + 1]);
    const hasMore = result.rows.length > limit;
    const items = result.rows.slice(0, limit).map((row) => this.toConversation(row));
    const last = items[items.length - 1];
    return { items, nextCursor: hasMore && last ? encodeConversationCursor({ updatedAt: last.lastMessageAt ?? last.updatedAt, id: last.id }) : undefined, hasMore };
  }

  async getConversation(adminId: string, conversationId: string): Promise<ConversationRecord | undefined> {
    const result = await this.pool.query("select c.* from messages.conversations c where c.id=$1 and exists (select 1 from auth.account_scopes scope where scope.account_id=c.account_id and scope.admin_id=$2 and scope.status='active' and (scope.expires_at is null or scope.expires_at>now()))", [conversationId, adminId]);
    return result.rows[0] ? this.toConversation(result.rows[0]) : undefined;
  }

  async markConversationRead(adminId: string, conversationId: string): Promise<ConversationRecord | undefined> {
    const result = await this.pool.query("update messages.conversations c set unread_count=0, version=c.version+1 where c.id=$1 and exists (select 1 from auth.account_scopes scope where scope.account_id=c.account_id and scope.admin_id=$2 and scope.status='active' and (scope.expires_at is null or scope.expires_at>now())) returning c.*", [conversationId, adminId]);
    return result.rows[0] ? this.toConversation(result.rows[0]) : undefined;
  }

  async findConversationByExternalRef(adminId: string, accountId: string, externalConversationRef: string): Promise<ConversationRecord | undefined> {
    const result = await this.pool.query("select c.* from messages.conversations c where c.account_id=$1 and c.external_conversation_ref=$2 and exists (select 1 from auth.account_scopes scope where scope.account_id=c.account_id and scope.admin_id=$3 and scope.status='active' and (scope.expires_at is null or scope.expires_at>now()))", [accountId, externalConversationRef, adminId]);
    return result.rows[0] ? this.toConversation(result.rows[0]) : undefined;
  }

  async upsertExternalConversation(input: { adminId: string; accountId: string; externalConversationRef: string; buyerRef: string; buyerDisplayName?: string; buyerAvatarUrl?: string; itemRef?: string; itemTitle?: string; itemImageUrl?: string; unreadCount?: number; lastMessagePreview?: string; lastMessageAt?: string }): Promise<ConversationRecord> {
    if (!(await this.hasAccountScope(input.adminId, input.accountId))) throw new Error('ACCOUNT_SCOPE_FORBIDDEN');
    const result = await this.pool.query("insert into messages.conversations (id,account_id,external_conversation_ref,buyer_ref,buyer_display_name,buyer_avatar_url,item_ref,item_title,item_image_url,unread_count,last_message_preview,last_message_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) on conflict (account_id,external_conversation_ref) where external_conversation_ref is not null do update set buyer_ref=excluded.buyer_ref,buyer_display_name=coalesce(excluded.buyer_display_name,messages.conversations.buyer_display_name),buyer_avatar_url=coalesce(excluded.buyer_avatar_url,messages.conversations.buyer_avatar_url),item_ref=coalesce(excluded.item_ref,messages.conversations.item_ref),item_title=coalesce(excluded.item_title,messages.conversations.item_title),item_image_url=coalesce(excluded.item_image_url,messages.conversations.item_image_url),unread_count=coalesce(excluded.unread_count,messages.conversations.unread_count),last_message_preview=case when excluded.last_message_at is not null and (messages.conversations.last_message_at is null or excluded.last_message_at>=messages.conversations.last_message_at) then coalesce(excluded.last_message_preview,messages.conversations.last_message_preview) else messages.conversations.last_message_preview end,last_message_at=case when excluded.last_message_at is not null and (messages.conversations.last_message_at is null or excluded.last_message_at>=messages.conversations.last_message_at) then excluded.last_message_at else messages.conversations.last_message_at end,version=messages.conversations.version+1,updated_at=greatest(messages.conversations.updated_at, coalesce(excluded.last_message_at, messages.conversations.updated_at)) returning *", [createId(), input.accountId, input.externalConversationRef, input.buyerRef, input.buyerDisplayName ?? null, input.buyerAvatarUrl ?? null, input.itemRef ?? null, input.itemTitle ?? null, input.itemImageUrl ?? null, input.unreadCount ?? 0, input.lastMessagePreview ?? null, input.lastMessageAt ?? null]);
    return this.toConversation(result.rows[0]);
  }

  async listMessages(adminId: string, conversationId: string, query: MessageListQuery): Promise<MessageListResult> {
    const conversation = await this.getConversation(adminId, conversationId);
    if (!conversation) return { items: [], hasMore: false, latestCursor: 0, hasMoreHistory: false };
    const limit = Math.min(200, Math.max(1, query.limit ?? 100));
    const latest = await this.pool.query('select coalesce(max(cursor),0)::bigint as cursor from messages.events where conversation_id=$1', [conversationId]);
    const latestCursor = Number(latest.rows[0]?.cursor ?? 0);
    const history = decodeMessageHistoryCursor(query.beforeCursor);
    const params: unknown[] = [conversationId];
    let cursorClause = '';
    let orderClause = 'm.created_at desc, m.id desc';
    let fetchLimit = limit + 1;
    if (query.cursor !== undefined) {
      params.push(query.cursor);
      cursorClause = ` and exists (select 1 from messages.events e where e.conversation_id=m.conversation_id and (e.payload_json->'message'->>'id')=m.id::text and e.cursor>$${params.length})`;
      orderClause = 'm.created_at asc, m.id asc';
      fetchLimit = limit;
    } else if (history?.beforeCreatedAt) {
      params.push(history.beforeCreatedAt);
      const timestampParam = `$${params.length}`;
      if (history.beforeMessageId) {
        params.push(history.beforeMessageId);
        cursorClause = ` and (m.created_at<${timestampParam}::timestamptz or (m.created_at=${timestampParam}::timestamptz and m.id<$${params.length}::uuid))`;
      } else {
        cursorClause = ` and m.created_at<${timestampParam}::timestamptz`;
      }
    }
    params.push(fetchLimit);
    const latestEventCursor = "(select max(e2.cursor) from messages.events e2 where e2.conversation_id=m.conversation_id and (e2.payload_json->'message'->>'id')=m.id::text)";
    const rows = await this.pool.query(`select m.*, ${latestEventCursor} as event_cursor from messages.messages m where m.conversation_id=$1${cursorClause} order by ${orderClause} limit $${params.length}`, params);
    const hasMoreHistory = query.cursor === undefined && rows.rows.length > limit;
    const pageRows = hasMoreHistory ? rows.rows.slice(0, limit) : rows.rows;
    if (query.cursor === undefined) pageRows.reverse();
    const items = pageRows.map((row) => this.toMessage(row));
    const nextCursor = items.length === limit ? Number(pageRows[pageRows.length - 1]?.event_cursor ?? 0) : undefined;
    return { items, nextCursor, hasMore: nextCursor !== undefined, latestCursor, hasMoreHistory };
  }

  async listConversationEvents(adminId: string, conversationId: string, afterCursor: number, limit: number): Promise<ConversationEventRecord[]> {
    const conversation = await this.getConversation(adminId, conversationId);
    if (!conversation) return [];
    const result = await this.pool.query('select * from messages.events where conversation_id=$1 and cursor>$2 order by cursor asc limit $3', [conversationId, afterCursor, Math.min(limit, 200)]);
    return result.rows.map((row) => this.toConversationEvent(row));
  }

  async findMessageByExternalRef(adminId: string, conversationId: string, externalMessageRef: string): Promise<MessageRecord | undefined> {
    const conversation = await this.getConversation(adminId, conversationId);
    if (!conversation) return undefined;
    const result = await this.pool.query('select * from messages.messages where conversation_id=$1 and external_message_ref=$2 limit 1', [conversationId, externalMessageRef]);
    return result.rows[0] ? this.toMessage(result.rows[0]) : undefined;
  }

  async createConversation(input: { adminId: string; accountId: string; buyerRef: string; buyerDisplayName?: string; buyerAvatarUrl?: string; itemRef?: string; itemTitle?: string; itemImageUrl?: string; externalConversationRef?: string }): Promise<ConversationRecord> {
    if (!(await this.hasAccountScope(input.adminId, input.accountId))) throw new Error('ACCOUNT_SCOPE_FORBIDDEN');
    const result = await this.pool.query('insert into messages.conversations (id,account_id,external_conversation_ref,buyer_ref,buyer_display_name,buyer_avatar_url,item_ref,item_title,item_image_url) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *', [createId(), input.accountId, input.externalConversationRef ?? null, input.buyerRef, input.buyerDisplayName ?? null, input.buyerAvatarUrl ?? null, input.itemRef ?? null, input.itemTitle ?? null, input.itemImageUrl ?? null]);
    return this.toConversation(result.rows[0]);
  }

  async createMessage(input: { adminId: string; conversationId: string; direction: MessageRecord['direction']; senderRole: MessageRecord['senderRole']; bodyType: MessageRecord['bodyType']; bodyText?: string; bodyRef?: string; externalMessageRef?: string; source?: MessageRecord['source']; orderRef?: string; productRef?: string; riskFlags?: string[]; createdAt?: string; traceId?: string }): Promise<{ message: MessageRecord; event: ConversationEventRecord }> {
    const conversation = await this.getConversation(input.adminId, input.conversationId);
    if (!conversation) throw new Error('CONVERSATION_NOT_FOUND');
    if (input.externalMessageRef) {
      const existing = await this.pool.query('select * from messages.messages where conversation_id=$1 and external_message_ref=$2 limit 1', [input.conversationId, input.externalMessageRef]);
      if (existing.rows[0]) {
        const message = this.toMessage(existing.rows[0]);
        const eventResult = await this.pool.query("select * from messages.events where conversation_id=$1 and payload_json->'message'->>'id'=$2 order by cursor desc limit 1", [input.conversationId, message.id]);
        if (eventResult.rows[0]) return { message, event: this.toConversationEvent(eventResult.rows[0]) };
      }
    }
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const id = createId();
      const createdAt = input.createdAt ?? new Date().toISOString();
      const messageResult = await client.query('insert into messages.messages (id,conversation_id,account_id,direction,sender_role,body_type,body_text,body_ref,external_message_ref,source,order_ref,product_ref,risk_flags,handling_mode,created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15) returning *', [id, conversation.id, conversation.accountId, input.direction, input.senderRole, input.bodyType, input.bodyText ?? null, input.bodyRef ?? null, input.externalMessageRef ?? null, input.source ?? null, input.orderRef ?? null, input.productRef ?? null, JSON.stringify(input.riskFlags ?? []), conversation.handlingMode, createdAt]);
      const updated = await client.query("update messages.conversations set unread_count=unread_count + case when $2='inbound' then 1 else 0 end, last_message_preview=case when last_message_at is null or $4::timestamptz>=last_message_at then $3 else last_message_preview end, last_message_at=greatest(coalesce(last_message_at,$4::timestamptz),$4::timestamptz), version=version+1, updated_at=greatest(updated_at, $4::timestamptz) where id=$1 returning *", [conversation.id, input.direction, input.bodyText?.slice(0, 180) ?? null, createdAt]);
      // Serialize cursor allocation per conversation. PostgreSQL does not allow
      // FOR UPDATE on an aggregate result, so use a transaction-scoped advisory
      // lock before reading max(cursor) and inserting the next event.
      await client.query('select pg_advisory_xact_lock(hashtext($1))', [conversation.id]);
      const cursorResult = await client.query('select coalesce(max(cursor),0)::bigint + 1 as cursor from messages.events where conversation_id=$1', [conversation.id]);
      const cursor = Number(cursorResult.rows[0]?.cursor ?? 1);
      const message = this.toMessage(messageResult.rows[0]);
      const updatedConversation = this.toConversation(updated.rows[0]);
      const event: ConversationEventRecord = { eventId: createId(), conversationId: conversation.id, accountId: conversation.accountId, cursor, type: 'chat.message.created', occurredAt: createdAt, traceId: input.traceId ?? `postgres:${message.id}`, payload: { message, conversation: updatedConversation } };
      const eventResult = await client.query('insert into messages.events (event_id,conversation_id,account_id,cursor,type,occurred_at,trace_id,payload_json) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb) returning *', [event.eventId, event.conversationId, event.accountId, event.cursor, event.type, event.occurredAt, event.traceId, JSON.stringify(event.payload)]);
      await client.query('commit');
      return { message, event: this.toConversationEvent(eventResult.rows[0]) };
    } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
  }

  async markMessagesReadByExternalRef(input: { adminId: string; conversationId: string; externalMessageRef: string; readAt?: string }): Promise<{ messages: MessageRecord[]; events: ConversationEventRecord[] }> {
    return this.markOutgoingRead(input, input.externalMessageRef);
  }

  async markLatestOutgoingRead(input: { adminId: string; conversationId: string; readAt?: string }): Promise<{ messages: MessageRecord[]; events: ConversationEventRecord[] }> {
    return this.markOutgoingRead(input);
  }

  private async markOutgoingRead(input: { adminId: string; conversationId: string; externalMessageRef?: string; readAt?: string }, externalMessageRef?: string): Promise<{ messages: MessageRecord[]; events: ConversationEventRecord[] }> {
    const conversation = await this.getConversation(input.adminId, input.conversationId);
    if (!conversation) return { messages: [], events: [] };
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query('select pg_advisory_xact_lock(hashtext($1))', [conversation.id]);
      const readAt = input.readAt ?? new Date().toISOString();
      let targetResult;
      if (externalMessageRef) {
        targetResult = await client.query('select created_at from messages.messages where conversation_id=$1 and external_message_ref=$2 and direction=\'outbound\' limit 1', [conversation.id, externalMessageRef]);
      } else {
        targetResult = await client.query('select created_at from messages.messages where conversation_id=$1 and direction=\'outbound\' and read_status<>2 order by created_at desc, id desc limit 1', [conversation.id]);
      }
      const targetCreatedAt = targetResult.rows[0]?.created_at;
      if (!targetCreatedAt) { await client.query('commit'); return { messages: [], events: [] }; }
      const rows = await client.query('select * from messages.messages where conversation_id=$1 and direction=\'outbound\' and read_status<>2 and created_at<=$2 order by created_at asc, id asc', [conversation.id, targetCreatedAt]);
      const events: ConversationEventRecord[] = [];
      const messages: MessageRecord[] = [];
      let cursor = Number((await client.query('select coalesce(max(cursor),0)::bigint as cursor from messages.events where conversation_id=$1', [conversation.id])).rows[0]?.cursor ?? 0);
      for (const row of rows.rows) {
        const updated = await client.query('update messages.messages set read_status=2, read_at=coalesce(read_at,$2::timestamptz) where id=$1 returning *', [row.id, readAt]);
        const message = this.toMessage(updated.rows[0]);
        const conversationResult = await client.query('update messages.conversations set version=version+1 where id=$1 returning *', [conversation.id]);
        const updatedConversation = this.toConversation(conversationResult.rows[0]);
        cursor += 1;
        const event: ConversationEventRecord = { eventId: createId(), conversationId: conversation.id, accountId: conversation.accountId, cursor, type: 'chat.message.updated', occurredAt: readAt, traceId: `read:${message.id}`, payload: { message, conversation: updatedConversation } };
        const eventResult = await client.query('insert into messages.events (event_id,conversation_id,account_id,cursor,type,occurred_at,trace_id,payload_json) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb) returning *', [event.eventId, event.conversationId, event.accountId, event.cursor, event.type, event.occurredAt, event.traceId, JSON.stringify(event.payload)]);
        messages.push(message);
        events.push(this.toConversationEvent(eventResult.rows[0]));
      }
      await client.query('commit');
      return { messages, events };
    } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
  }
  async createLoginSession(input: { adminId: string; accountId?: string; provisionalAccountRef?: string; loginMethod: string; expiresAt: string; qrTokenRef?: string }): Promise<LoginSessionRecord> { if (input.accountId && !(await this.hasAccountScope(input.adminId, input.accountId))) throw new Error('ACCOUNT_SCOPE_FORBIDDEN'); const result = await this.pool.query('insert into auth.account_login_sessions (id,admin_id,account_id,provisional_account_ref,login_method,status,started_at,expires_at,qr_token_ref) values ($1,$2,$3,$4,$5,\'waiting\',now(),$6,$7) returning *', [createId(), input.adminId, input.accountId ?? null, input.provisionalAccountRef ?? null, input.loginMethod, input.expiresAt, input.qrTokenRef ?? null]); return this.toLoginSession(result.rows[0]); }
  async getLoginSession(adminId: string, accountId: string, sessionId: string): Promise<LoginSessionRecord | undefined> { const result = await this.pool.query('select s.* from auth.account_login_sessions s join auth.account_scopes scope on scope.account_id=s.account_id where s.id=$1 and s.account_id=$2 and scope.admin_id=$3 and scope.status=\'active\' and (scope.expires_at is null or scope.expires_at>now())', [sessionId, accountId, adminId]); return this.normalizeLoginSession(result.rows[0]); }
  async getLoginSessionById(adminId: string, sessionId: string): Promise<LoginSessionRecord | undefined> { const result = await this.pool.query('select s.* from auth.account_login_sessions s left join auth.account_scopes scope on scope.account_id=s.account_id and scope.admin_id=$2 and scope.status=\'active\' and (scope.expires_at is null or scope.expires_at>now()) where s.id=$1 and (s.admin_id=$2 or scope.admin_id is not null)', [sessionId, adminId]); return this.normalizeLoginSession(result.rows[0]); }
  async updateLoginSession(adminId: string, accountId: string | undefined, sessionId: string, patch: { accountId?: string; status?: LoginSessionRecord['status']; expiresAt?: string; completedAt?: string; failureCode?: string }): Promise<LoginSessionRecord | undefined> { const current = accountId ? await this.getLoginSession(adminId, accountId, sessionId) : await this.getLoginSessionById(adminId, sessionId); if (!current) return undefined; const result = await this.pool.query('update auth.account_login_sessions set account_id=coalesce($2,account_id), status=coalesce($3,status), expires_at=coalesce($4,expires_at), completed_at=coalesce($5,completed_at), failure_code=coalesce($6,failure_code) where id=$1 and (admin_id=$7 or account_id=$8) returning *', [sessionId, patch.accountId ?? null, patch.status ?? null, patch.expiresAt ?? null, patch.completedAt ?? null, patch.failureCode ?? null, adminId, accountId ?? null]); return result.rows[0] ? this.toLoginSession(result.rows[0]) : current; }
  async getCredential(adminId: string, accountId: string): Promise<CredentialRecord | undefined> {
    const result = await this.pool.query('select c.* from auth.account_credentials c join auth.account_scopes scope on scope.account_id=c.account_id where c.account_id=$1 and scope.admin_id=$2 and scope.status=\'active\' and (scope.expires_at is null or scope.expires_at>now()) limit 1', [accountId, adminId]);
    if (!result.rows[0]) return undefined;
    const row = result.rows[0];
    if (row.status === 'active' && row.expires_at && new Date(String(row.expires_at)).getTime() <= Date.now()) {
      await this.pool.query('update auth.account_credentials set status=\'expired\', updated_at=now() where id=$1 and status=\'active\'', [row.id]);
      await this.pool.query('update accounts.accounts set status=\'expired\', updated_at=now() where id=$1 and status=\'connected\'', [accountId]);
      row.status = 'expired';
    }
    return this.toCredential(row);
  }
  async upsertCredential(input: { adminId: string; accountId: string; platform: string; cookieHeader?: string; accessToken?: string; deviceId?: string; metadata?: Record<string, string>; expiresAt?: string }): Promise<CredentialRecord> {
    if (!(await this.hasAccountScope(input.adminId, input.accountId))) throw new Error('ACCOUNT_SCOPE_FORBIDDEN');
    const result = await this.pool.query('insert into auth.account_credentials (id,account_id,platform,status,cookie_header,access_token,device_id,metadata_json,expires_at) values ($1,$2,$3,\'active\',$4,$5,$6,$7::jsonb,$8) on conflict (account_id) do update set platform=excluded.platform,status=\'active\',cookie_header=excluded.cookie_header,access_token=excluded.access_token,device_id=excluded.device_id,metadata_json=excluded.metadata_json,expires_at=excluded.expires_at,updated_at=now() returning *', [createId(), input.accountId, input.platform, input.cookieHeader ?? null, input.accessToken ?? null, input.deviceId ?? null, JSON.stringify(input.metadata ?? {}), input.expiresAt ?? null]);
    return this.toCredential(result.rows[0]);
  }
  async revokeCredential(adminId: string, accountId: string): Promise<CredentialRecord | undefined> {
    const current = await this.getCredential(adminId, accountId);
    if (!current) return undefined;
    const result = await this.pool.query('update auth.account_credentials set status=\'revoked\',updated_at=now() where id=$1 returning *', [current.id]);
    return result.rows[0] ? this.toCredential(result.rows[0]) : current;
  }
  async markCredentialVerified(input: { adminId: string; accountId: string; status: CredentialRecord['status']; expiresAt?: string }): Promise<CredentialRecord | undefined> {
    const current = await this.getCredential(input.adminId, input.accountId);
    if (!current) return undefined;
    const result = await this.pool.query('update auth.account_credentials set status=$2,last_verified_at=now(),expires_at=coalesce($3,expires_at),updated_at=now() where id=$1 returning *', [current.id, input.status, input.expiresAt ?? null]);
    return result.rows[0] ? this.toCredential(result.rows[0]) : current;
  }
  async getIdempotency(scope: string, key: string): Promise<IdempotencyRecord | undefined> { const result = await this.pool.query('select * from execution.idempotency_records where scope=$1 and key=$2 and expires_at>now()', [scope, key]); return result.rows[0] ? this.toIdempotency(result.rows[0]) : undefined; }
  async beginIdempotency(record: IdempotencyRecord): Promise<void> { await this.pool.query('insert into execution.idempotency_records (id,scope,key,request_fingerprint,status,expires_at) values ($1,$2,$3,$4,$5,$6)', [createId(), record.scope, record.key, record.requestFingerprint, record.status, record.expiresAt]); }
  async abortIdempotency(scope: string, key: string): Promise<void> { await this.pool.query('delete from execution.idempotency_records where scope=$1 and key=$2 and status=\'processing\'', [scope, key]); }
  async completeIdempotency(input: { scope: string; key: string; status: IdempotencyRecord['status']; responseEnvelope: unknown; statusCode: number; traceId: string }): Promise<void> { await this.pool.query('update execution.idempotency_records set status=$3,response_envelope=$4,status_code=$5,trace_id=$6 where scope=$1 and key=$2', [input.scope, input.key, input.status, JSON.stringify(input.responseEnvelope), input.statusCode, input.traceId]); }
  async recordAudit(event: AuditEventRecord): Promise<void> { await this.pool.query('insert into observability.audit_events (id,actor_type,actor_id,action,target_ref,request_id,trace_id,payload_digest,account_id,reason) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [event.id, event.actorType, event.actorId ?? null, event.action, event.targetRef ?? null, event.requestId, event.traceId, event.payloadDigest, event.accountId ?? null, event.reason ?? null]); }

  async listAgentSessions(adminId: string, query: { accountId?: string; search?: string } = {}): Promise<AgentSessionRecord[]> {
    const params: unknown[] = [adminId];
    const where = ['exists (select 1 from auth.account_scopes scope where scope.account_id=s.account_id and scope.admin_id=$1 and scope.status=\'active\' and (scope.expires_at is null or scope.expires_at>now()))'];
    if (query.accountId) { params.push(query.accountId); where.push(`s.account_id=$${params.length}`); }
    if (query.search?.trim()) { params.push(`%${query.search.trim()}%`); where.push(`(s.title ilike $${params.length} or coalesce(s.summary, '') ilike $${params.length})`); }
    const result = await this.pool.query(`select s.* from workspace.agent_sessions s where ${where.join(' and ')} order by s.last_active_at desc`, params);
    return result.rows.map((row) => this.toAgentSession(row));
  }

  async createAgentSession(input: { adminId: string; accountId: string; title: string; summary?: string }): Promise<AgentSessionRecord> {
    if (!(await this.hasAccountScope(input.adminId, input.accountId))) throw new Error('ACCOUNT_SCOPE_FORBIDDEN');
    const result = await this.pool.query('insert into workspace.agent_sessions (id,account_id,title,summary) values ($1,$2,$3,$4) returning *', [createId(), input.accountId, input.title, input.summary ?? null]);
    return this.toAgentSession(result.rows[0]);
  }

  async getAgentSession(adminId: string, sessionId: string): Promise<AgentSessionRecord | undefined> {
    const result = await this.pool.query('select s.* from workspace.agent_sessions s where s.id=$1 and exists (select 1 from auth.account_scopes scope where scope.account_id=s.account_id and scope.admin_id=$2 and scope.status=\'active\' and (scope.expires_at is null or scope.expires_at>now()))', [sessionId, adminId]);
    return result.rows[0] ? this.toAgentSession(result.rows[0]) : undefined;
  }

  async archiveAgentSession(adminId: string, sessionId: string): Promise<AgentSessionRecord | undefined> {
    const result = await this.pool.query("update workspace.agent_sessions s set status='archived',archived_at=now(),updated_at=now() where s.id=$1 and s.status='active' and exists (select 1 from auth.account_scopes scope where scope.account_id=s.account_id and scope.admin_id=$2 and scope.status='active' and (scope.expires_at is null or scope.expires_at>now())) returning s.*", [sessionId, adminId]);
    return result.rows[0] ? this.toAgentSession(result.rows[0]) : this.getAgentSession(adminId, sessionId).then((session) => session);
  }

  async createRun(input: { adminId: string; accountId: string; sessionId: string; instruction: string; clientRunRef?: string; route?: string }): Promise<{ run: RunRecord; steps: StepRecord[] }> {
    if (!(await this.hasAccountScope(input.adminId, input.accountId))) throw new Error('ACCOUNT_SCOPE_FORBIDDEN');
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const session = await client.query('select * from workspace.agent_sessions where id=$1 and account_id=$2 for update', [input.sessionId, input.accountId]);
      if (!session.rows[0]) throw new Error('SESSION_NOT_FOUND');
      if (session.rows[0].status !== 'active') throw new Error('SESSION_ARCHIVED');
      if (input.clientRunRef) {
        const existing = await client.query('select * from workspace.runs where account_id=$1 and client_run_ref=$2 limit 1', [input.accountId, input.clientRunRef]);
        if (existing.rows[0]) {
          const steps = await client.query('select * from workspace.steps where run_id=$1 order by step_no,attempt', [existing.rows[0].id]);
          await client.query('commit');
          return { run: this.toRun(existing.rows[0]), steps: steps.rows.map((row) => this.toStep(row)) };
        }
      }
      const runId = createId();
      const stepId = createId();
      const now = new Date().toISOString();
      await client.query('insert into workspace.runs (id,account_id,session_id,route,instruction,status,requested_by,client_run_ref) values ($1,$2,$3,$4,$5,\'queued\',$6,$7)', [runId, input.accountId, input.sessionId, input.route ?? 'workspace', input.instruction, input.adminId, input.clientRunRef ?? null]);
      await client.query('insert into workspace.steps (id,run_id,step_no,kind,label,status,attempt,input_summary) values ($1,$2,1,\'plan\',$3,\'pending\',1,$4)', [stepId, runId, '解析指令并准备执行上下文', input.instruction.slice(0, 200)]);
      await client.query('insert into workspace.task_contexts (id,run_id,context_json,redacted_summary) values ($1,$2,$3::jsonb,$4)', [createId(), runId, JSON.stringify({ instruction: input.instruction.slice(0, 200) }), '受控工作区上下文']);
      await client.query('update workspace.agent_sessions set last_active_at=now(),updated_at=now() where id=$1', [input.sessionId]);
      const runResult = await client.query('select * from workspace.runs where id=$1', [runId]);
      const stepResult = await client.query('select * from workspace.steps where id=$1', [stepId]);
      await client.query('commit');
      return { run: this.toRun(runResult.rows[0]), steps: stepResult.rows.map((row) => this.toStep(row)) };
    } catch (error) {
      await client.query('rollback');
      if ((error as { code?: string }).code === '23505' && input.clientRunRef) {
        const existing = await this.findRunByClientRef(input.adminId, input.accountId, input.clientRunRef);
        if (existing) return existing;
      }
      throw error;
    } finally { client.release(); }
  }

  async findRunByClientRef(adminId: string, accountId: string, clientRunRef: string): Promise<{ run: RunRecord; steps: StepRecord[] } | undefined> {
    const result = await this.pool.query('select r.* from workspace.runs r where r.account_id=$1 and r.client_run_ref=$2 and exists (select 1 from auth.account_scopes scope where scope.account_id=r.account_id and scope.admin_id=$3 and scope.status=\'active\' and (scope.expires_at is null or scope.expires_at>now())) limit 1', [accountId, clientRunRef, adminId]);
    if (!result.rows[0]) return undefined;
    const steps = await this.pool.query('select * from workspace.steps where run_id=$1 order by step_no,attempt', [result.rows[0].id]);
    return { run: this.toRun(result.rows[0]), steps: steps.rows.map((row) => this.toStep(row)) };
  }

  async getRun(adminId: string, runId: string): Promise<{ run: RunRecord; steps: StepRecord[] } | undefined> {
    const result = await this.pool.query('select r.* from workspace.runs r where r.id=$1 and exists (select 1 from auth.account_scopes scope where scope.account_id=r.account_id and scope.admin_id=$2 and scope.status=\'active\' and (scope.expires_at is null or scope.expires_at>now()))', [runId, adminId]);
    if (!result.rows[0]) return undefined;
    const steps = await this.pool.query('select * from workspace.steps where run_id=$1 order by step_no,attempt', [runId]);
    return { run: this.toRun(result.rows[0]), steps: steps.rows.map((row) => this.toStep(row)) };
  }

  async updateRun(runId: string, patch: { status?: RunStatus; resultSummary?: string; errorCode?: string; startedAt?: string; finishedAt?: string }): Promise<RunRecord | undefined> {
    const result = await this.pool.query('update workspace.runs set status=coalesce($2,status),result_summary=coalesce($3,result_summary),error_code=coalesce($4,error_code),started_at=coalesce($5,started_at),finished_at=coalesce($6,finished_at),updated_at=now() where id=$1 returning *', [runId, patch.status ?? null, patch.resultSummary ?? null, patch.errorCode ?? null, patch.startedAt ?? null, patch.finishedAt ?? null]);
    return result.rows[0] ? this.toRun(result.rows[0]) : undefined;
  }

  async updateRunStep(stepId: string, patch: { status?: StepStatus; inputSummary?: string; outputSummary?: string; errorCode?: string; startedAt?: string; finishedAt?: string }): Promise<StepRecord | undefined> {
    const result = await this.pool.query('update workspace.steps set status=coalesce($2,status),input_summary=coalesce($3,input_summary),output_summary=coalesce($4,output_summary),error_code=coalesce($5,error_code),started_at=coalesce($6,started_at),finished_at=coalesce($7,finished_at) where id=$1 returning *', [stepId, patch.status ?? null, patch.inputSummary ?? null, patch.outputSummary ?? null, patch.errorCode ?? null, patch.startedAt ?? null, patch.finishedAt ?? null]);
    return result.rows[0] ? this.toStep(result.rows[0]) : undefined;
  }

  async appendRunEvent(input: { runId: string; eventType: string; payload: Record<string, unknown> }): Promise<RunEventRecord> {
    const result = await this.pool.query('insert into workspace.run_events (run_id,event_type,payload_json) values ($1,$2,$3::jsonb) returning *', [input.runId, input.eventType, JSON.stringify(input.payload)]);
    return this.toRunEvent(result.rows[0]);
  }

  async listRunEvents(adminId: string, runId: string, afterSequence = 0): Promise<RunEventRecord[]> {
    const result = await this.pool.query('select e.* from workspace.run_events e join workspace.runs r on r.id=e.run_id where e.run_id=$1 and e.sequence>$2 and exists (select 1 from auth.account_scopes scope where scope.account_id=r.account_id and scope.admin_id=$3 and scope.status=\'active\' and (scope.expires_at is null or scope.expires_at>now())) order by e.sequence asc', [runId, afterSequence, adminId]);
    return result.rows.map((row) => this.toRunEvent(row));
  }

  async appendWorkspaceMessage(input: { adminId: string; sessionId: string; runId?: string; type: WorkspaceMessageType; content: string; summary?: string }): Promise<WorkspaceMessageRecord> {
    const session = await this.getAgentSession(input.adminId, input.sessionId);
    if (!session) throw new Error('SESSION_NOT_FOUND');
    const result = await this.pool.query('insert into workspace.messages (id,session_id,run_id,message_type,content,summary) values ($1,$2,$3,$4,$5,$6) returning *', [createId(), input.sessionId, input.runId ?? null, input.type, input.content, input.summary ?? null]);
    return this.toWorkspaceMessage(result.rows[0]);
  }

  async listWorkspaceMessages(adminId: string, sessionId: string, limit = 100): Promise<WorkspaceMessageRecord[]> {
    const session = await this.getAgentSession(adminId, sessionId);
    if (!session) return [];
    const result = await this.pool.query('select * from workspace.messages where session_id=$1 order by sequence desc limit $2', [sessionId, Math.max(1, Math.min(limit, 500))]);
    return result.rows.reverse().map((row) => this.toWorkspaceMessage(row));
  }
  async close(): Promise<void> { await this.pool.end(); }

  private toCouponBatch(row: Row): CouponBatchRecord {
    const totalCount = Number(row.computed_total_count ?? row.total_count ?? 0);
    const metadata = row.metadata_json && typeof row.metadata_json === 'object' && !Array.isArray(row.metadata_json) ? row.metadata_json as CouponBatchMetadata : {};
    return { id: String(row.id), accountId: String(row.account_id), label: row.label ? String(row.label) : undefined, purpose: String(row.purpose), deliveryScope: row.delivery_scope as CouponBatchRecord['deliveryScope'], quarkUrl: row.quark_url ? String(row.quark_url) : undefined, extractionCode: row.extract_code_ciphertext ? decryptCouponValue(row.extract_code_ciphertext) : undefined, metadata, totalCount, availableCount: row.computed_available_count === undefined ? undefined : Number(row.computed_available_count), reservedCount: row.computed_reserved_count === undefined ? undefined : Number(row.computed_reserved_count), consumedCount: row.computed_consumed_count === undefined ? undefined : Number(row.computed_consumed_count), status: row.status as CouponBatchRecord['status'], version: Number(row.version ?? 1), createdAt: new Date(String(row.created_at)).toISOString(), updatedAt: new Date(String(row.updated_at)).toISOString() };
  }
  private toCouponItem(row: Row): CouponItemRecord { return { id: String(row.id), batchId: String(row.batch_id), content: decryptCouponValue(row.content_ciphertext), status: row.status as CouponItemRecord['status'], reservedUntil: iso(row.reserved_until), consumedAt: iso(row.consumed_at), createdAt: new Date(String(row.created_at)).toISOString() }; }
  private toCouponBinding(row: Row): CouponBindingRecord { return { id: String(row.id), batchId: String(row.coupon_batch_id), productId: String(row.product_id), priority: Number(row.priority ?? 0), status: row.status as CouponBindingRecord['status'], expiresAt: iso(row.expires_at), createdAt: new Date(String(row.created_at)).toISOString(), updatedAt: new Date(String(row.updated_at)).toISOString() }; }

  private toConversation(row: Row): ConversationRecord { return { id: String(row.id), accountId: String(row.account_id), externalConversationRef: row.external_conversation_ref ? String(row.external_conversation_ref) : undefined, buyerRef: String(row.buyer_ref), buyerDisplayName: row.buyer_display_name ? String(row.buyer_display_name) : undefined, buyerAvatarUrl: row.buyer_avatar_url ? String(row.buyer_avatar_url) : undefined, itemRef: row.item_ref ? String(row.item_ref) : undefined, itemTitle: row.item_title ? String(row.item_title) : undefined, itemImageUrl: row.item_image_url ? String(row.item_image_url) : undefined, unreadCount: Number(row.unread_count ?? 0), lastMessagePreview: row.last_message_preview ? String(row.last_message_preview) : undefined, lastMessageAt: iso(row.last_message_at), handlingMode: row.handling_mode as ConversationRecord['handlingMode'], version: Number(row.version ?? 1), createdAt: dateIso(row.created_at), updatedAt: dateIso(row.updated_at) }; }
  private toMessage(row: Row): MessageRecord { const riskFlags = Array.isArray(row.risk_flags) ? row.risk_flags.map(String) : []; return { id: String(row.id), conversationId: String(row.conversation_id), accountId: String(row.account_id), direction: row.direction as MessageRecord['direction'], senderRole: row.sender_role as MessageRecord['senderRole'], bodyType: row.body_type as MessageRecord['bodyType'], bodyText: row.body_text ? String(row.body_text) : undefined, bodyRef: row.body_ref ? String(row.body_ref) : undefined, redactionState: row.redaction_state as MessageRecord['redactionState'], status: row.status as MessageRecord['status'], readStatus: Number(row.read_status ?? 0) === 2 ? 2 : 0, readAt: iso(row.read_at), externalMessageRef: row.external_message_ref ? String(row.external_message_ref) : undefined, source: row.source as MessageRecord['source'], orderRef: row.order_ref ? String(row.order_ref) : undefined, productRef: row.product_ref ? String(row.product_ref) : undefined, riskFlags, handlingMode: row.handling_mode as MessageRecord['handlingMode'], createdAt: new Date(String(row.created_at)).toISOString() }; }
  private toConversationEvent(row: Row): ConversationEventRecord { const payload = row.payload_json && typeof row.payload_json === 'object' && !Array.isArray(row.payload_json) ? row.payload_json as Record<string, unknown> : {}; return { eventId: String(row.event_id), conversationId: String(row.conversation_id), accountId: String(row.account_id), cursor: Number(row.cursor), type: row.type as ConversationEventRecord['type'], occurredAt: new Date(String(row.occurred_at)).toISOString(), traceId: String(row.trace_id), payload }; }

  private toAdmin(row: Row): AdminRecord { return { id: String(row.id), email: String(row.email), passwordHash: String(row.password_hash), displayName: String(row.display_name ?? ''), role: String(row.role), status: row.status as AdminRecord['status'], createdAt: new Date(String(row.created_at)).toISOString(), lastLoginAt: iso(row.last_login_at) }; }
  private toSession(row: Row): SessionRecord { return { id: String(row.id), adminId: String(row.admin_id), issuedAt: new Date(String(row.issued_at)).toISOString(), lastSeenAt: new Date(String(row.last_seen_at)).toISOString(), expiresAt: new Date(String(row.expires_at)).toISOString(), csrfTokenHash: String(row.csrf_token_hash), revokedAt: iso(row.revoked_at) }; }
  private toScope(row: Row): AccountScopeRecord { return { id: String(row.id), adminId: String(row.admin_id), accountId: String(row.account_id), scope: String(row.scope), status: row.status as AccountScopeRecord['status'], expiresAt: iso(row.expires_at), revokedAt: iso(row.revoked_at) }; }
  private toAccount(row: Row): AccountRecord { return { id: String(row.id), platform: String(row.platform), sellerRef: String(row.seller_ref), displayName: row.display_name ? String(row.display_name) : undefined, remark: row.remark ? String(row.remark) : undefined, avatarUrl: row.avatar_url ? String(row.avatar_url) : undefined, platformUserId: row.platform_user_id ? String(row.platform_user_id) : undefined, status: row.status as AccountRecord['status'], createdAt: new Date(String(row.created_at)).toISOString(), updatedAt: new Date(String(row.updated_at)).toISOString(), lastConnectedAt: iso(row.last_connected_at) }; }
  private toProduct(row: Row): ProductRecord {
    const attributes = row.attributes_json && typeof row.attributes_json === 'object' && !Array.isArray(row.attributes_json) ? row.attributes_json as Record<string, unknown> : {};
    return { id: String(row.id), accountId: String(row.account_id), externalProductRef: row.external_product_ref ? String(row.external_product_ref) : undefined, title: String(row.title), description: row.description ? String(row.description) : undefined, categoryCode: row.category_code ? String(row.category_code) : undefined, attributes: { ...attributes }, defaultReplyTemplate: row.default_reply_template ? String(row.default_reply_template) : undefined, aiPrompt: row.ai_prompt ? String(row.ai_prompt) : undefined, configVersion: Number(row.config_version ?? 1), priceMinor: row.price_minor === null || row.price_minor === undefined ? undefined : Number(row.price_minor), status: row.status as ProductRecord['status'], source: (row.source ?? 'local') as ProductRecord['source'], lastSyncedAt: iso(row.last_synced_at), sourcePayloadDigest: row.source_payload_digest ? String(row.source_payload_digest) : undefined, createdAt: new Date(String(row.created_at)).toISOString(), updatedAt: new Date(String(row.updated_at)).toISOString(), skuCount: Number(row.sku_count ?? 0), assetCount: Number(row.asset_count ?? 0), couponBatches: this.toProductCouponBatches(row.coupon_batches) };
  }
  private toProductCouponBatches(value: unknown): Array<{ id: string; label?: string }> | undefined {
    const parsed = typeof value === 'string' ? (() => { try { return JSON.parse(value) as unknown; } catch { return undefined; } })() : value;
    if (!Array.isArray(parsed)) return undefined;
    return parsed.flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return [];
      const row = entry as Record<string, unknown>;
      if (!row.id) return [];
      return [{ id: String(row.id), label: row.label === null || row.label === undefined ? undefined : String(row.label) }];
    });
  }
  private toProductSku(row: Row): ProductSkuRecord { return { id: String(row.id), productId: String(row.product_id), skuCode: String(row.sku_code), externalSkuRef: row.external_sku_ref ? String(row.external_sku_ref) : undefined, priceMinor: Number(row.price_minor), status: row.status as ProductSkuRecord['status'] }; }
  private toProductAsset(row: Row): ProductAssetRecord { return { id: String(row.id), productId: String(row.product_id), storageKey: String(row.storage_key), mimeType: String(row.mime_type), checksum: row.checksum ? String(row.checksum) : undefined, status: row.status as ProductAssetRecord['status'] }; }
  private toIdempotency(row: Row): IdempotencyRecord { return { scope: String(row.scope), key: String(row.key), requestFingerprint: String(row.request_fingerprint), status: row.status as IdempotencyRecord['status'], responseEnvelope: row.response_envelope, statusCode: row.status_code ? Number(row.status_code) : undefined, traceId: row.trace_id ? String(row.trace_id) : undefined, expiresAt: new Date(String(row.expires_at)).toISOString() }; }
  private toAgentSession(row: Row): AgentSessionRecord { return { id: String(row.id), accountId: String(row.account_id), title: String(row.title), status: row.status as AgentSessionRecord['status'], summary: row.summary ? String(row.summary) : undefined, lastActiveAt: new Date(String(row.last_active_at)).toISOString(), archivedAt: iso(row.archived_at), createdAt: new Date(String(row.created_at)).toISOString(), updatedAt: new Date(String(row.updated_at)).toISOString() }; }
  private toRun(row: Row): RunRecord { return { id: String(row.id), accountId: String(row.account_id), sessionId: String(row.session_id), route: String(row.route), instruction: String(row.instruction), status: row.status as RunRecord['status'], requestedBy: String(row.requested_by), clientRunRef: row.client_run_ref ? String(row.client_run_ref) : undefined, resultSummary: row.result_summary ? String(row.result_summary) : undefined, errorCode: row.error_code ? String(row.error_code) : undefined, createdAt: new Date(String(row.created_at)).toISOString(), updatedAt: new Date(String(row.updated_at)).toISOString(), startedAt: iso(row.started_at), finishedAt: iso(row.finished_at) }; }
  private toStep(row: Row): StepRecord { return { id: String(row.id), runId: String(row.run_id), stepNo: Number(row.step_no), kind: row.kind as StepRecord['kind'], label: String(row.label), status: row.status as StepRecord['status'], attempt: Number(row.attempt ?? 1), inputSummary: row.input_summary ? String(row.input_summary) : undefined, outputSummary: row.output_summary ? String(row.output_summary) : undefined, errorCode: row.error_code ? String(row.error_code) : undefined, createdAt: new Date(String(row.created_at)).toISOString(), startedAt: iso(row.started_at), finishedAt: iso(row.finished_at) }; }
  private toRunEvent(row: Row): RunEventRecord { const payload = row.payload_json && typeof row.payload_json === 'object' && !Array.isArray(row.payload_json) ? row.payload_json as Record<string, unknown> : {}; return { sequence: Number(row.sequence), runId: String(row.run_id), eventType: String(row.event_type), payload: { ...payload }, createdAt: new Date(String(row.created_at)).toISOString() }; }
  private toWorkspaceMessage(row: Row): WorkspaceMessageRecord { return { id: String(row.id), sessionId: String(row.session_id), runId: row.run_id ? String(row.run_id) : undefined, type: row.message_type as WorkspaceMessageType, content: String(row.content), summary: row.summary ? String(row.summary) : undefined, createdAt: new Date(String(row.created_at)).toISOString(), sequence: Number(row.sequence) }; }
  private normalizeLoginSession(row?: Row): LoginSessionRecord | undefined { if (!row) return undefined; if (row.status === 'waiting' && row.expires_at && new Date(String(row.expires_at)).getTime() <= Date.now()) { void this.pool.query('update auth.account_login_sessions set status=\'expired\', completed_at=now() where id=$1 and status=\'waiting\'', [row.id]); row.status = 'expired'; } return this.toLoginSession(row); }
  private toLoginSession(row: Row): LoginSessionRecord { return { id: String(row.id), adminId: row.admin_id ? String(row.admin_id) : undefined, accountId: row.account_id ? String(row.account_id) : undefined, provisionalAccountRef: row.provisional_account_ref ? String(row.provisional_account_ref) : undefined, loginMethod: String(row.login_method), status: row.status as LoginSessionRecord['status'], startedAt: new Date(String(row.started_at)).toISOString(), expiresAt: new Date(String(row.expires_at)).toISOString(), completedAt: iso(row.completed_at), failureCode: row.failure_code ? String(row.failure_code) : undefined, qrTokenRef: row.qr_token_ref ? String(row.qr_token_ref) : undefined }; }
  private toCredential(row: Row): CredentialRecord {
    const metadata = row.metadata_json && typeof row.metadata_json === 'object' && !Array.isArray(row.metadata_json) ? Object.fromEntries(Object.entries(row.metadata_json as Record<string, unknown>).map(([key, value]) => [key, String(value)])) : {};
    return { id: String(row.id), accountId: String(row.account_id), platform: String(row.platform), status: row.status as CredentialRecord['status'], cookieHeader: row.cookie_header ? String(row.cookie_header) : undefined, accessToken: row.access_token ? String(row.access_token) : undefined, deviceId: row.device_id ? String(row.device_id) : undefined, metadata, expiresAt: iso(row.expires_at), lastVerifiedAt: iso(row.last_verified_at), createdAt: new Date(String(row.created_at)).toISOString(), updatedAt: new Date(String(row.updated_at)).toISOString() };
  }
}

const couponContentKey = createHash('sha256').update(process.env.COUPON_CONTENT_KEY ?? 'xianyu-agent-local-coupon-key').digest();
function encryptCouponValue(value: string): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', couponContentKey, iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]);
}
function decryptCouponValue(value: unknown): string {
  if (!value) return '';
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'base64');
  if (bytes.length < 28) return bytes.toString('utf8');
  try {
    const iv = bytes.subarray(0, 12);
    const tag = bytes.subarray(12, 28);
    const ciphertext = bytes.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', couponContentKey, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch { return ''; }
}
