import assert from 'node:assert/strict';
import { createApp } from '../dist/app.js';
import { hashPassword } from '../dist/security.js';

const port = 18280 + (process.pid % 400);
const runtime = createApp({ host: '127.0.0.1', port, cookieSecure: false, allowInMemory: true, sessionIdleMs: 1_800_000, sessionAbsoluteMs: 28_800_000, xianyuQrMode: 'stub' });
await runtime.listen();

function cookiesFrom(response) {
  return (response.headers.getSetCookie?.() ?? []).map((value) => value.split(';', 1)[0]).join('; ');
}

async function request(path, options = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { ...options, headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers ?? {}) } });
  const body = await response.json();
  return { response, body };
}

try {
  const unauthenticated = await request('/api/v1/products');
  assert.equal(unauthenticated.response.status, 401);
  assert.equal(unauthenticated.body.error.code, 'UNAUTHENTICATED');

  const bootstrap = await request('/api/v1/auth/bootstrap', { method: 'POST', headers: { 'Idempotency-Key': 'products-bootstrap' }, body: JSON.stringify({ email: 'products@example.com', password: 'password-123', displayName: 'Products Test' }) });
  assert.equal(bootstrap.response.status, 200);
  const cookie = cookiesFrom(bootstrap.response);
  const csrf = decodeURIComponent(cookie.match(/csrf_token=([^;]+)/)?.[1] ?? '');
  const adminId = bootstrap.body.data.profile.id;

  const account = await runtime.store.createAccount({ adminId, platform: 'xianyu', sellerRef: 'seller-products' });
  const product = await runtime.store.createProduct({
    adminId,
    accountId: account.id,
    externalProductRef: 'ITEM-001',
    title: '测试商品',
    description: '商品详情',
    categoryCode: 'digital',
    attributes: { deliveryType: 'coupon_only' },
    priceMinor: 1990,
    status: 'ready',
  });
  const activeCouponBatch = await runtime.store.createCouponBatch({ adminId, accountId: account.id, label: '绑定卡券', purpose: 'text' });
  await runtime.store.bindCouponBatch({ adminId, batchId: activeCouponBatch.id, productId: product.id });
  const inactiveCouponBatch = await runtime.store.createCouponBatch({ adminId, accountId: account.id, label: '已解绑卡券', purpose: 'text' });
  await runtime.store.bindCouponBatch({ adminId, batchId: inactiveCouponBatch.id, productId: product.id });
  await runtime.store.unbindCouponBatch({ adminId, batchId: inactiveCouponBatch.id, productId: product.id });

  const list = await request(`/api/v1/products?accountId=${encodeURIComponent(account.id)}&status=ready&keyword=${encodeURIComponent('测试')}`, { headers: { cookie } });
  assert.equal(list.response.status, 200);
  assert.deepEqual(list.body.data.items.map((item) => item.id), [product.id]);
  assert.equal(list.body.data.items[0].priceMinor, 1990);
  assert.equal(list.body.data.items[0].skuCount, 0);
  assert.equal(list.body.data.items[0].assetCount, 0);
  assert.deepEqual(list.body.data.items[0].couponBatches, [{ id: activeCouponBatch.sequenceId, label: '绑定卡券' }]);
  assert.equal(list.body.data.total, 1);
  assert.equal(list.body.data.totalPages, 1);

  const detail = await request(`/api/v1/products/${encodeURIComponent(product.id)}`, { headers: { cookie } });
  assert.equal(detail.response.status, 200);
  assert.equal(detail.body.data.externalProductRef, 'ITEM-001');
  assert.deepEqual(detail.body.data.attributesJson, { deliveryType: 'coupon_only' });
  assert.deepEqual(detail.body.data.couponBatches, [{ id: activeCouponBatch.sequenceId, label: '绑定卡券' }]);
  assert.deepEqual(detail.body.data.skus, []);
  assert.deepEqual(detail.body.data.assets, []);

  const created = await request('/api/v1/products', {
    method: 'POST',
    headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': 'product-create-1' },
    body: JSON.stringify({ accountId: account.id, title: 'API 创建商品', description: '通过写 API 创建', categoryCode: 'digital', attributesJson: { source: 'api' }, priceMinor: 2990 }),
  });
  assert.equal(created.response.status, 201);
  assert.equal(created.body.data.status, 'draft');
  assert.deepEqual(created.body.data.attributesJson, { source: 'api' });
  assert.deepEqual(created.body.data.skus, []);
  assert.deepEqual(created.body.data.assets, []);
  const createdId = created.body.data.id;

  const replayedCreate = await request('/api/v1/products', {
    method: 'POST',
    headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': 'product-create-1' },
    body: JSON.stringify({ accountId: account.id, title: 'API 创建商品', description: '通过写 API 创建', categoryCode: 'digital', attributesJson: { source: 'api' }, priceMinor: 2990 }),
  });
  assert.equal(replayedCreate.response.status, 201);
  assert.equal(replayedCreate.body.data.id, createdId);

  const createConflict = await request('/api/v1/products', {
    method: 'POST',
    headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': 'product-create-1' },
    body: JSON.stringify({ accountId: account.id, title: '不同请求', priceMinor: 2990 }),
  });
  assert.equal(createConflict.response.status, 409);
  assert.equal(createConflict.body.error.code, 'IDEMPOTENCY_CONFLICT');

  const updated = await request(`/api/v1/products/${encodeURIComponent(createdId)}`, {
    method: 'PATCH',
    headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': 'product-update-1', 'If-Match-Version': '1' },
    body: JSON.stringify({ title: 'API 更新商品', attributesJson: { source: 'api', version: 2 } }),
  });
  assert.equal(updated.response.status, 200);
  assert.equal(updated.body.data.title, 'API 更新商品');
  assert.equal(updated.body.data.configVersion, 2);
  assert.deepEqual(updated.body.data.attributesJson, { source: 'api', version: 2 });

  const headerFingerprint = await request(`/api/v1/products/${encodeURIComponent(createdId)}`, {
    method: 'PATCH',
    headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': 'product-update-header-fingerprint-1', 'If-Match-Version': '2' },
    body: JSON.stringify({ title: 'API header fingerprint' }),
  });
  assert.equal(headerFingerprint.response.status, 200);
  assert.equal(headerFingerprint.body.data.configVersion, 3);
  const headerConflict = await request(`/api/v1/products/${encodeURIComponent(createdId)}`, {
    method: 'PATCH',
    headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': 'product-update-header-fingerprint-1', 'If-Match-Version': '1' },
    body: JSON.stringify({ title: 'API header fingerprint' }),
  });
  assert.equal(headerConflict.response.status, 409);
  assert.equal(headerConflict.body.error.code, 'IDEMPOTENCY_CONFLICT');

  const replayedUpdate = await request(`/api/v1/products/${encodeURIComponent(createdId)}`, {
    method: 'PATCH',
    headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': 'product-update-1', 'If-Match-Version': '1' },
    body: JSON.stringify({ title: 'API 更新商品', attributesJson: { source: 'api', version: 2 } }),
  });
  assert.equal(replayedUpdate.response.status, 200);
  assert.equal(replayedUpdate.body.data.configVersion, 2);

  const staleUpdate = await request(`/api/v1/products/${encodeURIComponent(createdId)}`, {
    method: 'PATCH',
    headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': 'product-update-stale-1', 'If-Match-Version': '1' },
    body: JSON.stringify({ title: '过期版本更新' }),
  });
  assert.equal(staleUpdate.response.status, 409);
  assert.equal(staleUpdate.body.error.code, 'PRODUCT_VERSION_CONFLICT');

  const invalidCreate = await request('/api/v1/products', {
    method: 'POST',
    headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': 'product-create-invalid-1' },
    body: JSON.stringify({ accountId: account.id, title: '', priceMinor: -1 }),
  });
  assert.equal(invalidCreate.response.status, 422);
  assert.equal(invalidCreate.body.error.code, 'VALIDATION_FAILED');

  const foreignAdmin = await runtime.store.createAdmin({ email: `foreign-${process.pid}@example.com`, passwordHash: await hashPassword('password-123'), displayName: 'Foreign Products Test' });
  const foreignAccount = await runtime.store.createAccount({ adminId: foreignAdmin.id, platform: 'xianyu', sellerRef: `foreign-products-${process.pid}` });
  const foreignProduct = await runtime.store.createProduct({ adminId: foreignAdmin.id, accountId: foreignAccount.id, title: '跨账号商品', status: 'draft' });
  const crossAccountUpdate = await request(`/api/v1/products/${encodeURIComponent(foreignProduct.id)}`, {
    method: 'PATCH',
    headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': 'product-update-forbidden-1', 'If-Match-Version': '1' },
    body: JSON.stringify({ accountId: foreignAccount.id, title: '越权更新' }),
  });
  assert.equal(crossAccountUpdate.response.status, 403);
  assert.equal(crossAccountUpdate.body.error.code, 'FORBIDDEN');

  const forbidden = await request('/api/v1/products?accountId=00000000-0000-0000-0000-000000000000', { headers: { cookie } });
  assert.equal(forbidden.response.status, 403);
  assert.equal(forbidden.body.error.code, 'FORBIDDEN');

  const invalidPage = await request('/api/v1/products?page=0', { headers: { cookie } });
  assert.equal(invalidPage.response.status, 422);
  assert.equal(invalidPage.body.error.code, 'VALIDATION_FAILED');

  const missing = await request('/api/v1/products/00000000-0000-0000-0000-000000000000', { headers: { cookie } });
  assert.equal(missing.response.status, 404);
  assert.equal(missing.body.error.code, 'NOT_FOUND');

  const malformed = await request('/api/v1/products/not-a-uuid', { headers: { cookie } });
  assert.equal(malformed.response.status, 404);
  assert.equal(malformed.body.error.code, 'NOT_FOUND');

  console.log('products read slice smoke passed');
} finally {
  await runtime.close();
}
