import assert from 'node:assert/strict';
import { createApp } from '../dist/app.js';

const port = 18980 + (process.pid % 200);
const runtime = createApp({ host: '127.0.0.1', port, cookieSecure: false, allowInMemory: true, sessionIdleMs: 1_800_000, sessionAbsoluteMs: 28_800_000, xianyuQrMode: 'stub', webSocketAllowedOrigins: [], agentRuntime: 'in-process', modelTimeoutMs: 1000, credentialEncryptionKey: 'test-key', objectStorageEndpoint: 'http://127.0.0.1:19000', objectStorageAccessKey: 'xianyu', objectStorageSecretKey: 'xianyu', objectStorageBucket: 'xianyu-assets', objectStorageRegion: 'us-east-1' });
await runtime.listen();

function cookiesFrom(response) { return (response.headers.getSetCookie?.() ?? []).map((value) => value.split(';', 1)[0]).join('; '); }
async function request(path, options = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { ...options, headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers ?? {}) } });
  const body = await response.json();
  return { response, body };
}

try {
  const bootstrap = await request('/api/v1/auth/bootstrap', { method: 'POST', headers: { 'Idempotency-Key': 'automation-bootstrap' }, body: JSON.stringify({ email: 'automation-api@example.com', password: 'password-123', displayName: 'Automation API' }) });
  assert.equal(bootstrap.response.status, 200);
  const cookie = cookiesFrom(bootstrap.response);
  const csrf = decodeURIComponent(cookie.match(/csrf_token=([^;]+)/)?.[1] ?? '');
  const adminId = bootstrap.body.data.profile.id;
  const account = await runtime.store.createAccount({ adminId, platform: 'xianyu', sellerRef: 'automation-api-seller' });
  const product = await runtime.store.createProduct({ adminId, accountId: account.id, title: '自动化 API 商品', status: 'published' });
  const second = await runtime.store.createProduct({ adminId, accountId: account.id, title: '批量 API 商品', status: 'published' });
  const associationOnlyProduct = await runtime.store.createProduct({ adminId, accountId: account.id, title: '仅关联 API 商品', status: 'published' });
  const coupon = await runtime.store.createCouponBatch({ adminId, accountId: account.id, label: '自动化 API 卡券', purpose: 'text', deliveryScope: 'buyer_deliverable' });
  await runtime.store.importCouponItems({ adminId, batchId: coupon.id, contents: ['api-coupon-1'] });
  const associationOnlyCoupon = await runtime.store.createCouponBatch({ adminId, accountId: account.id, label: '仅关联 API 卡券', purpose: 'text', deliveryScope: 'operator_only' });

  const initial = await request(`/api/v1/products/${product.id}/automation`, { headers: { cookie } });
  assert.equal(initial.response.status, 200);
  assert.equal(initial.body.data.configVersion, 1);
  const config = initial.body.data.config;
  assert.equal(config.paidAutoDelivery.autoConfirm, true);
  const associationOnly = await request(`/api/v1/products/${associationOnlyProduct.id}/automation`, { method: 'PUT', headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': 'automation-association-only', 'If-Match-Version': '1' }, body: JSON.stringify({ config: { ...config, paidAutoDelivery: { ...config.paidAutoDelivery, enabled: false, couponBatchIds: [associationOnlyCoupon.id] } } }) });
  assert.equal(associationOnly.response.status, 200);
  assert.deepEqual(associationOnly.body.data.config.paidAutoDelivery.couponBatchIds, [associationOnlyCoupon.sequenceId ?? associationOnlyCoupon.id]);
  config.paidAutoDelivery = { ...config.paidAutoDelivery, enabled: true, couponBatchIds: [coupon.id], autoConfirm: true };
  const saved = await request(`/api/v1/products/${product.id}/automation`, { method: 'PUT', headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': 'automation-save-1', 'If-Match-Version': '1' }, body: JSON.stringify({ config }) });
  assert.equal(saved.response.status, 200);
  assert.equal(saved.body.data.configVersion, 1);
  const replay = await request(`/api/v1/products/${product.id}/automation`, { method: 'PUT', headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': 'automation-save-1', 'If-Match-Version': '1' }, body: JSON.stringify({ config }) });
  assert.equal(replay.response.status, 200);
  assert.equal(replay.body.data.configVersion, 1);
  const stale = await request(`/api/v1/products/${product.id}/automation`, { method: 'PUT', headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': 'automation-save-stale', 'If-Match-Version': '2' }, body: JSON.stringify({ config }) });
  assert.equal(stale.response.status, 409);
  assert.equal(stale.body.error.code, 'AUTOMATION_VERSION_CONFLICT');

  const batchConfig = { ...config, reviewGift: { ...config.reviewGift, enabled: true, couponBatchIds: [coupon.id] } };
  const batch = await request('/api/v1/products/automation/batch', { method: 'POST', headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': 'automation-batch-1' }, body: JSON.stringify({ productIds: [product.id, second.id], expectedConfigVersions: { [product.id]: 1, [second.id]: 1 }, config: batchConfig }) });
  assert.equal(batch.response.status, 200);
  assert.deepEqual(batch.body.data.updatedProductIds.sort(), [product.id, second.id].sort());
  const afterBatch = await request(`/api/v1/products/${second.id}/automation`, { headers: { cookie } });
  assert.equal(afterBatch.response.status, 200);
  assert.equal(afterBatch.body.data.config.reviewGift.enabled, true);

  const noCsrf = await request(`/api/v1/products/${product.id}/automation`, { method: 'PUT', headers: { cookie, 'Idempotency-Key': 'automation-no-csrf', 'If-Match-Version': '1' }, body: JSON.stringify({ config }) });
  assert.equal(noCsrf.response.status, 403);
  console.log('product automation API smoke passed');
} finally {
  await runtime.close();
}
