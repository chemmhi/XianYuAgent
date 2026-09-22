import assert from 'node:assert/strict';
import { createApp } from '../dist/app.js';

const port = 18480 + (process.pid % 300);
const runtime = createApp({ host: '127.0.0.1', port, cookieSecure: false, allowInMemory: true, sessionIdleMs: 1_800_000, sessionAbsoluteMs: 28_800_000, xianyuQrMode: 'stub' });
await runtime.listen();

function cookiesFrom(response) { return (response.headers.getSetCookie?.() ?? []).map((value) => value.split(';', 1)[0]).join('; '); }
async function request(path, options = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { ...options, headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers ?? {}) } });
  const body = await response.json();
  return { response, body };
}

try {
  const bootstrap = await request('/api/v1/auth/bootstrap', { method: 'POST', headers: { 'Idempotency-Key': 'coupon-bootstrap' }, body: JSON.stringify({ email: 'coupon@example.com', password: 'password-123', displayName: 'Coupon Test' }) });
  assert.equal(bootstrap.response.status, 200);
  const cookie = cookiesFrom(bootstrap.response);
  const csrf = decodeURIComponent(cookie.match(/csrf_token=([^;]+)/)?.[1] ?? '');
  const adminId = bootstrap.body.data.profile.id;
  const account = await runtime.store.createAccount({ adminId, platform: 'xianyu', sellerRef: 'seller-coupons' });
  const product = await runtime.store.createProduct({ adminId, accountId: account.id, externalProductRef: 'coupon-product', title: 'Coupon Product', status: 'ready' });

  const empty = await request(`/api/v1/coupons/batches?accountId=${account.id}`, { headers: { cookie } });
  assert.equal(empty.response.status, 200);
  assert.equal(empty.body.data.total, 0);

  const created = await request('/api/v1/coupons/batches', { method: 'POST', headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': 'coupon-create-1' }, body: JSON.stringify({ accountId: account.id, label: 'Demo cards', purpose: 'text', deliveryScope: 'operator_only', metadata: { description: 'Demo description', textContent: 'Demo content', delaySeconds: 5, dockable: true, price: '9.90' }, quarkUrl: 'https://quark.example/demo', extractionCode: 'extract-123' }) });
  assert.equal(created.response.status, 201);
  const batchId = created.body.data.batchId;
  assert.match(String(batchId), /^\d+$/);
  assert.equal(batchId, '1');
  assert.equal(created.body.data.availableCount, 0);
  assert.equal(created.body.data.stockAlert, 'exhausted');
  assert.equal(created.body.data.purpose, 'text');

  const updated = await request(`/api/v1/coupons/batches/${batchId}`, { method: 'PATCH', headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': 'coupon-update-1' }, body: JSON.stringify({ label: 'Demo cards edited', status: 'paused', metadata: { description: 'Edited description', textContent: 'Edited content' } }) });
  assert.equal(updated.response.status, 200);
  assert.equal(updated.body.data.label, 'Demo cards edited');
  assert.equal(updated.body.data.status, 'paused');
  assert.equal(updated.body.data.metadata.textContent, 'Edited content');

  const listed = await request(`/api/v1/coupons/batches?accountId=${account.id}`, { headers: { cookie } });
  assert.equal(listed.response.status, 200);
  assert.equal(listed.body.data.items[0].metadata.description, 'Edited description');
  assert.equal(listed.body.data.items[0].metadata.textContent, undefined);

  const sortProbe = await request('/api/v1/coupons/batches', { method: 'POST', headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': 'coupon-create-sort-probe' }, body: JSON.stringify({ accountId: account.id, label: 'Sort probe', purpose: 'text', deliveryScope: 'operator_only' }) });
  assert.equal(sortProbe.response.status, 201);
  assert.equal(sortProbe.body.data.batchId, '2');
  const ascending = await request(`/api/v1/coupons/batches?accountId=${account.id}&sortBy=createdAt&sortOrder=asc`, { headers: { cookie } });
  assert.equal(ascending.response.status, 200);
  assert.deepEqual(ascending.body.data.items.slice(0, 2).map((item) => item.label), ['Demo cards edited', 'Sort probe']);
  const descending = await request(`/api/v1/coupons/batches?accountId=${account.id}&sortBy=createdAt&sortOrder=desc`, { headers: { cookie } });
  assert.equal(descending.response.status, 200);
  assert.deepEqual(descending.body.data.items.slice(0, 2).map((item) => item.label), ['Sort probe', 'Demo cards edited']);
  const invalidSortField = await request(`/api/v1/coupons/batches?accountId=${account.id}&sortBy=updatedAt`, { headers: { cookie } });
  assert.equal(invalidSortField.response.status, 422);
  const invalidSortOrder = await request(`/api/v1/coupons/batches?accountId=${account.id}&sortBy=createdAt&sortOrder=sideways`, { headers: { cookie } });
  assert.equal(invalidSortOrder.response.status, 422);

  const imported = await request(`/api/v1/coupons/batches/${batchId}/items/import`, { method: 'POST', headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': 'coupon-import-1' }, body: JSON.stringify({ items: ['code-a', 'code-b', 'code-a', ''] }) });
  assert.equal(imported.response.status, 200);
  assert.equal(imported.body.data.importedCount, 2);
  assert.equal(imported.body.data.rejected.length, 2);
  assert.equal(imported.body.data.stockAlert, 'low_stock');

  const detail = await request(`/api/v1/coupons/batches/${batchId}`, { headers: { cookie } });
  assert.equal(detail.response.status, 200);
  assert.equal(detail.body.data.items.length, 2);
  assert.equal(JSON.stringify(detail.body.data).includes('code-a'), false);
  const itemId = detail.body.data.items[0].id;
  const internalBatch = await runtime.store.getCouponBatch(adminId, batchId);
  assert.ok(internalBatch?.id);
  const legacyDetail = await request(`/api/v1/coupons/batches/${internalBatch.id}`, { headers: { cookie } });
  assert.equal(legacyDetail.response.status, 200);
  assert.equal(legacyDetail.body.data.batchId, batchId);

  const preview = await request(`/api/v1/coupons/${itemId}/content?purpose=preview&deliveryScope=operator_only&couponId=${itemId}`, { headers: { cookie } });
  assert.equal(preview.response.status, 200);
  assert.equal(preview.body.data.access.allowed, true);
  assert.equal(preview.body.data.content.body, 'code-a');

  const denied = await request(`/api/v1/coupons/${itemId}/content?purpose=delivery&deliveryScope=operator_only&couponId=${itemId}`, { headers: { cookie } });
  assert.equal(denied.response.status, 200);
  assert.equal(denied.body.data.access.allowed, false);
  assert.equal(denied.body.data.access.denialReason, 'purpose_not_allowed');
  assert.equal(denied.body.data.content, undefined);

  const bound = await request(`/api/v1/coupons/batches/${batchId}/bind`, { method: 'POST', headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': 'coupon-bind-1' }, body: JSON.stringify({ productId: product.id }) });
  assert.equal(bound.response.status, 200);
  assert.equal(bound.body.data.binding.productId, product.id);

  const deleted = await request(`/api/v1/coupons/batches/${batchId}`, { method: 'DELETE', headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': 'coupon-delete-1' } });
  assert.equal(deleted.response.status, 200);
  assert.equal(deleted.body.data.batch.status, 'voided');
  assert.equal(deleted.body.data.batch.stockAlert, 'exhausted');
  const defaultAfterVoid = await request(`/api/v1/coupons/batches?accountId=${account.id}`, { headers: { cookie } });
  assert.equal(defaultAfterVoid.response.status, 200);
  assert.equal(defaultAfterVoid.body.data.items.some((item) => item.batchId === batchId), false);
  const voidedHistory = await request(`/api/v1/coupons/batches?accountId=${account.id}&status=voided`, { headers: { cookie } });
  assert.equal(voidedHistory.response.status, 200);
  assert.equal(voidedHistory.body.data.items.some((item) => item.batchId === batchId && item.status === 'voided'), true);

  const forbiddenReactivate = await request(`/api/v1/coupons/batches/${batchId}`, { method: 'PATCH', headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': 'coupon-reactivate-voided' }, body: JSON.stringify({ status: 'active' }) });
  assert.equal(forbiddenReactivate.response.status, 409);
  assert.equal(forbiddenReactivate.body.error.code, 'CONFLICT');

  const forbiddenImport = await request(`/api/v1/coupons/batches/${batchId}/items/import`, { method: 'POST', headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': 'coupon-import-2' }, body: JSON.stringify({ items: ['code-c'] }) });
  assert.equal(forbiddenImport.response.status, 409);
  assert.equal(forbiddenImport.body.error.code, 'CONFLICT');
  const secondCreated = await request('/api/v1/coupons/batches', { method: 'POST', headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': 'coupon-create-2' }, body: JSON.stringify({ accountId: account.id, label: 'Second cards', purpose: 'text', deliveryScope: 'operator_only' }) });
  assert.equal(secondCreated.response.status, 201);
  assert.equal(secondCreated.body.data.batchId, '1');
  const newestFirst = await request(`/api/v1/coupons/batches?accountId=${account.id}`, { headers: { cookie } });
  assert.equal(newestFirst.response.status, 200);
  assert.equal(newestFirst.body.data.items[0].label, 'Second cards');
  assert.equal(newestFirst.body.data.items[0].batchId, '1');
  assert.ok(runtime.store.audits.some((event) => event.action === 'coupon.content.previewed'));
  assert.equal(runtime.store.audits.some((event) => event.payloadDigest.includes('code-a')), false);
  console.log('coupons smoke passed');
} finally {
  await runtime.close();
}
