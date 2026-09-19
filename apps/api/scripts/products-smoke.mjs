import assert from 'node:assert/strict';
import { createApp } from '../dist/app.js';

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

  const list = await request(`/api/v1/products?accountId=${encodeURIComponent(account.id)}&status=ready&keyword=${encodeURIComponent('测试')}`, { headers: { cookie } });
  assert.equal(list.response.status, 200);
  assert.deepEqual(list.body.data.items.map((item) => item.id), [product.id]);
  assert.equal(list.body.data.items[0].priceMinor, 1990);
  assert.equal(list.body.data.items[0].skuCount, 0);
  assert.equal(list.body.data.items[0].assetCount, 0);
  assert.equal(list.body.data.total, 1);
  assert.equal(list.body.data.totalPages, 1);

  const detail = await request(`/api/v1/products/${encodeURIComponent(product.id)}`, { headers: { cookie } });
  assert.equal(detail.response.status, 200);
  assert.equal(detail.body.data.externalProductRef, 'ITEM-001');
  assert.deepEqual(detail.body.data.attributes, { deliveryType: 'coupon_only' });
  assert.deepEqual(detail.body.data.skus, []);
  assert.deepEqual(detail.body.data.assets, []);

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
