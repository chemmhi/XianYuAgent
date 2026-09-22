import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createApp } from '../dist/app.js';
import { hashPassword } from '../dist/security.js';

let port = 0;
const databaseUrl = process.env.DATABASE_URL ?? 'postgres://xianyu:xianyu_dev_only@127.0.0.1:5432/xianyu_agent';
const runtime = createApp({ host: '127.0.0.1', port, databaseUrl, cookieSecure: false, allowInMemory: false, sessionIdleMs: 1_800_000, sessionAbsoluteMs: 28_800_000, xianyuQrMode: 'stub' });
let adminId;
let accountId;
let productId;
let createdId;

function cookiesFrom(response) {
  return (response.headers.getSetCookie?.() ?? []).map((value) => value.split(';', 1)[0]).join('; ');
}

async function request(path, options = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { ...options, headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers ?? {}) } });
  const body = await response.json();
  return { response, body };
}

await runtime.store.pool.query(await readFile(new URL('../migrations/003_catalog.sql', import.meta.url), 'utf8'));
await runtime.store.pool.query(await readFile(new URL('../migrations/013_product_sync.sql', import.meta.url), 'utf8'));
await runtime.store.pool.query(await readFile(new URL('../migrations/029_product_xianyu_updated_at.sql', import.meta.url), 'utf8'));
await runtime.store.pool.query(await readFile(new URL('../migrations/030_product_xianyu_list_rank.sql', import.meta.url), 'utf8'));
await runtime.listen();
port = runtime.server.address().port;

try {
  const email = `products-postgres-${process.pid}-${Date.now()}@example.com`;
  const admin = await runtime.store.createAdmin({ email, passwordHash: await hashPassword('password-123'), displayName: 'Products Postgres Test' });
  adminId = admin.id;
  const loggedIn = await runtime.auth.login({ email, password: 'password-123' });
  const csrf = loggedIn.csrfToken;
  const cookie = `session_id=${loggedIn.session.id}; csrf_token=${encodeURIComponent(csrf)}`;

  const account = await runtime.store.createAccount({ adminId, platform: 'xianyu', sellerRef: `products-postgres-${process.pid}` });
  accountId = account.id;
  const product = await runtime.store.createProduct({ adminId, accountId, externalProductRef: `PG-${process.pid}`, title: 'Postgres 商品', description: '持久化商品详情', categoryCode: 'digital', attributes: { source: 'postgres-smoke' }, priceMinor: 2590, status: 'ready' });
  productId = product.id;

  const list = await request(`/api/v1/products?accountId=${encodeURIComponent(accountId)}&status=ready`, { headers: { cookie } });
  assert.equal(list.response.status, 200);
  assert.equal(list.body.data.items[0].id, productId);
  assert.equal(list.body.data.items[0].priceMinor, 2590);

  const detail = await request(`/api/v1/products/${encodeURIComponent(productId)}`, { headers: { cookie } });
  assert.equal(detail.response.status, 200);
  assert.equal(detail.body.data.title, 'Postgres 商品');
  assert.deepEqual(detail.body.data.attributesJson, { source: 'postgres-smoke' });

  const created = await request('/api/v1/products', {
    method: 'POST',
    headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': `products-postgres-create-${process.pid}` },
    body: JSON.stringify({ accountId, title: 'Postgres API 创建', attributesJson: { source: 'api' }, priceMinor: 3190 }),
  });
  assert.equal(created.response.status, 201);
  assert.equal(created.body.data.status, 'draft');
  assert.deepEqual(created.body.data.attributesJson, { source: 'api' });
  assert.deepEqual(created.body.data.skus, []);
  assert.deepEqual(created.body.data.assets, []);
  createdId = created.body.data.id;

  const updated = await request(`/api/v1/products/${encodeURIComponent(createdId)}`, {
    method: 'PATCH',
    headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': `products-postgres-update-${process.pid}`, 'If-Match-Version': '1' },
    body: JSON.stringify({ title: 'Postgres API 更新', attributesJson: { source: 'api', version: 2 } }),
  });
  assert.equal(updated.response.status, 200);
  assert.equal(updated.body.data.configVersion, 2);
  assert.equal(updated.body.data.title, 'Postgres API 更新');

  const headerFingerprint = await request(`/api/v1/products/${encodeURIComponent(createdId)}`, {
    method: 'PATCH',
    headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': `products-postgres-header-fingerprint-${process.pid}`, 'If-Match-Version': '2' },
    body: JSON.stringify({ title: 'Postgres header fingerprint' }),
  });
  assert.equal(headerFingerprint.response.status, 200);
  assert.equal(headerFingerprint.body.data.configVersion, 3);
  const headerConflict = await request(`/api/v1/products/${encodeURIComponent(createdId)}`, {
    method: 'PATCH',
    headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': `products-postgres-header-fingerprint-${process.pid}`, 'If-Match-Version': '1' },
    body: JSON.stringify({ title: 'Postgres header fingerprint' }),
  });
  assert.equal(headerConflict.response.status, 409);
  assert.equal(headerConflict.body.error.code, 'IDEMPOTENCY_CONFLICT');

  const conflict = await request(`/api/v1/products/${encodeURIComponent(createdId)}`, {
    method: 'PATCH',
    headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': `products-postgres-stale-${process.pid}`, 'If-Match-Version': '1' },
    body: JSON.stringify({ title: 'Postgres stale' }),
  });
  assert.equal(conflict.response.status, 409);
  assert.equal(conflict.body.error.code, 'PRODUCT_VERSION_CONFLICT');

  const persisted = await runtime.store.getProduct(adminId, productId);
  assert.equal(persisted?.externalProductRef, `PG-${process.pid}`);

  runtime.xianyu.fetchItemsAll = async () => {
    const items = [
      { externalProductRef: `SYNC-${process.pid}-1`, title: 'Postgres 同步商品一', categoryCode: 'digital', priceMinor: 1990, xianyuListRank: 1, sourcePayloadDigest: 'pg-sync-1' },
      { externalProductRef: `SYNC-${process.pid}-2`, title: 'Postgres 同步商品二', categoryCode: 'digital', priceMinor: 2990, xianyuListRank: 2, xianyuUpdatedAt: '2026-09-21T12:30:00.000Z', sourcePayloadDigest: 'pg-sync-2' },
      { externalProductRef: `SYNC-${process.pid}-3`, title: 'Postgres 同步商品三', categoryCode: 'digital', priceMinor: 3990, xianyuListRank: 3, sourcePayloadDigest: 'pg-sync-3' },
    ];
    return { pages: [{ success: true, accountInvalid: false, cookieHeader: '', items, pageNumber: 1, pageSize: 20, totalCount: items.length, totalPages: 1, hasMore: false }], items, hasMore: false };
  };
  runtime.xianyu.fetchItemDetail = async (_adminId, _accountId, itemId) => ({ success: true, accountInvalid: false, cookieHeader: '', summary: { itemId: String(itemId), xianyuUpdatedAt: itemId.endsWith('-1') ? '2026-09-20T12:30:00.000Z' : undefined } });
  const synced = await request('/api/v1/products/sync', {
    method: 'POST',
    headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': `products-postgres-sync-${process.pid}` },
    body: JSON.stringify({ accountId }),
  });
  assert.equal(synced.response.status, 200);
  assert.equal(synced.body.data.fetchedCount, 3);
  assert.equal(synced.body.data.createdCount, 3);
  const syncedProducts = (await runtime.store.listProducts(adminId, { accountId })).items.filter((item) => item.source === 'xianyu');
  assert.equal(syncedProducts.length, 3);
  assert.deepEqual(syncedProducts.map((item) => item.externalProductRef), [`SYNC-${process.pid}-1`, `SYNC-${process.pid}-2`, `SYNC-${process.pid}-3`]);
  assert.deepEqual(syncedProducts.map((item) => item.xianyuListRank), [1, 2, 3]);
  assert.equal(syncedProducts.find((item) => item.externalProductRef.endsWith('-1'))?.xianyuUpdatedAt, '2026-09-20T12:30:00.000Z');
  assert.equal(syncedProducts.find((item) => item.externalProductRef.endsWith('-2'))?.xianyuUpdatedAt, '2026-09-21T12:30:00.000Z');
  assert.equal(syncedProducts.find((item) => item.externalProductRef.endsWith('-3'))?.xianyuUpdatedAt, undefined);
  await runtime.store.upsertCredential({ adminId, accountId, platform: 'xianyu', cookieHeader: 'unb=postgres-delete-smoke' });

  const deleted = await request(`/api/v1/accounts/${encodeURIComponent(accountId)}`, {
    method: 'DELETE',
    headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': `products-postgres-account-delete-${process.pid}` },
    body: JSON.stringify({}),
  });
  assert.equal(deleted.response.status, 200);
  assert.equal(deleted.body.data.deleted, true);
  assert.equal(deleted.body.data.account.status, 'disabled');
  const accountsAfterDelete = await request('/api/v1/accounts', { headers: { cookie } });
  assert.equal(accountsAfterDelete.response.status, 200);
  assert.equal(accountsAfterDelete.body.data.items.some((item) => item.id === accountId), false);
  const accountAfterDelete = await request(`/api/v1/accounts/${encodeURIComponent(accountId)}`, { headers: { cookie } });
  assert.equal(accountAfterDelete.response.status, 404);
  const credentialRow = await runtime.store.pool.query('select status from auth.account_credentials where account_id=$1', [accountId]);
  assert.equal(credentialRow.rows[0]?.status, 'revoked');
  const deletedReplay = await request(`/api/v1/accounts/${encodeURIComponent(accountId)}`, {
    method: 'DELETE',
    headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': `products-postgres-account-delete-${process.pid}` },
    body: JSON.stringify({}),
  });
  assert.equal(deletedReplay.response.status, 200);
  assert.deepEqual(deletedReplay.body, deleted.body);
  console.log('products postgres smoke passed');
} finally {
  if (accountId) await runtime.store.pool.query('delete from products.products where account_id=$1', [accountId]);
  if (createdId) await runtime.store.pool.query('delete from products.products where id=$1', [createdId]);
  if (productId) await runtime.store.pool.query('delete from products.products where id=$1', [productId]);
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
