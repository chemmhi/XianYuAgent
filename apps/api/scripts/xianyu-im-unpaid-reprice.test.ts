import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryStore } from '../src/store-memory.js';
import { MessageService } from '../src/messages.js';
import { XianyuImService } from '../src/xianyu-im-service.js';
import { AutomationWorkflowService, ProductAutomationService, defaultProductAutomationConfig } from '../src/product-automation.js';
import { ProductAutomationTrigger } from '../src/product-automation-trigger.js';

test('trusted platform payment-state reminders refresh orders, while buyer text does not', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'unpaid-refresh@example.com', passwordHash: 'hash', displayName: 'Unpaid Refresh' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'seller-unpaid-refresh' });
  const conversation = await store.createConversation({
    adminId: admin.id,
    accountId: account.id,
    buyerRef: 'buyer-unpaid-refresh',
    buyerDisplayName: 'Buyer',
    externalConversationRef: 'conversation-unpaid-refresh',
  });
  const messages = new MessageService(store, async () => 'audit');
  const refreshes: string[] = [];
  const service = new XianyuImService(
    store,
    {} as never,
    messages,
    undefined,
    undefined,
    undefined,
    async ({ event }) => { refreshes.push(event.externalMessageRef); },
  );

  const baseEvent = {
    accountId: account.id,
    externalConversationRef: conversation.externalConversationRef!,
    senderRef: conversation.buyerRef,
    senderName: conversation.buyerDisplayName,
    direction: 'inbound' as const,
    bodyType: 'text' as const,
    bodyText: '[我已拍下，待付款]',
    occurredAt: '2026-09-26T01:00:00.000Z',
  };

  await service.handleExternalEvent(admin.id, { ...baseEvent, externalMessageRef: 'trusted-unpaid-event', platformSystemMessage: true });
  await service.handleExternalEvent(admin.id, {
    ...baseEvent,
    externalMessageRef: 'trusted-paid-event',
    bodyText: '[我已付款，等待你发货]',
    platformSystemMessage: true,
  });
  await service.handleExternalEvent(admin.id, { ...baseEvent, externalMessageRef: 'buyer-text-event' });

  assert.deepEqual(refreshes, ['trusted-unpaid-event', 'trusted-paid-event']);
});

test('trusted paid reminder runs delivery immediately through the event-driven refresh path', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'paid-event-delivery@example.com', passwordHash: 'hash', displayName: 'Paid Event Delivery' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'seller-paid-event' });
  const product = await store.createProduct({ adminId: admin.id, accountId: account.id, title: 'Event Delivery Product', status: 'published' });
  const conversation = await store.createConversation({ adminId: admin.id, accountId: account.id, buyerRef: 'buyer-paid-event', buyerDisplayName: 'Buyer', externalConversationRef: 'conversation-paid-event' });
  const coupon = await store.createCouponBatch({ adminId: admin.id, accountId: account.id, label: 'Event Delivery Coupon', purpose: 'text' });
  await store.importCouponItems({ adminId: admin.id, batchId: coupon.id, contents: ['EVENT-DELIVERY-CODE'] });
  const configs = new ProductAutomationService(store, async () => 'audit');
  const config = defaultProductAutomationConfig();
  config.paidAutoDelivery = { ...config.paidAutoDelivery, enabled: true, couponBatchIds: [coupon.id], autoConfirm: true, maxAttempts: 1, retryBackoffSeconds: 0 };
  await configs.update({ adminId: admin.id, productId: product.id, expectedConfigVersion: 1, config, requestId: 'paid-event-config', traceId: 'paid-event-config' });
  const order = await store.createOrder({ adminId: admin.id, order: {
    orderNo: 'PAID-EVENT-1', accountId: account.id, buyerId: conversation.buyerRef, buyerName: 'Buyer', itemId: product.externalProductRef ?? product.id, itemTitle: product.title,
    amountMinor: 1_000, paymentStatus: 'paid', orderStatus: 'open', deliveryStatus: 'pending', afterSalesStatus: 'none', deliveryType: 'coupon_only', conversationId: conversation.id, productId: product.id, source: 'local',
  } });

  const calls: string[] = [];
  const adapter = {
    readiness: 'ready' as const,
    reserveCoupon: async () => { calls.push('reserve'); return { reservationId: 'reservation-1', quantity: 1 }; },
    sendCoupon: async () => { calls.push('send'); return { status: 'succeeded' as const, externalRef: 'send-1' }; },
    commitCoupon: async () => { calls.push('commit'); },
    releaseCoupon: async () => { calls.push('release'); },
    confirmShipment: async () => { calls.push('confirm'); return { status: 'succeeded' as const, externalRef: 'confirm-1' }; },
    repriceOrder: async () => ({ status: 'succeeded' as const, externalRef: 'reprice-1' }),
    sendText: async () => ({ status: 'succeeded' as const, externalRef: 'text-1' }),
    persistReviewFact: async () => ({ created: true }),
    readOrder: async () => undefined,
    markManualReview: async () => undefined,
  };
  const trigger = new ProductAutomationTrigger(
    store,
    configs,
    new AutomationWorkflowService(adapter),
    adapter,
    undefined,
    { executionMode: 'live', liveConfirmed: true, reviewExternalWritesConfirmed: true, buyerAllowlist: ['Buyer'] },
  );
  const messages = new MessageService(store, async () => 'audit');
  const service = new XianyuImService(store, {} as never, messages, undefined, trigger, undefined, async ({ adminId, accountId }) => {
    const current = await store.getOrder(adminId, order.orderNo, accountId);
    assert.ok(current);
    await trigger.onOrderRefresh({ adminId, accountId, items: [current], requestId: 'event-refresh', traceId: 'event-refresh' });
  });

  await service.handleExternalEvent(admin.id, {
    accountId: account.id,
    externalConversationRef: conversation.externalConversationRef!,
    externalMessageRef: 'paid-event-reminder.PNM',
    senderRef: conversation.buyerRef,
    senderName: conversation.buyerDisplayName,
    direction: 'inbound',
    bodyType: 'text',
    bodyText: '[我已付款，等待你发货]',
    platformSystemMessage: true,
    occurredAt: '2026-10-05T01:00:00.000Z',
  });

  assert.deepEqual(calls, ['reserve', 'send', 'commit', 'confirm']);
});
