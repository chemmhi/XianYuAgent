import assert from 'node:assert/strict';
import { createApp } from '../dist/app.js';

const port = 18480 + (process.pid % 400);
const runtime = createApp({ host: '127.0.0.1', port, cookieSecure: false, allowInMemory: true, sessionIdleMs: 1_800_000, sessionAbsoluteMs: 28_800_000, xianyuQrMode: 'stub' });
await runtime.listen();

function cookiesFrom(response) { return (response.headers.getSetCookie?.() ?? []).map((value) => value.split(';', 1)[0]).join('; '); }
async function request(path, options = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { ...options, headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers ?? {}) } });
  const body = await response.json();
  return { response, body };
}
function order(accountId, orderNo, overrides = {}) {
  return { orderNo, accountId, buyerId: `buyer-${orderNo}`, buyerNickname: `昵称-${orderNo}`, buyerName: `买家-${orderNo}`, itemId: `item-${orderNo}`, itemTitle: `商品-${orderNo}`, amountMinor: 1990, paymentStatus: 'paid', orderStatus: 'open', deliveryStatus: 'pending', afterSalesStatus: 'none', deliveryType: 'coupon_only', ...overrides };
}

try {
  const unauthenticated = await request('/api/v1/orders');
  assert.equal(unauthenticated.response.status, 401);
  assert.equal(unauthenticated.body.error.code, 'UNAUTHENTICATED');

  const bootstrap = await request('/api/v1/auth/bootstrap', { method: 'POST', headers: { 'Idempotency-Key': 'orders-bootstrap' }, body: JSON.stringify({ email: 'orders@example.com', password: 'password-123', displayName: 'Orders Test' }) });
  assert.equal(bootstrap.response.status, 200);
  const cookie = cookiesFrom(bootstrap.response);
  const csrf = decodeURIComponent(cookie.match(/csrf_token=([^;]+)/)?.[1] ?? '');
  const adminId = bootstrap.body.data.profile.id;
  const account = await runtime.store.createAccount({ adminId, platform: 'xianyu', sellerRef: 'seller-orders', displayName: '订单账号' });
  const second = await runtime.store.createAccount({ adminId, platform: 'xianyu', sellerRef: 'seller-orders-2', displayName: '第二账号' });
  await runtime.store.createProduct({ adminId, accountId: account.id, externalProductRef: 'item-XY202609200001', title: '第一商品标题', attributes: { xianyu: { imageUrls: ['https://img.example/order-product.png'] } } });
  const buyerConversation = await runtime.store.createConversation({ adminId, accountId: account.id, buyerRef: 'buyer-XY202609200001', buyerDisplayName: '昵称甲', buyerAvatarUrl: 'https://img.example/nick-a.png', externalConversationRef: 'orders-smoke-buyer-1' });
  const first = await runtime.store.createOrder({ adminId, order: order(account.id, 'XY202609200001', { buyerNickname: undefined, buyerName: '甲', conversationId: buyerConversation.id, itemTitle: 'item-XY202609200001', amountMinor: 3990, orderStatus: 'completed', deliveryStatus: 'delivered' }) });
  const conversationOnly = await runtime.store.createConversation({ adminId, accountId: account.id, buyerRef: 'buyer-XY202609200004', itemRef: 'item-conversation-only', itemTitle: '会话聚合商品标题', itemImageUrl: 'https://img.example/conversation-product.png', externalConversationRef: 'orders-smoke-item-only' });
  const conversationOnlyOrder = await runtime.store.createOrder({ adminId, order: order(account.id, 'XY202609200099', { buyerId: 'buyer-XY202609200099', itemId: 'item-conversation-only', itemTitle: 'item-conversation-only', conversationId: undefined }) });
  await runtime.store.createOrder({ adminId, order: order(account.id, 'XY202609200002', { buyerName: '乙', paymentStatus: 'unpaid', orderStatus: 'open', deliveryStatus: 'pending' }) });
  await runtime.store.createOrder({ adminId, order: order(second.id, 'XY202609200003', { buyerName: '丙', orderStatus: 'failed', deliveryStatus: 'failed', amountMinor: 12900 }) });

  const list = await request(`/api/v1/orders?accountId=${encodeURIComponent(account.id)}&paymentStatus=paid&orderStatus=completed&page=1&pageSize=20`, { headers: { cookie } });
  assert.equal(list.response.status, 200);
  assert.equal(list.body.data.total, 1);
  assert.equal(list.body.data.items[0].orderNo, first.orderNo);
  assert.equal(list.body.data.items[0].amountMinor, 3990);
  assert.equal(list.body.data.items[0].buyerNickname, '昵称甲');
  assert.equal(list.body.data.items[0].buyerAvatarUrl, 'https://img.example/nick-a.png');
  assert.equal(list.body.data.items[0].itemTitle, '第一商品标题');
  assert.equal(list.body.data.items[0].itemImageUrl, 'https://img.example/order-product.png');
  const conversationOnlyList = await request('/api/v1/orders?accountId=' + encodeURIComponent(account.id) + '&keyword=' + encodeURIComponent('会话聚合商品标题'), { headers: { cookie } });
  assert.equal(conversationOnlyList.body.data.total, 1);
  assert.equal(conversationOnlyList.body.data.items[0].orderNo, conversationOnlyOrder.orderNo);
  assert.equal(conversationOnlyList.body.data.items[0].itemTitle, '会话聚合商品标题');
  assert.equal(conversationOnlyList.body.data.items[0].itemImageUrl, 'https://img.example/conversation-product.png');
  const conversationOnlyDetail = await request(`/api/v1/orders/${encodeURIComponent(conversationOnlyOrder.orderNo)}?accountId=${encodeURIComponent(account.id)}`, { headers: { cookie } });
  assert.equal(conversationOnlyDetail.body.data.itemTitle, '会话聚合商品标题');
  const conversationOnlyIdSearch = await request('/api/v1/orders?accountId=' + encodeURIComponent(account.id) + '&keyword=item-conversation-only', { headers: { cookie } });
  assert.equal(conversationOnlyIdSearch.body.data.total, 0);
  const keyword = await request('/api/v1/orders?keyword=' + encodeURIComponent('昵称-XY202609200002') + '&page=1&pageSize=20', { headers: { cookie } });
  assert.equal(keyword.response.status, 200);
  assert.deepEqual(keyword.body.data.items.map((item) => item.orderNo), ['XY202609200002']);
  const buyerIdKeyword = await request('/api/v1/orders?keyword=' + encodeURIComponent('buyer-XY202609200002') + '&page=1&pageSize=20', { headers: { cookie } });
  assert.equal(buyerIdKeyword.body.data.total, 0);
  const itemIdKeyword = await request('/api/v1/orders?keyword=' + encodeURIComponent('item-XY202609200002') + '&page=1&pageSize=20', { headers: { cookie } });
  assert.equal(itemIdKeyword.body.data.total, 0);

  const detail = await request(`/api/v1/orders/${encodeURIComponent(first.orderNo)}?accountId=${encodeURIComponent(account.id)}`, { headers: { cookie } });
  assert.equal(detail.response.status, 200);
  assert.equal(detail.body.data.orderNo, first.orderNo);
  const forbidden = await request(`/api/v1/orders?accountId=00000000-0000-0000-0000-000000000000`, { headers: { cookie } });
  assert.equal(forbidden.response.status, 403);
  assert.equal(forbidden.body.error.code, 'FORBIDDEN');
  const missing = await request('/api/v1/orders/not-found', { headers: { cookie } });
  assert.equal(missing.response.status, 404);

  const missingRefreshAccount = await request('/api/v1/orders/refresh', { method: 'POST', headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': 'orders-refresh-missing-account' }, body: JSON.stringify({}) });
  assert.equal(missingRefreshAccount.response.status, 422);
  const forbiddenRefresh = await request('/api/v1/orders/refresh', { method: 'POST', headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': 'orders-refresh-forbidden-account' }, body: JSON.stringify({ accountId: '00000000-0000-0000-0000-000000000000' }) });
  assert.equal(forbiddenRefresh.response.status, 403);

  await runtime.store.createProduct({ adminId, accountId: account.id, externalProductRef: 'item-refresh', title: '刷新商品标题' });
  const staleExternalOrderNo = 'XY202609200005';
  await runtime.store.upsertExternalOrder({
    adminId,
    accountId: account.id,
    accountName: account.displayName,
    syncedAt: '2026-09-20T01:00:00.000Z',
    item: order(account.id, staleExternalOrderNo, { sourcePayloadDigest: 'fixture-stale-external' }),
  });
  runtime.xianyu.fetchOrdersAll = async () => ({ pages: [{ success: true, accountInvalid: false, pageNumber: 1, pageSize: 30, items: [] }], items: [{ orderNo: 'XY202609200004', buyerId: 'buyer-refresh', buyerNickname: '刷新昵称', buyerName: '刷新买家', itemId: 'item-refresh', itemTitle: 'item-refresh', amountMinor: 4990, paymentStatus: 'paid', orderStatus: 'open', deliveryStatus: 'pending', afterSalesStatus: 'none', deliveryType: 'manual', createdAt: '2026-09-20T01:00:00.000Z', sourcePayloadDigest: 'fixture-refresh' }], hasMore: false });
  const refreshed = await request('/api/v1/orders/refresh', { method: 'POST', headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': 'orders-refresh-1' }, body: JSON.stringify({ accountId: account.id }) });
  assert.equal(refreshed.response.status, 200);
  assert.equal(refreshed.body.data.createdCount, 1);
  assert.equal(refreshed.body.data.deletedCount, 1);
  assert.equal(await runtime.store.getOrder(adminId, staleExternalOrderNo, account.id), undefined);
  assert.ok(await runtime.store.getOrder(adminId, first.orderNo, account.id));
  const afterRefresh = await request('/api/v1/orders?accountId=' + encodeURIComponent(account.id) + '&keyword=刷新', { headers: { cookie } });
  assert.equal(afterRefresh.body.data.total, 1);
  assert.equal(afterRefresh.body.data.items[0].source, 'xianyu');
  assert.equal(afterRefresh.body.data.items[0].buyerNickname, '刷新昵称');
  assert.equal(afterRefresh.body.data.items[0].itemTitle, '刷新商品标题');
  const partialStaleExternalOrderNo = 'XY202609200006';
  await runtime.store.upsertExternalOrder({
    adminId,
    accountId: account.id,
    accountName: account.displayName,
    syncedAt: '2026-09-20T01:00:00.000Z',
    item: order(account.id, partialStaleExternalOrderNo, { sourcePayloadDigest: 'fixture-partial-stale-external' }),
  });
  runtime.xianyu.fetchOrdersAll = async () => ({ pages: [{ success: true, accountInvalid: false, pageNumber: 1, pageSize: 1, items: [] }], items: [], hasMore: true });
  const partialRefresh = await request('/api/v1/orders/refresh', { method: 'POST', headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': 'orders-refresh-partial' }, body: JSON.stringify({ accountId: account.id, pageSize: 1, maxPages: 1 }) });
  assert.equal(partialRefresh.response.status, 200);
  assert.equal(partialRefresh.body.data.deletedCount, 0);
  assert.ok(await runtime.store.getOrder(adminId, partialStaleExternalOrderNo, account.id));
  console.log('orders read/refresh smoke passed');
} finally {
  await runtime.close();
}
