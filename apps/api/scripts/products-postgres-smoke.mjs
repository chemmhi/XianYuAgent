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

function cookiesFrom(response) {
  return (response.headers.getSetCookie?.() ?? []).map((value) => value.split(';', 1)[0]).join('; ');
}

async function request(path, options = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { ...options, headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers ?? {}) } });
  const body = await response.json();
  return { response, body };
}

await runtime.store.pool.query(await readFile(new URL('../migrations/003_catalog.sql', import.meta.url), 'utf8'));
await runtime.listen();
port = runtime.server.address().port;

try {
  const email = `products-postgres-${process.pid}-${Date.now()}@example.com`;
  const admin = await runtime.store.createAdmin({ email, passwordHash: await hashPassword('password-123'), displayName: 'Products Postgres Test' });
  adminId = admin.id;
  const loggedIn = await runtime.auth.login({ email, password: 'password-123' });
  const cookie = `session_id=${loggedIn.session.id}; csrf_token=${encodeURIComponent(loggedIn.csrfToken)}`;

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
  assert.deepEqual(detail.body.data.attributes, { source: 'postgres-smoke' });

  const persisted = await runtime.store.getProduct(adminId, productId);
  assert.equal(persisted?.externalProductRef, `PG-${process.pid}`);
  console.log('products postgres smoke passed');
} finally {
  if (productId) await runtime.store.pool.query('delete from products.products where id=$1', [productId]);
  if (accountId) await runtime.store.pool.query('delete from auth.account_scopes where account_id=$1', [accountId]);
  if (accountId) await runtime.store.pool.query('delete from accounts.accounts where id=$1', [accountId]);
  if (adminId) {
    await runtime.store.pool.query('delete from auth.sessions where admin_id=$1', [adminId]);
    await runtime.store.pool.query('delete from auth.admins where id=$1', [adminId]);
  }
  await runtime.close();
}
