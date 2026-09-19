import { Pool } from 'pg';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { AccountRecord, AccountScopeRecord, AdminRecord, AuditEventRecord, CouponBatchListQuery, CouponBatchListResult, CouponBatchMetadata, CouponBatchRecord, CouponBatchStatus, CouponBindingRecord, CouponDeliveryScope, CouponItemRecord, CredentialRecord, IdempotencyRecord, LoginSessionRecord, ProductAssetRecord, ProductListQuery, ProductListResult, ProductPatch, ProductRecord, ProductSkuRecord, ProductStatus, SessionRecord, Store, XianyuProductItem, ProductUpsertResult } from './domain.js';
import { createId } from './security.js';

type Row = Record<string, unknown>;
function iso(value: unknown): string | undefined { return value ? new Date(String(value)).toISOString() : undefined; }

export class PostgresStore implements Store {
  readonly kind = 'postgres' as const;
  readonly pool: Pool;
  constructor(databaseUrl: string) { this.pool = new Pool({ connectionString: databaseUrl }); }
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
  async listAccounts(adminId: string): Promise<AccountRecord[]> { const result = await this.pool.query('select a.* from accounts.accounts a join auth.account_scopes s on s.account_id=a.id where s.admin_id=$1 and s.status=\'active\' and a.status<>\'disabled\' and (s.expires_at is null or s.expires_at>now()) order by a.created_at desc', [adminId]); return result.rows.map(this.toAccount); }
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
    const rows = await this.pool.query(`select p.*, (select count(*)::int from products.product_skus sku where sku.product_id=p.id and sku.status <> 'archived') as sku_count, (select count(*)::int from products.asset_refs asset where asset.product_id=p.id and asset.status <> 'archived') as asset_count from products.products p where ${where} order by ${sortColumn} ${sortOrder}, p.id limit $${limitIndex} offset $${offsetIndex}`, [...params, pageSize, (page - 1) * pageSize]);
    return { items: rows.rows.map((row) => this.toProduct(row)), page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
  }
  async getProduct(adminId: string, productId: string): Promise<ProductRecord | undefined> {
    const result = await this.pool.query("select p.*, (select count(*)::int from products.product_skus sku where sku.product_id=p.id and sku.status <> 'archived') as sku_count, (select count(*)::int from products.asset_refs asset where asset.product_id=p.id and asset.status <> 'archived') as asset_count from products.products p where p.id=$1 and exists (select 1 from auth.account_scopes scope where scope.account_id=p.account_id and scope.admin_id=$2 and scope.status='active' and (scope.expires_at is null or scope.expires_at>now()))", [productId, adminId]);
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
  async close(): Promise<void> { await this.pool.end(); }

  private toCouponBatch(row: Row): CouponBatchRecord {
    const totalCount = Number(row.computed_total_count ?? row.total_count ?? 0);
    const metadata = row.metadata_json && typeof row.metadata_json === 'object' && !Array.isArray(row.metadata_json) ? row.metadata_json as CouponBatchMetadata : {};
    return { id: String(row.id), accountId: String(row.account_id), label: row.label ? String(row.label) : undefined, purpose: String(row.purpose), deliveryScope: row.delivery_scope as CouponBatchRecord['deliveryScope'], quarkUrl: row.quark_url ? String(row.quark_url) : undefined, extractionCode: row.extract_code_ciphertext ? decryptCouponValue(row.extract_code_ciphertext) : undefined, metadata, totalCount, availableCount: row.computed_available_count === undefined ? undefined : Number(row.computed_available_count), reservedCount: row.computed_reserved_count === undefined ? undefined : Number(row.computed_reserved_count), consumedCount: row.computed_consumed_count === undefined ? undefined : Number(row.computed_consumed_count), status: row.status as CouponBatchRecord['status'], version: Number(row.version ?? 1), createdAt: new Date(String(row.created_at)).toISOString(), updatedAt: new Date(String(row.updated_at)).toISOString() };
  }
  private toCouponItem(row: Row): CouponItemRecord { return { id: String(row.id), batchId: String(row.batch_id), content: decryptCouponValue(row.content_ciphertext), status: row.status as CouponItemRecord['status'], reservedUntil: iso(row.reserved_until), consumedAt: iso(row.consumed_at), createdAt: new Date(String(row.created_at)).toISOString() }; }
  private toCouponBinding(row: Row): CouponBindingRecord { return { id: String(row.id), batchId: String(row.coupon_batch_id), productId: String(row.product_id), priority: Number(row.priority ?? 0), status: row.status as CouponBindingRecord['status'], expiresAt: iso(row.expires_at), createdAt: new Date(String(row.created_at)).toISOString(), updatedAt: new Date(String(row.updated_at)).toISOString() }; }

  private toAdmin(row: Row): AdminRecord { return { id: String(row.id), email: String(row.email), passwordHash: String(row.password_hash), displayName: String(row.display_name ?? ''), role: String(row.role), status: row.status as AdminRecord['status'], createdAt: new Date(String(row.created_at)).toISOString(), lastLoginAt: iso(row.last_login_at) }; }
  private toSession(row: Row): SessionRecord { return { id: String(row.id), adminId: String(row.admin_id), issuedAt: new Date(String(row.issued_at)).toISOString(), lastSeenAt: new Date(String(row.last_seen_at)).toISOString(), expiresAt: new Date(String(row.expires_at)).toISOString(), csrfTokenHash: String(row.csrf_token_hash), revokedAt: iso(row.revoked_at) }; }
  private toScope(row: Row): AccountScopeRecord { return { id: String(row.id), adminId: String(row.admin_id), accountId: String(row.account_id), scope: String(row.scope), status: row.status as AccountScopeRecord['status'], expiresAt: iso(row.expires_at), revokedAt: iso(row.revoked_at) }; }
  private toAccount(row: Row): AccountRecord { return { id: String(row.id), platform: String(row.platform), sellerRef: String(row.seller_ref), displayName: row.display_name ? String(row.display_name) : undefined, remark: row.remark ? String(row.remark) : undefined, avatarUrl: row.avatar_url ? String(row.avatar_url) : undefined, platformUserId: row.platform_user_id ? String(row.platform_user_id) : undefined, status: row.status as AccountRecord['status'], createdAt: new Date(String(row.created_at)).toISOString(), updatedAt: new Date(String(row.updated_at)).toISOString(), lastConnectedAt: iso(row.last_connected_at) }; }
  private toProduct(row: Row): ProductRecord {
    const attributes = row.attributes_json && typeof row.attributes_json === 'object' && !Array.isArray(row.attributes_json) ? row.attributes_json as Record<string, unknown> : {};
    return { id: String(row.id), accountId: String(row.account_id), externalProductRef: row.external_product_ref ? String(row.external_product_ref) : undefined, title: String(row.title), description: row.description ? String(row.description) : undefined, categoryCode: row.category_code ? String(row.category_code) : undefined, attributes: { ...attributes }, defaultReplyTemplate: row.default_reply_template ? String(row.default_reply_template) : undefined, aiPrompt: row.ai_prompt ? String(row.ai_prompt) : undefined, configVersion: Number(row.config_version ?? 1), priceMinor: row.price_minor === null || row.price_minor === undefined ? undefined : Number(row.price_minor), status: row.status as ProductRecord['status'], source: (row.source ?? 'local') as ProductRecord['source'], lastSyncedAt: iso(row.last_synced_at), sourcePayloadDigest: row.source_payload_digest ? String(row.source_payload_digest) : undefined, createdAt: new Date(String(row.created_at)).toISOString(), updatedAt: new Date(String(row.updated_at)).toISOString(), skuCount: Number(row.sku_count ?? 0), assetCount: Number(row.asset_count ?? 0) };
  }
  private toProductSku(row: Row): ProductSkuRecord { return { id: String(row.id), productId: String(row.product_id), skuCode: String(row.sku_code), externalSkuRef: row.external_sku_ref ? String(row.external_sku_ref) : undefined, priceMinor: Number(row.price_minor), status: row.status as ProductSkuRecord['status'] }; }
  private toProductAsset(row: Row): ProductAssetRecord { return { id: String(row.id), productId: String(row.product_id), storageKey: String(row.storage_key), mimeType: String(row.mime_type), checksum: row.checksum ? String(row.checksum) : undefined, status: row.status as ProductAssetRecord['status'] }; }
  private toIdempotency(row: Row): IdempotencyRecord { return { scope: String(row.scope), key: String(row.key), requestFingerprint: String(row.request_fingerprint), status: row.status as IdempotencyRecord['status'], responseEnvelope: row.response_envelope, statusCode: row.status_code ? Number(row.status_code) : undefined, traceId: row.trace_id ? String(row.trace_id) : undefined, expiresAt: new Date(String(row.expires_at)).toISOString() }; }
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
