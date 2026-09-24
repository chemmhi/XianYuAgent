import assert from 'node:assert/strict';
import { createApp } from '../dist/app.js';
import { hashPassword } from '../dist/security.js';

const databaseUrl = process.env.DATABASE_URL ?? 'postgres://xianyu:xianyu_dev_only@127.0.0.1:5432/xianyu_agent';
const suffix = `${process.pid}-${Date.now()}`;
const email = `dashboard-pg-${suffix}@example.com`;
const now = new Date();
const runtimeConfig = { host: '127.0.0.1', port: 0, databaseUrl, redisUrl: undefined, cookieSecure: false, allowInMemory: false, sessionIdleMs: 1_800_000, sessionAbsoluteMs: 28_800_000, xianyuQrMode: 'stub' };
let runtime;
let adminId;
let accountId;
let otherAccountId;
let productId;
let couponBatchId;

function cookieHeader(login) {
  return `session_id=${login.session.id}; csrf_token=${encodeURIComponent(login.csrfToken)}`;
}

async function request(port, path, options = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    ...options,
    headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers ?? {}) },
  });
  const body = await response.json();
  return { response, body };
}

async function seed(store) {
  const admin = await store.createAdmin({ email, passwordHash: await hashPassword('password-123'), displayName: 'Dashboard PostgreSQL Integration' });
  adminId = admin.id;
  const account = await store.createAccount({ adminId, platform: 'xianyu', sellerRef: `dashboard-pg-${suffix}`, displayName: 'Dashboard PostgreSQL 账号' });
  accountId = account.id;
  await store.updateAccount(adminId, accountId, { status: 'connected' });
  const otherAccount = await store.createAccount({ adminId, platform: 'xianyu', sellerRef: `dashboard-pg-other-${suffix}`, displayName: 'Dashboard PostgreSQL 第二账号' });
  otherAccountId = otherAccount.id;
  await store.updateAccount(adminId, otherAccountId, { status: 'connected' });
  const product = await store.createProduct({ adminId, accountId, title: 'Dashboard PostgreSQL 商品', status: 'published' });
  productId = product.id;
  const batch = await store.createCouponBatch({ adminId, accountId, label: 'Dashboard PostgreSQL 交付配置', purpose: 'data' });
  couponBatchId = batch.id;
  await store.importCouponItems({ adminId, batchId: couponBatchId, contents: [`PG-${suffix}-A`, `PG-${suffix}-B`, `PG-${suffix}-C`] });
  await store.createOrder({ adminId, order: {
    orderNo: `DASH-PG-${suffix}-DELIVERED`, accountId, buyerId: 'pg-buyer-1', buyerName: 'PG 买家一', itemId: 'pg-item', itemTitle: product.title,
    productId, amountMinor: 12_900, paymentStatus: 'paid', orderStatus: 'open', deliveryStatus: 'delivered', afterSalesStatus: 'none', deliveryType: 'coupon_only', createdAt: now.toISOString(), updatedAt: now.toISOString(),
  } });
  await store.createOrder({ adminId, order: {
    orderNo: `DASH-PG-${suffix}-PENDING`, accountId, buyerId: 'pg-buyer-2', buyerName: 'PG 买家二', itemId: 'pg-item', itemTitle: product.title,
    productId, amountMinor: 5_000, paymentStatus: 'paid', orderStatus: 'open', deliveryStatus: 'pending', afterSalesStatus: 'none', deliveryType: 'coupon_only', createdAt: now.toISOString(), updatedAt: now.toISOString(),
  } });
  await store.createOrder({ adminId, order: {
    orderNo: `DASH-PG-${suffix}-OTHER-ACCOUNT`, accountId: otherAccountId, buyerId: 'pg-buyer-other', buyerName: 'PG 第二账号买家', itemId: 'pg-other-item', itemTitle: '不应跨账号出现',
    amountMinor: 99_900, paymentStatus: 'paid', orderStatus: 'open', deliveryStatus: 'delivered', afterSalesStatus: 'none', deliveryType: 'manual', createdAt: now.toISOString(), updatedAt: now.toISOString(),
  } });
  await store.upsertExternalConversation({ adminId, accountId, externalConversationRef: `dashboard-pg-conversation-${suffix}`, buyerRef: 'pg-buyer-2', buyerDisplayName: 'PG 买家二', unreadCount: 2, lastMessagePreview: '请尽快发货', lastMessageAt: now.toISOString() });
}

async function cleanup(store) {
  const pool = store.pool;
  await pool.query('begin');
  try {
    for (const scopedAccountId of [accountId, otherAccountId].filter(Boolean)) {
      await pool.query('delete from messages.events where account_id=$1', [scopedAccountId]);
      await pool.query('delete from messages.messages where account_id=$1', [scopedAccountId]);
      await pool.query('delete from messages.conversations where account_id=$1', [scopedAccountId]);
      await pool.query('delete from orders.orders where account_id=$1', [scopedAccountId]);
      await pool.query('delete from coupons.coupon_items where batch_id in (select id from coupons.coupon_batches where account_id=$1)', [scopedAccountId]);
      await pool.query('delete from coupons.coupon_bindings where coupon_batch_id in (select id from coupons.coupon_batches where account_id=$1)', [scopedAccountId]);
      await pool.query('delete from coupons.coupon_batches where account_id=$1', [scopedAccountId]);
      await pool.query('delete from products.asset_refs where product_id in (select id from products.products where account_id=$1)', [scopedAccountId]);
      await pool.query('delete from products.product_skus where product_id in (select id from products.products where account_id=$1)', [scopedAccountId]);
      await pool.query('delete from products.products where account_id=$1', [scopedAccountId]);
      await pool.query('delete from observability.audit_events where account_id=$1', [scopedAccountId]);
      await pool.query('delete from auth.account_credentials where account_id=$1', [scopedAccountId]);
      await pool.query('delete from auth.account_scopes where account_id=$1', [scopedAccountId]);
      await pool.query('delete from accounts.accounts where id=$1', [scopedAccountId]);
    }
    if (adminId) {
      await pool.query('delete from auth.sessions where admin_id=$1', [adminId]);
      await pool.query('delete from observability.audit_events where actor_id=$1', [adminId]);
      await pool.query('delete from auth.admins where id=$1', [adminId]);
    }
    await pool.query('commit');
  } catch (error) {
    await pool.query('rollback');
    throw error;
  }
}

try {
  runtime = createApp(runtimeConfig);
  await runtime.listen();
  const port = runtime.server.address().port;
  await seed(runtime.store);
  const login = await runtime.auth.login({ email, password: 'password-123' });
  const cookie = cookieHeader(login);

  const health = await request(port, '/healthz');
  assert.equal(health.response.status, 200);
  assert.equal(health.body.data.storage, 'postgres');
  assert.equal(health.body.data.services.database, 'ok');

  const unauthenticated = await request(port, '/api/v1/dashboard/snapshot');
  assert.equal(unauthenticated.response.status, 401);

  const missingAccount = await request(port, '/api/v1/dashboard/snapshot', { headers: { cookie } });
  assert.equal(missingAccount.response.status, 422);

  const snapshot = await request(port, `/api/v1/dashboard/snapshot?accountId=${encodeURIComponent(accountId)}`, { headers: { cookie } });
  assert.equal(snapshot.response.status, 200);
  assert.equal(snapshot.body.data.totalSales, 179);
  assert.equal(snapshot.body.data.todayOrderAmount, 179);
  assert.equal(snapshot.body.data.autoProcessRate, 50);
  assert.equal(snapshot.body.data.pendingManualCount, 2);
  assert.equal('availableCouponCount' in snapshot.body.data, false);
  assert.equal(snapshot.body.data.productRank[0].title, 'Dashboard PostgreSQL 商品');
  assert.ok(snapshot.body.data.recentActivity.some((item) => item.text.includes('PENDING')));
  assert.ok(snapshot.body.data.riskTodos.some((item) => item.id.startsWith('order-')));
  assert.ok(!JSON.stringify(snapshot.body.data).includes('OTHER-ACCOUNT'));

  const todayTrend = await request(port, `/api/v1/dashboard/snapshot?accountId=${encodeURIComponent(accountId)}&range=today`, { headers: { cookie } });
  assert.equal(todayTrend.response.status, 200);
  assert.equal(todayTrend.body.data.trend.length, 24);

  const invalidRange = await request(port, `/api/v1/dashboard/snapshot?accountId=${encodeURIComponent(accountId)}&range=invalid`, { headers: { cookie } });
  assert.equal(invalidRange.response.status, 422);

  await runtime.close();
  runtime = createApp(runtimeConfig);
  await runtime.listen();
  const restartedPort = runtime.server.address().port;
  const restartedLogin = await runtime.auth.login({ email, password: 'password-123' });
  const reread = await request(restartedPort, `/api/v1/dashboard/snapshot?accountId=${encodeURIComponent(accountId)}`, { headers: { cookie: cookieHeader(restartedLogin) } });
  assert.equal(reread.response.status, 200);
  assert.equal(reread.body.data.totalSales, 179);
  assert.equal(reread.body.data.todayOrderAmount, 179);
  assert.equal('availableCouponCount' in reread.body.data, false);
  console.log(JSON.stringify({ status: 'PASS', storage: 'postgres', persistedAfterRestart: true, todayOrderAmount: reread.body.data.todayOrderAmount, riskTodoCount: reread.body.data.riskTodos.length }, null, 2));
} finally {
  if (runtime?.store?.pool) {
    try { await cleanup(runtime.store); } catch (error) { console.error(`dashboard cleanup failed: ${error instanceof Error ? error.message : String(error)}`); }
  }
  if (runtime) await runtime.close();
}
