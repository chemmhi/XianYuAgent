import assert from 'node:assert/strict';
import { createApp } from '../dist/app.js';

const port = 19180 + (process.pid % 400);
const runtime = createApp({ host: '127.0.0.1', port, cookieSecure: false, allowInMemory: true, sessionIdleMs: 1_800_000, sessionAbsoluteMs: 28_800_000, xianyuQrMode: 'stub' });
await runtime.listen();

function cookiesFrom(response) { return (response.headers.getSetCookie?.() ?? []).map((value) => value.split(';', 1)[0]).join('; '); }
async function request(path, options = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { ...options, headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers ?? {}) } });
  return { response, body: await response.json() };
}

try {
  const bootstrap = await request('/api/v1/auth/bootstrap', { method: 'POST', headers: { 'Idempotency-Key': 'automation-entry-bootstrap' }, body: JSON.stringify({ email: 'automation-entry@example.com', password: 'password-123', displayName: 'Automation Entry' }) });
  assert.equal(bootstrap.response.status, 200);
  const cookie = cookiesFrom(bootstrap.response);
  const csrf = decodeURIComponent(cookie.match(/csrf_token=([^;]+)/)?.[1] ?? '');
  const adminId = bootstrap.body.data.profile.id;
  const account = await runtime.store.createAccount({ adminId, platform: 'xianyu', sellerRef: 'automation-entry-seller' });
  const product = await runtime.store.createProduct({ adminId, accountId: account.id, externalProductRef: 'automation-entry-item', title: '自动化入口商品', status: 'published' });
  const coupon = await runtime.store.createCouponBatch({ adminId, accountId: account.id, label: '入口赠品卡券', purpose: 'text', deliveryScope: 'buyer_deliverable' });
  await runtime.store.importCouponItems({ adminId, batchId: coupon.id, contents: ['entry-gift-1'] });
  const conversation = await runtime.store.createConversation({ adminId, accountId: account.id, buyerRef: 'automation-entry-buyer', buyerDisplayName: '入口买家', externalConversationRef: 'automation-entry-conversation' });
  const initial = await runtime.productAutomation.get(adminId, product.id);
  await runtime.productAutomation.update({
    adminId,
    productId: product.id,
    expectedConfigVersion: initial.configVersion,
    config: { ...initial.config, unpaidAutoReprice: { ...initial.config.unpaidAutoReprice, enabled: true, targetPriceMinor: 880 }, reviewGift: { ...initial.config.reviewGift, enabled: true, couponBatchIds: [coupon.id] }, reviewReminder: { ...initial.config.reviewReminder, enabled: true, firstDelayHours: 1, message: '请评价' } },
    requestId: 'entry-config',
    traceId: 'entry-config',
  });

  runtime.xianyu.fetchOrdersAll = async () => ({ pages: [{ success: true, accountInvalid: false, pageNumber: 1, pageSize: 30, items: [] }], items: [{ orderNo: 'ENTRY-UNPAID', buyerId: 'entry-buyer', buyerName: '入口买家', itemId: 'automation-entry-item', itemTitle: '自动化入口商品', amountMinor: 1000, paymentStatus: 'unpaid', orderStatus: 'open', deliveryStatus: 'pending', afterSalesStatus: 'none', deliveryType: 'coupon_only', createdAt: '2026-09-22T00:00:00.000Z', sourcePayloadDigest: 'entry-fixture' }], hasMore: false });
  const refreshed = await request('/api/v1/orders/refresh', { method: 'POST', headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': 'automation-entry-refresh' }, body: JSON.stringify({ accountId: account.id }) });
  assert.equal(refreshed.response.status, 200);
  assert.equal(refreshed.body.data.automation.results[0].trigger, 'unpaid_reprice');
  assert.equal(refreshed.body.data.automation.results[0].status, 'blocked');
  assert.equal(refreshed.body.data.automation.results[0].reason, 'PRODUCT_AUTOMATION_LIVE_MODE_REQUIRED');

  await runtime.store.createOrder({ adminId, order: { id: 'entry-review-order', orderNo: 'ENTRY-REVIEW', accountId: account.id, buyerId: 'entry-buyer', buyerName: '入口买家', itemId: product.externalProductRef ?? 'automation-entry-item', itemTitle: product.title, amountMinor: 1000, paymentStatus: 'paid', orderStatus: 'completed', deliveryStatus: 'delivered', afterSalesStatus: 'none', deliveryType: 'coupon_only', createdAt: '2026-09-20T00:00:00.000Z', updatedAt: '2026-09-22T00:00:00.000Z', configVersion: 1, source: 'local', productId: product.id, conversationId: conversation.id } });
  const imResult = await runtime.xianyuIm.handleExternalEvent(adminId, { accountId: account.id, externalConversationRef: conversation.externalConversationRef, externalMessageRef: 'entry-review-message', senderRef: 'entry-buyer', direction: 'inbound', bodyType: 'system', bodyText: '评价完成', occurredAt: '2026-09-23T00:00:00.000Z', raw: { productAutomation: { kind: 'review_created', orderNo: 'ENTRY-REVIEW', eventId: 'entry-review-event' } } }, { deferAutoReply: true });
  assert.equal(imResult.automation?.accepted, true);
  assert.equal(imResult.automation?.result?.trigger, 'review_gift');
  assert.equal(imResult.automation?.result?.status, 'blocked');

  const reminder = await runtime.productAutomationWorker.pollReviewReminders({ adminId, accountId: account.id, now: '2026-09-24T00:00:00.000Z' });
  assert.ok(reminder.results.some((item) => item.trigger === 'review_reminder' && item.status === 'blocked'));
  console.log('product automation entry cross-layer smoke passed');
} finally {
  await runtime.close();
}
