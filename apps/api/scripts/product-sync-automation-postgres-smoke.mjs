import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createApp } from '../dist/app.js';
import { hashPassword } from '../dist/security.js';

const databaseUrl = process.env.DATABASE_URL ?? 'postgres://xianyu:xianyu_dev_only@127.0.0.1:5432/xianyu_agent';
const runtime = createApp({ host: '127.0.0.1', port: 0, databaseUrl, cookieSecure: false, allowInMemory: false, sessionIdleMs: 1_800_000, sessionAbsoluteMs: 28_800_000, xianyuQrMode: 'stub' });
let adminId;
let accountId;
let productId;
let couponId;

for (const migration of ['003_catalog.sql', '013_coupons.sql', '013_product_sync.sql', '031_product_automation.sql']) {
  await runtime.store.pool.query(await readFile(new URL(`../migrations/${migration}`, import.meta.url), 'utf8'));
}

try {
  const admin = await runtime.store.createAdmin({ email: `product-sync-postgres-${process.pid}-${Date.now()}@example.com`, passwordHash: await hashPassword('password-123'), displayName: 'Product Sync Postgres' });
  adminId = admin.id;
  const account = await runtime.store.createAccount({ adminId, platform: 'xianyu', sellerRef: `product-sync-postgres-${process.pid}-${Date.now()}` });
  accountId = account.id;
  const product = await runtime.store.createProduct({ adminId, accountId, externalProductRef: `OLD-${process.pid}`, title: '旧商品', status: 'published' });
  productId = product.id;
  const coupon = await runtime.store.createCouponBatch({ adminId, accountId, label: '恢复测试卡券', purpose: 'text' });
  couponId = coupon.id;
  const config = {
    paidAutoDelivery: { enabled: true, couponBatchIds: [coupon.id], autoConfirm: true, maxAttempts: 3, retryBackoffSeconds: 30 },
    unpaidAutoReprice: { enabled: false, mode: 'fixed', targetPriceMinor: 0, maxAttempts: 3, retryBackoffSeconds: 30 },
    reviewGift: { enabled: false, couponBatchIds: [], maxAttempts: 3, retryBackoffSeconds: 30 },
    reviewReminder: { enabled: false, firstDelayMinutes: 4320, repeatIntervalMinutes: 1440, maxReminders: 1, message: '如果使用满意，欢迎给个好评，谢谢支持～' },
  };
  await runtime.store.updateProductAutomation({ adminId, productId, expectedConfigVersion: 1, config, configDigest: 'before-sync' });

  const result = await runtime.store.upsertExternalProduct({
    adminId,
    accountId,
    syncedAt: '2026-09-26T00:00:00.000Z',
    item: { externalProductRef: `NEW-${process.pid}`, externalProductRefs: [`NEW-${process.pid}`, `OLD-${process.pid}`], title: '同步后的商品', priceMinor: 1990, sourcePayloadDigest: 'digest' },
  });
  assert.equal(result.action, 'updated');
  assert.equal(result.product.id, productId);
  assert.equal(result.product.externalProductRef, `NEW-${process.pid}`);
  const saved = await runtime.store.getProductAutomation(adminId, productId);
  assert.equal(saved?.configDigest, 'before-sync');
  assert.equal(saved?.config.paidAutoDelivery.enabled, true);
  const bindings = await runtime.store.pool.query('select status from coupons.coupon_bindings where product_id=$1 and coupon_batch_id=$2', [productId, couponId]);
  assert.equal(bindings.rows[0]?.status, 'active');
  console.log('product sync automation postgres smoke passed');
} finally {
  if (productId) await runtime.store.pool.query('delete from coupons.coupon_bindings where product_id=$1', [productId]);
  if (productId) await runtime.store.pool.query('delete from products.automation_configs where product_id=$1', [productId]);
  if (productId) await runtime.store.pool.query('delete from products.products where id=$1', [productId]);
  if (couponId) await runtime.store.pool.query('delete from coupons.coupon_items where batch_id=$1', [couponId]);
  if (couponId) await runtime.store.pool.query('delete from coupons.coupon_batches where id=$1', [couponId]);
  if (accountId) await runtime.store.pool.query('delete from observability.audit_events where account_id=$1', [accountId]);
  if (accountId) await runtime.store.pool.query('delete from auth.account_credentials where account_id=$1', [accountId]);
  if (accountId) await runtime.store.pool.query('delete from auth.account_scopes where account_id=$1', [accountId]);
  if (accountId) await runtime.store.pool.query('delete from accounts.accounts where id=$1', [accountId]);
  if (adminId) {
    await runtime.store.pool.query('delete from auth.sessions where admin_id=$1', [adminId]);
    await runtime.store.pool.query('delete from auth.admins where id=$1', [adminId]);
  }
  await runtime.close();
}
