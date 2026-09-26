import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { AutomationWorkflowService, PersistentAutomationExecutionLedger } from '../src/product-automation.js';
import { ProductAutomationTrigger } from '../src/product-automation-trigger.js';
import { XianyuProductAutomationExecutionAdapter } from '../src/product-automation-xianyu.js';
import type { OrderRecord, ProductAutomationConfig } from '../src/domain.js';
import type { XianyuImService } from '../src/xianyu-im-service.js';
import type { XianyuMtopClient } from '../src/xianyu-mtop.js';

type Runtime = ReturnType<typeof createApp>;

interface ExternalCall {
  kind: 'sendText' | 'sendImage' | 'confirmShipment' | 'repriceOrder';
  orderNo?: string;
  text?: string;
  targetPriceMinor?: number;
}

test('product automation full E2E executes each configured rule from order state to Xianyu adapter calls', async () => {
  const config = loadConfig({
    ...process.env,
    HOST: '127.0.0.1',
    PORT: '0',
    ALLOW_IN_MEMORY: 'true',
    XIANYU_QR_MODE: 'stub',
    AGENT_RUNTIME: 'in-process',
    AUTO_REPLY_MODEL_ENABLED: 'false',
    AUTO_REPLY_OUTCOME_REVIEW_WORKER_ENABLED: 'false',
    PRODUCT_AUTOMATION_EXECUTION_MODE: 'simulate',
    PRODUCT_AUTOMATION_LIVE_CONFIRMED: 'false',
  });
  const runtime = createApp(config);
  await runtime.listen();

  try {
    const address = runtime.server.address();
    assert.ok(address && typeof address === 'object');
    const baseUrl = `http://127.0.0.1:${address.port}`;
    let cookie = '';
    let csrf = '';

    const request = async (path: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      if (cookie) headers.set('cookie', cookie);
      const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
      const setCookies = response.headers.getSetCookie?.() ?? [];
      if (setCookies.length > 0) {
        const values = new Map<string, string>();
        for (const pair of cookie.split('; ')) {
          const index = pair.indexOf('=');
          if (index > 0) values.set(pair.slice(0, index), pair.slice(index + 1));
        }
        for (const value of setCookies) {
          const pair = value.split(';', 1)[0] ?? '';
          const index = pair.indexOf('=');
          if (index > 0) values.set(pair.slice(0, index), pair.slice(index + 1));
        }
        cookie = [...values.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
        csrf = decodeURIComponent(values.get('csrf_token') ?? '');
      }
      const raw = await response.text();
      return { response, body: raw ? JSON.parse(raw) as { data?: any; error?: any } : undefined };
    };

    const bootstrap = await request('/api/v1/auth/bootstrap', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Idempotency-Key': 'product-automation-full-e2e-bootstrap' },
      body: JSON.stringify({ email: 'product-automation-full-e2e@example.com', password: 'password-123', displayName: '自动化 E2E' }),
    });
    assert.equal(bootstrap.response.status, 200);
    const adminId = bootstrap.body?.data?.profile?.id as string;
    assert.ok(adminId);
    assert.ok(cookie && csrf);

    const account = await runtime.store.createAccount({ adminId, platform: 'xianyu', sellerRef: 'full-e2e-seller', displayName: 'E2E 卖家' });
    const paidProduct = await runtime.store.createProduct({ adminId, accountId: account.id, externalProductRef: 'full-e2e-paid', title: 'E2E 付款自动发货', description: '付款规则商品', status: 'published' });
    const unpaidProduct = await runtime.store.createProduct({ adminId, accountId: account.id, externalProductRef: 'full-e2e-unpaid', title: 'E2E 未付款改价', description: '改价规则商品', status: 'published' });
    const giftProduct = await runtime.store.createProduct({ adminId, accountId: account.id, externalProductRef: 'full-e2e-gift', title: 'E2E 评价赠品', description: '评价赠品商品', status: 'published' });
    const reminderProduct = await runtime.store.createProduct({ adminId, accountId: account.id, externalProductRef: 'full-e2e-reminder', title: 'E2E 评价提醒', description: '评价提醒商品', status: 'published' });

    const paidConversation = await runtime.store.createConversation({ adminId, accountId: account.id, buyerRef: 'buyer-paid', buyerDisplayName: '付款买家', externalConversationRef: 'conversation-paid' });
    const giftConversation = await runtime.store.createConversation({ adminId, accountId: account.id, buyerRef: 'buyer-gift', buyerDisplayName: '评价买家', externalConversationRef: 'conversation-gift' });
    const reminderConversation = await runtime.store.createConversation({ adminId, accountId: account.id, buyerRef: 'buyer-reminder', buyerDisplayName: '提醒买家', externalConversationRef: 'conversation-reminder' });

    const deliveryBatch = await runtime.store.createCouponBatch({ adminId, accountId: account.id, label: 'E2E 发货卡券', purpose: 'text', metadata: { textContent: 'DELIVERY-E2E' } });
    await runtime.store.importCouponItems({ adminId, batchId: deliveryBatch.id, contents: ['DELIVERY-E2E-ITEM'] });
    const giftBatch = await runtime.store.createCouponBatch({ adminId, accountId: account.id, label: 'E2E 评价赠品', purpose: 'text', metadata: { textContent: 'GIFT-E2E' } });
    await runtime.store.importCouponItems({ adminId, batchId: giftBatch.id, contents: ['GIFT-E2E-ITEM'] });
    const deliveryBatchRef = deliveryBatch.sequenceId ?? deliveryBatch.id;
    const giftBatchRef = giftBatch.sequenceId ?? giftBatch.id;

    const configure = async (productId: string, rule: Record<string, unknown>) => {
      const updated = await request(`/api/v1/products/${productId}/automation`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          'if-match-version': '1',
          'x-csrf-token': csrf,
          'idempotency-key': `product-automation-full-e2e-config-${productId}`,
        },
        body: JSON.stringify({ config: rule }),
      });
      assert.equal(updated.response.status, 200);
      const read = await request(`/api/v1/products/${productId}/automation`);
      assert.equal(read.response.status, 200);
      return read.body?.data?.config as ProductAutomationConfig;
    };

    const paidConfig = await configure(paidProduct.id, { paidAutoDelivery: { enabled: true, couponBatchIds: [deliveryBatchRef], autoConfirm: true, maxAttempts: 1, retryBackoffSeconds: 0 } });
    const unpaidConfig = await configure(unpaidProduct.id, { unpaidAutoReprice: { enabled: true, mode: 'fixed', targetPriceMinor: 777, message: '请及时付款', maxAttempts: 1, retryBackoffSeconds: 0 } });
    const giftConfig = await configure(giftProduct.id, { reviewGift: { enabled: true, couponBatchIds: [giftBatchRef], maxAttempts: 1, retryBackoffSeconds: 0 } });
    const reminderConfig = await configure(reminderProduct.id, { reviewReminder: { enabled: true, firstDelayMinutes: 1, repeatIntervalMinutes: 1, maxReminders: 1, message: '请完成评价' } });
    assert.equal(paidConfig.paidAutoDelivery.enabled, true);
    assert.equal(unpaidConfig.unpaidAutoReprice.targetPriceMinor, 777);
    assert.equal(giftConfig.reviewGift.enabled, true);
    assert.deepEqual({ firstDelayMinutes: reminderConfig.reviewReminder.firstDelayMinutes, repeatIntervalMinutes: reminderConfig.reviewReminder.repeatIntervalMinutes }, { firstDelayMinutes: 1, repeatIntervalMinutes: 1 });

    const now = '2026-09-25T10:00:00.000Z';
    const orders = new Map<string, OrderRecord>();
    const createOrder = async (input: Omit<OrderRecord, 'id' | 'createdAt' | 'updatedAt' | 'configVersion' | 'source'> & { id: string; createdAt: string; updatedAt: string }) => {
      const order = await runtime.store.createOrder({ adminId, order: { ...input, source: 'local' } });
      orders.set(order.orderNo, order);
      return order;
    };
    const paidOrder = await createOrder({ id: 'full-e2e-paid-order', orderNo: 'FULL-E2E-PAID', accountId: account.id, buyerId: 'buyer-paid', buyerName: '付款买家', itemId: paidProduct.externalProductRef!, itemTitle: paidProduct.title, amountMinor: 1000, paymentStatus: 'paid', orderStatus: 'open', deliveryStatus: 'pending', afterSalesStatus: 'none', deliveryType: 'coupon_only', conversationId: paidConversation.id, productId: paidProduct.id, createdAt: now, updatedAt: now });
    const unpaidOrder = await createOrder({ id: 'full-e2e-unpaid-order', orderNo: 'FULL-E2E-UNPAID', accountId: account.id, buyerId: 'buyer-unpaid', buyerName: '改价买家', itemId: unpaidProduct.externalProductRef!, itemTitle: unpaidProduct.title, amountMinor: 1000, paymentStatus: 'unpaid', orderStatus: 'open', deliveryStatus: 'pending', afterSalesStatus: 'none', productId: unpaidProduct.id, createdAt: now, updatedAt: now });
    const giftOrder = await createOrder({ id: 'full-e2e-gift-order', orderNo: 'FULL-E2E-GIFT', accountId: account.id, buyerId: 'buyer-gift', buyerName: '评价买家', itemId: giftProduct.externalProductRef!, itemTitle: giftProduct.title, amountMinor: 1000, paymentStatus: 'paid', orderStatus: 'completed', deliveryStatus: 'delivered', afterSalesStatus: 'none', deliveryType: 'coupon_only', conversationId: giftConversation.id, productId: giftProduct.id, createdAt: now, updatedAt: now });
    const reminderOrder = await createOrder({ id: 'full-e2e-reminder-order', orderNo: 'FULL-E2E-REMINDER', accountId: account.id, buyerId: 'buyer-reminder', buyerName: '提醒买家', itemId: reminderProduct.externalProductRef!, itemTitle: reminderProduct.title, amountMinor: 1000, paymentStatus: 'paid', orderStatus: 'completed', deliveryStatus: 'delivered', afterSalesStatus: 'none', deliveryType: 'coupon_only', conversationId: reminderConversation.id, productId: reminderProduct.id, createdAt: '2026-09-25T09:57:00.000Z', updatedAt: '2026-09-25T09:57:00.000Z' });

    const calls: ExternalCall[] = [];
    const fakeMtop = {
      readOrderDetail: async (_adminId: string, _accountId: string, orderNo: string) => {
        const order = orders.get(orderNo);
        return { success: true, accountInvalid: false, cookieHeader: '', detail: order ? { orderNo, itemId: order.itemId, itemTitle: order.itemTitle, buyerId: order.buyerId, conversationId: order.conversationId, paymentStatus: order.paymentStatus, deliveryStatus: order.deliveryStatus } : undefined };
      },
      confirmShipment: async (_adminId: string, _accountId: string, orderNo: string) => { calls.push({ kind: 'confirmShipment', orderNo }); return { status: 'succeeded', externalRef: `shipment:${orderNo}`, cookieHeader: '' }; },
      repriceOrder: async (_adminId: string, _accountId: string, orderNo: string, targetPriceMinor: number) => { calls.push({ kind: 'repriceOrder', orderNo, targetPriceMinor }); return { status: 'succeeded', externalRef: `reprice:${orderNo}`, cookieHeader: '' }; },
    } as unknown as XianyuMtopClient;
    const fakeIm = {
      sendText: async (_adminId: string, _accountId: string, _conversationId: string, text: string) => { calls.push({ kind: 'sendText', text }); return { externalMessageRef: `text:${calls.length}` }; },
      sendImage: async () => { calls.push({ kind: 'sendImage' }); return { externalMessageRef: `image:${calls.length}` }; },
    } as unknown as XianyuImService;
    const adapter = new XianyuProductAutomationExecutionAdapter(runtime.store, () => fakeMtop, () => fakeIm);
    const trigger = new ProductAutomationTrigger(
      runtime.store,
      runtime.productAutomation,
      new AutomationWorkflowService(adapter, new PersistentAutomationExecutionLedger(runtime.store)),
      adapter,
      undefined,
      { executionMode: 'live', liveConfirmed: true, reviewExternalWritesConfirmed: true, buyerAllowlist: [] },
    );

    const paidResult = await trigger.onOrderRefresh({ adminId, accountId: account.id, items: [paidOrder], requestId: 'full-e2e-paid', traceId: 'full-e2e-paid' });
    assert.equal(paidResult.results[0]?.trigger, 'payment_paid');
    assert.equal(paidResult.results[0]?.status, 'succeeded');
    assert.ok(calls.some((call) => call.kind === 'sendText' && call.text === 'DELIVERY-E2E'));
    assert.ok(calls.some((call) => call.kind === 'confirmShipment' && call.orderNo === paidOrder.orderNo));

    const unpaidResult = await trigger.onOrderRefresh({ adminId, accountId: account.id, items: [unpaidOrder], requestId: 'full-e2e-unpaid', traceId: 'full-e2e-unpaid' });
    assert.equal(unpaidResult.results[0]?.trigger, 'unpaid_reprice');
    assert.equal(unpaidResult.results[0]?.status, 'succeeded');
    assert.ok(calls.some((call) => call.kind === 'repriceOrder' && call.orderNo === unpaidOrder.orderNo && call.targetPriceMinor === 777));

    const reviewResult = await trigger.onImEvent(adminId, { accountId: account.id, externalConversationRef: giftConversation.externalConversationRef, externalMessageRef: 'full-e2e-review-message', sourceEventId: 'full-e2e-review-event', senderRef: giftOrder.buyerId, direction: 'inbound', bodyType: 'system', platformSystemMessage: true, bodyText: '已评价', itemRef: giftOrder.itemId, occurredAt: now, raw: {} });
    assert.equal(reviewResult.accepted, true);
    assert.equal(reviewResult.result?.trigger, 'review_gift');
    assert.equal(reviewResult.result?.status, 'succeeded');
    assert.ok(calls.some((call) => call.kind === 'sendText' && call.text === 'GIFT-E2E'));
    assert.ok((await runtime.store.getOrder(adminId, giftOrder.orderNo, account.id))?.reviewedAt);

    const reminderResult = await trigger.onReviewReminder({ adminId, order: reminderOrder, now });
    assert.equal(reminderResult.trigger, 'review_reminder');
    assert.equal(reminderResult.status, 'succeeded');
    assert.ok(calls.some((call) => call.kind === 'sendText' && call.text === '请完成评价'));
    const persistedReminder = await runtime.store.getOrder(adminId, reminderOrder.orderNo, account.id);
    assert.equal(persistedReminder?.reminderCount, 1);
    assert.equal(persistedReminder?.lastReminderAt, now);

    const visibleOrders = await request(`/api/v1/orders?accountId=${encodeURIComponent(account.id)}&page=1&pageSize=100`);
    assert.equal(visibleOrders.response.status, 200);
    const visibleOrderNos = (visibleOrders.body?.data?.items ?? []).map((item: { orderNo: string }) => item.orderNo);
    assert.deepEqual(new Set(visibleOrderNos), new Set(orders.keys()));
    console.log('product automation full E2E passed: paid delivery, unpaid reprice, system review gift, and minute-based review reminder all executed through the Xianyu adapter');
  } finally {
    await runtime.close();
  }
});
