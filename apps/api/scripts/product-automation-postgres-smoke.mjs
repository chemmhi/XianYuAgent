import assert from 'node:assert/strict';
import { createApp } from '../dist/app.js';

const databaseUrl = process.env.DATABASE_URL ?? 'postgres://xianyu:xianyu_dev_only@127.0.0.1:5432/xianyu_agent';
const config = { host: '127.0.0.1', port: 0, databaseUrl, redisUrl: '', cookieSecure: false, allowInMemory: false, sessionIdleMs: 1_800_000, sessionAbsoluteMs: 28_800_000, xianyuQrMode: 'stub', webSocketAllowedOrigins: [], agentRuntime: 'in-process', modelTimeoutMs: 1000, credentialEncryptionKey: 'test-key', objectStorageEndpoint: 'http://127.0.0.1:19000', objectStorageAccessKey: 'xianyu', objectStorageSecretKey: 'xianyu', objectStorageBucket: 'xianyu-assets', objectStorageRegion: 'us-east-1' };
const runtime = createApp(config);
await runtime.listen();
const suffix = `${process.pid}-${Date.now()}`;
try {
  const healthy = await runtime.store.health();
  assert.equal(healthy.reachable, true, 'PostgreSQL must be reachable; apply migrations before running this smoke');
  const admin = await runtime.store.createAdmin({ email: `automation-pg-${suffix}@example.com`, passwordHash: 'hash', displayName: 'Automation PG' });
  const account = await runtime.store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: `automation-pg-${suffix}` });
  const product = await runtime.store.createProduct({ adminId: admin.id, accountId: account.id, externalProductRef: `pg-item-${suffix}`, title: '自动化 PG 商品', status: 'published' });
  const second = await runtime.store.createProduct({ adminId: admin.id, accountId: account.id, title: '自动化 PG 商品 2', status: 'published' });
  const coupon = await runtime.store.createCouponBatch({ adminId: admin.id, accountId: account.id, label: 'PG 自动化卡券', purpose: 'text', deliveryScope: 'buyer_deliverable' });
  await runtime.store.importCouponItems({ adminId: admin.id, batchId: coupon.id, contents: [`pg-coupon-${suffix}`] });
  const defaultConfig = await runtime.productAutomation.get(admin.id, product.id);
  const configValue = { ...defaultConfig.config, paidAutoDelivery: { ...defaultConfig.config.paidAutoDelivery, enabled: true, couponBatchIds: [coupon.id], autoConfirm: true } };
  const saved = await runtime.productAutomation.update({ adminId: admin.id, productId: product.id, expectedConfigVersion: 1, config: configValue, requestId: `pg-save-${suffix}`, traceId: `pg-save-${suffix}` });
  assert.equal(saved.configVersion, 1);
  const linkedOrder = await runtime.store.upsertExternalOrder({ adminId: admin.id, accountId: account.id, syncedAt: new Date().toISOString(), item: { orderNo: `PG-LINK-${suffix}`, buyerId: 'pg-link-buyer', buyerName: 'PG 关联买家', itemId: `pg-item-${suffix}`, itemTitle: `pg-item-${suffix}`, amountMinor: 1000, paymentStatus: 'paid', orderStatus: 'open', deliveryStatus: 'pending', afterSalesStatus: 'none', deliveryType: 'coupon_only', createdAt: new Date().toISOString(), sourcePayloadDigest: `pg-link-${suffix}` } });
  assert.equal(linkedOrder.order.productId, product.id, 'externalProductRef must resolve productId on external order upsert');
} finally {
  await runtime.close();
}

const reopened = createApp(config);
await reopened.listen();
try {
  const admin = await reopened.store.findAdminByEmail(`automation-pg-${suffix}@example.com`);
  assert.ok(admin);
  const accounts = await reopened.store.listAccounts(admin.id, { page: 1, pageSize: 10 });
  const account = accounts.items.find((item) => item.sellerRef === `automation-pg-${suffix}`);
  assert.ok(account);
  const products = await reopened.store.listProducts(admin.id, { accountId: account.id, page: 1, pageSize: 10 });
  const product = products.items.find((item) => item.title === '自动化 PG 商品');
  const second = products.items.find((item) => item.title === '自动化 PG 商品 2');
  assert.ok(product && second);
  const persisted = await reopened.productAutomation.get(admin.id, product.id);
  assert.equal(persisted.configVersion, 1);
  assert.equal(persisted.config.paidAutoDelivery.enabled, true);
  await assert.rejects(() => reopened.productAutomation.updateBatch({ adminId: admin.id, productIds: [product.id, second.id], expectedConfigVersions: { [product.id]: 2, [second.id]: 1 }, config: persisted.config, requestId: `pg-batch-${suffix}`, traceId: `pg-batch-${suffix}` }), (error) => error?.code === 'AUTOMATION_VERSION_CONFLICT');
  assert.equal((await reopened.productAutomation.get(admin.id, product.id)).configVersion, 1, 'batch conflict must not partially update product one');
  console.log('product automation PostgreSQL smoke passed');
} finally {
  await reopened.close();
}
