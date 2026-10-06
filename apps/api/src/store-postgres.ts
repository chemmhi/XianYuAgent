import { Pool, type PoolClient } from 'pg';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { AccountListQuery, AccountListResult, AccountRecord, AccountScopeRecord, AgentSessionRecord, AdminRecord, AuditEventRecord, AutoReplyActivitySummary, AutoReplyAgentConfig, AutoReplyAgentConfigPatch, AutoReplyAgentConfigRecord, AutoReplyOutboxRecord, AutoReplyRepairPolicyBundle, AutoReplyRunDetailRecord, AutoReplyRunEventRecord, AutoReplyRunListItem, AutoReplyRunListQuery, AutoReplyRunListResult, AutoReplyRunRecord, AutoReplyRunUpdate, AutoReplyDecision, AutoReplyRunStage, AutoReplyRunStatus, AutoReplyConversationContext, AutoReplyConversationListQuery, AutoReplyConversationListResult, AutoReplyMessageContext, AutoReplyMessageListQuery, AutoReplyMessageListResult, AutoReplyOrderContext, AutoReplyOrderListQuery, AutoReplyOrderListResult, AutoReplyProductContext, AutoReplyProductListQuery, AutoReplyProductListResult, AutoReplyProductLookup, ConversationEventRecord, ConversationListQuery, ConversationListResult, ConversationRecord, CouponAssetRecord, CouponBatchListQuery, CouponBatchListResult, CouponBatchMetadata, CouponBatchRecord, CouponBatchStatus, CouponBindingRecord, CouponItemRecord, CouponReservationPurpose, CouponReservationRecord, CredentialRecord, CredentialRefRecord, CredentialRefStatus, DeliveryRecord, DeliveryRecordStatus, IdempotencyRecord, InboundInboxRecord, InboundQuarantineRecord, LoginSessionRecord, MessageListQuery, MessageListResult, MessageRecord, OrderListQuery, OrderListResult, OrderRecord, OrderSource, OrderUpsertResult, ProductAssetRecord, ProductAutomationBatchResult, ProductAutomationConfig, ProductAutomationConfigRecord, ProductKnowledgeBaseMessageRecord, ProductListQuery, ProductListResult, ProductPatch, ProductRecord, ProductSkuRecord, ProductStatus, RunEventRecord, RunRecord, RunStatus, SessionRecord, StepRecord, StepStatus, Store, WorkspaceConfirmationRecord, WorkspaceMessageRecord, WorkspaceMessageType, XianyuItemDetailPersistenceInput, XianyuOrderItem, XianyuProductItem, ProductUpsertResult, AutomationExecutionLedgerRecord } from './domain.js';
import { autoReplyStageForStatus } from './domain.js';
import { projectAutoReplyRun } from './auto-reply-activity-projection.js';
import { createId } from './security.js';
import { decodeConversationCursor, encodeConversationCursor } from './conversation-cursor.js';
import { decodeMessageHistoryCursor } from './message-history-cursor.js';
import { normalizeAutoReplyProductMetric } from './auto-reply-product-metrics.js';
import { cloneCouponReservation, normalizeCouponReservationInput, normalizeLeaseSeconds, reservationFingerprint } from './coupon-reservation.js';
import { validatePersistedAutoReplyRepairPolicyBundle } from './auto-reply-repair-config.js';
import { normalizeProductSearchTerms, normalizeProductSearchText, splitProductSearchTerms, type AutoReplyProductSearchMode } from './auto-reply-product-search.js';
import { splitDataContent } from './coupon-delivery.js';

type Row = Record<string, unknown>;
const PRODUCT_COUPON_BATCHES_SELECT = `(select coalesce(json_agg(json_build_object('id', cb.sequence_id, 'label', cb.label) order by binding.priority desc, binding.created_at, cb.sequence_id), '[]'::json) from coupons.coupon_bindings binding join coupons.coupon_batches cb on cb.id=binding.coupon_batch_id where binding.product_id=p.id and binding.status='active' and cb.status <> 'voided') as coupon_batches`;
const AUTO_REPLY_PRODUCT_SELECT = `p.id,p.external_product_ref,p.title,
        coalesce(nullif(btrim(p.description), ''), nullif(btrim(p.attributes_json #>> '{xianyu,detail,summary,description}'), '')) as description,
        p.default_reply_template,p.knowledge_base,p.price_minor,p.status,
        nullif(p.attributes_json #>> '{xianyu,detail,summary,browseCount}', '')::int as browse_count,
        nullif(p.attributes_json #>> '{xianyu,detail,summary,wantCount}', '')::int as want_count,
        nullif(p.attributes_json #>> '{xianyu,detail,summary,collectCount}', '')::int as collect_count`;
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
  async listAdminIds(): Promise<string[]> { const result = await this.pool.query("select id from auth.admins where status='active' order by created_at asc"); return result.rows.map((row) => String(row.id)); }
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
    if (query.accountId) conditions.push(`a.id = ${addParam(query.accountId)}`);
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
  async getAccountForLogin(adminId: string, accountId: string): Promise<AccountRecord | undefined> { const result = await this.pool.query('select a.* from accounts.accounts a join auth.account_scopes s on s.account_id=a.id where a.id=$1 and s.admin_id=$2 and s.scope=\'manage\' limit 1', [accountId, adminId]); return result.rows[0] ? this.toAccount(result.rows[0]) : undefined; }
  async findAccountForLogin(input: { adminId: string; platform: string; sellerRef: string }): Promise<AccountRecord | undefined> { const result = await this.pool.query('select a.* from accounts.accounts a join auth.account_scopes s on s.account_id=a.id where a.platform=$1 and a.seller_ref=$2 and s.admin_id=$3 and s.scope=\'manage\' limit 1', [input.platform, input.sellerRef, input.adminId]); return result.rows[0] ? this.toAccount(result.rows[0]) : undefined; }
  async restoreAccountForLogin(adminId: string, accountId: string): Promise<AccountRecord | undefined> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const current = await client.query('select a.* from accounts.accounts a join auth.account_scopes s on s.account_id=a.id where a.id=$1 and s.admin_id=$2 and s.scope=\'manage\' limit 1 for update', [accountId, adminId]);
      if (!current.rows[0]) { await client.query('rollback'); return undefined; }
      await client.query('insert into auth.account_scopes (id,admin_id,account_id,scope,status) values ($1,$2,$3,\'manage\',\'active\') on conflict (admin_id,account_id,scope) do update set status=\'active\', revoked_at=null, expires_at=null', [createId(), adminId, accountId]);
      const result = await client.query("update accounts.accounts set status=case when status='disabled' then 'pending' else status end, updated_at=now() where id=$1 returning *", [accountId]);
      await client.query('commit');
      return result.rows[0] ? this.toAccount(result.rows[0]) : undefined;
    } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
  }
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
    const sortBy = query.sortBy ?? 'xianyuOrder';
    const sortColumn = sortBy === 'title' ? 'p.title' : sortBy === 'priceMinor' ? 'p.price_minor' : sortBy === 'createdAt' ? 'p.created_at' : sortBy === 'xianyuOrder' ? 'p.xianyu_list_rank' : 'p.xianyu_updated_at';
    const sortOrder = query.sortOrder === 'desc' ? 'DESC' : sortBy === 'xianyuOrder' ? 'ASC' : 'DESC';
    const sortNulls = sortBy === 'updatedAt' || sortBy === 'xianyuOrder' || !query.sortBy ? ' NULLS LAST' : '';
    const limitIndex = params.length + 1;
    const offsetIndex = params.length + 2;
    const rows = await this.pool.query(`select p.*, (select count(*)::int from products.product_skus sku where sku.product_id=p.id and sku.status <> 'archived') as sku_count, (select count(*)::int from products.asset_refs asset where asset.product_id=p.id and asset.status <> 'archived') as asset_count, ${PRODUCT_COUPON_BATCHES_SELECT} from products.products p where ${where} order by ${sortColumn} ${sortOrder}${sortNulls}, p.id limit $${limitIndex} offset $${offsetIndex}`, [...params, pageSize, (page - 1) * pageSize]);
    return { items: rows.rows.map((row) => this.toProduct(row)), page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
  }
  async getAutoReplyProduct(adminId: string, query: AutoReplyProductLookup): Promise<AutoReplyProductContext | undefined> {
    const params: unknown[] = [adminId, query.accountId];
    const conditions = [
      'p.account_id=$2',
      "EXISTS (SELECT 1 FROM auth.account_scopes scope WHERE scope.account_id=p.account_id AND scope.admin_id=$1 AND scope.status='active' AND (scope.expires_at IS NULL OR scope.expires_at>now()))",
    ];
    if (query.productId) {
      params.push(query.productId);
      conditions.push(`p.id=$${params.length}::uuid`);
    } else if (query.externalProductRef) {
      params.push(query.externalProductRef);
      conditions.push(`p.external_product_ref=$${params.length}`);
    } else if (query.title) {
      params.push(query.title);
      conditions.push(`p.title=$${params.length}`);
    } else {
      return undefined;
    }
    const result = await this.pool.query(`select ${AUTO_REPLY_PRODUCT_SELECT} from products.products p where ${conditions.join(' AND ')} limit 1`, params);
    return result.rows[0] ? this.toAutoReplyProduct(result.rows[0]) : undefined;
  }
  async listAutoReplyProducts(adminId: string, query: AutoReplyProductListQuery): Promise<AutoReplyProductListResult> {
    const limit = Math.min(50, Math.max(1, query.limit ?? 10));
    const baseParams: unknown[] = [adminId, query.accountId];
    const baseConditions = [
      'p.account_id=$2',
      "EXISTS (SELECT 1 FROM auth.account_scopes scope WHERE scope.account_id=p.account_id AND scope.admin_id=$1 AND scope.status='active' AND (scope.expires_at IS NULL OR scope.expires_at>now()))",
    ];
    if (query.productId) {
      baseParams.push(query.productId);
      baseConditions.push(`p.id=$${baseParams.length}::uuid`);
    }
    const normalizedKeyword = normalizeProductSearchText(query.keyword);
    const explicitKeywords = normalizeProductSearchTerms(query.keywords);
    const fieldSql = (placeholder: string) => `(lower(p.title) like ${placeholder} or lower(coalesce(p.external_product_ref,'')) like ${placeholder} or lower(coalesce(p.description,'')) like ${placeholder} or lower(coalesce(p.attributes_json #>> '{xianyu,detail,summary,description}','')) like ${placeholder})`;
    const runSearch = async (terms: string[], searchMode: AutoReplyProductSearchMode): Promise<AutoReplyProductListResult> => {
      const params = [...baseParams];
      const termConditions: string[] = [];
      const scoreParts: string[] = [];
      for (const term of terms) {
        params.push(`%${term}%`);
        const placeholder = `$${params.length}`;
        termConditions.push(fieldSql(placeholder));
        scoreParts.push(`case when ${fieldSql(placeholder)} then 1 else 0 end`);
      }
      const conditions = [...baseConditions, `(${termConditions.join(' or ')})`];
      const where = conditions.join(' and ');
      const count = await this.pool.query(`select count(*)::int as total from products.products p where ${where}`, params);
      const total = Number(count.rows[0]?.total ?? 0);
      const limitIndex = params.length + 1;
      const rows = await this.pool.query(`select ${AUTO_REPLY_PRODUCT_SELECT} from products.products p where ${where} order by (${scoreParts.join(' + ')}) desc, p.title asc, p.id asc limit $${limitIndex}`, [...params, limit]);
      return { items: rows.rows.map((row) => this.toAutoReplyProduct(row)), total, searchMode };
    };
    if (normalizedKeyword) {
      const exact = await runSearch([normalizedKeyword], 'exact_phrase');
      if (exact.total > 0) return exact;
      const fallbackTerms = explicitKeywords.length > 0 ? explicitKeywords : splitProductSearchTerms(normalizedKeyword);
      if (fallbackTerms.length > 0) return runSearch(fallbackTerms, 'core_terms');
      return { items: [], total: 0, searchMode: 'exact_phrase' };
    }
    if (explicitKeywords.length > 0) return runSearch(explicitKeywords, 'core_terms');
    const params = [...baseParams];
    const where = baseConditions.join(' AND ');
    const count = await this.pool.query(`select count(*)::int as total from products.products p where ${where}`, params);
    const rows = await this.pool.query(`select ${AUTO_REPLY_PRODUCT_SELECT} from products.products p where ${where} order by p.title asc, p.id asc limit $${params.length + 1}`, [...params, limit]);
    return { items: rows.rows.map((row) => this.toAutoReplyProduct(row)), total: Number(count.rows[0]?.total ?? 0), searchMode: 'catalog' };
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

  async getProductAutomation(adminId: string, productId: string): Promise<ProductAutomationConfigRecord | undefined> {
    const result = await this.pool.query(`select a.*
      from products.automation_configs a
      join products.products p on p.id=a.product_id
      where a.product_id=$1 and exists (
        select 1 from auth.account_scopes scope
        where scope.account_id=p.account_id and scope.admin_id=$2 and scope.status='active'
          and (scope.expires_at is null or scope.expires_at>now())
      ) limit 1`, [productId, adminId]);
    return result.rows[0] ? this.toProductAutomation(result.rows[0]) : undefined;
  }

  async updateProductAutomation(input: { adminId: string; productId: string; expectedConfigVersion: number; config: ProductAutomationConfig; configDigest: string; syncCouponBindings?: boolean }): Promise<ProductAutomationConfigRecord | undefined> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const product = await client.query(`select p.account_id
        from products.products p
        where p.id=$1 and exists (
          select 1 from auth.account_scopes scope
          where scope.account_id=p.account_id and scope.admin_id=$2 and scope.status='active'
            and (scope.expires_at is null or scope.expires_at>now())
        ) for update`, [input.productId, input.adminId]);
      if (!product.rows[0]) { await client.query('rollback'); return undefined; }
      const current = await client.query('select * from products.automation_configs where product_id=$1 for update', [input.productId]);
      const row = current.rows[0] as Row | undefined;
      const currentVersion = row ? Number(row.config_version) : 1;
      if ((row && currentVersion !== input.expectedConfigVersion) || (!row && input.expectedConfigVersion !== 1)) throw new Error('AUTOMATION_VERSION_CONFLICT');
      if (input.syncCouponBindings !== false) await this.syncProductCouponBindings(client, { productId: input.productId, accountId: String(product.rows[0].account_id), config: input.config });
      const recordId = row ? String(row.id) : createId();
      const version = row ? currentVersion + 1 : 1;
      const saved = row
        ? await client.query(`update products.automation_configs
            set config_version=$2, config_json=$3::jsonb, config_digest=$4, updated_at=now()
            where product_id=$1 returning *`, [input.productId, version, JSON.stringify(input.config), input.configDigest])
        : await client.query(`insert into products.automation_configs
            (id,product_id,account_id,config_version,config_json,config_digest)
            values ($1,$2,$3,$4,$5::jsonb,$6) returning *`, [recordId, input.productId, product.rows[0].account_id, version, JSON.stringify(input.config), input.configDigest]);
      await client.query('commit');
      return this.toProductAutomation(saved.rows[0]);
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally { client.release(); }
  }

  async updateProductAutomationsBatch(input: { adminId: string; productIds: string[]; expectedConfigVersions: Record<string, number>; config?: ProductAutomationConfig; configDigest?: string; configByProductId?: Record<string, ProductAutomationConfig>; configDigests?: Record<string, string>; syncCouponBindingsByProduct?: Record<string, boolean> }): Promise<ProductAutomationBatchResult> {
    const productIds = [...new Set(input.productIds)];
    if (productIds.length === 0) throw new Error('PRODUCT_NOT_FOUND');
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const products = await client.query(`select p.id,p.account_id
        from products.products p
        where p.id = any($1::uuid[])
          and exists (
            select 1 from auth.account_scopes scope
            where scope.account_id=p.account_id and scope.admin_id=$2 and scope.status='active'
              and (scope.expires_at is null or scope.expires_at>now())
          )
        order by p.id for update`, [productIds, input.adminId]);
      if (products.rowCount !== productIds.length) { await client.query('rollback'); throw new Error('PRODUCT_NOT_FOUND'); }
      const accountIds = new Set(products.rows.map((row) => String(row.account_id)));
      if (accountIds.size !== 1) { await client.query('rollback'); throw new Error('AUTOMATION_BATCH_ACCOUNT_MISMATCH'); }
      const current = await client.query('select * from products.automation_configs where product_id = any($1::uuid[]) for update', [productIds]);
      const byProduct = new Map(current.rows.map((row) => [String(row.product_id), row as Row]));
      for (const productId of productIds) {
        const row = byProduct.get(productId);
        const expected = input.expectedConfigVersions[productId];
        const version = row ? Number(row.config_version) : 1;
        if (!Number.isSafeInteger(expected) || expected !== version) { await client.query('rollback'); throw new Error('AUTOMATION_VERSION_CONFLICT'); }
      }
      const saved: ProductAutomationConfigRecord[] = [];
      for (const productId of productIds) {
        const row = byProduct.get(productId);
        const version = row ? Number(row.config_version) + 1 : 1;
        const product = products.rows.find((item) => String(item.id) === productId)!;
        const config = input.configByProductId?.[productId] ?? input.config!;
        if (input.syncCouponBindingsByProduct?.[productId] !== false) await this.syncProductCouponBindings(client, { productId, accountId: String(product.account_id), config });
        const result = row
          ? await client.query(`update products.automation_configs
              set config_version=$2, config_json=$3::jsonb, config_digest=$4, updated_at=now()
              where product_id=$1 returning *`, [productId, version, JSON.stringify(config), input.configDigests?.[productId] ?? input.configDigest ?? ''])
          : await client.query(`insert into products.automation_configs
              (id,product_id,account_id,config_version,config_json,config_digest)
              values ($1,$2,$3,$4,$5::jsonb,$6) returning *`, [createId(), productId, product.account_id, version, JSON.stringify(config), input.configDigests?.[productId] ?? input.configDigest ?? '']);
        saved.push(this.toProductAutomation(result.rows[0]));
      }
      await client.query('commit');
      return { items: saved, updatedProductIds: productIds };
    } catch (error) {
      try { await client.query('rollback'); } catch { /* preserve original error */ }
      throw error;
    } finally { client.release(); }
  }

  private automationCouponBatchIds(config: ProductAutomationConfig): string[] {
    return [...new Set([
      ...(config.paidAutoDelivery?.couponBatchIds ?? []),
      ...(config.reviewGift?.couponBatchIds ?? []),
    ].map((value) => String(value).trim()).filter(Boolean))];
  }

  private async syncProductCouponBindings(client: PoolClient, input: { productId: string; accountId: string; config: ProductAutomationConfig }): Promise<void> {
    const selectedRows: Row[] = [];
    for (const batchRef of this.automationCouponBatchIds(input.config)) {
      const result = await client.query(`select b.*
        from coupons.coupon_batches b
        where (b.id::text=$1 or b.sequence_id::text=$1) and b.account_id=$2
        order by (b.status='voided') asc, b.created_at desc, b.id desc
        limit 1 for update`, [batchRef, input.accountId]);
      const row = result.rows[0] as Row | undefined;
      if (!row) throw new Error('COUPON_NOT_FOUND');
      if (row.status === 'voided' || row.status === 'closed') throw new Error('COUPON_BATCH_VOIDED');
      selectedRows.push(row);
    }
    const selectedIds = new Set(selectedRows.map((row) => String(row.id)));
    const bindings = await client.query('select * from coupons.coupon_bindings where product_id=$1 for update', [input.productId]);
    const activeIds = new Set(bindings.rows.filter((row) => row.status === 'active').map((row) => String(row.coupon_batch_id)));
    const touchedBatchIds = new Set<string>();
    for (const binding of bindings.rows) {
      const batchId = String(binding.coupon_batch_id);
      if (binding.status === 'active' && !selectedIds.has(batchId)) {
        await client.query("update coupons.coupon_bindings set status='inactive',updated_at=now() where id=$1", [binding.id]);
        touchedBatchIds.add(batchId);
      }
    }
    for (const row of selectedRows) {
      const batchId = String(row.id);
      if (activeIds.has(batchId)) continue;
      await client.query("insert into coupons.coupon_bindings (id,coupon_batch_id,product_id,priority,status) values ($1,$2,$3,0,'active') on conflict (coupon_batch_id,product_id) do update set status='active',updated_at=now()", [createId(), batchId, input.productId]);
      touchedBatchIds.add(batchId);
    }
    for (const batchId of touchedBatchIds) await client.query('update coupons.coupon_batches set version=version+1,updated_at=now() where id=$1', [batchId]);
  }

  async persistXianyuItemDetail(input: XianyuItemDetailPersistenceInput): Promise<ProductRecord | undefined> {
    const current = await this.pool.query('select account_id from products.products where id=$1', [input.productId]);
    if (!current.rows[0]) return undefined;
    const accountId = String(current.rows[0].account_id);
    if (!(await this.hasAccountScope(input.adminId, accountId))) throw new Error('ACCOUNT_SCOPE_FORBIDDEN');
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const existing = await client.query('select attributes_json from products.products where id=$1 for update', [input.productId]);
      if (!existing.rows[0]) { await client.query('rollback'); return undefined; }
      const attributes = existing.rows[0].attributes_json && typeof existing.rows[0].attributes_json === 'object' && !Array.isArray(existing.rows[0].attributes_json)
        ? existing.rows[0].attributes_json as Record<string, unknown>
        : {};
      const existingXianyu = attributes.xianyu && typeof attributes.xianyu === 'object' && !Array.isArray(attributes.xianyu) ? attributes.xianyu as Record<string, unknown> : {};
      const previousDetail = existingXianyu.detail && typeof existingXianyu.detail === 'object' && !Array.isArray(existingXianyu.detail) ? existingXianyu.detail as Record<string, unknown> : {};
      const previousImageUrls = Array.isArray(previousDetail.imageUrls) ? previousDetail.imageUrls.filter((value): value is string => typeof value === 'string') : [];
      const detail = { itemId: input.itemId, summary: { ...input.summary }, rawResponse: { ...input.rawResponse }, imageUrls: [...input.imageUrls], assetUploadErrors: input.assetUploadErrors ? input.assetUploadErrors.map((entry) => ({ ...entry })) : [], syncedAt: input.syncedAt };
      const nextAttributes = { ...attributes, xianyu: { ...existingXianyu, imageUrls: [...input.imageUrls], detail } };
      const title = typeof input.summary.title === 'string' && input.summary.title.trim() ? input.summary.title.trim() : undefined;
      const description = typeof input.summary.description === 'string' ? input.summary.description : undefined;
      const priceMinor = typeof input.summary.priceMinor === 'number' && Number.isSafeInteger(input.summary.priceMinor) ? input.summary.priceMinor : undefined;
      const xianyuUpdatedAt = typeof input.summary.xianyuUpdatedAt === 'string' && input.summary.xianyuUpdatedAt.trim() ? input.summary.xianyuUpdatedAt : null;
      await client.query(`update products.products set external_product_ref=coalesce(external_product_ref,$2), title=coalesce($3,title), description=coalesce($4,description), price_minor=coalesce($5,price_minor), attributes_json=$6::jsonb, source='xianyu', last_synced_at=$7, xianyu_updated_at=coalesce($8,xianyu_updated_at), source_payload_digest=$9, config_version=config_version+1, updated_at=$7 where id=$1`, [input.productId, input.itemId, title ?? null, description ?? null, priceMinor ?? null, JSON.stringify(nextAttributes), input.syncedAt, xianyuUpdatedAt, input.sourcePayloadDigest]);
      const currentStorageKeys = input.assets.map((asset) => asset.storageKey);
      const detailPrefix = `products/${input.productId}/xianyu/${input.itemId}/images/`;
      await client.query(`update products.asset_refs
        set status='archived'
        where product_id=$1
          and status <> 'archived'
          and (metadata_json->>'source'='xianyu-detail' or storage_key like $2 or source_url = any($3::text[]))
          and not (storage_key = any($4::text[]))`, [input.productId, `${detailPrefix}%`, previousImageUrls, currentStorageKeys]);
      for (const asset of input.assets) {
        await client.query(`insert into products.asset_refs (id,product_id,storage_key,mime_type,checksum,source_url,metadata_json,status)
          values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
          on conflict (product_id,storage_key) do update set mime_type=excluded.mime_type,checksum=excluded.checksum,source_url=excluded.source_url,metadata_json=excluded.metadata_json,status=excluded.status`, [createId(), input.productId, asset.storageKey, asset.mimeType, asset.checksum ?? null, asset.sourceUrl ?? null, JSON.stringify(asset.metadata ?? {}), asset.status ?? 'active']);
      }
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
    return this.getProduct(input.adminId, input.productId);
  }
  async listOrders(adminId: string, query: OrderListQuery): Promise<OrderListResult> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const params: unknown[] = [adminId];
    const productJoin = `left join lateral (select p.title, p.attributes_json from products.products p where p.account_id=o.account_id and (p.id::text=o.product_id or p.external_product_ref=o.item_id) order by (p.id::text=o.product_id) desc limit 1) product on true`;
    const buyerJoin = `left join lateral (select c.buyer_display_name, c.buyer_avatar_url from messages.conversations c where c.account_id=o.account_id and ((o.conversation_id is not null and c.id::text=o.conversation_id) or c.buyer_ref=o.buyer_id) order by (c.id::text=o.conversation_id) desc, c.updated_at desc nulls last limit 1) buyer_identity on true`;
    const itemJoin = `left join lateral (select c.item_ref, c.item_title, c.item_image_url from messages.conversations c where c.account_id=o.account_id and ((o.conversation_id is not null and c.id::text=o.conversation_id) or c.item_ref=o.item_id) order by (c.item_title is not null and btrim(c.item_title)<>'') desc, (c.id::text=o.conversation_id) desc, (c.item_ref=o.item_id) desc, c.updated_at desc nulls last limit 1) item_identity on true`;
    const buyerItemJoin = `left join lateral (select c.item_ref, c.item_title, c.item_image_url from messages.conversations c where c.account_id=o.account_id and c.buyer_ref=o.buyer_id order by (c.item_title is not null and btrim(c.item_title)<>'') desc, c.updated_at desc nulls last limit 1) buyer_item_identity on true`;
    const displayBuyerNickname = `coalesce(nullif(btrim(o.buyer_nickname), ''), nullif(btrim(buyer_identity.buyer_display_name), '')) as display_buyer_nickname`;
    const displayBuyerAvatar = `coalesce(nullif(btrim(o.buyer_avatar_url), ''), nullif(btrim(buyer_identity.buyer_avatar_url), '')) as display_buyer_avatar_url`;
    const displayItemTitle = `case when o.item_title is not null and btrim(o.item_title)<>'' and btrim(o.item_title)<>btrim(o.item_id) then o.item_title when product.title is not null and btrim(product.title)<>'' and btrim(product.title)<>btrim(o.item_id) then product.title when item_identity.item_title is not null and btrim(item_identity.item_title)<>'' and btrim(item_identity.item_title)<>btrim(o.item_id) and (item_identity.item_ref is null or btrim(item_identity.item_title)<>btrim(item_identity.item_ref)) then item_identity.item_title when buyer_item_identity.item_title is not null and btrim(buyer_item_identity.item_title)<>'' and btrim(buyer_item_identity.item_title)<>btrim(o.item_id) and (buyer_item_identity.item_ref is null or btrim(buyer_item_identity.item_title)<>btrim(buyer_item_identity.item_ref)) then buyer_item_identity.item_title else null end as display_item_title`;
    const displayItemImage = `coalesce(nullif(btrim(item_identity.item_image_url), ''), nullif(btrim(buyer_item_identity.item_image_url), ''), nullif(product.attributes_json #>> '{xianyu,imageUrls,0}', ''), nullif(product.attributes_json #>> '{imageUrls,0}', '')) as display_item_image_url`;
    const conditions = ["EXISTS (SELECT 1 FROM auth.account_scopes scope WHERE scope.account_id=o.account_id AND scope.admin_id=$1 AND scope.status='active' AND (scope.expires_at IS NULL OR scope.expires_at>now()))"];
    const addParam = (value: unknown) => { params.push(value); return `$${params.length}`; };
    if (query.accountId) conditions.push(`o.account_id=${addParam(query.accountId)}`);
    if (query.paymentStatus) conditions.push(`o.payment_status=${addParam(query.paymentStatus)}`);
    if (query.orderStatus) conditions.push(`o.order_status=${addParam(query.orderStatus)}`);
    if (query.deliveryStatus) conditions.push(`o.delivery_status=${addParam(query.deliveryStatus)}`);
    if (query.afterSalesStatus) conditions.push(`o.after_sales_status=${addParam(query.afterSalesStatus)}`);
    const keyword = query.keyword?.trim();
    if (keyword) { const p = addParam(`%${keyword}%`); conditions.push(`(o.order_no ILIKE ${p} OR o.buyer_nickname ILIKE ${p} OR buyer_identity.buyer_display_name ILIKE ${p} OR (o.item_title IS NOT NULL AND btrim(o.item_title) <> '' AND btrim(o.item_title) <> btrim(o.item_id) AND o.item_title ILIKE ${p}) OR (product.title IS NOT NULL AND btrim(product.title) <> '' AND btrim(product.title) <> btrim(o.item_id) AND product.title ILIKE ${p}) OR (item_identity.item_title IS NOT NULL AND btrim(item_identity.item_title) <> '' AND btrim(item_identity.item_title) <> btrim(o.item_id) AND (item_identity.item_ref IS NULL OR btrim(item_identity.item_title) <> btrim(item_identity.item_ref)) AND item_identity.item_title ILIKE ${p}) OR (buyer_item_identity.item_title IS NOT NULL AND btrim(buyer_item_identity.item_title) <> '' AND btrim(buyer_item_identity.item_title) <> btrim(o.item_id) AND (buyer_item_identity.item_ref IS NULL OR btrim(buyer_item_identity.item_title) <> btrim(buyer_item_identity.item_ref)) AND buyer_item_identity.item_title ILIKE ${p}))`); }
    const where = conditions.join(' AND ');
    const count = await this.pool.query(`select count(*)::int as total from orders.orders o ${productJoin} ${buyerJoin} ${itemJoin} ${buyerItemJoin} where ${where}`, params);
    const total = Number(count.rows[0]?.total ?? 0);
    const sortColumn = query.sortBy === 'amountMinor' ? 'o.amount_minor' : 'o.created_at';
    const sortOrder = query.sortOrder === 'asc' ? 'ASC' : 'DESC';
    const rows = await this.pool.query(`select o.*, ${displayBuyerNickname}, ${displayBuyerAvatar}, ${displayItemTitle}, ${displayItemImage} from orders.orders o ${productJoin} ${buyerJoin} ${itemJoin} ${buyerItemJoin} where ${where} order by ${sortColumn} ${sortOrder}, o.order_no limit $${params.length + 1} offset $${params.length + 2}`, [...params, pageSize, (page - 1) * pageSize]);
    return { items: rows.rows.map((row) => this.toOrder(row)), page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
  }
  async listAutoReplyOrders(adminId: string, query: AutoReplyOrderListQuery): Promise<AutoReplyOrderListResult> {
    const limit = Math.min(50, Math.max(1, query.limit ?? 20));
    if (!query.buyerId && !query.conversationId) return { items: [], total: 0 };
    const params: unknown[] = [adminId, query.accountId];
    const conditions = [
      'o.account_id=$2',
      "EXISTS (SELECT 1 FROM auth.account_scopes scope WHERE scope.account_id=o.account_id AND scope.admin_id=$1 AND scope.status='active' AND (scope.expires_at IS NULL OR scope.expires_at>now()))",
    ];
    const identityConditions: string[] = [];
    if (query.buyerId) { params.push(query.buyerId); identityConditions.push(`o.buyer_id=$${params.length}`); }
    if (query.conversationId) { params.push(query.conversationId); identityConditions.push(`o.conversation_id=$${params.length}`); }
    if (identityConditions.length > 0) conditions.push(`(${identityConditions.join(' OR ')})`);
    const where = conditions.join(' AND ');
    const count = await this.pool.query(`select count(*)::int as total from orders.orders o where ${where}`, params);
    const rows = await this.pool.query(`select o.order_no,o.item_id,o.item_title,o.payment_status,o.order_status,o.delivery_status,o.after_sales_status
      from orders.orders o where ${where} order by o.created_at desc, o.order_no desc limit $${params.length + 1}`, [...params, limit]);
    return { items: rows.rows.map((row) => this.toAutoReplyOrder(row)), total: Number(count.rows[0]?.total ?? 0) };
  }
  async getOrder(adminId: string, orderNo: string, accountId?: string): Promise<OrderRecord | undefined> {
    const params: unknown[] = [orderNo, adminId];
    const accountClause = accountId ? ` and o.account_id=$3` : '';
    if (accountId) params.push(accountId);
    const result = await this.pool.query(`select o.*, coalesce(nullif(btrim(o.buyer_nickname), ''), nullif(btrim(buyer_identity.buyer_display_name), '')) as display_buyer_nickname, coalesce(nullif(btrim(o.buyer_avatar_url), ''), nullif(btrim(buyer_identity.buyer_avatar_url), '')) as display_buyer_avatar_url, case when o.item_title is not null and btrim(o.item_title)<>'' and btrim(o.item_title)<>btrim(o.item_id) then o.item_title when product.title is not null and btrim(product.title)<>'' and btrim(product.title)<>btrim(o.item_id) then product.title when item_identity.item_title is not null and btrim(item_identity.item_title)<>'' and btrim(item_identity.item_title)<>btrim(o.item_id) and (item_identity.item_ref is null or btrim(item_identity.item_title)<>btrim(item_identity.item_ref)) then item_identity.item_title when buyer_item_identity.item_title is not null and btrim(buyer_item_identity.item_title)<>'' and btrim(buyer_item_identity.item_title)<>btrim(o.item_id) and (buyer_item_identity.item_ref is null or btrim(buyer_item_identity.item_title)<>btrim(buyer_item_identity.item_ref)) then buyer_item_identity.item_title else null end as display_item_title, coalesce(nullif(btrim(item_identity.item_image_url), ''), nullif(btrim(buyer_item_identity.item_image_url), ''), nullif(product.attributes_json #>> '{xianyu,imageUrls,0}', ''), nullif(product.attributes_json #>> '{imageUrls,0}', '')) as display_item_image_url from orders.orders o left join lateral (select p.title, p.attributes_json from products.products p where p.account_id=o.account_id and (p.id::text=o.product_id or p.external_product_ref=o.item_id) order by (p.id::text=o.product_id) desc limit 1) product on true left join lateral (select c.buyer_display_name, c.buyer_avatar_url from messages.conversations c where c.account_id=o.account_id and ((o.conversation_id is not null and c.id::text=o.conversation_id) or c.buyer_ref=o.buyer_id) order by (c.id::text=o.conversation_id) desc, c.updated_at desc nulls last limit 1) buyer_identity on true left join lateral (select c.item_ref, c.item_title, c.item_image_url from messages.conversations c where c.account_id=o.account_id and ((o.conversation_id is not null and c.id::text=o.conversation_id) or c.item_ref=o.item_id) order by (c.item_title is not null and btrim(c.item_title)<>'') desc, (c.id::text=o.conversation_id) desc, (c.item_ref=o.item_id) desc, c.updated_at desc nulls last limit 1) item_identity on true left join lateral (select c.item_ref, c.item_title, c.item_image_url from messages.conversations c where c.account_id=o.account_id and c.buyer_ref=o.buyer_id order by (c.item_title is not null and btrim(c.item_title)<>'') desc, c.updated_at desc nulls last limit 1) buyer_item_identity on true where o.order_no=$1${accountClause} and exists (select 1 from auth.account_scopes scope where scope.account_id=o.account_id and scope.admin_id=$2 and scope.status='active' and (scope.expires_at is null or scope.expires_at>now())) limit 1`, params);
    return result.rows[0] ? this.toOrder(result.rows[0]) : undefined;
  }
  async getAutomationExecution(executionKey: string): Promise<AutomationExecutionLedgerRecord | undefined> {
    const result = await this.pool.query('select * from automation.execution_ledger where execution_key=$1 limit 1', [executionKey]);
    return result.rows[0] ? this.toAutomationExecution(result.rows[0]) : undefined;
  }
  async claimAutomationExecution(input: { executionKey: string; fingerprint: string; ownerToken: string; leaseUntil: string; allowManualReviewRecovery?: boolean }): Promise<{ claimed: boolean; record: AutomationExecutionLedgerRecord }> {
    const inserted = await this.pool.query(`insert into automation.execution_ledger (execution_key,fingerprint,status,owner_token,lease_until,attempt_count)
      values ($1,$2,'running',$3,$4,1) on conflict (execution_key) do nothing returning *`, [input.executionKey, input.fingerprint, input.ownerToken, input.leaseUntil]);
    if (inserted.rows[0]) return { claimed: true, record: this.toAutomationExecution(inserted.rows[0]) };
    const existing = await this.pool.query('select * from automation.execution_ledger where execution_key=$1 limit 1', [input.executionKey]);
    if (!existing.rows[0]) throw new Error('AUTOMATION_EXECUTION_CLAIM_LOST');
    const current = this.toAutomationExecution(existing.rows[0]);
    const allowManualReviewRecovery = input.allowManualReviewRecovery === true;
    const recoverManualReview = allowManualReviewRecovery && current.status === 'completed' && (current.result as { status?: unknown } | undefined)?.status === 'manual_review';
    if (current.fingerprint !== input.fingerprint && !(current.status === 'completed' && current.retryable) && !recoverManualReview) throw new Error('AUTOMATION_EXECUTION_FINGERPRINT_CONFLICT');
    const takeover = await this.pool.query(`update automation.execution_ledger
      set status='running', fingerprint=$2, result_json=null, retryable=false, owner_token=$3, lease_until=$4, attempt_count=attempt_count+1, updated_at=now()
      where execution_key=$1 and ((status='completed' and retryable=true) or (status='completed' and $5=true and result_json->>'status'='manual_review') or (status='running' and fingerprint=$2 and lease_until < now())) returning *`, [input.executionKey, input.fingerprint, input.ownerToken, input.leaseUntil, allowManualReviewRecovery]);
    if (takeover.rows[0]) return { claimed: true, record: this.toAutomationExecution(takeover.rows[0]) };
    const latest = await this.pool.query('select * from automation.execution_ledger where execution_key=$1 limit 1', [input.executionKey]);
    return { claimed: false, record: this.toAutomationExecution(latest.rows[0]) };
  }
  async completeAutomationExecution(input: { executionKey: string; ownerToken: string; result: unknown; retryable: boolean }): Promise<void> {
    const result = await this.pool.query(`update automation.execution_ledger
      set status='completed', result_json=$3::jsonb, retryable=$4, lease_until=null, updated_at=now()
      where execution_key=$1 and owner_token=$2`, [input.executionKey, input.ownerToken, JSON.stringify(input.result), input.retryable]);
    if ((result.rowCount ?? 0) !== 1) throw new Error('AUTOMATION_EXECUTION_OWNER_CONFLICT');
  }
  async cleanupExpiredCouponReservations(): Promise<number> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const count = await this.expireCouponReservations(client);
      await client.query('commit');
      return count;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }
  async recordReviewFact(input: { accountId: string; orderNo: string; eventId: string; reviewedAt?: string }): Promise<{ created: boolean }> {
    const reviewedAt = input.reviewedAt ?? new Date().toISOString();
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const inserted = await client.query(`insert into automation.review_facts (account_id,order_no,event_id,reviewed_at)
        values ($1,$2,$3,$4) on conflict (account_id,order_no) do nothing returning event_id`, [input.accountId, input.orderNo, input.eventId, reviewedAt]);
      if (inserted.rows[0]) await client.query(`update orders.orders set reviewed_at=$3, updated_at=$3, config_version=config_version+1 where account_id=$1 and order_no=$2`, [input.accountId, input.orderNo, reviewedAt]);
      await client.query('commit');
      return { created: Boolean(inserted.rows[0]) };
    } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
  }
  async recordReviewReminderSent(input: { accountId: string; orderNo: string; sentAt: string; expectedReminderCount?: number }): Promise<OrderRecord | undefined> {
    const values: unknown[] = [input.accountId, input.orderNo, input.sentAt];
    const expectedClause = input.expectedReminderCount === undefined ? '' : ` and review_reminder_count=$${values.push(input.expectedReminderCount)}`;
    const result = await this.pool.query(`update orders.orders set review_reminder_count=review_reminder_count+1, last_review_reminder_at=$3, updated_at=$3, config_version=config_version+1 where account_id=$1 and order_no=$2${expectedClause} returning *`, values);
    if (result.rows[0]) return this.toOrder(result.rows[0]);
    const current = await this.pool.query('select * from orders.orders where account_id=$1 and order_no=$2', [input.accountId, input.orderNo]);
    return current.rows[0] ? this.toOrder(current.rows[0]) : undefined;
  }
  async markOrderDelivered(input: { adminId: string; accountId: string; orderNo: string }): Promise<OrderRecord | undefined> {
    if (!(await this.hasAccountScope(input.adminId, input.accountId))) throw new Error('ACCOUNT_SCOPE_FORBIDDEN');
    const result = await this.pool.query(`update orders.orders
      set delivery_status='delivered', delivery_fail_reason=null, updated_at=now(), config_version=config_version+1
      where account_id=$1 and order_no=$2
      returning *`, [input.accountId, input.orderNo]);
    if (!result.rows[0]) return undefined;
    return this.toOrder(result.rows[0]);
  }
  async updateOrderDelivery(input: { adminId: string; accountId: string; orderNo: string; deliveryStatus: OrderRecord['deliveryStatus']; deliveryFailReason?: string; deliveryType?: OrderRecord['deliveryType'] }): Promise<OrderRecord | undefined> {
    if (!(await this.hasAccountScope(input.adminId, input.accountId))) throw new Error('ACCOUNT_SCOPE_FORBIDDEN');
    const result = await this.pool.query(`update orders.orders
      set delivery_status=$3, delivery_fail_reason=$4, delivery_type=coalesce($5,delivery_type), updated_at=now(), config_version=config_version+1
      where account_id=$1 and order_no=$2
      returning *`, [input.accountId, input.orderNo, input.deliveryStatus, input.deliveryFailReason ?? null, input.deliveryType ?? null]);
    return result.rows[0] ? this.toOrder(result.rows[0]) : undefined;
  }
  async listDeliveryRecords(adminId: string, input: { accountId: string; orderNo: string }): Promise<DeliveryRecord[]> {
    if (!(await this.hasAccountScope(adminId, input.accountId))) throw new Error('ACCOUNT_SCOPE_FORBIDDEN');
    const result = await this.pool.query(`select * from orders.delivery_records where account_id=$1 and order_no=$2 order by attempt desc, created_at desc`, [input.accountId, input.orderNo]);
    return result.rows.map((row) => this.toDeliveryRecord(row));
  }
  async getDeliveryRecordByIdempotency(adminId: string, input: { accountId: string; idempotencyKey: string }): Promise<DeliveryRecord | undefined> {
    if (!(await this.hasAccountScope(adminId, input.accountId))) throw new Error('ACCOUNT_SCOPE_FORBIDDEN');
    const scope = `order-delivery:${adminId}:${input.accountId}`;
    const result = await this.pool.query('select * from orders.delivery_records where account_id=$1 and idempotency_scope=$2 and idempotency_key=$3 limit 1', [input.accountId, scope, input.idempotencyKey]);
    return result.rows[0] ? this.toDeliveryRecord(result.rows[0]) : undefined;
  }
  async createDeliveryRecord(input: { adminId: string; orderId: string; orderNo: string; accountId: string; deliveryType: OrderRecord['deliveryType']; idempotencyScope: string; idempotencyKey: string; attempt: number; trackingRef?: string }): Promise<DeliveryRecord> {
    if (!(await this.hasAccountScope(input.adminId, input.accountId))) throw new Error('ACCOUNT_SCOPE_FORBIDDEN');
    const existing = await this.pool.query(`select * from orders.delivery_records where idempotency_scope=$1 and idempotency_key=$2 limit 1`, [input.idempotencyScope, input.idempotencyKey]);
    if (existing.rows[0]) return this.toDeliveryRecord(existing.rows[0]);
    const inserted = await this.pool.query(`insert into orders.delivery_records (id,order_id,order_no,account_id,delivery_type,status,idempotency_scope,idempotency_key,attempt,tracking_ref)
      values ($1,$2,$3,$4,$5,'pending',$6,$7,$8,$9)
      on conflict (idempotency_scope,idempotency_key) do nothing
      returning *`, [createId(), input.orderId, input.orderNo, input.accountId, input.deliveryType, input.idempotencyScope, input.idempotencyKey, input.attempt, input.trackingRef ?? null]);
    if (inserted.rows[0]) return this.toDeliveryRecord(inserted.rows[0]);
    const readback = await this.pool.query(`select * from orders.delivery_records where idempotency_scope=$1 and idempotency_key=$2 limit 1`, [input.idempotencyScope, input.idempotencyKey]);
    if (!readback.rows[0]) throw new Error('DELIVERY_RECORD_READBACK_FAILED');
    return this.toDeliveryRecord(readback.rows[0]);
  }
  async updateDeliveryRecord(input: { adminId: string; id: string; status: DeliveryRecordStatus; externalOutcome?: 'known_success' | 'known_failure' | 'unknown'; externalRef?: string; couponItemId?: string; trackingRef?: string; deliveredAt?: string; failureCode?: string; failureMessage?: string }): Promise<DeliveryRecord | undefined> {
    const current = await this.pool.query('select account_id from orders.delivery_records where id=$1', [input.id]);
    if (!current.rows[0]) return undefined;
    const accountId = String(current.rows[0].account_id);
    if (!(await this.hasAccountScope(input.adminId, accountId))) throw new Error('ACCOUNT_SCOPE_FORBIDDEN');
    const result = await this.pool.query(`update orders.delivery_records set status=$2, external_outcome=coalesce($3,external_outcome), external_ref=coalesce($4,external_ref), coupon_item_id=coalesce($5,coupon_item_id), tracking_ref=coalesce($6,tracking_ref), delivered_at=coalesce($7,delivered_at), failure_code=coalesce($8,failure_code), failure_message=coalesce($9,failure_message), updated_at=now() where id=$1 returning *`, [input.id, input.status, input.externalOutcome ?? null, input.externalRef ?? null, input.couponItemId ?? null, input.trackingRef ?? null, input.deliveredAt ?? null, input.failureCode ?? null, input.failureMessage ?? null]);
    return result.rows[0] ? this.toDeliveryRecord(result.rows[0]) : undefined;
  }
  async createOrder(input: { adminId: string; order: Omit<OrderRecord, 'id' | 'createdAt' | 'updatedAt' | 'configVersion' | 'source'> & { id?: string; createdAt?: string; updatedAt?: string; configVersion?: number; source?: OrderSource } }): Promise<OrderRecord> {
    if (!(await this.hasAccountScope(input.adminId, input.order.accountId))) throw new Error('ACCOUNT_SCOPE_FORBIDDEN');
    const order = input.order;
    const id = order.id ?? createId();
    try {
      await this.pool.query(`insert into orders.orders (id,order_no,account_id,account_name,buyer_id,buyer_name,buyer_nickname,buyer_avatar_url,item_id,item_title,amount_minor,payment_status,order_status,delivery_status,after_sales_status,delivery_type,created_at,updated_at,delivery_fail_reason,conversation_id,product_id,config_version,source,source_payload_digest,reviewed_at,review_reminder_count,last_review_reminder_at,sku_spec)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,coalesce($17,now()),coalesce($18,now()),$19,$20,$21,coalesce($22,1),coalesce($23,'local'),$24,$25,coalesce($26,0),$27,$28)`, [id, order.orderNo, order.accountId, order.accountName ?? null, order.buyerId, order.buyerName, order.buyerNickname ?? null, order.buyerAvatarUrl ?? null, order.itemId, order.itemTitle, order.amountMinor, order.paymentStatus, order.orderStatus, order.deliveryStatus, order.afterSalesStatus, order.deliveryType, order.createdAt ?? null, order.updatedAt ?? null, order.deliveryFailReason ?? null, order.conversationId ?? null, order.productId ?? null, order.configVersion ?? 1, order.source ?? 'local', order.sourcePayloadDigest ?? null, order.reviewedAt ?? null, order.reminderCount ?? 0, order.lastReminderAt ?? null, order.skuSpec ?? null]);
    } catch (error) { if ((error as { code?: string }).code === '23505') throw new Error('ORDER_DUPLICATE'); throw error; }
    const created = await this.getOrder(input.adminId, order.orderNo, order.accountId);
    if (!created) throw new Error('ORDER_CREATE_READBACK_FAILED');
    return created;
  }
  async upsertExternalOrder(input: { adminId: string; accountId: string; item: XianyuOrderItem; syncedAt: string; accountName?: string }): Promise<OrderUpsertResult> {
    if (!(await this.hasAccountScope(input.adminId, input.accountId))) throw new Error('ACCOUNT_SCOPE_FORBIDDEN');
    const linkedProduct = await this.pool.query('select id from products.products where account_id=$1 and (id::text=$2 or external_product_ref=$3) order by (id::text=$2) desc limit 1', [input.accountId, input.item.productId ?? '', input.item.itemId]);
    const linkedProductId = input.item.productId ?? (linkedProduct.rows[0]?.id ? String(linkedProduct.rows[0].id) : undefined);
    const existingOrder = await this.pool.query('select conversation_id from orders.orders where account_id=$1 and order_no=$2 limit 1', [input.accountId, input.item.orderNo]);
    const existingConversationId = existingOrder.rows[0]?.conversation_id ? String(existingOrder.rows[0].conversation_id) : undefined;
    const matchedConversation = await this.pool.query('select id from messages.conversations where account_id=$1 and buyer_ref=$2 and item_ref=$3 order by updated_at desc nulls last, id desc limit 1', [input.accountId, input.item.buyerId, input.item.itemId]);
    const matchedConversationId = matchedConversation.rows[0]?.id ? String(matchedConversation.rows[0].id) : undefined;
    const conversationId = input.item.conversationId ?? existingConversationId ?? matchedConversationId;
    const id = createId();
    const result = await this.pool.query(`insert into orders.orders (id,order_no,account_id,account_name,buyer_id,buyer_name,buyer_nickname,buyer_avatar_url,item_id,item_title,amount_minor,payment_status,order_status,delivery_status,after_sales_status,delivery_type,created_at,updated_at,delivery_fail_reason,conversation_id,product_id,config_version,source,source_payload_digest,sku_spec,reviewed_at)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,1,'xianyu',$22,$23,$24)
      on conflict (account_id,order_no) do update set account_name=coalesce(excluded.account_name,orders.orders.account_name),buyer_id=excluded.buyer_id,buyer_name=excluded.buyer_name,buyer_nickname=excluded.buyer_nickname,buyer_avatar_url=excluded.buyer_avatar_url,item_id=excluded.item_id,item_title=excluded.item_title,amount_minor=excluded.amount_minor,payment_status=excluded.payment_status,order_status=excluded.order_status,delivery_status=excluded.delivery_status,after_sales_status=excluded.after_sales_status,delivery_type=excluded.delivery_type,created_at=excluded.created_at,updated_at=$18,delivery_fail_reason=excluded.delivery_fail_reason,conversation_id=coalesce(excluded.conversation_id,orders.orders.conversation_id),product_id=excluded.product_id,config_version=orders.orders.config_version+1,source='xianyu',source_payload_digest=excluded.source_payload_digest,sku_spec=excluded.sku_spec,reviewed_at=coalesce(excluded.reviewed_at,orders.orders.reviewed_at)
      returning *, (xmax = 0) as inserted`, [id, input.item.orderNo, input.accountId, input.accountName ?? null, input.item.buyerId, input.item.buyerName, input.item.buyerNickname ?? null, input.item.buyerAvatarUrl ?? null, input.item.itemId, input.item.itemTitle, input.item.amountMinor, input.item.paymentStatus, input.item.orderStatus, input.item.deliveryStatus, input.item.afterSalesStatus, input.item.deliveryType, input.item.createdAt, input.syncedAt, input.item.deliveryFailReason ?? null, conversationId ?? null, linkedProductId ?? null, input.item.sourcePayloadDigest, input.item.skuSpec ?? null, input.item.reviewedAt ?? null]);
    const row = result.rows[0];
    const enriched = await this.getOrder(input.adminId, input.item.orderNo, input.accountId);
    return { action: row.inserted ? 'created' : 'updated', order: enriched ?? this.toOrder(row) };
  }
  async deleteExternalOrdersNotInSnapshot(input: { adminId: string; accountId: string; orderNos: readonly string[] }): Promise<number> {
    if (!(await this.hasAccountScope(input.adminId, input.accountId))) throw new Error('ACCOUNT_SCOPE_FORBIDDEN');
    const keepOrderNos = [...new Set(input.orderNos.map((orderNo) => orderNo.trim()).filter(Boolean))];
    const result = await this.pool.query(
      'delete from orders.orders where account_id=$1 and source=\'xianyu\' and order_no <> all($2::text[])',
      [input.accountId, keepOrderNos],
    );
    return result.rowCount ?? 0;
  }
  async createProduct(input: { adminId: string; accountId: string; externalProductRef?: string; title: string; description?: string; categoryCode?: string; attributes?: Record<string, unknown>; defaultReplyTemplate?: string; knowledgeBase?: string; priceMinor?: number; status?: ProductStatus }): Promise<ProductRecord> {
    if (!(await this.hasAccountScope(input.adminId, input.accountId))) throw new Error('ACCOUNT_SCOPE_FORBIDDEN');
    const id = createId();
    await this.pool.query('insert into products.products (id,account_id,external_product_ref,title,description,category_code,attributes_json,default_reply_template,knowledge_base,price_minor,status,source) values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,\'local\')', [id, input.accountId, input.externalProductRef ?? null, input.title, input.description ?? null, input.categoryCode ?? null, JSON.stringify(input.attributes ?? {}), input.defaultReplyTemplate ?? null, input.knowledgeBase ?? null, input.priceMinor ?? null, input.status ?? 'draft']);
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
    if (input.patch.knowledgeBase !== undefined) add('knowledge_base', input.patch.knowledgeBase);
    if (input.patch.priceMinor !== undefined) add('price_minor', input.patch.priceMinor);
    if (fields.length === 0) throw new Error('PRODUCT_PATCH_EMPTY');
    fields.push('config_version=config_version+1', 'updated_at=now()');
    const result = await this.pool.query(`update products.products set ${fields.join(', ')} where id=$1 and config_version=$2 returning *`, values);
    if (!result.rows[0]) throw new Error('PRODUCT_VERSION_CONFLICT');
    return this.getProduct(input.adminId, input.productId);
  }

  async upsertExternalProduct(input: { adminId: string; accountId: string; item: XianyuProductItem; syncedAt: string }): Promise<ProductUpsertResult> {
    if (!(await this.hasAccountScope(input.adminId, input.accountId))) throw new Error('ACCOUNT_SCOPE_FORBIDDEN');
    const knownRefs = [...new Set([input.item.externalProductRef, ...(input.item.externalProductRefs ?? [])]
      .map((value) => String(value ?? '').trim()).filter(Boolean))];
    const client = await this.pool.connect();
    let productId: string | undefined;
    let action: ProductUpsertResult['action'] = 'created';
    try {
      await client.query('begin');
      const existingResult = await client.query(`select id,source,status,attributes_json,external_product_ref
        from products.products
        where account_id=$1 and external_product_ref = any($2::text[])
        order by (external_product_ref=$3) desc, updated_at desc, id
        limit 1 for update`, [input.accountId, knownRefs, input.item.externalProductRef]);
      const existing = existingResult.rows[0] as Row | undefined;
      if (existing && String(existing.source ?? 'local') === 'local' && String(existing.status) === 'draft') {
        productId = String(existing.id);
        await client.query('rollback');
        const product = await this.getProduct(input.adminId, productId);
        if (!product) throw new Error('PRODUCT_SYNC_READBACK_FAILED');
        return { action: 'skipped_local_draft', product };
      }
      const existingAttributes = existing?.attributes_json && typeof existing.attributes_json === 'object' && !Array.isArray(existing.attributes_json) ? existing.attributes_json as Record<string, unknown> : {};
      const existingXianyu = existingAttributes.xianyu && typeof existingAttributes.xianyu === 'object' && !Array.isArray(existingAttributes.xianyu) ? existingAttributes.xianyu as Record<string, unknown> : {};
      const previousRefs = Array.isArray(existingXianyu.externalProductRefs) ? existingXianyu.externalProductRefs.map((value) => String(value).trim()) : [];
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
          externalProductRefs: [...new Set([...previousRefs, ...knownRefs].filter(Boolean))],
          ...(input.item.xianyuUpdatedAt ? { updatedAt: input.item.xianyuUpdatedAt } : {}),
          ...(existingXianyu.detail !== undefined ? { detail: existingXianyu.detail } : incomingXianyu.detail !== undefined ? { detail: incomingXianyu.detail } : {}),
        },
      };
      productId = existing ? String(existing.id) : createId();
      action = existing ? 'updated' : 'created';
      if (existing) {
        await client.query(`update products.products set
            external_product_ref=$2,
            title=$3,
            description=coalesce(nullif(btrim($4), ''), nullif(btrim(description), ''), nullif(btrim($5::jsonb #>> '{xianyu,detail,summary,description}'), '')),
            category_code=$6,
            attributes_json=$5::jsonb,
            price_minor=$7,
            status='published',
            source='xianyu',
            last_synced_at=$8,
            xianyu_updated_at=coalesce($9, xianyu_updated_at),
            xianyu_list_rank=coalesce($10, xianyu_list_rank),
            source_payload_digest=$11,
            config_version=config_version+1,
            updated_at=now()
          where id=$1`, [productId, input.item.externalProductRef, input.item.title, input.item.description ?? null, JSON.stringify(attributes), input.item.categoryCode ?? null, input.item.priceMinor ?? null, input.syncedAt, input.item.xianyuUpdatedAt ?? null, input.item.xianyuListRank ?? null, input.item.sourcePayloadDigest]);
      } else {
        const inserted = await client.query(`insert into products.products (id,account_id,external_product_ref,title,description,category_code,attributes_json,price_minor,status,source,last_synced_at,xianyu_updated_at,xianyu_list_rank,source_payload_digest)
          values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,'published','xianyu',$9,$10,$11,$12)
          on conflict (account_id,external_product_ref) where external_product_ref is not null do update set title=excluded.title,description=coalesce(nullif(btrim(excluded.description), ''), nullif(btrim(products.products.description), ''), nullif(btrim(excluded.attributes_json #>> '{xianyu,detail,summary,description}'), '')),category_code=excluded.category_code,attributes_json=excluded.attributes_json,price_minor=excluded.price_minor,status='published',source='xianyu',last_synced_at=excluded.last_synced_at,xianyu_updated_at=coalesce(excluded.xianyu_updated_at,products.products.xianyu_updated_at),xianyu_list_rank=coalesce(excluded.xianyu_list_rank,products.products.xianyu_list_rank),source_payload_digest=excluded.source_payload_digest,config_version=products.products.config_version+1,updated_at=now()
          returning id, (xmax = 0) as inserted`, [productId, input.accountId, input.item.externalProductRef, input.item.title, input.item.description ?? null, input.item.categoryCode ?? null, JSON.stringify(attributes), input.item.priceMinor ?? null, input.syncedAt, input.item.xianyuUpdatedAt ?? null, input.item.xianyuListRank ?? null, input.item.sourcePayloadDigest]);
        productId = String(inserted.rows[0]?.id ?? productId);
        action = inserted.rows[0]?.inserted ? 'created' : 'updated';
      }
      await client.query('commit');
    } catch (error) {
      try { await client.query('rollback'); } catch { /* preserve original error */ }
      throw error;
    } finally { client.release(); }
    const product = await this.getProduct(input.adminId, productId!);
    if (!product) throw new Error('PRODUCT_SYNC_READBACK_FAILED');
    return { action, product };
  }
  async resetXianyuListRanks(adminId: string, accountId: string): Promise<void> {
    if (!(await this.hasAccountScope(adminId, accountId))) throw new Error('ACCOUNT_SCOPE_FORBIDDEN');
    await this.pool.query("update products.products set xianyu_list_rank=null where account_id=$1 and source='xianyu'", [accountId]);
  }
  async listCouponBatches(adminId: string, query: CouponBatchListQuery): Promise<CouponBatchListResult> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const params: unknown[] = [adminId];
    const conditions = ["EXISTS (SELECT 1 FROM auth.account_scopes scope WHERE scope.account_id=b.account_id AND scope.admin_id=$1 AND scope.status='active' AND (scope.expires_at IS NULL OR scope.expires_at>now()))"];
    if (query.accountId) { params.push(query.accountId); conditions.push(`b.account_id=$${params.length}`); }
    if (query.status) { params.push(query.status); conditions.push(`b.status=$${params.length}`); }
    else conditions.push("b.status <> 'voided'");
    if (query.status === 'voided') conditions.push("not exists (select 1 from coupons.coupon_batches active_batch where active_batch.sequence_id=b.sequence_id and active_batch.status <> 'voided')");
    if (query.purpose) { params.push(query.purpose); conditions.push(`b.purpose=$${params.length}`); }
    if (query.keyword) { params.push(`%${query.keyword.trim().toLowerCase()}%`); conditions.push(`(lower(b.sequence_id::text) like $${params.length} or lower(b.id::text) like $${params.length} or lower(coalesce(b.label,'')) like $${params.length} or lower(b.purpose) like $${params.length})`); }
    const where = conditions.join(' AND ');
    const sortDirection = query.sortOrder === 'asc' ? 'ASC' : 'DESC';
    const count = await this.pool.query(`select count(*)::int as count from coupons.coupon_batches b where ${where}`, params);
    const total = Number(count.rows[0]?.count ?? 0);
    const limitIndex = params.length + 1;
    const offsetIndex = params.length + 2;
    const rows = await this.pool.query(`select b.*, count(i.id)::int as computed_total_count, count(i.id) filter (where i.status='available')::int as computed_available_count, count(i.id) filter (where i.status='reserved')::int as computed_reserved_count, count(i.id) filter (where i.status='consumed')::int as computed_consumed_count, (select coalesce(json_agg(json_build_object('id', ar.id, 'batch_id', ar.coupon_batch_id, 'storage_key', ar.storage_key, 'mime_type', ar.mime_type, 'checksum', ar.checksum, 'caption', ar.caption, 'status', ar.status, 'created_at', ar.created_at, 'updated_at', ar.updated_at) order by ar.created_at, ar.id) filter (where ar.status='active'), '[]'::json) from coupons.coupon_asset_refs ar where ar.coupon_batch_id=b.id) as coupon_assets from coupons.coupon_batches b left join coupons.coupon_items i on i.batch_id=b.id where ${where} group by b.id order by b.created_at ${sortDirection}, b.id ${sortDirection} limit $${limitIndex} offset $${offsetIndex}`, [...params, pageSize, (page - 1) * pageSize]);
    return { items: rows.rows.map((row) => this.toCouponBatch(row)), page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
  }
  async getCouponBatch(adminId: string, batchId: string): Promise<CouponBatchRecord | undefined> {
    const result = await this.pool.query("select b.* from coupons.coupon_batches b where (b.id::text=$1 or b.sequence_id::text=$1) and exists (select 1 from auth.account_scopes scope where scope.account_id=b.account_id and scope.admin_id=$2 and scope.status='active' and (scope.expires_at is null or scope.expires_at>now())) order by (b.status='voided') asc, b.created_at desc, b.id desc limit 1", [batchId, adminId]);
    if (!result.rows[0]) return undefined;
    const batchIdInternal = String(result.rows[0].id);
    const [items, bindings, assets] = await Promise.all([
      this.pool.query('select * from coupons.coupon_items where batch_id=$1 order by created_at,id', [batchIdInternal]),
      this.pool.query('select * from coupons.coupon_bindings where coupon_batch_id=$1 order by priority desc, created_at,id', [batchIdInternal]),
      this.pool.query('select * from coupons.coupon_asset_refs where coupon_batch_id=$1 and status=\'active\' order by created_at,id', [batchIdInternal]),
    ]);
    const batch = this.toCouponBatch(result.rows[0]);
    batch.items = items.rows.map((row) => this.toCouponItem(row));
    batch.bindings = bindings.rows.map((row) => this.toCouponBinding(row));
    batch.assets = assets.rows.map((row) => this.toCouponAsset(row));
    return batch;
  }
  async getCouponAsset(adminId: string, batchId: string, assetId: string): Promise<CouponAssetRecord | undefined> {
    const result = await this.pool.query("select ar.* from coupons.coupon_asset_refs ar join coupons.coupon_batches b on b.id=ar.coupon_batch_id where ar.id=$1 and (b.id::text=$2 or b.sequence_id::text=$2) and ar.status='active' and exists (select 1 from auth.account_scopes scope where scope.account_id=b.account_id and scope.admin_id=$3 and scope.status='active' and (scope.expires_at is null or scope.expires_at>now()))", [assetId, batchId, adminId]);
    return result.rows[0] ? this.toCouponAsset(result.rows[0]) : undefined;
  }
  async replaceCouponAssets(input: { adminId: string; batchId: string; assets: Array<{ id: string; storageKey: string; mimeType: string; checksum?: string; caption?: string }> }): Promise<CouponAssetRecord[]> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const batchResult = await client.query("select b.* from coupons.coupon_batches b where (b.id::text=$1 or b.sequence_id::text=$1) and exists (select 1 from auth.account_scopes scope where scope.account_id=b.account_id and scope.admin_id=$2 and scope.status='active' and (scope.expires_at is null or scope.expires_at>now())) for update", [input.batchId, input.adminId]);
      if (!batchResult.rows[0]) throw new Error('COUPON_NOT_FOUND');
      const batchIdInternal = String(batchResult.rows[0].id);
      const ids = input.assets.map((asset) => asset.id);
      if (ids.length > 0) await client.query('update coupons.coupon_asset_refs set status=\'archived\',updated_at=now() where coupon_batch_id=$1 and status=\'active\' and not (id=any($2::uuid[]))', [batchIdInternal, ids]);
      else await client.query("update coupons.coupon_asset_refs set status='archived',updated_at=now() where coupon_batch_id=$1 and status='active'", [batchIdInternal]);
      for (const asset of input.assets) {
        await client.query("insert into coupons.coupon_asset_refs (id,coupon_batch_id,storage_key,mime_type,checksum,caption,status) values ($1,$2,$3,$4,$5,$6,'active') on conflict (id) do update set coupon_batch_id=excluded.coupon_batch_id,storage_key=excluded.storage_key,mime_type=excluded.mime_type,checksum=excluded.checksum,caption=excluded.caption,status='active',updated_at=now()", [asset.id, batchIdInternal, asset.storageKey, asset.mimeType, asset.checksum ?? null, asset.caption ?? null]);
      }
      await client.query('update coupons.coupon_batches set version=version+1,updated_at=now() where id=$1', [batchIdInternal]);
      const rows = await client.query("select * from coupons.coupon_asset_refs where coupon_batch_id=$1 and status='active' order by created_at,id", [batchIdInternal]);
      await client.query('commit');
      return rows.rows.map((row) => this.toCouponAsset(row));
    } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
  }
  async createCouponBatch(input: { adminId: string; accountId: string; label?: string; purpose: string; metadata?: CouponBatchMetadata }): Promise<CouponBatchRecord> {
    if (!(await this.hasAccountScope(input.adminId, input.accountId))) throw new Error('ACCOUNT_SCOPE_FORBIDDEN');
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query("select pg_advisory_xact_lock(hashtext('coupons.coupon_batch_sequence'))");
      const sequenceResult = await client.query(`select coalesce(min(candidate), 1)::bigint as sequence_id
        from generate_series(1, coalesce((select max(sequence_id) from coupons.coupon_batches where status <> 'voided'), 0) + 1) candidate
        where not exists (select 1 from coupons.coupon_batches b where b.sequence_id=candidate and b.status <> 'voided')`);
      const sequenceId = String(sequenceResult.rows[0]?.sequence_id ?? '1');
      const result = await client.query('insert into coupons.coupon_batches (id,sequence_id,account_id,label,purpose,total_count,status,version,metadata_json) values ($1,$2,$3,$4,$5,$6,\'active\',1,$7::jsonb) returning *', [createId(), sequenceId, input.accountId, input.label ?? null, input.purpose, 0, JSON.stringify(input.metadata ?? {})]);
      await client.query('commit');
      return this.toCouponBatch(result.rows[0]);
    } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
  }
  async updateCouponBatch(input: { adminId: string; batchId: string; patch: { label?: string; purpose?: string; status?: CouponBatchStatus; metadata?: CouponBatchMetadata } }): Promise<CouponBatchRecord | undefined> {
    const current = await this.getCouponBatch(input.adminId, input.batchId);
    if (!current) return undefined;
    if (current.status === 'voided') throw new Error('COUPON_BATCH_VOIDED');
    const nextMetadata = input.patch.metadata ?? current.metadata ?? {};
    const result = await this.pool.query('update coupons.coupon_batches set label=$2,purpose=$3,status=$4,metadata_json=$5::jsonb,version=version+1,updated_at=now() where id=$1 returning *', [current.id, input.patch.label ?? current.label ?? null, input.patch.purpose ?? current.purpose, input.patch.status ?? current.status, JSON.stringify(nextMetadata)]);
    return result.rows[0] ? this.toCouponBatch(result.rows[0]) : current;
  }
  async importCouponItems(input: { adminId: string; batchId: string; contents: string[] }): Promise<{ batch: CouponBatchRecord; items: CouponItemRecord[]; rejected: Array<{ index: number; code: string; message: string }> }> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const batchResult = await client.query("select b.* from coupons.coupon_batches b where (b.id::text=$1 or b.sequence_id::text=$1) and exists (select 1 from auth.account_scopes scope where scope.account_id=b.account_id and scope.admin_id=$2 and scope.status='active' and (scope.expires_at is null or scope.expires_at>now())) order by (b.status='voided') asc, b.created_at desc, b.id desc limit 1 for update", [input.batchId, input.adminId]);
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
      const updated = await client.query('update coupons.coupon_batches set total_count=$2,version=version+1,updated_at=now() where id=$1 returning *', [batch.id, count]);
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
    const result = await this.pool.query("select i.id as item_id, i.batch_id as item_batch_id, i.content_ciphertext, i.status as item_status, i.reserved_until, i.consumed_at, i.created_at as item_created_at, b.id as batch_id, b.sequence_id as batch_sequence_id, b.account_id, b.label, b.purpose, b.total_count, b.status as batch_status, b.version, b.created_at as batch_created_at, b.updated_at as batch_updated_at from coupons.coupon_items i join coupons.coupon_batches b on b.id=i.batch_id where i.id=$1 and exists (select 1 from auth.account_scopes scope where scope.account_id=b.account_id and scope.admin_id=$2 and scope.status='active' and (scope.expires_at is null or scope.expires_at>now()))", [itemId, adminId]);
    if (!result.rows[0]) return undefined;
    const row = result.rows[0];
    const item = this.toCouponItem({ id: row.item_id, batch_id: row.item_batch_id, content_ciphertext: row.content_ciphertext, status: row.item_status, reserved_until: row.reserved_until, consumed_at: row.consumed_at, created_at: row.item_created_at });
    const batch = this.toCouponBatch({ id: row.batch_id, sequence_id: row.batch_sequence_id, account_id: row.account_id, label: row.label, purpose: row.purpose, total_count: row.total_count, status: row.batch_status, version: row.version, created_at: row.batch_created_at, updated_at: row.batch_updated_at });
    return { batch, item };
  }

  async reserveCoupon(input: { adminId: string; accountId: string; batchIds: string[]; quantity: number; executionKey: string; purpose: CouponReservationPurpose; leaseSeconds?: number }): Promise<CouponReservationRecord> {
    const normalized = normalizeCouponReservationInput(input);
    const leaseSeconds = normalizeLeaseSeconds(input.leaseSeconds);
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await this.expireCouponReservations(client);
      const batchRows = await client.query(`select b.* from coupons.coupon_batches b
        where (b.id::text = any($1::text[]) or b.sequence_id::text = any($1::text[]))
          and b.account_id=$2
          and exists (select 1 from auth.account_scopes scope where scope.account_id=b.account_id and scope.admin_id=$3 and scope.status='active' and (scope.expires_at is null or scope.expires_at>now()))
        order by (b.status='voided') asc, b.created_at desc, b.id desc`, [normalized.batchIds, input.accountId, input.adminId]);
      const byAlias = new Map<string, Row>();
      for (const row of batchRows.rows) { byAlias.set(String(row.id), row); if (row.sequence_id !== undefined && row.sequence_id !== null) byAlias.set(String(row.sequence_id), row); }
      const resolvedRows = normalized.batchIds.map((batchId) => byAlias.get(batchId));
      if (resolvedRows.some((row) => !row)) throw new Error('COUPON_BATCH_NOT_FOUND');
      const uniqueRows = [...new Map((resolvedRows as Row[]).map((row) => [String(row.id), row])).values()];
      const batchIds = uniqueRows.map((row) => String(row.id));
      const lockRows = await client.query('select * from coupons.coupon_batches where id=any($1::uuid[]) order by id for update', [batchIds]);
      if (lockRows.rowCount !== batchIds.length) throw new Error('COUPON_BATCH_NOT_FOUND');
      if (lockRows.rows.some((row) => row.status !== 'active')) throw new Error('COUPON_BATCH_UNAVAILABLE');
      const fingerprint = reservationFingerprint({ adminId: input.adminId, accountId: input.accountId, batchIds, quantity: normalized.quantity, purpose: normalized.purpose });
      const existingResult = await client.query('select * from coupons.coupon_reservations where execution_key=$1 for update', [normalized.executionKey]);
      const existing = existingResult.rows[0];
      if (existing) {
        if (String(existing.admin_id) !== input.adminId || String(existing.account_id) !== input.accountId || String(existing.fingerprint) !== fingerprint) throw new Error('COUPON_RESERVATION_KEY_CONFLICT');
        if (existing.status === 'committed' || existing.status === 'reserved') {
          const record = await this.loadCouponReservation(client, existing);
          await client.query('commit');
          return record;
        }
      }
      await this.ensureConfiguredCouponItems(client, lockRows.rows, normalized.quantity);
      const candidates = await client.query(`select i.*, b.label as batch_label
        from coupons.coupon_items i join coupons.coupon_batches b on b.id=i.batch_id
        where i.batch_id=any($1::uuid[]) and i.status='available'
        order by array_position($1::uuid[], i.batch_id), i.created_at, i.id
        for update skip locked`, [batchIds]);
      if ((candidates.rowCount ?? 0) < normalized.quantity) throw new Error('COUPON_DELIVERY_ITEM_UNAVAILABLE');
      const candidateIds = candidates.rows.map((row) => String(row.id));
      const usageResult = await client.query(`select ri.item_id, count(*)::int as use_count
        from coupons.coupon_reservation_items ri
        join coupons.coupon_reservations r on r.id=ri.reservation_id
        where ri.item_id=any($1::uuid[]) and r.status='committed'
        group by ri.item_id`, [candidateIds]);
      const usageByItemId = new Map(usageResult.rows.map((row) => [String(row.item_id), Number(row.use_count ?? 0)]));
      const batchPurposeById = new Map(lockRows.rows.map((row) => [String(row.id), String(row.purpose)]));
      const selectedRows: Row[] = [];
      for (const batchId of batchIds) {
        const batchRows = candidates.rows.filter((row) => String(row.batch_id) === batchId).sort((left, right) => {
          if (batchPurposeById.get(batchId) === 'data') {
            const usageDelta = (usageByItemId.get(String(left.id)) ?? 0) - (usageByItemId.get(String(right.id)) ?? 0);
            if (usageDelta !== 0) return usageDelta;
          }
          const leftCreatedAt = left.created_at instanceof Date ? left.created_at.getTime() : Date.parse(String(left.created_at));
          const rightCreatedAt = right.created_at instanceof Date ? right.created_at.getTime() : Date.parse(String(right.created_at));
          return leftCreatedAt - rightCreatedAt || String(left.id).localeCompare(String(right.id));
        });
        if (batchRows.length < normalized.quantity) throw new Error('COUPON_DELIVERY_ITEM_UNAVAILABLE');
        selectedRows.push(...batchRows.slice(0, normalized.quantity));
      }
      const now = new Date();
      const nowIso = now.toISOString();
      const leaseUntil = new Date(now.getTime() + leaseSeconds * 1000).toISOString();
      const reservationId = existing ? String(existing.id) : createId();
      await client.query('update coupons.coupon_items set status=\'reserved\',reserved_until=$2 where id=any($1::uuid[])', [selectedRows.map((row) => String(row.id)), leaseUntil]);
      if (existing) {
        await client.query(`update coupons.coupon_reservations set admin_id=$2,account_id=$3,purpose=$4,batch_ids=$5::uuid[],fingerprint=$6,quantity=$7,status='reserved',lease_until=$8,reason=null,finalized_at=null,updated_at=now() where id=$1`, [reservationId, input.adminId, input.accountId, normalized.purpose, batchIds, fingerprint, normalized.quantity, leaseUntil]);
        await client.query('delete from coupons.coupon_reservation_items where reservation_id=$1', [reservationId]);
      } else {
        await client.query(`insert into coupons.coupon_reservations (id,admin_id,account_id,execution_key,purpose,batch_ids,fingerprint,quantity,status,lease_until) values ($1,$2,$3,$4,$5,$6::uuid[],$7,$8,'reserved',$9)`, [reservationId, input.adminId, input.accountId, normalized.executionKey, normalized.purpose, batchIds, fingerprint, normalized.quantity, leaseUntil]);
      }
      const itemIds = selectedRows.map((row) => String(row.id));
      const itemPlaceholders = itemIds.map((_, index) => `($1,$${index + 2})`).join(',');
      await client.query(`insert into coupons.coupon_reservation_items (reservation_id,item_id) values ${itemPlaceholders}`, [reservationId, ...itemIds]);
      const record = await this.loadCouponReservation(client, { id: reservationId, admin_id: input.adminId, account_id: input.accountId, execution_key: normalized.executionKey, purpose: normalized.purpose, batch_ids: batchIds, fingerprint, quantity: normalized.quantity, status: 'reserved', lease_until: leaseUntil, reason: null, created_at: existing?.created_at ?? nowIso, updated_at: nowIso, finalized_at: null });
      await client.query('commit');
      return record;
    } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
  }

  async getCouponReservation(input: { adminId: string; reservationId: string; executionKey?: string }): Promise<CouponReservationRecord | undefined> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await this.expireCouponReservations(client);
      const result = await client.query(`select r.* from coupons.coupon_reservations r
        where r.id=$1 and r.admin_id=$2 and exists (select 1 from auth.account_scopes scope where scope.account_id=r.account_id and scope.admin_id=$2 and scope.status='active' and (scope.expires_at is null or scope.expires_at>now())) for update`, [input.reservationId, input.adminId]);
      if (!result.rows[0]) { await client.query('commit'); return undefined; }
      if (input.executionKey !== undefined && String(result.rows[0].execution_key) !== input.executionKey) throw new Error('COUPON_RESERVATION_KEY_CONFLICT');
      const record = await this.loadCouponReservation(client, result.rows[0]);
      await client.query('commit');
      return record;
    } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
  }

  async commitCouponReservation(input: { adminId: string; reservationId: string; executionKey: string }): Promise<CouponReservationRecord> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await this.expireCouponReservations(client);
      const result = await client.query(`select r.* from coupons.coupon_reservations r
        where r.id=$1 and r.admin_id=$2 and exists (select 1 from auth.account_scopes scope where scope.account_id=r.account_id and scope.admin_id=$2 and scope.status='active' and (scope.expires_at is null or scope.expires_at>now())) for update`, [input.reservationId, input.adminId]);
      if (!result.rows[0]) throw new Error('COUPON_RESERVATION_NOT_FOUND');
      const row = result.rows[0];
      if (String(row.execution_key) !== input.executionKey) throw new Error('COUPON_RESERVATION_KEY_CONFLICT');
      if (row.status === 'committed') { const record = await this.loadCouponReservation(client, row); await client.query('commit'); return record; }
      if (row.status === 'expired') { await client.query('commit'); throw new Error('COUPON_RESERVATION_EXPIRED'); }
      if (row.status !== 'reserved') throw new Error('COUPON_RESERVATION_NOT_ACTIVE');
      if (new Date(String(row.lease_until)).getTime() <= Date.now()) { await this.expireCouponReservations(client); throw new Error('COUPON_RESERVATION_EXPIRED'); }
      const expectedItems = await client.query('select count(*)::int as count from coupons.coupon_reservation_items where reservation_id=$1', [input.reservationId]);
      const expectedItemCount = Number(expectedItems.rows[0]?.count ?? 0);
      const reusable = await client.query(`update coupons.coupon_items i set status='available',reserved_until=null,consumed_at=null
        where i.status='reserved' and i.id in (select ri.item_id from coupons.coupon_reservation_items ri where ri.reservation_id=$1) returning i.id`, [input.reservationId]);
      if (expectedItemCount <= 0 || (reusable.rowCount ?? 0) !== expectedItemCount) throw new Error('COUPON_RESERVATION_INCONSISTENT');
      await client.query("update coupons.coupon_reservations set status='committed',reason=null,finalized_at=now(),updated_at=now() where id=$1", [input.reservationId]);
      const committed = await client.query('select * from coupons.coupon_reservations where id=$1', [input.reservationId]);
      const record = await this.loadCouponReservation(client, committed.rows[0]);
      await client.query('commit');
      return record;
    } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
  }

  async releaseCouponReservation(input: { adminId: string; reservationId: string; executionKey: string; reason: string }): Promise<CouponReservationRecord> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await this.expireCouponReservations(client);
      const result = await client.query(`select r.* from coupons.coupon_reservations r
        where r.id=$1 and r.admin_id=$2 and exists (select 1 from auth.account_scopes scope where scope.account_id=r.account_id and scope.admin_id=$2 and scope.status='active' and (scope.expires_at is null or scope.expires_at>now())) for update`, [input.reservationId, input.adminId]);
      if (!result.rows[0]) throw new Error('COUPON_RESERVATION_NOT_FOUND');
      const row = result.rows[0];
      if (String(row.execution_key) !== input.executionKey) throw new Error('COUPON_RESERVATION_KEY_CONFLICT');
      if (row.status === 'committed') throw new Error('COUPON_RESERVATION_FINALIZED');
      if (row.status === 'released' || row.status === 'expired') { const record = await this.loadCouponReservation(client, row); await client.query('commit'); return record; }
      if (row.status !== 'reserved') throw new Error('COUPON_RESERVATION_NOT_ACTIVE');
      if (new Date(String(row.lease_until)).getTime() <= Date.now()) { await this.expireCouponReservations(client); const expired = await client.query('select * from coupons.coupon_reservations where id=$1', [input.reservationId]); const record = await this.loadCouponReservation(client, expired.rows[0]); await client.query('commit'); return record; }
      await client.query(`update coupons.coupon_items i set status='available',reserved_until=null
        where i.status='reserved' and i.id in (select ri.item_id from coupons.coupon_reservation_items ri where ri.reservation_id=$1)`, [input.reservationId]);
      await client.query("update coupons.coupon_reservations set status='released',reason=$2,finalized_at=now(),updated_at=now() where id=$1", [input.reservationId, input.reason.trim() || 'released']);
      const released = await client.query('select * from coupons.coupon_reservations where id=$1', [input.reservationId]);
      const record = await this.loadCouponReservation(client, released.rows[0]);
      await client.query('commit');
      return record;
    } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
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
  async listAutoReplyConversations(adminId: string, query: AutoReplyConversationListQuery): Promise<AutoReplyConversationListResult> {
    const limit = Math.min(50, Math.max(1, query.limit ?? 20));
    const result = await this.pool.query(`select c.id,c.item_ref,c.item_title
      from messages.conversations c
      where c.account_id=$2 and c.buyer_ref=$3
        and exists (select 1 from auth.account_scopes scope where scope.account_id=c.account_id and scope.admin_id=$1 and scope.status='active' and (scope.expires_at is null or scope.expires_at>now()))
      order by coalesce(c.last_message_at,c.updated_at) desc, c.id desc limit $4`, [adminId, query.accountId, query.buyerRef, limit]);
    return { items: result.rows.map((row) => this.toAutoReplyConversation(row)) };
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
  async listProductKnowledgeBaseMessages(adminId: string, productId: string): Promise<ProductKnowledgeBaseMessageRecord[]> {
    const result = await this.pool.query(`select m.*, c.item_ref as conversation_item_ref, c.item_title as conversation_item_title
      from messages.messages m
      join messages.conversations c on c.id=m.conversation_id
      join products.products p on p.id=$2::uuid and p.account_id=c.account_id
      where exists (select 1 from auth.account_scopes scope where scope.account_id=p.account_id and scope.admin_id=$1 and scope.status='active' and (scope.expires_at is null or scope.expires_at>now()))
        and (c.item_ref=p.id::text or c.item_ref=p.external_product_ref or m.product_ref=p.id::text or m.product_ref=p.external_product_ref)
      order by m.created_at asc, m.id asc`, [adminId, productId]);
    return result.rows.map((row) => ({ conversationId: String(row.conversation_id), conversationItemRef: row.conversation_item_ref ? String(row.conversation_item_ref) : undefined, conversationItemTitle: row.conversation_item_title ? String(row.conversation_item_title) : undefined, message: this.toMessage(row) }));
  }
  async listAutoReplyMessages(adminId: string, conversationId: string, query: AutoReplyMessageListQuery): Promise<AutoReplyMessageListResult> {
    const limit = Math.min(50, Math.max(1, query.limit ?? 20));
    const result = await this.pool.query(`select m.id,m.direction,m.sender_role,m.body_type,m.body_text,m.body_ref
      from messages.messages m
      where m.conversation_id=$2
        and exists (select 1 from messages.conversations c join auth.account_scopes scope on scope.account_id=c.account_id
          where c.id=m.conversation_id and scope.admin_id=$1 and scope.status='active' and (scope.expires_at is null or scope.expires_at>now()))
      order by m.created_at desc, m.id desc limit $3`, [adminId, conversationId, limit + 1]);
    const hasMoreHistory = result.rows.length > limit;
    const rows = result.rows.slice(0, limit).reverse();
    return { items: rows.map((row) => this.toAutoReplyMessage(row)), hasMoreHistory };
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
    const result = await this.pool.query('select m.* from messages.messages m left join messages.message_external_ref_aliases a on a.message_id=m.id where m.conversation_id=$1 and (m.external_message_ref=$2 or a.external_message_ref=$2) limit 1', [conversationId, externalMessageRef]);
    return result.rows[0] ? this.toMessage(result.rows[0]) : undefined;
  }

  async reconcileExternalMessage(input: { adminId: string; conversationId: string; externalMessageRef: string; senderRole: MessageRecord['senderRole']; bodyType: MessageRecord['bodyType']; source?: MessageRecord['source']; riskFlags?: string[]; traceId?: string }): Promise<{ message: MessageRecord; event?: ConversationEventRecord } | undefined> {
    const conversation = await this.getConversation(input.adminId, input.conversationId);
    if (!conversation) return undefined;
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const result = await client.query('select m.* from messages.messages m where m.conversation_id=$1 and (m.external_message_ref=$2 or exists (select 1 from messages.message_external_ref_aliases a where a.message_id=m.id and a.external_message_ref=$2)) limit 1 for update', [input.conversationId, input.externalMessageRef]);
      if (!result.rows[0]) {
        await client.query('commit');
        return undefined;
      }
      const current = this.toMessage(result.rows[0]);
      const systemUpgrade = current.direction === 'inbound' && input.senderRole === 'system' && input.bodyType === 'system';
      const mergedRiskFlags = [...new Set([...current.riskFlags, ...(input.riskFlags ?? [])])];
      const changed = (systemUpgrade && (current.senderRole !== 'system' || current.bodyType !== 'system' || (input.source && current.source !== input.source)))
        || mergedRiskFlags.length !== current.riskFlags.length;
      if (!changed) {
        await client.query('commit');
        return { message: current };
      }
      const senderRole = systemUpgrade ? 'system' : current.senderRole;
      const bodyType = systemUpgrade ? 'system' : current.bodyType;
      const source = systemUpgrade ? (input.source ?? 'system') : current.source;
      const updatedResult = await client.query('update messages.messages set sender_role=$2,body_type=$3,source=$4,risk_flags=$5::jsonb where id=$1 returning *', [current.id, senderRole, bodyType, source ?? null, JSON.stringify(mergedRiskFlags)]);
      const updatedConversationResult = await client.query('update messages.conversations set version=version+1,updated_at=now() where id=$1 returning *', [conversation.id]);
      await client.query('select pg_advisory_xact_lock(hashtext($1))', [conversation.id]);
      const cursorResult = await client.query('select coalesce(max(cursor),0)::bigint + 1 as cursor from messages.events where conversation_id=$1', [conversation.id]);
      const cursor = Number(cursorResult.rows[0]?.cursor ?? 1);
      const message = this.toMessage(updatedResult.rows[0]);
      const updatedConversation = this.toConversation(updatedConversationResult.rows[0]);
      const event: ConversationEventRecord = { eventId: createId(), conversationId: conversation.id, accountId: conversation.accountId, cursor, type: 'chat.message.updated', occurredAt: new Date().toISOString(), traceId: input.traceId ?? `reconcile:${message.id}`, payload: { message, conversation: updatedConversation } };
      const eventResult = await client.query('insert into messages.events (event_id,conversation_id,account_id,cursor,type,occurred_at,trace_id,payload_json) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb) returning *', [event.eventId, event.conversationId, event.accountId, event.cursor, event.type, event.occurredAt, event.traceId, JSON.stringify(event.payload)]);
      await client.query('commit');
      return { message, event: this.toConversationEvent(eventResult.rows[0]) };
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async createConversation(input: { adminId: string; accountId: string; buyerRef: string; buyerDisplayName?: string; buyerAvatarUrl?: string; itemRef?: string; itemTitle?: string; itemImageUrl?: string; externalConversationRef?: string }): Promise<ConversationRecord> {
    if (!(await this.hasAccountScope(input.adminId, input.accountId))) throw new Error('ACCOUNT_SCOPE_FORBIDDEN');
    const result = await this.pool.query('insert into messages.conversations (id,account_id,external_conversation_ref,buyer_ref,buyer_display_name,buyer_avatar_url,item_ref,item_title,item_image_url) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *', [createId(), input.accountId, input.externalConversationRef ?? null, input.buyerRef, input.buyerDisplayName ?? null, input.buyerAvatarUrl ?? null, input.itemRef ?? null, input.itemTitle ?? null, input.itemImageUrl ?? null]);
    return this.toConversation(result.rows[0]);
  }

  async createMessage(input: { adminId: string; conversationId: string; direction: MessageRecord['direction']; senderRole: MessageRecord['senderRole']; bodyType: MessageRecord['bodyType']; bodyText?: string; bodyRef?: string; externalMessageRef?: string; externalMessageRefAliases?: string[]; source?: MessageRecord['source']; orderRef?: string; productRef?: string; riskFlags?: string[]; createdAt?: string; traceId?: string }): Promise<{ message: MessageRecord; event: ConversationEventRecord }> {
    const conversation = await this.getConversation(input.adminId, input.conversationId);
    if (!conversation) throw new Error('CONVERSATION_NOT_FOUND');
    if (input.externalMessageRef || (input.externalMessageRefAliases?.length ?? 0) > 0) {
      const refs = [input.externalMessageRef, ...(input.externalMessageRefAliases ?? [])].filter((value): value is string => Boolean(value));
      const existing = await this.pool.query('select m.* from messages.messages m left join messages.message_external_ref_aliases a on a.message_id=m.id where m.conversation_id=$1 and (m.external_message_ref = any($2::text[]) or a.external_message_ref = any($2::text[])) limit 1', [input.conversationId, refs]);
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
      for (const alias of input.externalMessageRefAliases ?? []) {
        if (!alias || alias === input.externalMessageRef) continue;
        await client.query('insert into messages.message_external_ref_aliases (account_id,conversation_id,message_id,external_message_ref) values ($1,$2,$3,$4) on conflict (account_id,external_message_ref) do nothing', [conversation.accountId, conversation.id, id, alias]);
      }
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
    } catch (error) {
      await client.query('rollback');
      if ((error as { code?: string }).code === '23505' && (input.externalMessageRef || (input.externalMessageRefAliases?.length ?? 0) > 0)) {
        const refs = [input.externalMessageRef, ...(input.externalMessageRefAliases ?? [])].filter((value): value is string => Boolean(value));
        const existing = await this.pool.query('select m.* from messages.messages m left join messages.message_external_ref_aliases a on a.message_id=m.id where m.conversation_id=$1 and (m.external_message_ref = any($2::text[]) or a.external_message_ref = any($2::text[])) limit 1', [input.conversationId, refs]);
        if (existing.rows[0]) {
          const message = this.toMessage(existing.rows[0]);
          const eventResult = await this.pool.query("select * from messages.events where conversation_id=$1 and payload_json->'message'->>'id'=$2 order by cursor desc limit 1", [input.conversationId, message.id]);
          if (eventResult.rows[0]) return { message, event: this.toConversationEvent(eventResult.rows[0]) };
        }
      }
      throw error;
    } finally { client.release(); }
  }

  async createAutoReplyRun(input: { adminId: string; accountId: string; conversationId: string; inboundMessageId: string; intent: string; decision: AutoReplyDecision; status: AutoReplyRunStatus; riskFlags?: string[]; productId?: string; orderRefs?: string[]; inputDigest: string; contextDigest?: string; replyDigest?: string; senderOutcome?: AutoReplyRunRecord['senderOutcome']; outboundMessageId?: string; failureCode?: string }): Promise<AutoReplyRunRecord> {
    const existing = await this.pool.query('select * from messages.auto_reply_runs where admin_id=$1 and inbound_message_id=$2 limit 1', [input.adminId, input.inboundMessageId]);
    if (existing.rows[0]) return this.toAutoReplyRun(existing.rows[0]);
    const id = createId();
    const result = await this.pool.query(`insert into messages.auto_reply_runs (id,admin_id,account_id,conversation_id,inbound_message_id,intent,decision,status,risk_flags,product_id,order_refs,input_digest,context_digest,reply_digest,sender_outcome,outbound_message_id,failure_code)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11::jsonb,$12,$13,$14,$15,$16,$17) returning *`, [id, input.adminId, input.accountId, input.conversationId, input.inboundMessageId, input.intent, input.decision, input.status, JSON.stringify(input.riskFlags ?? []), input.productId ?? null, JSON.stringify(input.orderRefs ?? []), input.inputDigest, input.contextDigest ?? null, input.replyDigest ?? null, input.senderOutcome ?? null, input.outboundMessageId ?? null, input.failureCode ?? null]);
    const run = this.toAutoReplyRun(result.rows[0]);
    await this.appendAutoReplyRunEvent({ runId: run.id, accountId: run.accountId, eventType: 'run.created', status: run.status, stage: autoReplyStageForStatus(run.status), payload: {
      decision: run.decision,
      intent: run.intent,
      failureCode: run.failureCode,
      log: { phase: 'gateway', state: 'received', message: '已接收买家消息，准备开始处理' },
      input: { kind: 'inbound_message', messageId: run.inboundMessageId, digest: run.inputDigest },
      output: { status: run.status, decision: run.decision, intent: run.intent },
    } });
    return run;
  }

  async updateAutoReplyRun(id: string, patch: AutoReplyRunUpdate): Promise<AutoReplyRunRecord | undefined> {
    const fields: string[] = [];
    const values: unknown[] = [id];
    const add = (field: string, value: unknown, cast?: string) => { values.push(value); fields.push(`${field}=$${values.length}${cast ?? ''}`); };
    if (patch.intent !== undefined) add('intent', patch.intent);
    if (patch.decision !== undefined) add('decision', patch.decision);
    if (patch.status !== undefined) add('status', patch.status);
    if (patch.riskFlags !== undefined) add('risk_flags', JSON.stringify(patch.riskFlags), '::jsonb');
    if (patch.productId !== undefined) add('product_id', patch.productId);
    if (patch.orderRefs !== undefined) add('order_refs', JSON.stringify(patch.orderRefs), '::jsonb');
    if (patch.contextDigest !== undefined) add('context_digest', patch.contextDigest);
    if (patch.replyDigest !== undefined) add('reply_digest', patch.replyDigest);
    if (patch.senderOutcome !== undefined) add('sender_outcome', patch.senderOutcome);
    if (patch.outboundMessageId !== undefined) add('outbound_message_id', patch.outboundMessageId);
    if (patch.failureCode !== undefined) add('failure_code', patch.failureCode);
    if (fields.length === 0) return this.getAutoReplyRunById(id);
    fields.push('updated_at=now()');
    const result = await this.pool.query(`update messages.auto_reply_runs set ${fields.join(', ')} where id=$1 returning *`, values);
    if (!result.rows[0]) return undefined;
    const run = this.toAutoReplyRun(result.rows[0]);
    if (patch.status !== undefined) await this.appendAutoReplyRunEvent({ runId: run.id, accountId: run.accountId, eventType: `run.${patch.status}`, status: run.status, stage: autoReplyStageForStatus(run.status), durationMs: patch.eventDurationMs, traceId: patch.eventTraceId, payload: { decision: run.decision, intent: run.intent, failureCode: run.failureCode, ...(patch.eventPayload ?? {}), output: { status: run.status, decision: run.decision, intent: run.intent, ...(patch.eventPayload?.output && typeof patch.eventPayload.output === 'object' && !Array.isArray(patch.eventPayload.output) ? patch.eventPayload.output as Record<string, unknown> : {}) } } });
    return run;
  }

  async getAutoReplyRun(adminId: string, id: string): Promise<AutoReplyRunRecord | undefined> {
    const result = await this.pool.query('select * from messages.auto_reply_runs where id=$1 and admin_id=$2 limit 1', [id, adminId]);
    return result.rows[0] ? this.toAutoReplyRun(result.rows[0]) : undefined;
  }

  async findAutoReplyRunByInboundMessage(adminId: string, inboundMessageId: string): Promise<AutoReplyRunRecord | undefined> {
    const result = await this.pool.query('select * from messages.auto_reply_runs where admin_id=$1 and inbound_message_id=$2 limit 1', [adminId, inboundMessageId]);
    return result.rows[0] ? this.toAutoReplyRun(result.rows[0]) : undefined;
  }

  private async getAutoReplyRunById(id: string): Promise<AutoReplyRunRecord | undefined> {
    const result = await this.pool.query('select * from messages.auto_reply_runs where id=$1 limit 1', [id]);
    return result.rows[0] ? this.toAutoReplyRun(result.rows[0]) : undefined;
  }

  async appendAutoReplyRunEvent(input: { runId: string; eventType: string; status: AutoReplyRunStatus; stage: AutoReplyRunStage; accountId: string; payload?: Record<string, unknown>; durationMs?: number; traceId?: string }): Promise<AutoReplyRunEventRecord> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const run = await client.query('select id, account_id from messages.auto_reply_runs where id=$1 and account_id=$2 for update', [input.runId, input.accountId]);
      if (!run.rows[0]) throw new Error('AUTO_REPLY_RUN_NOT_FOUND');
      const sequenceResult = await client.query('select coalesce(max(sequence),0)::int + 1 as sequence from messages.auto_reply_run_events where run_id=$1', [input.runId]);
      const sequence = Number(sequenceResult.rows[0]?.sequence ?? 1);
      const result = await client.query('insert into messages.auto_reply_run_events (run_id,account_id,sequence,event_type,stage,status,occurred_at,duration_ms,trace_id,payload_json) values ($1,$2,$3,$4,$5,$6,now(),$7,$8,$9::jsonb) returning *', [input.runId, input.accountId, sequence, input.eventType, input.stage, input.status, input.durationMs ?? null, input.traceId ?? null, JSON.stringify(input.payload ?? {})]);
      await client.query('commit');
      return this.toAutoReplyRunEvent(result.rows[0]);
    } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
  }

  async listAutoReplyRunEvents(adminId: string, runId: string): Promise<AutoReplyRunEventRecord[]> {
    const run = await this.getAutoReplyRun(adminId, runId);
    if (!run || !(await this.hasAccountScope(adminId, run.accountId))) return [];
    const result = await this.pool.query('select * from messages.auto_reply_run_events where run_id=$1 order by sequence asc', [runId]);
    return result.rows.map((row) => this.toAutoReplyRunEvent(row));
  }

  async listAutoReplyRuns(adminId: string, query: AutoReplyRunListQuery): Promise<AutoReplyRunListResult> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const params: unknown[] = [adminId];
    const conditions = ["exists (select 1 from auth.account_scopes scope where scope.admin_id=$1 and scope.account_id=r.account_id and scope.status='active' and (scope.expires_at is null or scope.expires_at>now()))"];
    const add = (value: unknown) => { params.push(value); return `$${params.length}`; };
    if (query.accountId) conditions.push(`r.account_id=${add(query.accountId)}`);
    if (query.conversationId) conditions.push(`r.conversation_id=${add(query.conversationId)}`);
    if (query.from) conditions.push(`r.created_at >= ${add(query.from)}`);
    if (query.to) conditions.push(`r.created_at <= ${add(query.to)}`);
    if (query.status) conditions.push(`r.status = ${add(query.status)}`);
    if (query.decision) conditions.push(`r.decision = ${add(query.decision)}`);
    if (query.processing) conditions.push(`r.status in ('received','classified','context_loaded','generated','simulated')`);
    if (query.stage) conditions.push(`r.status = ${add(this.statusForAutoReplyStage(query.stage))}`);
    if (query.keyword?.trim()) { const param = add(`%${query.keyword.trim()}%`); conditions.push(`(r.id::text ilike ${param} or r.intent ilike ${param} or coalesce(r.failure_code,'') ilike ${param} or coalesce(c.buyer_display_name,'') ilike ${param} or coalesce(p.title,'') ilike ${param})`); }
    const where = conditions.join(' and ');
    const count = await this.pool.query(`select count(*)::int as count from messages.auto_reply_runs r left join messages.conversations c on c.id=r.conversation_id left join products.products p on p.id=r.product_id where ${where}`, params);
    const total = Number(count.rows[0]?.count ?? 0);
    const limitIndex = params.length + 1;
    const offsetIndex = params.length + 2;
    const rows = await this.pool.query(`select r.*, c.buyer_display_name, p.title as product_title, m.body_text as inbound_message_preview, extract(epoch from (r.updated_at-r.created_at))*1000 as duration_ms from messages.auto_reply_runs r left join messages.conversations c on c.id=r.conversation_id left join products.products p on p.id=r.product_id left join messages.messages m on m.id=r.inbound_message_id where ${where} order by r.created_at desc, r.id desc limit $${limitIndex} offset $${offsetIndex}`, [...params, pageSize, (page - 1) * pageSize]);
    return { items: rows.rows.map((row) => this.toAutoReplyRunListItem(row)), page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
  }

  async getAutoReplyRunDetail(adminId: string, runId: string): Promise<AutoReplyRunDetailRecord | undefined> {
    const result = await this.pool.query(`select r.*, c.buyer_display_name, p.title as product_title, m.body_text as inbound_message_preview, extract(epoch from (r.updated_at-r.created_at))*1000 as duration_ms from messages.auto_reply_runs r left join messages.conversations c on c.id=r.conversation_id left join products.products p on p.id=r.product_id left join messages.messages m on m.id=r.inbound_message_id where r.id=$1 and r.admin_id=$2 and exists (select 1 from auth.account_scopes scope where scope.admin_id=$2 and scope.account_id=r.account_id and scope.status='active' and (scope.expires_at is null or scope.expires_at>now()))`, [runId, adminId]);
    if (!result.rows[0]) return undefined;
    const run = this.toAutoReplyRunListItem(result.rows[0]);
    const [events, conversation, inboundResult, outboundResult, product] = await Promise.all([
      this.listAutoReplyRunEvents(adminId, runId),
      this.getConversation(adminId, run.conversationId),
      this.pool.query('select * from messages.messages where id=$1 and conversation_id=$2 limit 1', [run.inboundMessageId, run.conversationId]),
      this.pool.query(`select * from messages.messages where conversation_id=$1 and direction='outbound' and ($2::uuid is null or id=$2) order by created_at asc`, [run.conversationId, run.outboundMessageId ?? null]),
      run.productId ? this.getProduct(adminId, run.productId) : Promise.resolve(undefined),
    ]);
    return { run, events, conversation, inboundMessage: inboundResult.rows[0] ? this.toMessage(inboundResult.rows[0]) : undefined, outboundMessages: outboundResult.rows.map((row) => this.toMessage(row)), product };
  }

  async enqueueInboundInbox(input: { adminId: string; accountId: string; conversationId: string; inboundMessageId: string; externalConversationRef: string; externalMessageRef: string; sourceEventId?: string; sourceSequence?: number; availableAt?: string }): Promise<{ record: InboundInboxRecord; created: boolean }> {
    if (!(await this.hasAccountScope(input.adminId, input.accountId))) throw new Error('ACCOUNT_SCOPE_FORBIDDEN');
    const sourceSequence = input.sourceSequence;
    const normalizedSourceSequence = typeof sourceSequence === 'number' && Number.isSafeInteger(sourceSequence) && sourceSequence > 0 ? sourceSequence : null;
    let inserted;
    try {
      inserted = await this.pool.query(`insert into messages.auto_reply_inbound_inbox (id,admin_id,account_id,conversation_id,inbound_message_id,external_conversation_ref,external_message_ref,source_event_id,source_sequence,available_at)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,coalesce($10::timestamptz,now()))
        on conflict (account_id,external_message_ref) do nothing returning *`, [createId(), input.adminId, input.accountId, input.conversationId, input.inboundMessageId, input.externalConversationRef, input.externalMessageRef, input.sourceEventId?.trim() || null, normalizedSourceSequence, input.availableAt ?? null]);
    } catch (error) {
      if ((error as { code?: string }).code !== '23505') throw error;
      inserted = { rows: [] } as { rows: Row[] };
    }
    if (inserted.rows[0]) return { record: this.toInboundInbox(inserted.rows[0]), created: true };
    const existing = await this.pool.query('select * from messages.auto_reply_inbound_inbox where account_id=$1 and (external_message_ref=$2 or inbound_message_id=$3) limit 1', [input.accountId, input.externalMessageRef, input.inboundMessageId]);
    if (!existing.rows[0]) throw new Error('INBOUND_INBOX_ENQUEUE_RACE');
    return { record: this.toInboundInbox(existing.rows[0]), created: false };
  }

  async getInboundInbox(id: string): Promise<InboundInboxRecord | undefined> {
    const result = await this.pool.query('select * from messages.auto_reply_inbound_inbox where id=$1 limit 1', [id]);
    return result.rows[0] ? this.toInboundInbox(result.rows[0]) : undefined;
  }

  async claimInboundInbox(input: { workerId: string; limit: number; leaseMs: number }): Promise<InboundInboxRecord[]> {
    const limit = Math.max(1, Math.min(100, Math.trunc(input.limit)));
    const leaseMs = Math.max(5_000, Math.min(300_000, Math.trunc(input.leaseMs)));
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const result = await client.query(`with candidate_conversations as (
        select c.id
        from messages.conversations c
        where exists (
          select 1 from messages.auto_reply_inbound_inbox i
          where i.conversation_id=c.id
            and ((i.status in ('pending','retryable') and i.available_at<=now()) or (i.status='processing' and i.lease_expires_at <= now()))
        )
          and not exists (
            select 1 from messages.auto_reply_inbound_inbox active
            where active.conversation_id=c.id and active.status='processing' and active.lease_expires_at > now()
          )
        order by c.updated_at asc, c.id asc
        for update skip locked
        limit $1
      ), candidates as (
        select distinct on (i.conversation_id) i.id
        from messages.auto_reply_inbound_inbox i
        join candidate_conversations c on c.id=i.conversation_id
        where ((i.status in ('pending','retryable') and i.available_at<=now()) or (i.status='processing' and i.lease_expires_at <= now()))
        order by i.conversation_id, i.created_at asc, i.id asc
      )
      update messages.auto_reply_inbound_inbox inbox
      set status='processing', attempt=inbox.attempt+1, locked_at=now(), lease_expires_at=now() + ($2::int * interval '1 millisecond'), lease_owner=$3, updated_at=now()
      from candidates
      where inbox.id=candidates.id
      returning inbox.*`, [limit, leaseMs, input.workerId]);
      await client.query('commit');
      return result.rows.map((row) => this.toInboundInbox(row));
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async heartbeatInboundInbox(input: { id: string; workerId: string; leaseMs: number }): Promise<boolean> {
    const result = await this.pool.query(`update messages.auto_reply_inbound_inbox set locked_at=now(), lease_expires_at=now() + ($3::int * interval '1 millisecond'), updated_at=now()
      where id=$1 and status='processing' and lease_owner=$2 and lease_expires_at > now()`, [input.id, input.workerId, Math.max(5_000, Math.min(300_000, Math.trunc(input.leaseMs)))]);
    return result.rowCount === 1;
  }

  async ackInboundInbox(input: { id: string; workerId: string }): Promise<boolean> {
    const result = await this.pool.query(`update messages.auto_reply_inbound_inbox set status='succeeded', processed_at=now(), locked_at=null, lease_expires_at=null, lease_owner=null, updated_at=now()
      where id=$1 and status='processing' and lease_owner=$2`, [input.id, input.workerId]);
    return result.rowCount === 1;
  }

  async retryInboundInbox(input: { id: string; workerId: string; errorCode: string; errorDigest: string; availableAt: string }): Promise<boolean> {
    const result = await this.pool.query(`update messages.auto_reply_inbound_inbox set status='retryable', available_at=$3, locked_at=null, lease_expires_at=null, lease_owner=null, last_error_code=$4, last_error_digest=$5, last_error_at=now(), updated_at=now()
      where id=$1 and status='processing' and lease_owner=$2`, [input.id, input.workerId, input.availableAt, input.errorCode, input.errorDigest]);
    return result.rowCount === 1;
  }

  async deadLetterInboundInbox(input: { id: string; workerId: string; errorCode: string; errorDigest: string }): Promise<boolean> {
    const result = await this.pool.query(`update messages.auto_reply_inbound_inbox set status='dead_lettered', locked_at=null, lease_expires_at=null, lease_owner=null, last_error_code=$3, last_error_digest=$4, last_error_at=now(), updated_at=now()
      where id=$1 and status='processing' and lease_owner=$2`, [input.id, input.workerId, input.errorCode, input.errorDigest]);
    return result.rowCount === 1;
  }

  async reapExpiredInboundInbox(now?: string): Promise<number> {
    const result = await this.pool.query(`update messages.auto_reply_inbound_inbox set status='retryable', locked_at=null, lease_expires_at=null, lease_owner=null, available_at=coalesce($1::timestamptz,now()), last_error_code='INBOX_LEASE_EXPIRED', last_error_at=now(), updated_at=now()
      where status='processing' and lease_expires_at <= now()`, [now ?? null]);
    return Number(result.rowCount ?? 0);
  }

  async recordInboundQuarantine(input: { accountId: string; reasonCode: string; payloadDigest: string; payloadPreview?: string; payloadSize: number; receivedAt?: string }): Promise<InboundQuarantineRecord> {
    const result = await this.pool.query('insert into messages.auto_reply_inbound_quarantine (account_id,reason_code,payload_digest,payload_preview,payload_size,received_at) values ($1,$2,$3,$4,$5,coalesce($6::timestamptz,now())) returning *', [input.accountId, input.reasonCode, input.payloadDigest, input.payloadPreview?.slice(0, 500) ?? null, Math.max(0, Math.trunc(input.payloadSize)), input.receivedAt ?? null]);
    const row = result.rows[0];
    return { id: String(row.id), accountId: String(row.account_id), reasonCode: String(row.reason_code), payloadDigest: String(row.payload_digest), payloadPreview: row.payload_preview ? String(row.payload_preview) : undefined, payloadSize: Number(row.payload_size ?? 0), receivedAt: dateIso(row.received_at), resolvedAt: iso(row.resolved_at), createdAt: dateIso(row.created_at) };
  }

  async getAutoReplyActivitySummary(adminId: string, query: { accountId?: string; from: string; to: string }): Promise<AutoReplyActivitySummary> {
    const params: unknown[] = [adminId, query.from, query.to];
    const accountClause = query.accountId ? 'and r.account_id=$4' : '';
    if (query.accountId) params.push(query.accountId);
    const where = `r.created_at >= $2 and r.created_at <= $3 ${accountClause} and exists (select 1 from auth.account_scopes scope where scope.admin_id=$1 and scope.account_id=r.account_id and scope.status='active' and (scope.expires_at is null or scope.expires_at>now()))`;
    const rows = await this.pool.query(`select r.*, extract(epoch from (r.updated_at-r.created_at))*1000 as duration_ms from messages.auto_reply_runs r where ${where} order by r.created_at asc`, params);
    const runs = rows.rows.map((row) => this.toAutoReplyRunListItem(row));
    const counts = new Map<AutoReplyRunStatus, number>();
    const stageCounts = new Map<AutoReplyRunStage, { count: number; duration: number }>();
    const exceptions = new Map<string, { count: number; status: AutoReplyRunStatus }>();
    for (const item of runs) { counts.set(item.status, (counts.get(item.status) ?? 0) + 1); const stage = stageCounts.get(item.stage) ?? { count: 0, duration: 0 }; stage.count += 1; stage.duration += item.durationMs; stageCounts.set(item.stage, stage); if (item.failureCode) { const exception = exceptions.get(item.failureCode) ?? { count: 0, status: item.status }; exception.count += 1; exception.status = item.status; exceptions.set(item.failureCode, exception); } }
    const durations = runs.map((item) => item.durationMs).sort((a, b) => a - b);
    const p95 = durations.length ? durations[Math.min(durations.length - 1, Math.ceil(durations.length * 0.95) - 1)] : 0;
    const seconds = Math.max(1, (Date.parse(query.to) - Date.parse(query.from)) / 1000);
    const terminal = new Set<AutoReplyRunStatus>(['persisted', 'handoff', 'skipped', 'failed']);
    const processing = new Set<AutoReplyRunStatus>(['received', 'classified', 'context_loaded', 'generated', 'simulated']);
    return { from: query.from, to: query.to, asOf: new Date().toISOString(), inboundCount: runs.length, processingCount: runs.filter((run) => processing.has(run.status)).length, persistedCount: counts.get('persisted') ?? 0, handoffCount: counts.get('handoff') ?? 0, failedCount: counts.get('failed') ?? 0, skippedCount: counts.get('skipped') ?? 0, completionRate: runs.length ? runs.filter((run) => terminal.has(run.status)).length / runs.length : 0, throughputPerSecond: runs.length / seconds, p95DurationMs: p95, byStatus: [...counts.entries()].map(([status, count]) => ({ status, count })), byStage: [...stageCounts.entries()].map(([stage, value]) => ({ stage, count: value.count, averageDurationMs: value.count ? Math.round(value.duration / value.count) : 0 })), exceptions: [...exceptions.entries()].map(([code, value]) => ({ code, count: value.count, status: value.status })), health: (await this.pool.query("select distinct on (component) component,status,observed_at,details_json from observability.health_snapshots order by component,observed_at desc")).rows.map((row) => ({ component: String(row.component), status: String(row.status), observedAt: dateIso(row.observed_at), details: row.details_json && typeof row.details_json === 'object' && !Array.isArray(row.details_json) ? row.details_json as Record<string, unknown> : {} })), };
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
  async listCredentialRefs(adminId: string, accountId: string): Promise<CredentialRefRecord[]> {
    const result = await this.pool.query(`select r.*, v.metadata_json, v.checksum
      from accounts.credential_refs r
      join accounts.credential_values v on v.credential_ref_id=r.id
      where r.account_id=$1 and exists (select 1 from auth.account_scopes scope where scope.account_id=r.account_id and scope.admin_id=$2 and scope.status='active' and (scope.expires_at is null or scope.expires_at>now()))
      order by r.updated_at desc`, [accountId, adminId]);
    return result.rows.map((row) => this.toCredentialRef(row));
  }
  async getCredentialRef(adminId: string, credentialId: string): Promise<CredentialRefRecord | undefined> {
    const result = await this.pool.query(`select r.*, v.metadata_json, v.checksum
      from accounts.credential_refs r
      join accounts.credential_values v on v.credential_ref_id=r.id
      where r.id=$1 and exists (select 1 from auth.account_scopes scope where scope.account_id=r.account_id and scope.admin_id=$2 and scope.status='active' and (scope.expires_at is null or scope.expires_at>now()))`, [credentialId, adminId]);
    return result.rows[0] ? this.toCredentialRef(result.rows[0]) : undefined;
  }
  async getCredentialRefSecret(adminId: string, credentialId: string): Promise<import('./domain.js').CredentialRefSecretRecord | undefined> {
    const result = await this.pool.query(`select r.*, v.metadata_json, v.checksum, v.ciphertext
      from accounts.credential_refs r
      join accounts.credential_values v on v.credential_ref_id=r.id
      where r.id=$1 and exists (select 1 from auth.account_scopes scope where scope.account_id=r.account_id and scope.admin_id=$2 and scope.status='active' and (scope.expires_at is null or scope.expires_at>now()))`, [credentialId, adminId]);
    const row = result.rows[0] as Row | undefined;
    if (!row) return undefined;
    const ref = this.toCredentialRef(row);
    const ciphertext = Buffer.isBuffer(row.ciphertext) ? row.ciphertext.toString('utf8') : String(row.ciphertext ?? '');
    if (!ciphertext) return undefined;
    return { ref, secretCiphertext: ciphertext };
  }
  async createCredentialRef(input: { adminId: string; accountId: string; provider: string; alias: string; label?: string; secretCiphertext: string; fingerprint: string; metadata?: Record<string, string> }): Promise<CredentialRefRecord> {
    if (!(await this.hasAccountScope(input.adminId, input.accountId))) throw new Error('ACCOUNT_SCOPE_FORBIDDEN');
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const id = createId();
      const ref = await client.query(`insert into accounts.credential_refs (id,account_id,kind,purpose,label,status,version,provider,alias,last_rotated_at)
        values ($1,$2,'api_key','model_client',$3,'active',1,$4,$5,now()) returning *`, [id, input.accountId, input.label?.trim() || null, input.provider.trim(), input.alias.trim()]);
      await client.query(`insert into accounts.credential_values (credential_ref_id,ciphertext,key_version,checksum,metadata_json)
        values ($1,$2,1,$3,$4::jsonb)`, [id, Buffer.from(input.secretCiphertext, 'utf8'), input.fingerprint, JSON.stringify(input.metadata ?? {})]);
      await client.query('commit');
      return this.toCredentialRef({ ...ref.rows[0], metadata_json: input.metadata ?? {}, checksum: input.fingerprint });
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally { client.release(); }
  }
  async updateCredentialRef(input: { adminId: string; credentialId: string; expectedVersion: number; provider?: string; alias?: string; label?: string; metadata?: Record<string, string> }): Promise<CredentialRefRecord | undefined> {
    const current = await this.getCredentialRef(input.adminId, input.credentialId);
    if (!current) return undefined;
    if (current.version !== input.expectedVersion) throw new Error('CREDENTIAL_VERSION_CONFLICT');
    const result = await this.pool.query(`update accounts.credential_refs set provider=coalesce($2,provider), alias=coalesce($3,alias), label=case when $4::text is null then label else nullif($4,'') end, version=version+1, updated_at=now() where id=$1 and version=$5 returning *`, [input.credentialId, input.provider?.trim() ?? null, input.alias?.trim() ?? null, input.label ?? null, input.expectedVersion]);
    if (!result.rows[0]) throw new Error('CREDENTIAL_VERSION_CONFLICT');
    if (input.metadata !== undefined) await this.pool.query('update accounts.credential_values set metadata_json=$2::jsonb, updated_at=now() where credential_ref_id=$1', [input.credentialId, JSON.stringify(input.metadata)]);
    return this.getCredentialRef(input.adminId, input.credentialId);
  }
  async rotateCredentialRef(input: { adminId: string; credentialId: string; expectedVersion: number; secretCiphertext: string; fingerprint: string }): Promise<CredentialRefRecord | undefined> {
    const current = await this.getCredentialRef(input.adminId, input.credentialId);
    if (!current) return undefined;
    if (current.version !== input.expectedVersion) throw new Error('CREDENTIAL_VERSION_CONFLICT');
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const ref = await client.query(`update accounts.credential_refs set status='active',version=version+1,last_rotated_at=now(),updated_at=now() where id=$1 and version=$2 returning *`, [input.credentialId, input.expectedVersion]);
      if (!ref.rows[0]) throw new Error('CREDENTIAL_VERSION_CONFLICT');
      await client.query(`update accounts.credential_values set ciphertext=$2,key_version=key_version+1,checksum=$3,updated_at=now() where credential_ref_id=$1`, [input.credentialId, Buffer.from(input.secretCiphertext, 'utf8'), input.fingerprint]);
      await client.query('commit');
      return this.getCredentialRef(input.adminId, input.credentialId);
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally { client.release(); }
  }
  async updateCredentialRefStatus(input: { adminId: string; credentialId: string; expectedVersion: number; status: CredentialRefStatus }): Promise<CredentialRefRecord | undefined> {
    const current = await this.getCredentialRef(input.adminId, input.credentialId);
    if (!current) return undefined;
    if (current.version !== input.expectedVersion) throw new Error('CREDENTIAL_VERSION_CONFLICT');
    if (current.status === 'revoked' && input.status !== 'revoked') throw new Error('CREDENTIAL_REVOKED');
    const result = await this.pool.query(`update accounts.credential_refs set status=$2,version=version+1,updated_at=now() where id=$1 and version=$3 returning *`, [input.credentialId, input.status, input.expectedVersion]);
    if (!result.rows[0]) throw new Error('CREDENTIAL_VERSION_CONFLICT');
    return this.getCredentialRef(input.adminId, input.credentialId);
  }
  async getAutoReplyAgentConfig(adminId: string, accountId: string): Promise<AutoReplyAgentConfigRecord | undefined> {
    const result = await this.pool.query(`select c.* from settings.auto_reply_agent_account_configs c
      where c.account_id=$2 and exists (
        select 1 from auth.account_scopes scope
        where scope.account_id=c.account_id and scope.admin_id=$1 and scope.status='active'
          and (scope.expires_at is null or scope.expires_at>now())
      )`, [adminId, accountId]);
    return result.rows[0] ? this.toAutoReplyAgentConfig(result.rows[0]) : undefined;
  }
  async upsertAutoReplyAgentConfig(input: { adminId: string; accountId: string; expectedVersion: number; patch: AutoReplyAgentConfigPatch; config: AutoReplyAgentConfig; configDigest: string }): Promise<AutoReplyAgentConfigRecord | undefined> {
    const current = await this.getAutoReplyAgentConfig(input.adminId, input.accountId);
    if (current && current.configVersion !== input.expectedVersion) throw new Error('AUTO_REPLY_AGENT_CONFIG_VERSION_CONFLICT');
    const version = current ? current.configVersion + 1 : 1;
    const result = await this.pool.query(`
      insert into settings.auto_reply_agent_account_configs (account_id, updated_by_admin_id, config_version, config_json, config_digest)
      values ($1,$2,$3,$4::jsonb,$5)
      on conflict (account_id) do update set updated_by_admin_id=excluded.updated_by_admin_id, config_version=excluded.config_version, config_json=excluded.config_json, config_digest=excluded.config_digest, updated_at=now()
      returning *`, [input.accountId, input.adminId, version, JSON.stringify(input.config), input.configDigest]);
    return result.rows[0] ? this.toAutoReplyAgentConfig(result.rows[0]) : undefined;
  }
  async getActiveAutoReplyRepairPolicy(accountId: string, now = new Date().toISOString()): Promise<AutoReplyRepairPolicyBundle | undefined> {
    const result = await this.pool.query(`select policy_json from settings.auto_reply_repair_policies
      where account_id=$1 and lifecycle_status='ACTIVE'
        and effective_from <= $2::timestamptz
        and (effective_to is null or effective_to > $2::timestamptz)
      order by created_at desc limit 1`, [accountId, now]);
    if (!result.rows[0]) return undefined;
    const raw = result.rows[0].policy_json as AutoReplyRepairPolicyBundle;
    return validatePersistedAutoReplyRepairPolicyBundle(raw, accountId, new Date(now));
  }
  async publishAutoReplyRepairPolicy(input: { accountId: string; bundle: AutoReplyRepairPolicyBundle; expectedActiveVersion?: string }): Promise<AutoReplyRepairPolicyBundle> {
    const now = new Date().toISOString();
    const bundle = validatePersistedAutoReplyRepairPolicyBundle(input.bundle, input.accountId, new Date(now));
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const active = await client.query(`select policy_version from settings.auto_reply_repair_policies where account_id=$1 and lifecycle_status='ACTIVE' for update`, [input.accountId]);
      const currentVersion = active.rows[0] ? String(active.rows[0].policy_version) : undefined;
      if (input.expectedActiveVersion && currentVersion !== input.expectedActiveVersion) throw new Error('AUTO_REPLY_POLICY_VERSION_CONFLICT');
      const duplicate = await client.query(`select 1 from settings.auto_reply_repair_policies where account_id=$1 and policy_version=$2 limit 1`, [input.accountId, bundle.policyConfig.policyVersion]);
      if (duplicate.rows[0]) throw new Error('AUTO_REPLY_POLICY_VERSION_EXISTS');
      await client.query(`update settings.auto_reply_repair_policies set lifecycle_status='RETIRED', retired_at=now(), updated_at=now() where account_id=$1 and lifecycle_status='ACTIVE'`, [input.accountId]);
      await client.query(`insert into settings.auto_reply_repair_policies (id,account_id,policy_version,policy_hash,lifecycle_status,policy_json,effective_from,effective_to,published_at,activated_at,created_at,updated_at)
        values ($1,$2,$3,$4,'ACTIVE',$5::jsonb,$6::timestamptz,$7::timestamptz,$8::timestamptz,$9::timestamptz,now(),now())`, [createId(), input.accountId, bundle.policyConfig.policyVersion, bundle.policyConfig.policyHash, JSON.stringify(bundle), bundle.policyConfig.effectiveFrom, bundle.policyConfig.effectiveTo ?? null, bundle.policyConfig.publishedAt ?? now, bundle.policyConfig.activatedAt ?? now]);
      await client.query('commit');
      return bundle;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally { client.release(); }
  }
  async rollbackAutoReplyRepairPolicy(input: { accountId: string; targetPolicyVersion: string; expectedActiveVersion?: string }): Promise<AutoReplyRepairPolicyBundle> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const active = await client.query(`select policy_version from settings.auto_reply_repair_policies where account_id=$1 and lifecycle_status='ACTIVE' for update`, [input.accountId]);
      const currentVersion = active.rows[0] ? String(active.rows[0].policy_version) : undefined;
      if (input.expectedActiveVersion && currentVersion !== input.expectedActiveVersion) throw new Error('AUTO_REPLY_POLICY_VERSION_CONFLICT');
      const target = await client.query(`select policy_json from settings.auto_reply_repair_policies where account_id=$1 and policy_version=$2 for update`, [input.accountId, input.targetPolicyVersion]);
      if (!target.rows[0]) throw new Error('AUTO_REPLY_POLICY_ROLLBACK_TARGET_NOT_FOUND');
      const bundle = validatePersistedAutoReplyRepairPolicyBundle(target.rows[0].policy_json as AutoReplyRepairPolicyBundle, input.accountId, new Date());
      await client.query(`update settings.auto_reply_repair_policies set lifecycle_status='RETIRED', retired_at=now(), updated_at=now() where account_id=$1 and lifecycle_status='ACTIVE' and policy_version<>$2`, [input.accountId, input.targetPolicyVersion]);
      await client.query(`update settings.auto_reply_repair_policies set lifecycle_status='ACTIVE', retired_at=null, updated_at=now() where account_id=$1 and policy_version=$2`, [input.accountId, input.targetPolicyVersion]);
      await client.query('commit');
      return bundle;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally { client.release(); }
  }
  async getIdempotency(scope: string, key: string): Promise<IdempotencyRecord | undefined> { const result = await this.pool.query('select * from execution.idempotency_records where scope=$1 and key=$2 and expires_at>now()', [scope, key]); return result.rows[0] ? this.toIdempotency(result.rows[0]) : undefined; }
  async beginIdempotency(record: IdempotencyRecord): Promise<void> { await this.pool.query('insert into execution.idempotency_records (id,scope,key,request_fingerprint,status,expires_at) values ($1,$2,$3,$4,$5,$6)', [createId(), record.scope, record.key, record.requestFingerprint, record.status, record.expiresAt]); }
  async abortIdempotency(scope: string, key: string): Promise<void> { await this.pool.query('delete from execution.idempotency_records where scope=$1 and key=$2 and status=\'processing\'', [scope, key]); }
  async completeIdempotency(input: { scope: string; key: string; status: IdempotencyRecord['status']; responseEnvelope: unknown; statusCode: number; traceId: string }): Promise<void> { await this.pool.query('update execution.idempotency_records set status=$3,response_envelope=$4,status_code=$5,trace_id=$6 where scope=$1 and key=$2', [input.scope, input.key, input.status, JSON.stringify(input.responseEnvelope), input.statusCode, input.traceId]); }
  async enqueueAutoReplyOutbox(input: { scope: string; aggregateType: string; aggregateId: string; operation: string; idempotencyKey: string; payload: Record<string, unknown>; traceId?: string; availableAt?: string }): Promise<{ record: AutoReplyOutboxRecord; created: boolean }> {
    const inserted = await this.pool.query(`insert into execution.outbox_jobs (id,scope,aggregate_type,aggregate_id,operation,status,available_at,idempotency_key,payload_json,trace_id,updated_at)
      values ($1,$2,$3,$4,$5,'pending',coalesce($6::timestamptz,now()),$7,$8::jsonb,$9,now())
      on conflict (scope,idempotency_key) do nothing returning *`, [createId(), input.scope, input.aggregateType, input.aggregateId, input.operation, input.availableAt ?? null, input.idempotencyKey, JSON.stringify(input.payload), input.traceId ?? null]);
    if (inserted.rows[0]) return { record: this.toAutoReplyOutbox(inserted.rows[0]), created: true };
    const existing = await this.pool.query('select * from execution.outbox_jobs where scope=$1 and idempotency_key=$2 limit 1', [input.scope, input.idempotencyKey]);
    if (!existing.rows[0]) throw new Error('AUTO_REPLY_OUTBOX_ENQUEUE_RACE');
    return { record: this.toAutoReplyOutbox(existing.rows[0]), created: false };
  }
  async getAutoReplyOutbox(scope: string, idempotencyKey: string): Promise<AutoReplyOutboxRecord | undefined> { const result = await this.pool.query('select * from execution.outbox_jobs where scope=$1 and idempotency_key=$2 limit 1', [scope, idempotencyKey]); return result.rows[0] ? this.toAutoReplyOutbox(result.rows[0]) : undefined; }
  async listAutoReplyOutboxByAggregate(scope: string, aggregateId: string): Promise<AutoReplyOutboxRecord[]> { const result = await this.pool.query('select * from execution.outbox_jobs where scope=$1 and aggregate_id=$2 order by created_at asc,id asc', [scope, aggregateId]); return result.rows.map((row) => this.toAutoReplyOutbox(row)); }
  async claimAutoReplyOutbox(input: { scope: string; workerId: string; limit: number; leaseMs: number; id?: string }): Promise<AutoReplyOutboxRecord[]> {
    const limit = Math.max(1, Math.min(100, Math.trunc(input.limit)));
    const leaseMs = Math.max(5_000, Math.min(300_000, Math.trunc(input.leaseMs)));
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const result = await client.query(`with candidates as (
        select id from execution.outbox_jobs
        where scope=$1 and ($5::uuid is null or id=$5::uuid) and ((status in ('pending','retryable') and available_at<=now()) or (status='processing' and lease_expires_at<=now()))
        order by created_at asc,id asc
        for update skip locked limit $2
      )
      update execution.outbox_jobs job
      set status='processing',attempt=job.attempt+1,locked_at=now(),lease_expires_at=now()+($3::int * interval '1 millisecond'),lease_owner=$4,updated_at=now()
      from candidates where job.id=candidates.id returning job.*`, [input.scope, limit, leaseMs, input.workerId, input.id ?? null]);
      await client.query('commit');
      return result.rows.map((row) => this.toAutoReplyOutbox(row));
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally { client.release(); }
  }
  async completeAutoReplyOutbox(input: { id: string; workerId: string; externalOutcome: AutoReplyOutboxRecord['externalOutcome']; externalMessageRef?: string }): Promise<boolean> {
    const result = await this.pool.query(`update execution.outbox_jobs set status='succeeded',external_outcome=$3,external_message_ref=$4,locked_at=null,lease_expires_at=null,lease_owner=null,updated_at=now() where id=$1 and status='processing' and lease_owner=$2`, [input.id, input.workerId, input.externalOutcome ?? null, input.externalMessageRef ?? null]);
    return result.rowCount === 1;
  }
  async persistAutoReplyOutbox(input: { id: string; outboundMessageId: string }): Promise<boolean> { const result = await this.pool.query(`update execution.outbox_jobs set outbound_message_id=$2,updated_at=now() where id=$1 and status='succeeded'`, [input.id, input.outboundMessageId]); return result.rowCount === 1; }
  async retryAutoReplyOutbox(input: { id: string; workerId: string; errorCode: string; errorDigest: string; availableAt: string }): Promise<boolean> {
    const result = await this.pool.query(`update execution.outbox_jobs set status='retryable',available_at=$3,last_error_code=$4,last_error_digest=$5,locked_at=null,lease_expires_at=null,lease_owner=null,updated_at=now() where id=$1 and status='processing' and lease_owner=$2`, [input.id, input.workerId, input.availableAt, input.errorCode, input.errorDigest]);
    return result.rowCount === 1;
  }
  async deadLetterAutoReplyOutbox(input: { id: string; workerId: string; errorCode: string; errorDigest: string }): Promise<boolean> {
    const result = await this.pool.query(`update execution.outbox_jobs set status='dead_lettered',last_error_code=$3,last_error_digest=$4,locked_at=null,lease_expires_at=null,lease_owner=null,updated_at=now() where id=$1 and status='processing' and lease_owner=$2`, [input.id, input.workerId, input.errorCode, input.errorDigest]);
    return result.rowCount === 1;
  }
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

  async deleteAgentSession(adminId: string, sessionId: string): Promise<AgentSessionRecord | undefined> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const sessionResult = await client.query("select s.* from workspace.agent_sessions s where s.id=$1 and exists (select 1 from auth.account_scopes scope where scope.account_id=s.account_id and scope.admin_id=$2 and scope.status='active' and (scope.expires_at is null or scope.expires_at>now())) for update", [sessionId, adminId]);
      const sessionRow = sessionResult.rows[0];
      if (!sessionRow) { await client.query('rollback'); return undefined; }
      const runResult = await client.query('select id,status from workspace.runs where session_id=$1 for update', [sessionId]);
      const runIds = runResult.rows.map((row) => String(row.id));
      if (runIds.length) {
        await client.query("delete from execution.outbox_jobs where aggregate_type='workspace_run' and aggregate_id = any($1::uuid[])", [runIds]);
      }
      await client.query('delete from workspace.runs where session_id=$1', [sessionId]);
      const deleted = await client.query('delete from workspace.agent_sessions where id=$1 returning *', [sessionId]);
      await client.query('commit');
      return deleted.rows[0] ? this.toAgentSession(deleted.rows[0]) : undefined;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally { client.release(); }
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

  async createWorkspaceConfirmation(input: { adminId: string; runId: string; stepId: string; accountId: string; requestedBy: string; action: WorkspaceConfirmationRecord['action']; policyRef: string; manifest: Record<string, unknown>; expiresAt: string }): Promise<WorkspaceConfirmationRecord> {
    if (!(await this.hasAccountScope(input.adminId, input.accountId))) throw new Error('ACCOUNT_SCOPE_FORBIDDEN');
    const existing = await this.pool.query("select c.* from workspace.confirmations c where c.run_id=$1 and c.status='active' limit 1", [input.runId]);
    if (existing.rows[0]) return this.toWorkspaceConfirmation(existing.rows[0]);
    const result = await this.pool.query(`insert into workspace.confirmations (id,run_id,step_id,account_id,requested_by,action,policy_ref,manifest_json,status,version,expires_at)
      values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,'active',1,$9) returning *`, [createId(), input.runId, input.stepId, input.accountId, input.requestedBy, input.action, input.policyRef, JSON.stringify(input.manifest), input.expiresAt]);
    return this.toWorkspaceConfirmation(result.rows[0]);
  }

  async getWorkspaceConfirmation(adminId: string, runId: string): Promise<WorkspaceConfirmationRecord | undefined> {
    const result = await this.pool.query('select c.* from workspace.confirmations c where c.run_id=$1 and exists (select 1 from auth.account_scopes scope where scope.account_id=c.account_id and scope.admin_id=$2 and scope.status=\'active\' and (scope.expires_at is null or scope.expires_at>now())) order by c.created_at desc limit 1', [runId, adminId]);
    if (!result.rows[0]) return undefined;
    const row = result.rows[0];
    if (row.status === 'active' && new Date(String(row.expires_at)).getTime() <= Date.now()) {
      const expired = await this.pool.query("update workspace.confirmations set status='expired',version=version+1,updated_at=now() where id=$1 and status='active' returning *", [row.id]);
      return expired.rows[0] ? this.toWorkspaceConfirmation(expired.rows[0]) : this.toWorkspaceConfirmation(row);
    }
    return this.toWorkspaceConfirmation(row);
  }

  async transitionWorkspaceConfirmation(input: { adminId: string; confirmationId: string; expectedVersion: number; status: Exclude<WorkspaceConfirmationRecord['status'], 'active'>; actorId: string }): Promise<WorkspaceConfirmationRecord | undefined> {
    const result = await this.pool.query(`update workspace.confirmations c set status=$3,version=version+1,confirmed_at=case when $3='confirmed' then now() else confirmed_at end,confirmed_by=case when $3='confirmed' then $4 else confirmed_by end,cancelled_at=case when $3='cancelled' then now() else cancelled_at end,updated_at=now()
      where c.id=$1 and c.version=$2 and c.status='active' and exists (select 1 from auth.account_scopes scope where scope.account_id=c.account_id and scope.admin_id=$5 and scope.status='active' and (scope.expires_at is null or scope.expires_at>now())) returning c.*`, [input.confirmationId, input.expectedVersion, input.status, input.actorId, input.adminId]);
    return result.rows[0] ? this.toWorkspaceConfirmation(result.rows[0]) : undefined;
  }

  async getExecutionOutboxById(scope: string, id: string): Promise<AutoReplyOutboxRecord | undefined> {
    const result = await this.pool.query('select * from execution.outbox_jobs where scope=$1 and id=$2 limit 1', [scope, id]);
    return result.rows[0] ? this.toAutoReplyOutbox(result.rows[0]) : undefined;
  }

  async requeueExecutionOutbox(input: { scope: string; id: string; availableAt?: string }): Promise<AutoReplyOutboxRecord | undefined> {
    const result = await this.pool.query("update execution.outbox_jobs set status='pending',available_at=coalesce($3::timestamptz,now()),locked_at=null,lease_expires_at=null,lease_owner=null,updated_at=now() where scope=$1 and id=$2 and status in ('retryable','dead_lettered') returning *", [input.scope, input.id, input.availableAt ?? null]);
    return result.rows[0] ? this.toAutoReplyOutbox(result.rows[0]) : undefined;
  }
  async close(): Promise<void> { await this.pool.end(); }

  private async expireCouponReservations(client: PoolClient): Promise<number> {
    const result = await client.query(`with expired as (
      update coupons.coupon_reservations
      set status='expired',reason='reservation_expired',finalized_at=now(),updated_at=now()
      where status='reserved' and lease_until<=now()
      returning id
    ), released as (
      update coupons.coupon_items i
      set status='available',reserved_until=null
      from coupons.coupon_reservation_items ri
      join expired e on e.id=ri.reservation_id
      where i.id=ri.item_id and i.status='reserved'
      returning i.id
    )
    select count(*)::int as count from expired`);
    return Number(result.rows[0]?.count ?? 0);
  }

  private async loadCouponReservation(client: PoolClient, row: Row): Promise<CouponReservationRecord> {
    const items = await client.query(`select ri.item_id, i.batch_id, i.content_ciphertext, b.label as batch_label
      from coupons.coupon_reservation_items ri
      join coupons.coupon_items i on i.id=ri.item_id
      join coupons.coupon_batches b on b.id=i.batch_id
      where ri.reservation_id=$1
      order by ri.item_id`, [row.id]);
    return this.toCouponReservation(row, items.rows);
  }

  private async ensureConfiguredCouponItems(client: PoolClient, rows: Row[], quantity: number): Promise<void> {
    for (const row of rows) {
      const batchId = String(row.id);
      const existing = await client.query('select content_ciphertext,status from coupons.coupon_items where batch_id=$1', [batchId]);
      const existingContent = new Set(existing.rows.map((item) => decryptCouponValue(item.content_ciphertext)));
      const batch = this.toCouponBatch(row);
      if (batch.purpose === 'data') {
        const createdAtBase = Date.now();
        for (const [index, content] of splitDataContent(batch.metadata?.dataContent).entries()) {
          if (existingContent.has(content)) continue;
          await client.query('insert into coupons.coupon_items (id,batch_id,content_ciphertext,status,created_at) values ($1,$2,$3,\'available\',$4)', [createId(), batchId, encryptCouponValue(content), new Date(createdAtBase + index).toISOString()]);
          existingContent.add(content);
        }
      } else {
        const configuredOnly = existing.rows.length === 0 || existing.rows.every((item) => decryptCouponValue(item.content_ciphertext) === '__CONFIGURED_COUPON__');
        const availableCount = existing.rows.filter((item) => item.status === 'available').length;
        const required = configuredOnly ? Math.max(0, quantity - availableCount) : 0;
        for (let index = 0; index < required; index += 1) {
          await client.query('insert into coupons.coupon_items (id,batch_id,content_ciphertext,status) values ($1,$2,$3,\'available\')', [createId(), batchId, encryptCouponValue('__CONFIGURED_COUPON__')]);
        }
      }
      await client.query('update coupons.coupon_batches set total_count=(select count(*) from coupons.coupon_items where batch_id=$1),version=version+1,updated_at=now() where id=$1', [batchId]);
    }
  }

  private toCouponBatch(row: Row): CouponBatchRecord {
    const totalCount = Number(row.computed_total_count ?? row.total_count ?? 0);
    const metadata = row.metadata_json && typeof row.metadata_json === 'object' && !Array.isArray(row.metadata_json) ? row.metadata_json as CouponBatchMetadata : {};
    const assets = Array.isArray(row.coupon_assets) ? row.coupon_assets.map((asset) => this.toCouponAsset(asset as Row)) : undefined;
    return { id: String(row.id), sequenceId: row.sequence_id === null || row.sequence_id === undefined ? undefined : String(row.sequence_id), accountId: String(row.account_id), label: row.label ? String(row.label) : undefined, purpose: String(row.purpose), metadata, assets, totalCount, availableCount: row.computed_available_count === undefined ? undefined : Number(row.computed_available_count), reservedCount: row.computed_reserved_count === undefined ? undefined : Number(row.computed_reserved_count), consumedCount: row.computed_consumed_count === undefined ? undefined : Number(row.computed_consumed_count), status: row.status as CouponBatchRecord['status'], version: Number(row.version ?? 1), createdAt: new Date(String(row.created_at)).toISOString(), updatedAt: new Date(String(row.updated_at)).toISOString() };
  }
  private toCouponAsset(row: Row): CouponAssetRecord { return { id: String(row.id), batchId: String(row.batch_id ?? row.coupon_batch_id), storageKey: String(row.storage_key), mimeType: String(row.mime_type), checksum: row.checksum ? String(row.checksum) : undefined, caption: row.caption ? String(row.caption) : undefined, status: row.status as CouponAssetRecord['status'], createdAt: dateIso(row.created_at), updatedAt: dateIso(row.updated_at) }; }
  private toCouponItem(row: Row): CouponItemRecord { return { id: String(row.id), batchId: String(row.batch_id), content: decryptCouponValue(row.content_ciphertext), status: row.status as CouponItemRecord['status'], reservedUntil: iso(row.reserved_until), consumedAt: iso(row.consumed_at), createdAt: new Date(String(row.created_at)).toISOString() }; }
  private toCouponBinding(row: Row): CouponBindingRecord { return { id: String(row.id), batchId: String(row.coupon_batch_id), productId: String(row.product_id), priority: Number(row.priority ?? 0), status: row.status as CouponBindingRecord['status'], expiresAt: iso(row.expires_at), createdAt: new Date(String(row.created_at)).toISOString(), updatedAt: new Date(String(row.updated_at)).toISOString() }; }
  private toCouponReservation(row: Row, itemRows: Row[]): CouponReservationRecord {
    const batchIds = Array.isArray(row.batch_ids) ? row.batch_ids.map(String) : typeof row.batch_ids === 'string' ? (() => { try { return (JSON.parse(row.batch_ids) as unknown[]).map(String); } catch { return []; } })() : [];
    return {
      reservationId: String(row.id),
      adminId: String(row.admin_id),
      accountId: String(row.account_id),
      executionKey: String(row.execution_key),
      purpose: row.purpose as CouponReservationPurpose,
      batchIds,
      fingerprint: String(row.fingerprint),
      quantity: Number(row.quantity),
      status: row.status as CouponReservationRecord['status'],
      leaseUntil: dateIso(row.lease_until),
      reason: row.reason ? String(row.reason) : undefined,
      items: itemRows.map((item) => ({ itemId: String(item.item_id), content: decryptCouponValue(item.content_ciphertext), batchId: String(item.batch_id), batchLabel: item.batch_label ? String(item.batch_label) : undefined })),
      createdAt: dateIso(row.created_at),
      updatedAt: dateIso(row.updated_at),
      finalizedAt: iso(row.finalized_at),
    };
  }

  private toConversation(row: Row): ConversationRecord { return { id: String(row.id), accountId: String(row.account_id), externalConversationRef: row.external_conversation_ref ? String(row.external_conversation_ref) : undefined, buyerRef: String(row.buyer_ref), buyerDisplayName: row.buyer_display_name ? String(row.buyer_display_name) : undefined, buyerAvatarUrl: row.buyer_avatar_url ? String(row.buyer_avatar_url) : undefined, itemRef: row.item_ref ? String(row.item_ref) : undefined, itemTitle: row.item_title ? String(row.item_title) : undefined, itemImageUrl: row.item_image_url ? String(row.item_image_url) : undefined, unreadCount: Number(row.unread_count ?? 0), lastMessagePreview: row.last_message_preview ? String(row.last_message_preview) : undefined, lastMessageAt: iso(row.last_message_at), handlingMode: row.handling_mode as ConversationRecord['handlingMode'], version: Number(row.version ?? 1), createdAt: dateIso(row.created_at), updatedAt: dateIso(row.updated_at) }; }
  private toMessage(row: Row): MessageRecord { const riskFlags = Array.isArray(row.risk_flags) ? row.risk_flags.map(String) : []; return { id: String(row.id), conversationId: String(row.conversation_id), accountId: String(row.account_id), direction: row.direction as MessageRecord['direction'], senderRole: row.sender_role as MessageRecord['senderRole'], bodyType: row.body_type as MessageRecord['bodyType'], bodyText: row.body_text ? String(row.body_text) : undefined, bodyRef: row.body_ref ? String(row.body_ref) : undefined, redactionState: row.redaction_state as MessageRecord['redactionState'], status: row.status as MessageRecord['status'], readStatus: Number(row.read_status ?? 0) === 2 ? 2 : 0, readAt: iso(row.read_at), externalMessageRef: row.external_message_ref ? String(row.external_message_ref) : undefined, source: row.source as MessageRecord['source'], orderRef: row.order_ref ? String(row.order_ref) : undefined, productRef: row.product_ref ? String(row.product_ref) : undefined, riskFlags, handlingMode: row.handling_mode as MessageRecord['handlingMode'], createdAt: new Date(String(row.created_at)).toISOString() }; }
  private toAutoReplyRun(row: Row): AutoReplyRunRecord {
    const riskFlags = Array.isArray(row.risk_flags) ? row.risk_flags.map(String) : [];
    const orderRefs = Array.isArray(row.order_refs) ? row.order_refs.map(String) : [];
    return { id: String(row.id), adminId: String(row.admin_id), accountId: String(row.account_id), conversationId: String(row.conversation_id), inboundMessageId: String(row.inbound_message_id), intent: String(row.intent), decision: row.decision as AutoReplyRunRecord['decision'], status: row.status as AutoReplyRunRecord['status'], riskFlags, productId: row.product_id ? String(row.product_id) : undefined, orderRefs, inputDigest: String(row.input_digest), contextDigest: row.context_digest ? String(row.context_digest) : undefined, replyDigest: row.reply_digest ? String(row.reply_digest) : undefined, senderOutcome: row.sender_outcome as AutoReplyRunRecord['senderOutcome'], outboundMessageId: row.outbound_message_id ? String(row.outbound_message_id) : undefined, failureCode: row.failure_code ? String(row.failure_code) : undefined, createdAt: dateIso(row.created_at), updatedAt: dateIso(row.updated_at) };
  }
  private toAutoReplyRunEvent(row: Row): AutoReplyRunEventRecord { const payload = row.payload_json && typeof row.payload_json === 'object' && !Array.isArray(row.payload_json) ? row.payload_json as Record<string, unknown> : {}; return { id: String(row.id), runId: String(row.run_id), accountId: String(row.account_id), sequence: Number(row.sequence), eventType: String(row.event_type), stage: row.stage as AutoReplyRunStage, status: row.status as AutoReplyRunStatus, occurredAt: dateIso(row.occurred_at), durationMs: row.duration_ms === null || row.duration_ms === undefined ? undefined : Number(row.duration_ms), traceId: row.trace_id ? String(row.trace_id) : undefined, payload: { ...payload } }; }
  private toInboundInbox(row: Row): InboundInboxRecord { return { id: String(row.id), adminId: String(row.admin_id), accountId: String(row.account_id), conversationId: String(row.conversation_id), inboundMessageId: String(row.inbound_message_id), externalConversationRef: String(row.external_conversation_ref), externalMessageRef: String(row.external_message_ref), sourceEventId: row.source_event_id ? String(row.source_event_id) : undefined, sourceSequence: row.source_sequence === null || row.source_sequence === undefined ? undefined : Number(row.source_sequence), status: row.status as InboundInboxRecord['status'], attempt: Number(row.attempt ?? 0), availableAt: dateIso(row.available_at), lockedAt: iso(row.locked_at), leaseExpiresAt: iso(row.lease_expires_at), leaseOwner: row.lease_owner ? String(row.lease_owner) : undefined, lastErrorCode: row.last_error_code ? String(row.last_error_code) : undefined, lastErrorDigest: row.last_error_digest ? String(row.last_error_digest) : undefined, lastErrorAt: iso(row.last_error_at), processedAt: iso(row.processed_at), createdAt: dateIso(row.created_at), updatedAt: dateIso(row.updated_at) }; }
  private toAutoReplyRunListItem(row: Row): AutoReplyRunListItem { const run = this.toAutoReplyRun(row); return { ...run, ...projectAutoReplyRun(run), stage: autoReplyStageForStatus(run.status), durationMs: Math.max(0, Number(row.duration_ms ?? (Date.parse(run.updatedAt) - Date.parse(run.createdAt)))), buyerDisplayName: row.buyer_display_name ? String(row.buyer_display_name) : undefined, productTitle: row.product_title ? String(row.product_title) : undefined, inboundMessagePreview: row.inbound_message_preview ? String(row.inbound_message_preview).slice(0, 180) : undefined }; }
  private statusForAutoReplyStage(stage: AutoReplyRunStage): AutoReplyRunStatus { const map: Record<AutoReplyRunStage, AutoReplyRunStatus> = { gateway_received: 'received', intent_recognition: 'classified', context_read: 'context_loaded', reply_generation: 'generated', sending: 'simulated', persisted: 'persisted', handoff: 'handoff', skipped: 'skipped', failed: 'failed' }; return map[stage]; }
  private toConversationEvent(row: Row): ConversationEventRecord { const payload = row.payload_json && typeof row.payload_json === 'object' && !Array.isArray(row.payload_json) ? row.payload_json as Record<string, unknown> : {}; return { eventId: String(row.event_id), conversationId: String(row.conversation_id), accountId: String(row.account_id), cursor: Number(row.cursor), type: row.type as ConversationEventRecord['type'], occurredAt: new Date(String(row.occurred_at)).toISOString(), traceId: String(row.trace_id), payload }; }

  private toAdmin(row: Row): AdminRecord { return { id: String(row.id), email: String(row.email), passwordHash: String(row.password_hash), displayName: String(row.display_name ?? ''), role: String(row.role), status: row.status as AdminRecord['status'], createdAt: new Date(String(row.created_at)).toISOString(), lastLoginAt: iso(row.last_login_at) }; }
  private toSession(row: Row): SessionRecord { return { id: String(row.id), adminId: String(row.admin_id), issuedAt: new Date(String(row.issued_at)).toISOString(), lastSeenAt: new Date(String(row.last_seen_at)).toISOString(), expiresAt: new Date(String(row.expires_at)).toISOString(), csrfTokenHash: String(row.csrf_token_hash), revokedAt: iso(row.revoked_at) }; }
  private toScope(row: Row): AccountScopeRecord { return { id: String(row.id), adminId: String(row.admin_id), accountId: String(row.account_id), scope: String(row.scope), status: row.status as AccountScopeRecord['status'], expiresAt: iso(row.expires_at), revokedAt: iso(row.revoked_at) }; }
  private toAccount(row: Row): AccountRecord { return { id: String(row.id), platform: String(row.platform), sellerRef: String(row.seller_ref), displayName: row.display_name ? String(row.display_name) : undefined, remark: row.remark ? String(row.remark) : undefined, avatarUrl: row.avatar_url ? String(row.avatar_url) : undefined, platformUserId: row.platform_user_id ? String(row.platform_user_id) : undefined, status: row.status as AccountRecord['status'], createdAt: new Date(String(row.created_at)).toISOString(), updatedAt: new Date(String(row.updated_at)).toISOString(), lastConnectedAt: iso(row.last_connected_at) }; }
  private toProduct(row: Row): ProductRecord {
    const attributes = row.attributes_json && typeof row.attributes_json === 'object' && !Array.isArray(row.attributes_json) ? row.attributes_json as Record<string, unknown> : {};
    return { id: String(row.id), accountId: String(row.account_id), externalProductRef: row.external_product_ref ? String(row.external_product_ref) : undefined, title: String(row.title), description: row.description ? String(row.description) : undefined, categoryCode: row.category_code ? String(row.category_code) : undefined, attributes: { ...attributes }, defaultReplyTemplate: row.default_reply_template ? String(row.default_reply_template) : undefined, knowledgeBase: row.knowledge_base ? String(row.knowledge_base) : undefined, configVersion: Number(row.config_version ?? 1), priceMinor: row.price_minor === null || row.price_minor === undefined ? undefined : Number(row.price_minor), status: row.status as ProductRecord['status'], source: (row.source ?? 'local') as ProductRecord['source'], lastSyncedAt: iso(row.last_synced_at), xianyuUpdatedAt: iso(row.xianyu_updated_at), xianyuListRank: row.xianyu_list_rank === null || row.xianyu_list_rank === undefined ? undefined : Number(row.xianyu_list_rank), sourcePayloadDigest: row.source_payload_digest ? String(row.source_payload_digest) : undefined, createdAt: new Date(String(row.created_at)).toISOString(), updatedAt: new Date(String(row.updated_at)).toISOString(), skuCount: Number(row.sku_count ?? 0), assetCount: Number(row.asset_count ?? 0), couponBatches: this.toProductCouponBatches(row.coupon_batches) };
  }
  private toAutoReplyProduct(row: Row): AutoReplyProductContext {
    return {
      id: String(row.id),
      externalProductRef: row.external_product_ref ? String(row.external_product_ref) : undefined,
      title: String(row.title),
      description: row.description ? String(row.description) : undefined,
      browseCount: normalizeAutoReplyProductMetric(row.browse_count),
      wantCount: normalizeAutoReplyProductMetric(row.want_count),
      collectCount: normalizeAutoReplyProductMetric(row.collect_count),
      defaultReplyTemplate: row.default_reply_template ? String(row.default_reply_template) : undefined,
      knowledgeBase: row.knowledge_base ? String(row.knowledge_base) : undefined,
      priceMinor: row.price_minor === null || row.price_minor === undefined ? undefined : Number(row.price_minor),
      status: row.status as AutoReplyProductContext['status'],
    };
  }
  private toAutoReplyOrder(row: Row): AutoReplyOrderContext {
    return {
      orderNo: String(row.order_no),
      itemId: String(row.item_id ?? ''),
      itemTitle: String(row.item_title ?? row.item_id ?? ''),
      paymentStatus: row.payment_status as AutoReplyOrderContext['paymentStatus'],
      orderStatus: row.order_status as AutoReplyOrderContext['orderStatus'],
      deliveryStatus: row.delivery_status as AutoReplyOrderContext['deliveryStatus'],
      afterSalesStatus: row.after_sales_status as AutoReplyOrderContext['afterSalesStatus'],
    };
  }
  private toAutoReplyConversation(row: Row): AutoReplyConversationContext {
    return {
      id: String(row.id),
      itemRef: row.item_ref ? String(row.item_ref) : undefined,
      itemTitle: row.item_title ? String(row.item_title) : undefined,
    };
  }
  private toAutoReplyMessage(row: Row): AutoReplyMessageContext {
    return {
      messageId: row.id ? String(row.id) : undefined,
      direction: row.direction as AutoReplyMessageContext['direction'],
      senderRole: row.sender_role as AutoReplyMessageContext['senderRole'],
      bodyType: row.body_type as AutoReplyMessageContext['bodyType'],
      bodyText: row.body_text ? String(row.body_text) : undefined,
      bodyRef: row.body_ref ? String(row.body_ref) : undefined,
    };
  }
  private toProductAutomation(row: Row): ProductAutomationConfigRecord {
    const config: ProductAutomationConfig = row.config_json && typeof row.config_json === 'object' && !Array.isArray(row.config_json)
      ? row.config_json as ProductAutomationConfig
      : { paidAutoDelivery: { enabled: false, couponBatchIds: [], autoConfirm: true, maxAttempts: 3, retryBackoffSeconds: 30 }, unpaidAutoReprice: { enabled: false, mode: 'fixed', targetPriceMinor: 0, maxAttempts: 3, retryBackoffSeconds: 30 }, reviewGift: { enabled: false, couponBatchIds: [], maxAttempts: 3, retryBackoffSeconds: 30 }, reviewReminder: { enabled: false, firstDelayMinutes: 72 * 60, repeatIntervalMinutes: 24 * 60, maxReminders: 1, message: '' } };
    return { id: String(row.id), productId: String(row.product_id), accountId: String(row.account_id), configVersion: Number(row.config_version ?? 1), config: structuredClone(config), configDigest: String(row.config_digest ?? ''), createdAt: dateIso(row.created_at), updatedAt: dateIso(row.updated_at) };
  }
  private toOrder(row: Row): OrderRecord {
    return {
      id: String(row.id),
      orderNo: String(row.order_no),
      accountId: String(row.account_id),
      accountName: row.account_name ? String(row.account_name) : undefined,
      buyerId: String(row.buyer_id ?? ''),
      buyerName: String(row.buyer_name ?? ''),
      buyerNickname: row.display_buyer_nickname ? String(row.display_buyer_nickname) : row.buyer_nickname ? String(row.buyer_nickname) : undefined,
      buyerAvatarUrl: row.display_buyer_avatar_url ? String(row.display_buyer_avatar_url) : row.buyer_avatar_url ? String(row.buyer_avatar_url) : undefined,
      itemId: String(row.item_id ?? ''),
      itemTitle: (() => { const itemId = String(row.item_id ?? ''); const title = String(row.display_item_title ?? row.item_title ?? ''); return title.trim() && title.trim() !== itemId.trim() ? title : ''; })(),
      skuSpec: row.sku_spec ? String(row.sku_spec) : undefined,
      itemImageUrl: row.display_item_image_url ? String(row.display_item_image_url) : undefined,
      amountMinor: Number(row.amount_minor ?? 0),
      paymentStatus: row.payment_status as OrderRecord['paymentStatus'],
      orderStatus: row.order_status as OrderRecord['orderStatus'],
      deliveryStatus: row.delivery_status as OrderRecord['deliveryStatus'],
      afterSalesStatus: row.after_sales_status as OrderRecord['afterSalesStatus'],
      deliveryType: row.delivery_type as OrderRecord['deliveryType'],
      createdAt: dateIso(row.created_at),
      updatedAt: dateIso(row.updated_at),
      deliveryFailReason: row.delivery_fail_reason ? String(row.delivery_fail_reason) : undefined,
      conversationId: row.conversation_id ? String(row.conversation_id) : undefined,
      productId: row.product_id ? String(row.product_id) : undefined,
      configVersion: Number(row.config_version ?? 1),
      source: (row.source ?? 'local') as OrderRecord['source'],
      sourcePayloadDigest: row.source_payload_digest ? String(row.source_payload_digest) : undefined,
      reviewedAt: iso(row.reviewed_at),
      reminderCount: Number(row.review_reminder_count ?? 0),
      lastReminderAt: iso(row.last_review_reminder_at),
    };
  }
  private toDeliveryRecord(row: Row): DeliveryRecord {
    return {
      id: String(row.id),
      orderId: String(row.order_id),
      orderNo: String(row.order_no),
      accountId: String(row.account_id),
      deliveryType: row.delivery_type as DeliveryRecord['deliveryType'],
      status: row.status as DeliveryRecordStatus,
      idempotencyScope: String(row.idempotency_scope),
      idempotencyKey: String(row.idempotency_key),
      attempt: Number(row.attempt ?? 1),
      couponItemId: row.coupon_item_id ? String(row.coupon_item_id) : undefined,
      trackingRef: row.tracking_ref ? String(row.tracking_ref) : undefined,
      deliveredAt: iso(row.delivered_at),
      failureCode: row.failure_code ? String(row.failure_code) : undefined,
      failureMessage: row.failure_message ? String(row.failure_message) : undefined,
      externalOutcome: row.external_outcome ? row.external_outcome as DeliveryRecord['externalOutcome'] : undefined,
      externalRef: row.external_ref ? String(row.external_ref) : undefined,
      createdAt: dateIso(row.created_at),
      updatedAt: dateIso(row.updated_at),
    };
  }
  private toAutomationExecution(row: Row): AutomationExecutionLedgerRecord {
    return {
      executionKey: String(row.execution_key),
      fingerprint: String(row.fingerprint),
      status: row.status as AutomationExecutionLedgerRecord['status'],
      result: row.result_json === null || row.result_json === undefined ? undefined : row.result_json,
      retryable: Boolean(row.retryable),
      ownerToken: row.owner_token ? String(row.owner_token) : undefined,
      leaseUntil: iso(row.lease_until),
      attemptCount: Number(row.attempt_count ?? 0),
      createdAt: dateIso(row.created_at),
      updatedAt: dateIso(row.updated_at),
    };
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
  private toProductAsset(row: Row): ProductAssetRecord {
    const metadata = row.metadata_json && typeof row.metadata_json === 'object' && !Array.isArray(row.metadata_json) ? row.metadata_json as Record<string, unknown> : undefined;
    return { id: String(row.id), productId: String(row.product_id), storageKey: String(row.storage_key), mimeType: String(row.mime_type), checksum: row.checksum ? String(row.checksum) : undefined, sourceUrl: row.source_url ? String(row.source_url) : undefined, metadata, status: row.status as ProductAssetRecord['status'] };
  }
  private toIdempotency(row: Row): IdempotencyRecord { return { scope: String(row.scope), key: String(row.key), requestFingerprint: String(row.request_fingerprint), status: row.status as IdempotencyRecord['status'], responseEnvelope: row.response_envelope, statusCode: row.status_code ? Number(row.status_code) : undefined, traceId: row.trace_id ? String(row.trace_id) : undefined, expiresAt: new Date(String(row.expires_at)).toISOString() }; }
  private toAgentSession(row: Row): AgentSessionRecord { return { id: String(row.id), accountId: String(row.account_id), title: String(row.title), status: row.status as AgentSessionRecord['status'], summary: row.summary ? String(row.summary) : undefined, lastActiveAt: new Date(String(row.last_active_at)).toISOString(), archivedAt: iso(row.archived_at), createdAt: new Date(String(row.created_at)).toISOString(), updatedAt: new Date(String(row.updated_at)).toISOString() }; }
  private toRun(row: Row): RunRecord { return { id: String(row.id), accountId: String(row.account_id), sessionId: String(row.session_id), route: String(row.route), instruction: String(row.instruction), status: row.status as RunRecord['status'], requestedBy: String(row.requested_by), clientRunRef: row.client_run_ref ? String(row.client_run_ref) : undefined, resultSummary: row.result_summary ? String(row.result_summary) : undefined, errorCode: row.error_code ? String(row.error_code) : undefined, createdAt: new Date(String(row.created_at)).toISOString(), updatedAt: new Date(String(row.updated_at)).toISOString(), startedAt: iso(row.started_at), finishedAt: iso(row.finished_at) }; }
  private toStep(row: Row): StepRecord { return { id: String(row.id), runId: String(row.run_id), stepNo: Number(row.step_no), kind: row.kind as StepRecord['kind'], label: String(row.label), status: row.status as StepRecord['status'], attempt: Number(row.attempt ?? 1), inputSummary: row.input_summary ? String(row.input_summary) : undefined, outputSummary: row.output_summary ? String(row.output_summary) : undefined, errorCode: row.error_code ? String(row.error_code) : undefined, createdAt: new Date(String(row.created_at)).toISOString(), startedAt: iso(row.started_at), finishedAt: iso(row.finished_at) }; }
  private toRunEvent(row: Row): RunEventRecord { const payload = row.payload_json && typeof row.payload_json === 'object' && !Array.isArray(row.payload_json) ? row.payload_json as Record<string, unknown> : {}; return { sequence: Number(row.sequence), runId: String(row.run_id), eventType: String(row.event_type), payload: { ...payload }, createdAt: new Date(String(row.created_at)).toISOString() }; }
  private toWorkspaceMessage(row: Row): WorkspaceMessageRecord { return { id: String(row.id), sessionId: String(row.session_id), runId: row.run_id ? String(row.run_id) : undefined, type: row.message_type as WorkspaceMessageType, content: String(row.content), summary: row.summary ? String(row.summary) : undefined, createdAt: new Date(String(row.created_at)).toISOString(), sequence: Number(row.sequence) }; }
  private toWorkspaceConfirmation(row: Row): WorkspaceConfirmationRecord {
    const manifest = row.manifest_json && typeof row.manifest_json === 'object' && !Array.isArray(row.manifest_json) ? row.manifest_json as Record<string, unknown> : {};
    return { id: String(row.id), runId: String(row.run_id), stepId: String(row.step_id), accountId: String(row.account_id), requestedBy: String(row.requested_by), action: row.action as WorkspaceConfirmationRecord['action'], policyRef: String(row.policy_ref), manifest: { ...manifest }, status: row.status as WorkspaceConfirmationRecord['status'], version: Number(row.version ?? 1), expiresAt: new Date(String(row.expires_at)).toISOString(), confirmedAt: iso(row.confirmed_at), confirmedBy: row.confirmed_by ? String(row.confirmed_by) : undefined, cancelledAt: iso(row.cancelled_at), createdAt: new Date(String(row.created_at)).toISOString(), updatedAt: new Date(String(row.updated_at)).toISOString() };
  }
  private normalizeLoginSession(row?: Row): LoginSessionRecord | undefined { if (!row) return undefined; if (row.status === 'waiting' && row.expires_at && new Date(String(row.expires_at)).getTime() <= Date.now()) { void this.pool.query('update auth.account_login_sessions set status=\'expired\', completed_at=now() where id=$1 and status=\'waiting\'', [row.id]); row.status = 'expired'; } return this.toLoginSession(row); }
  private toLoginSession(row: Row): LoginSessionRecord { return { id: String(row.id), adminId: row.admin_id ? String(row.admin_id) : undefined, accountId: row.account_id ? String(row.account_id) : undefined, provisionalAccountRef: row.provisional_account_ref ? String(row.provisional_account_ref) : undefined, loginMethod: String(row.login_method), status: row.status as LoginSessionRecord['status'], startedAt: new Date(String(row.started_at)).toISOString(), expiresAt: new Date(String(row.expires_at)).toISOString(), completedAt: iso(row.completed_at), failureCode: row.failure_code ? String(row.failure_code) : undefined, qrTokenRef: row.qr_token_ref ? String(row.qr_token_ref) : undefined }; }
  private toCredential(row: Row): CredentialRecord {
    const metadata = row.metadata_json && typeof row.metadata_json === 'object' && !Array.isArray(row.metadata_json) ? Object.fromEntries(Object.entries(row.metadata_json as Record<string, unknown>).map(([key, value]) => [key, String(value)])) : {};
    return { id: String(row.id), accountId: String(row.account_id), platform: String(row.platform), status: row.status as CredentialRecord['status'], cookieHeader: row.cookie_header ? String(row.cookie_header) : undefined, accessToken: row.access_token ? String(row.access_token) : undefined, deviceId: row.device_id ? String(row.device_id) : undefined, metadata, expiresAt: iso(row.expires_at), lastVerifiedAt: iso(row.last_verified_at), createdAt: new Date(String(row.created_at)).toISOString(), updatedAt: new Date(String(row.updated_at)).toISOString() };
  }
  private toCredentialRef(row: Row): CredentialRefRecord {
    const metadata = row.metadata_json && typeof row.metadata_json === 'object' && !Array.isArray(row.metadata_json)
      ? Object.fromEntries(Object.entries(row.metadata_json as Record<string, unknown>).map(([key, value]) => [key, String(value)]))
      : {};
    return {
      id: String(row.id),
      accountId: String(row.account_id),
      kind: 'api_key',
      purpose: 'model_client',
      label: row.label ? String(row.label) : undefined,
      status: row.status as CredentialRefStatus,
      version: Number(row.version ?? 1),
      provider: String(row.provider),
      alias: String(row.alias),
      fingerprint: String(row.checksum ?? row.fingerprint ?? ''),
      metadata,
      lastRotatedAt: iso(row.last_rotated_at),
      createdAt: new Date(String(row.created_at)).toISOString(),
      updatedAt: new Date(String(row.updated_at)).toISOString(),
      canReveal: false,
    };
  }
  private toAutoReplyAgentConfig(row: Row): AutoReplyAgentConfigRecord {
    const config = row.config_json && typeof row.config_json === 'object' && !Array.isArray(row.config_json)
      ? row.config_json as Record<string, unknown>
      : {};
    return {
      accountId: String(row.account_id),
      updatedByAdminId: row.updated_by_admin_id ? String(row.updated_by_admin_id) : undefined,
      enabled: Boolean(config.enabled),
      systemPrompt: String(config.systemPrompt ?? ''),
      userPromptTemplate: String(config.userPromptTemplate ?? ''),
      maxLoops: Number(config.maxLoops ?? 4),
      maxToolCalls: Number(config.maxToolCalls ?? 8),
      toolTimeoutMs: Number(config.toolTimeoutMs ?? 10_000),
      totalTimeoutMs: Number(config.totalTimeoutMs ?? 60_000),
      maxHistory: Number(config.maxHistory ?? 20),
      maxReplyLength: Number(config.maxReplyLength ?? 1_000),
      replySegmentDelayMs: Number(config.replySegmentDelayMs ?? 800),
      debounceMs: Number(config.debounceMs ?? 2_000),
      sendDelaySeconds: Number(config.sendDelaySeconds ?? 300),
      sendMode: config.sendMode === 'live' ? 'live' : 'simulate',
      configVersion: Number(row.config_version ?? 1),
      configDigest: String(row.config_digest ?? ''),
      createdAt: new Date(String(row.created_at)).toISOString(),
      updatedAt: new Date(String(row.updated_at)).toISOString(),
    };
  }
  private toAutoReplyOutbox(row: Row): AutoReplyOutboxRecord {
    const payload = row.payload_json && typeof row.payload_json === 'object' && !Array.isArray(row.payload_json) ? row.payload_json as Record<string, unknown> : {};
    return {
      id: String(row.id), scope: String(row.scope), aggregateType: String(row.aggregate_type), aggregateId: String(row.aggregate_id), operation: String(row.operation),
      status: row.status as AutoReplyOutboxRecord['status'], attempt: Number(row.attempt ?? 0), availableAt: dateIso(row.available_at), lockedAt: iso(row.locked_at), leaseExpiresAt: iso(row.lease_expires_at), leaseOwner: row.lease_owner ? String(row.lease_owner) : undefined,
      lastErrorCode: row.last_error_code ? String(row.last_error_code) : undefined, lastErrorDigest: row.last_error_digest ? String(row.last_error_digest) : undefined, externalOutcome: row.external_outcome ? row.external_outcome as AutoReplyOutboxRecord['externalOutcome'] : undefined,
      idempotencyKey: String(row.idempotency_key), payload: { ...payload }, externalMessageRef: row.external_message_ref ? String(row.external_message_ref) : undefined, outboundMessageId: row.outbound_message_id ? String(row.outbound_message_id) : undefined, traceId: row.trace_id ? String(row.trace_id) : undefined,
      createdAt: dateIso(row.created_at), updatedAt: dateIso(row.updated_at ?? row.created_at),
    };
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
