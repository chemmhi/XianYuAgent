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
  await runtime.store.createProduct({ adminId, accountId, externalProductRef: 'pg-item', title: 'PostgreSQL 订单商品', attributes: { xianyu: { imageUrls: ['https://img.example/pg-product.png'] } } });
  const buyerConversation = await runtime.store.createConversation({ adminId, accountId, buyerRef: 'pg-buyer', buyerDisplayName: 'pg-nickname', buyerAvatarUrl: 'https://img.example/pg-nick.png', externalConversationRef: `orders-pg-buyer-${process.pid}` });
  orderNo = `PG-${process.pid}-${Date.now()}`;
  await runtime.store.createOrder({
    adminId,
    order: {
      orderNo,
      accountId,
      buyerId: 'pg-buyer',
      buyerName: 'PostgreSQL 买家',
      conversationId: buyerConversation.id,
      itemId: 'pg-item',
      itemTitle: 'pg-item',
      skuSpec: '颜色:红色',
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
  assert.equal(listed.body.data.items[0].buyerNickname, 'pg-nickname');
  assert.equal(listed.body.data.items[0].buyerAvatarUrl, 'https://img.example/pg-nick.png');
  assert.equal(listed.body.data.items[0].itemTitle, 'PostgreSQL 订单商品');
  assert.equal(listed.body.data.items[0].itemImageUrl, 'https://img.example/pg-product.png');
  const persistedDetail = await request(port, `/api/v1/orders/${encodeURIComponent(orderNo)}?accountId=${encodeURIComponent(accountId)}`, { headers: { cookie } });
  assert.equal(persistedDetail.body.data.skuSpec, '颜色:红色');
  const buyerIdSearch = await request(port, `/api/v1/orders?accountId=${encodeURIComponent(accountId)}&keyword=pg-buyer`, { headers: { cookie } });
  assert.equal(buyerIdSearch.body.data.total, 0);
  const itemIdSearch = await request(port, `/api/v1/orders?accountId=${encodeURIComponent(accountId)}&keyword=pg-item`, { headers: { cookie } });
  assert.equal(itemIdSearch.body.data.total, 0);

  const conversationOnly = await runtime.store.createConversation({ adminId, accountId, buyerRef: 'pg-conversation-buyer', itemRef: 'pg-conversation-item', itemTitle: 'PostgreSQL 会话聚合商品', itemImageUrl: 'https://img.example/pg-conversation-product.png', externalConversationRef: `orders-pg-item-only-${process.pid}` });
  const conversationOnlyOrder = `PG-${process.pid}-${Date.now()}-ITEM`;
  await runtime.store.createOrder({ adminId, order: { orderNo: conversationOnlyOrder, accountId, buyerId: 'pg-conversation-buyer', buyerName: 'PostgreSQL 会话买家', itemId: 'pg-conversation-item', itemTitle: 'pg-conversation-item', amountMinor: 1990, paymentStatus: 'paid', orderStatus: 'open', deliveryStatus: 'pending', afterSalesStatus: 'none', deliveryType: 'manual' } });
  const conversationOnlyList = await request(port, `/api/v1/orders?accountId=${encodeURIComponent(accountId)}&keyword=${encodeURIComponent('PostgreSQL 会话聚合商品')}`, { headers: { cookie } });
  assert.equal(conversationOnlyList.body.data.total, 1);
  assert.equal(conversationOnlyList.body.data.items[0].orderNo, conversationOnlyOrder);
  assert.equal(conversationOnlyList.body.data.items[0].itemTitle, 'PostgreSQL 会话聚合商品');
  assert.equal(conversationOnlyList.body.data.items[0].itemImageUrl, 'https://img.example/pg-conversation-product.png');
  const conversationOnlyDetail = await request(port, `/api/v1/orders/${encodeURIComponent(conversationOnlyOrder)}?accountId=${encodeURIComponent(accountId)}`, { headers: { cookie } });
  assert.equal(conversationOnlyDetail.body.data.itemTitle, 'PostgreSQL 会话聚合商品');
  const conversationOnlyIdSearch = await request(port, `/api/v1/orders?accountId=${encodeURIComponent(accountId)}&keyword=pg-conversation-item`, { headers: { cookie } });
  assert.equal(conversationOnlyIdSearch.body.data.total, 0);

  const refreshedOrderNo = `${orderNo}-X`;
  const staleExternalOrderNo = `${orderNo}-STALE`;
  await runtime.store.upsertExternalOrder({
    adminId,
    accountId,
    syncedAt: new Date().toISOString(),
    item: { orderNo: staleExternalOrderNo, buyerId: 'pg-stale-buyer', buyerName: 'PostgreSQL 过期买家', itemId: 'pg-item', itemTitle: 'pg-item', amountMinor: 1000, paymentStatus: 'paid', orderStatus: 'open', deliveryStatus: 'pending', afterSalesStatus: 'none', deliveryType: 'manual', createdAt: new Date().toISOString(), sourcePayloadDigest: 'postgres-stale-fixture' },
  });
  await runtime.store.createProduct({ adminId, accountId, externalProductRef: 'pg-xianyu-item', title: '闲鱼同步商品标题' });
  runtime.xianyu.fetchOrdersAll = async () => ({
    pages: [{ success: true, accountInvalid: false, pageNumber: 1, pageSize: 30, items: [] }],
    items: [{ orderNo: refreshedOrderNo, buyerId: 'pg-xianyu-buyer', buyerNickname: '闲鱼同步昵称', buyerName: '闲鱼同步买家', itemId: 'pg-xianyu-item', itemTitle: 'pg-xianyu-item', skuSpec: '版本:专业版', amountMinor: 12900, paymentStatus: 'paid', orderStatus: 'open', deliveryStatus: 'pending', afterSalesStatus: 'none', deliveryType: 'manual', createdAt: new Date().toISOString(), sourcePayloadDigest: 'postgres-xianyu-fixture' }],
    hasMore: false,
  });
  const refreshed = await request(port, '/api/v1/orders/refresh', { method: 'POST', headers: { cookie, 'X-CSRF-Token': loggedIn.csrfToken, 'Idempotency-Key': `orders-pg-refresh-${process.pid}` }, body: JSON.stringify({ accountId }) });
  assert.equal(refreshed.response.status, 200);
  assert.equal(refreshed.body.data.createdCount, 1);
  assert.equal(refreshed.body.data.deletedCount, 1);

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
  assert.equal(reread.body.data.items[0].buyerNickname, '闲鱼同步昵称');
  assert.equal(reread.body.data.items[0].itemTitle, '闲鱼同步商品标题');
  const rereadDetail = await request(restartedPort, `/api/v1/orders/${encodeURIComponent(refreshedOrderNo)}?accountId=${encodeURIComponent(accountId)}`, { headers: { cookie } });
  assert.equal(rereadDetail.body.data.skuSpec, '版本:专业版');
  const stale = await request(restartedPort, `/api/v1/orders/${encodeURIComponent(staleExternalOrderNo)}?accountId=${encodeURIComponent(accountId)}`, { headers: { cookie } });
  assert.equal(stale.response.status, 404);
  console.log('orders postgres persistence smoke passed');
} finally {
  const active = restarted ?? runtime;
  if (active?.store?.pool) {
    if (accountId) await active.store.pool.query('delete from orders.orders where account_id=$1', [accountId]);
    if (accountId) await active.store.pool.query('delete from products.products where account_id=$1', [accountId]);
    if (accountId) await active.store.pool.query('delete from messages.conversations where account_id=$1', [accountId]);
    if (accountId) await active.store.pool.query('delete from observability.audit_events where account_id=$1', [accountId]);
    if (accountId) await active.store.pool.query('delete from settings.auto_reply_repair_policies where account_id=$1', [accountId]);
    if (accountId) await active.store.pool.query('delete from auth.account_credentials where account_id=$1', [accountId]);
    if (accountId) await active.store.pool.query('delete from auth.account_scopes where account_id=$1', [accountId]);
    if (accountId) await active.store.pool.query('delete from accounts.accounts where id=$1', [accountId]);
    if (adminId) await active.store.pool.query('delete from auth.sessions where admin_id=$1', [adminId]);
    if (adminId) await active.store.pool.query('delete from auth.admins where id=$1', [adminId]);
  }
  if (restarted) await restarted.close();
  else if (runtime) await runtime.close();
}
