import { randomUUID, createHash } from 'node:crypto';
import { Pool } from 'pg';

const args = new Set(process.argv.slice(2));
const accountArgIndex = process.argv.indexOf('--account-id');
const accountId = accountArgIndex >= 0 ? process.argv[accountArgIndex + 1] : undefined;
const productRefArgIndex = process.argv.indexOf('--product-ref');
const productRef = productRefArgIndex >= 0 ? process.argv[productRefArgIndex + 1] : undefined;
const apply = args.has('--apply');
const databaseUrl = process.env.DATABASE_URL ?? 'postgres://xianyu:xianyu_dev_only@127.0.0.1:5432/xianyu_agent';

if (!accountId) {
  console.error('usage: node scripts/repair-product-automation-rules.mjs --account-id <uuid> [--product-ref <ref>] [--apply]');
  process.exitCode = 2;
} else {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const candidates = await findCandidates(pool, accountId, productRef);
    const report = candidates.map((candidate) => ({
      productId: candidate.productId,
      externalProductRef: candidate.externalProductRef,
      title: candidate.title,
      source: candidate.source,
      recovery: candidate.recovery,
      confidence: candidate.confidence,
      activeCouponBatchIds: candidate.activeCouponBatchIds,
      voidedActiveCouponBatchIds: candidate.voidedActiveCouponBatchIds,
      sourceProductId: candidate.sourceProductId,
    }));
    console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', accountId, candidates: report }, null, 2));
    if (apply) {
      const applied = [];
      for (const candidate of candidates) {
        const result = await applyCandidate(pool, candidate);
        if (result) applied.push(result);
      }
      console.log(JSON.stringify({ applied }, null, 2));
    }
  } finally {
    await pool.end();
  }
}

function defaultConfig(couponBatchIds = []) {
  return {
    paidAutoDelivery: { enabled: couponBatchIds.length > 0, couponBatchIds, autoConfirm: true, maxAttempts: 3, retryBackoffSeconds: 30 },
    unpaidAutoReprice: { enabled: false, mode: 'fixed', targetPriceMinor: 0, maxAttempts: 3, retryBackoffSeconds: 30 },
    reviewGift: { enabled: false, couponBatchIds: [], maxAttempts: 3, retryBackoffSeconds: 30 },
    reviewReminder: { enabled: false, firstDelayMinutes: 72 * 60, repeatIntervalMinutes: 24 * 60, maxReminders: 1, message: '如果使用满意，欢迎给个好评，谢谢支持～' },
  };
}

function digestJson(value) {
  return createHash('sha256').update(JSON.stringify(value, (_key, item) => typeof item === 'string' && item.length > 256 ? `${item.slice(0, 32)}…` : item)).digest('hex');
}

async function findCandidates(pool, accountId, requestedProductRef) {
  const params = [accountId];
  const filters = ['p.account_id=$1', 'p.source=\'xianyu\''];
  if (requestedProductRef) { params.push(requestedProductRef); filters.push(`p.external_product_ref=$${params.length}`); }
  const products = await pool.query(`select p.id,p.account_id,p.external_product_ref,p.title,p.source,p.attributes_json,
      a.product_id as configured_product_id,
      coalesce(json_agg(distinct cb.sequence_id order by cb.sequence_id) filter (where binding.status='active' and cb.status <> 'voided'), '[]'::json) as active_coupon_batch_ids,
      coalesce(json_agg(distinct cb.sequence_id order by cb.sequence_id) filter (where binding.status='active' and cb.status='voided'), '[]'::json) as voided_active_coupon_batch_ids
    from products.products p
    left join products.automation_configs a on a.product_id=p.id
    left join coupons.coupon_bindings binding on binding.product_id=p.id
    left join coupons.coupon_batches cb on cb.id=binding.coupon_batch_id
    where ${filters.join(' and ')}
    group by p.id,a.product_id
    order by p.external_product_ref,p.id`, params);

  const candidates = [];
  for (const row of products.rows) {
    if (row.configured_product_id) continue;
    const activeCouponBatchIds = Array.isArray(row.active_coupon_batch_ids) ? row.active_coupon_batch_ids.map((value) => String(value)) : [];
    const voidedActiveCouponBatchIds = Array.isArray(row.voided_active_coupon_batch_ids) ? row.voided_active_coupon_batch_ids.map((value) => String(value)) : [];
    if (activeCouponBatchIds.length > 0) {
      candidates.push({
        productId: String(row.id),
        accountId: String(row.account_id),
        externalProductRef: String(row.external_product_ref ?? ''),
        title: String(row.title),
        source: String(row.source),
        activeCouponBatchIds,
        recovery: 'active_coupon_binding_recovery',
        confidence: 'high',
        voidedActiveCouponBatchIds,
      });
      continue;
    }
    if (voidedActiveCouponBatchIds.length > 0) {
      candidates.push({
        productId: String(row.id),
        accountId: String(row.account_id),
        externalProductRef: String(row.external_product_ref ?? ''),
        title: String(row.title),
        source: String(row.source),
        activeCouponBatchIds: [],
        voidedActiveCouponBatchIds,
        recovery: 'orphan_binding_manual_review',
        confidence: 'manual_review',
      });
      continue;
    }
    const source = await findUniqueLegacySource(pool, row, accountId);
    if (source) candidates.push({
      productId: String(row.id),
      accountId: String(row.account_id),
      externalProductRef: String(row.external_product_ref ?? ''),
      title: String(row.title),
      source: String(row.source),
      activeCouponBatchIds: [],
      voidedActiveCouponBatchIds: [],
      recovery: 'legacy_product_identity_relink',
      confidence: 'high',
      sourceProductId: source.productId,
      sourceConfig: source.config,
      sourceConfigVersion: source.configVersion,
      sourceBindings: source.bindings,
    });
  }
  return candidates;
}

async function findUniqueLegacySource(pool, target, accountId) {
  const targetAttrs = asRecord(target.attributes_json);
  const targetXianyu = asRecord(targetAttrs.xianyu);
  const targetDetailUrl = stringValue(targetXianyu.detailUrl);
  const targetImage = firstImage(targetXianyu.imageUrls);
  const sourceRows = await pool.query(`select p.id,p.title,p.attributes_json,a.config_json,a.config_version,
      coalesce(json_agg(json_build_object('coupon_batch_id', cb.id, 'sequence_id', cb.sequence_id)) filter (where binding.status='active' and cb.status <> 'voided'), '[]'::json) as bindings
    from products.products p
    join products.automation_configs a on a.product_id=p.id
    left join coupons.coupon_bindings binding on binding.product_id=p.id
    left join coupons.coupon_batches cb on cb.id=binding.coupon_batch_id
    where p.account_id=$1 and p.id<>$2 and p.source='xianyu'
    group by p.id,a.config_json,a.config_version`, [accountId, target.id]);
  const matches = sourceRows.rows.map((row) => {
    const attrs = asRecord(row.attributes_json);
    const xianyu = asRecord(attrs.xianyu);
    const detailUrl = stringValue(xianyu.detailUrl);
    const image = firstImage(xianyu.imageUrls);
    let score = 0;
    if (String(row.title) === String(target.title)) score += 2;
    if (targetDetailUrl && detailUrl && targetDetailUrl === detailUrl) score += 4;
    if (targetImage && image && targetImage === image) score += 3;
    return { row, score, config: row.config_json, configVersion: Number(row.config_version ?? 1), bindings: Array.isArray(row.bindings) ? row.bindings : [] };
  }).filter((entry) => entry.score >= 4).sort((left, right) => right.score - left.score);
  if (matches.length !== 1 || (matches[1] && matches[1].score === matches[0].score)) return undefined;
  return { productId: String(matches[0].row.id), config: matches[0].config, configVersion: matches[0].configVersion, bindings: matches[0].bindings };
}

async function applyCandidate(pool, candidate) {
  if (candidate.recovery === 'orphan_binding_manual_review') return { productId: candidate.productId, status: 'skipped_voided_coupon_binding' };
  const client = await pool.connect();
  try {
    await client.query('begin');
    const target = await client.query('select id,account_id from products.products where id=$1 and account_id=$2 for update', [candidate.productId, candidate.accountId]);
    if (!target.rows[0]) { await client.query('rollback'); return { productId: candidate.productId, status: 'skipped_missing_product' }; }
    const existing = await client.query('select 1 from products.automation_configs where product_id=$1', [candidate.productId]);
    if (existing.rows[0]) { await client.query('rollback'); return { productId: candidate.productId, status: 'skipped_already_configured' }; }

    const config = candidate.recovery === 'legacy_product_identity_relink' ? candidate.sourceConfig : defaultConfig(candidate.activeCouponBatchIds);
    const configVersion = candidate.recovery === 'legacy_product_identity_relink' ? candidate.sourceConfigVersion : 1;
    await client.query(`insert into products.automation_configs (id,product_id,account_id,config_version,config_json,config_digest)
      values ($1,$2,$3,$4,$5::jsonb,$6)`, [randomUUID(), candidate.productId, candidate.accountId, configVersion, JSON.stringify(config), digestJson(config)]);

    if (candidate.recovery === 'legacy_product_identity_relink') {
      for (const binding of candidate.sourceBindings ?? []) {
        const batchId = String(binding.coupon_batch_id ?? '');
        if (!batchId) continue;
        await client.query(`insert into coupons.coupon_bindings (id,coupon_batch_id,product_id,priority,status)
          values ($1,$2,$3,0,'active')
          on conflict (coupon_batch_id,product_id) do update set status='active',updated_at=now()`, [randomUUID(), batchId, candidate.productId]);
      }
    }
    const payload = { productId: candidate.productId, sourceProductId: candidate.sourceProductId, recovery: candidate.recovery, activeCouponBatchIds: candidate.activeCouponBatchIds };
    await client.query(`insert into observability.audit_events
      (id,actor_type,action,target_ref,request_id,trace_id,payload_digest,account_id,reason)
      values ($1,'system',$2,$3,$4,$5,$6,$7,$8)`, [randomUUID(), 'product.automation.recovered', candidate.productId, `repair:${candidate.recovery}:${candidate.productId}`, `repair:${candidate.recovery}:${candidate.productId}`, digestJson(payload), candidate.accountId, candidate.recovery]);
    await client.query('commit');
    return { productId: candidate.productId, status: 'recovered', recovery: candidate.recovery };
  } catch (error) {
    try { await client.query('rollback'); } catch { /* preserve original error */ }
    throw error;
  } finally { client.release(); }
}

function asRecord(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function stringValue(value) { return typeof value === 'string' && value.trim() ? value.trim() : undefined; }
function firstImage(value) { return Array.isArray(value) ? value.map(stringValue).find(Boolean) : stringValue(value); }
