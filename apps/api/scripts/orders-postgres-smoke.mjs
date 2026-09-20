import assert from 'node:assert/strict';
import { createApp } from '../dist/app.js';
import { hashPassword } from '../dist/security.js';

const databaseUrl = process.env.DATABASE_URL ?? 'postgres://xianyu:xianyu_dev_only@127.0.0.1:5432/xianyu_agent';
const email = `orders-pg-${process.pid}-${Date.now()}@example.com`;
const sellerRef = `orders-pg-${process.pid}-${Date.now()}`;
let runtime;
let restarted;
let adminId;
let accountId;
let orderNo;

function cookieHeader(login) {
  return `session_id=${login.session.id}; csrf_token=${encodeURIComponent(login.csrfToken)}`;
}

async function request(port, path, options = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.headers ?? {}),
    },
  });
  const body = await response.json();
  return { response, body };
}

runtime = createApp({ host: '127.0.0.1', port: 0, databaseUrl, cookieSecure: false, allowInMemory: false, sessionIdleMs: 1_800_000, sessionAbsoluteMs: 28_800_000, xianyuQrMode: 'stub' });
await runtime.listen();
const port = runtime.server.address().port;

try {
  const admin = await runtime.store.createAdmin({ email, passwordHash: await hashPassword('password-123'), displayName: 'Orders PostgreSQL Smoke' });
  adminId = admin.id;
  const loggedIn = await runtime.auth.login({ email, password: 'password-123' });
  const cookie = cookieHeader(loggedIn);
  const account = await runtime.store.createAccount({ adminId, platform: 'xianyu', sellerRef, displayName: 'PostgreSQL 订单账号' });
  accountId = account.id;
  orderNo = `PG-${process.pid}-${Date.now()}`;
  await runtime.store.createOrder({
    adminId,
    order: {
      orderNo,
      accountId,
      buyerId: 'pg-buyer',
      buyerName: 'PostgreSQL 买家',
      itemId: 'pg-item',
      itemTitle: 'PostgreSQL 订单商品',
      amountMinor: 3990,
      paymentStatus: 'paid',
      orderStatus: 'open',
      deliveryStatus: 'pending',
      afterSalesStatus: 'none',
      deliveryType: 'coupon_only',
    },
  });
  const listed = await request(port, `/api/v1/orders?accountId=${encodeURIComponent(accountId)}&keyword=PostgreSQL`, { headers: { cookie } });
  assert.equal(listed.response.status, 200);
  assert.equal(listed.body.data.total, 1);
  assert.equal(listed.body.data.items[0].orderNo, orderNo);
  assert.equal(listed.body.data.items[0].amountMinor, 3990);

  const refreshedOrderNo = `${orderNo}-X`;
  runtime.xianyu.fetchOrdersAll = async () => ({
    pages: [{ success: true, accountInvalid: false, pageNumber: 1, pageSize: 100, items: [] }],
    items: [{ orderNo: refreshedOrderNo, buyerId: 'pg-xianyu-buyer', buyerName: '闲鱼同步买家', itemId: 'pg-xianyu-item', itemTitle: '闲鱼同步商品', amountMinor: 12900, paymentStatus: 'paid', orderStatus: 'open', deliveryStatus: 'pending', afterSalesStatus: 'none', deliveryType: 'manual', createdAt: new Date().toISOString(), sourcePayloadDigest: 'postgres-xianyu-fixture' }],
    hasMore: false,
  });
  const refreshed = await request(port, '/api/v1/orders/refresh', { method: 'POST', headers: { cookie, 'X-CSRF-Token': loggedIn.csrfToken, 'Idempotency-Key': `orders-pg-refresh-${process.pid}` }, body: JSON.stringify({ accountId }) });
  assert.equal(refreshed.response.status, 200);
  assert.equal(refreshed.body.data.createdCount, 1);

  await runtime.close();
  runtime = undefined;
  restarted = createApp({ host: '127.0.0.1', port: 0, databaseUrl, cookieSecure: false, allowInMemory: false, sessionIdleMs: 1_800_000, sessionAbsoluteMs: 28_800_000, xianyuQrMode: 'stub' });
  await restarted.listen();
  const restartedPort = restarted.server.address().port;
  const reread = await request(restartedPort, `/api/v1/orders?accountId=${encodeURIComponent(accountId)}&keyword=闲鱼同步`, { headers: { cookie } });
  assert.equal(reread.response.status, 200);
  assert.equal(reread.body.data.total, 1);
  assert.equal(reread.body.data.items[0].orderNo, refreshedOrderNo);
  assert.equal(reread.body.data.items[0].source, 'xianyu');
  console.log('orders postgres persistence smoke passed');
} finally {
  const active = restarted ?? runtime;
  if (active?.store?.pool) {
    if (accountId) await active.store.pool.query('delete from orders.orders where account_id=$1', [accountId]);
    if (accountId) await active.store.pool.query('delete from observability.audit_events where account_id=$1', [accountId]);
    if (accountId) await active.store.pool.query('delete from auth.account_credentials where account_id=$1', [accountId]);
    if (accountId) await active.store.pool.query('delete from auth.account_scopes where account_id=$1', [accountId]);
    if (accountId) await active.store.pool.query('delete from accounts.accounts where id=$1', [accountId]);
    if (adminId) await active.store.pool.query('delete from auth.sessions where admin_id=$1', [adminId]);
    if (adminId) await active.store.pool.query('delete from auth.admins where id=$1', [adminId]);
  }
  if (restarted) await restarted.close();
  else if (runtime) await runtime.close();
}
