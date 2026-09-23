import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryStore } from '../src/store-memory.js';
import type { AutomationExecutionPort, AutomationExternalResult, AutomationOrderSnapshot } from '../src/product-automation.js';
import { AutomationWorkflowService, ProductAutomationService, defaultProductAutomationConfig } from '../src/product-automation.js';
import { NotConfiguredAutomationExecutionAdapter, ProductAutomationTrigger, ProductAutomationWorker } from '../src/product-automation-trigger.js';
import type { ProductAutomationConfig } from '../src/domain.js';
import type { ProductAutomationLiveConfig } from '../src/product-automation-live-gate.js';

function testLiveGate(): ProductAutomationLiveConfig {
  return { executionMode: 'live', liveConfirmed: true, productTitleAllowlist: ['自动化商品'] };
}

function external(status: AutomationExternalResult['status'], errorCode?: string): AutomationExternalResult { return { status, errorCode, externalRef: status === 'succeeded' ? `ext-${status}` : undefined }; }

function order(overrides: Partial<AutomationOrderSnapshot> = {}): AutomationOrderSnapshot {
  return {
    id: 'order-1', orderNo: 'ORDER-1', accountId: 'account-1', buyerId: 'buyer-1', buyerName: '买家', itemId: 'item-1', itemTitle: '商品', amountMinor: 1000,
    paymentStatus: 'paid', orderStatus: 'open', deliveryStatus: 'pending', afterSalesStatus: 'none', deliveryType: 'coupon_only', createdAt: '2026-09-20T00:00:00.000Z', updatedAt: '2026-09-20T00:00:00.000Z', configVersion: 1, source: 'local', productId: 'product-1', conversationId: 'conversation-1', ...overrides,
  };
}

class ReadyPort implements AutomationExecutionPort {
  readonly calls: string[] = [];
  reviewCreated = true;
  reviewError?: Error;
  readOrderResult?: AutomationOrderSnapshot;
  async reserveCoupon(input: { purpose: 'delivery' | 'gift'; quantity: number }): Promise<{ reservationId: string; quantity: number }> { this.calls.push(`reserve:${input.purpose}`); return { reservationId: 'reservation-1', quantity: input.quantity }; }
  async sendCoupon(input: { purpose: 'delivery' | 'gift' }): Promise<AutomationExternalResult> { this.calls.push(`send:${input.purpose}`); return external('succeeded'); }
  async commitCoupon(): Promise<void> { this.calls.push('commit'); }
  async releaseCoupon(input: { reason: string }): Promise<void> { this.calls.push(`release:${input.reason}`); }
  async confirmShipment(): Promise<AutomationExternalResult> { this.calls.push('confirm'); return external('succeeded'); }
  async repriceOrder(input: { targetPriceMinor: number }): Promise<AutomationExternalResult> { this.calls.push(`reprice:${input.targetPriceMinor}`); return external('succeeded'); }
  async sendText(input: { text: string }): Promise<AutomationExternalResult> { this.calls.push(`text:${input.text}`); return external('succeeded'); }
  async persistReviewFact(): Promise<{ created: boolean }> { this.calls.push('review-fact'); if (this.reviewError) throw this.reviewError; return { created: this.reviewCreated }; }
  async readOrder(): Promise<AutomationOrderSnapshot | undefined> { this.calls.push('read-order'); return this.readOrderResult; }
  async markManualReview(input: { reason: string }): Promise<void> { this.calls.push(`manual:${input.reason}`); }
}

async function setup() {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: `trigger-${Math.random()}@example.com`, passwordHash: 'hash', displayName: 'Trigger' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: `trigger-${Math.random()}` });
  const product = await store.createProduct({ adminId: admin.id, accountId: account.id, title: '自动化商品', status: 'published' });
  const coupon = await store.createCouponBatch({ adminId: admin.id, accountId: account.id, label: '自动化卡券', purpose: 'text', deliveryScope: 'buyer_deliverable' });
  await store.importCouponItems({ adminId: admin.id, batchId: coupon.id, contents: ['coupon-1', 'coupon-2'] });
  const configs = new ProductAutomationService(store, async () => 'audit');
  return { store, admin, account, product, coupon, configs };
}

test('order refresh trigger dispatches paid and unpaid workflows through a ready adapter', async () => {
  const { store, admin, account, product, coupon, configs } = await setup();
  const config = defaultProductAutomationConfig();
  config.paidAutoDelivery = { ...config.paidAutoDelivery, enabled: true, couponBatchIds: [coupon.id] };
  config.unpaidAutoReprice = { ...config.unpaidAutoReprice, enabled: true, targetPriceMinor: 880 };
  await configs.update({ adminId: admin.id, productId: product.id, expectedConfigVersion: 1, config, requestId: 'config', traceId: 'config' });
  const port = new ReadyPort();
  const trigger = new ProductAutomationTrigger(store, configs, new AutomationWorkflowService(port), Object.assign(port, { readiness: 'ready' as const }), undefined, testLiveGate());
  const paid = order({ id: 'paid', orderNo: 'PAID-1', accountId: account.id, productId: product.id });
  const unpaid = order({ id: 'unpaid', orderNo: 'UNPAID-1', accountId: account.id, productId: product.id, paymentStatus: 'unpaid' });
  port.readOrderResult = unpaid;
  const result = await trigger.onOrderRefresh({ adminId: admin.id, accountId: account.id, items: [paid, unpaid], requestId: 'refresh', traceId: 'refresh' });
  assert.deepEqual(result.results.map((item) => item.status), ['succeeded', 'succeeded']);
  assert.deepEqual(port.calls, ['reserve:delivery', 'send:delivery', 'commit', 'read-order', 'reprice:880']);
});

test('default adapter blocks without fabricating shipment/reprice success and worker polls reminders', async () => {
  const { store, admin, account, product, coupon, configs } = await setup();
  const config = defaultProductAutomationConfig();
  config.paidAutoDelivery = { ...config.paidAutoDelivery, enabled: true, couponBatchIds: [coupon.id] };
  config.reviewReminder = { ...config.reviewReminder, enabled: true, firstDelayHours: 1, message: '请评价' };
  await configs.update({ adminId: admin.id, productId: product.id, expectedConfigVersion: 1, config, requestId: 'config', traceId: 'config' });
  const blocked = new NotConfiguredAutomationExecutionAdapter();
  const trigger = new ProductAutomationTrigger(store, configs, new AutomationWorkflowService(blocked), blocked, undefined, testLiveGate());
  const blockedResult = await trigger.onOrderRefresh({ adminId: admin.id, accountId: account.id, items: [order({ accountId: account.id, productId: product.id })], requestId: 'refresh', traceId: 'refresh' });
  assert.equal(blockedResult.results[0]?.status, 'blocked');
  assert.equal(blockedResult.results[0]?.reason, 'AUTOMATION_EXECUTION_NOT_CONFIGURED');
  const worker = new ProductAutomationWorker(store, trigger);
  await store.createOrder({ adminId: admin.id, order: { ...order({ id: 'reminder', orderNo: 'REMINDER-1', accountId: account.id, productId: product.id, deliveryStatus: 'delivered', paymentStatus: 'paid' }), source: 'local' } });
  const reminders = await worker.pollReviewReminders({ adminId: admin.id, accountId: account.id, now: '2026-09-24T00:00:00.000Z' });
  assert.equal(reminders.results.length, 1);
  assert.equal(reminders.results[0]?.status, 'blocked');
});

test('blocked adapter never fabricates success for all four automation flows', async () => {
  const { store, admin, account, product, coupon, configs } = await setup();
  const config = defaultProductAutomationConfig();
  config.paidAutoDelivery = { ...config.paidAutoDelivery, enabled: true, couponBatchIds: [coupon.id] };
  config.unpaidAutoReprice = { ...config.unpaidAutoReprice, enabled: true, targetPriceMinor: 880 };
  config.reviewGift = { ...config.reviewGift, enabled: true, couponBatchIds: [coupon.id] };
  config.reviewReminder = { ...config.reviewReminder, enabled: true, firstDelayHours: 1 };
  await configs.update({ adminId: admin.id, productId: product.id, expectedConfigVersion: 1, config, requestId: 'blocked-config', traceId: 'blocked-config' });
  const blocked = new NotConfiguredAutomationExecutionAdapter();
  const trigger = new ProductAutomationTrigger(store, configs, new AutomationWorkflowService(blocked), blocked, undefined, testLiveGate());
  const paid = order({ id: 'blocked-paid', orderNo: 'BLOCKED-PAID', accountId: account.id, productId: product.id, paymentStatus: 'paid' });
  const unpaid = order({ id: 'blocked-unpaid', orderNo: 'BLOCKED-UNPAID', accountId: account.id, productId: product.id, paymentStatus: 'unpaid' });
  await store.createOrder({ adminId: admin.id, order: { ...paid, source: 'local' } });
  await store.createOrder({ adminId: admin.id, order: { ...unpaid, source: 'local' } });
  const refresh = await trigger.onOrderRefresh({ adminId: admin.id, accountId: account.id, items: [paid, unpaid], requestId: 'blocked-refresh', traceId: 'blocked-refresh' });
  assert.deepEqual(refresh.results.map((item) => item.status), ['blocked', 'blocked']);
  const gift = await trigger.onReviewEvent({ adminId: admin.id, accountId: account.id, orderNo: paid.orderNo, eventId: 'blocked-review' });
  assert.equal(gift.status, 'blocked');
  const reminder = await trigger.onReviewReminder({ adminId: admin.id, order: { ...paid, deliveryStatus: 'delivered' }, now: '2026-09-22T00:00:00.000Z' });
  assert.equal(reminder.status, 'blocked');
});

test('successful reminder persists count and next polling pass does not resend', async () => {
  const { store, admin, account, product, configs } = await setup();
  const config = defaultProductAutomationConfig();
  config.reviewReminder = { ...config.reviewReminder, enabled: true, firstDelayHours: 1, maxReminders: 1, message: '请评价' };
  await configs.update({ adminId: admin.id, productId: product.id, expectedConfigVersion: 1, config, requestId: 'reminder-config', traceId: 'reminder-config' });
  const created = await store.createOrder({ adminId: admin.id, order: { ...order({ id: 'reminder-persist', orderNo: 'REMINDER-PERSIST', accountId: account.id, productId: product.id, deliveryStatus: 'delivered', paymentStatus: 'paid', createdAt: '2026-09-20T00:00:00.000Z', conversationId: 'conversation-1' }), source: 'local' } });
  const port = new ReadyPort();
  port.readOrderResult = { ...created, deliveryStatus: 'delivered', reviewedAt: undefined, reminderCount: 0 };
  const adapter = Object.assign(port, { readiness: 'ready' as const });
  const trigger = new ProductAutomationTrigger(store, configs, new AutomationWorkflowService(port), adapter, undefined, testLiveGate());
  const first = await trigger.onReviewReminder({ adminId: admin.id, order: created, now: '2026-09-21T00:00:00.000Z' });
  assert.equal(first.status, 'succeeded');
  assert.equal((await store.getOrder(admin.id, created.orderNo, account.id))?.reminderCount, 1);
  const sendsAfterFirst = port.calls.filter((call) => call === 'text:请评价').length;
  const worker = new ProductAutomationWorker(store, trigger);
  const secondPass = await worker.pollReviewReminders({ adminId: admin.id, accountId: account.id, now: '2026-09-21T00:00:00.000Z' });
  assert.equal(secondPass.results.find((item) => item.orderNo === created.orderNo)?.reason, 'not_due_or_capped');
  assert.equal(port.calls.filter((call) => call === 'text:请评价').length, sendsAfterFirst);
});

test('IM adapter envelope accepts only explicit review signals', async () => {
  const { store, admin, account, product, configs } = await setup();
  const config = defaultProductAutomationConfig();
  const trigger = new ProductAutomationTrigger(store, configs, new AutomationWorkflowService(new NotConfiguredAutomationExecutionAdapter()), new NotConfiguredAutomationExecutionAdapter(), undefined, testLiveGate());
  const ignored = await trigger.onImEvent(admin.id, { accountId: account.id, externalConversationRef: 'c', externalMessageRef: 'm-1', senderRef: 'buyer', direction: 'inbound', bodyType: 'text', bodyText: '好评', occurredAt: '2026-09-23T00:00:00.000Z', raw: { text: '好评' } });
  assert.deepEqual(ignored, { accepted: false, reason: 'AUTOMATION_SIGNAL_NOT_PRESENT' });
  const accepted = await trigger.onImEvent(admin.id, { accountId: account.id, externalConversationRef: 'c', externalMessageRef: 'm-2', senderRef: 'buyer', direction: 'inbound', bodyType: 'system', occurredAt: '2026-09-23T00:00:00.000Z', raw: { productAutomation: { kind: 'review_created', orderNo: 'MISSING', eventId: 'review-1' } } });
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.result?.reason, 'ORDER_NOT_FOUND');
  assert.equal(product.accountId, account.id);
});

test('IM review signal validates buyer and conversation ownership before execution', async () => {
  const { store, admin, account, product, configs } = await setup();
  const created = await store.createOrder({ adminId: admin.id, order: { ...order({ id: 'review-owner', orderNo: 'REVIEW-OWNER', accountId: account.id, productId: product.id, buyerId: 'buyer-owner', conversationId: 'conversation-owner' }), source: 'local' } });
  const adapter = new NotConfiguredAutomationExecutionAdapter();
  const trigger = new ProductAutomationTrigger(store, configs, new AutomationWorkflowService(adapter), adapter, undefined, testLiveGate());
  const mismatchedBuyer = await trigger.onImEvent(admin.id, { accountId: account.id, externalConversationRef: created.conversationId!, externalMessageRef: 'm-owner-1', senderRef: 'attacker', direction: 'inbound', bodyType: 'system', occurredAt: '2026-09-22T00:00:00.000Z', raw: { productAutomation: { kind: 'review_created', orderNo: created.orderNo, eventId: 'review-owner-1' } } });
  assert.deepEqual(mismatchedBuyer, { accepted: false, reason: 'AUTOMATION_SIGNAL_BUYER_MISMATCH' });
  const mismatchedConversation = await trigger.onImEvent(admin.id, { accountId: account.id, externalConversationRef: 'conversation-other', externalMessageRef: 'm-owner-2', senderRef: created.buyerId, direction: 'inbound', bodyType: 'system', occurredAt: '2026-09-22T00:00:00.000Z', raw: { productAutomation: { kind: 'review_created', orderNo: created.orderNo, eventId: 'review-owner-2' } } });
  assert.deepEqual(mismatchedConversation, { accepted: false, reason: 'AUTOMATION_SIGNAL_CONVERSATION_MISMATCH' });
  assert.equal(product.accountId, account.id);
});

test('review trigger is idempotent, contains persistence failure, and does not send gift before fact commit', async () => {
  const { store, admin, account, product, coupon, configs } = await setup();
  const config = defaultProductAutomationConfig();
  config.reviewGift = { ...config.reviewGift, enabled: true, couponBatchIds: [coupon.id] };
  await configs.update({ adminId: admin.id, productId: product.id, expectedConfigVersion: 1, config, requestId: 'config', traceId: 'config' });
  await store.createOrder({ adminId: admin.id, order: { ...order({ id: 'review-order', orderNo: 'REVIEW-1', accountId: account.id, productId: product.id }), source: 'local' } });
  const port = new ReadyPort();
  const trigger = new ProductAutomationTrigger(store, configs, new AutomationWorkflowService(port), Object.assign(port, { readiness: 'ready' as const }), undefined, testLiveGate());
  const first = await trigger.onReviewEvent({ adminId: admin.id, accountId: account.id, orderNo: 'REVIEW-1', eventId: 'review-event-1' });
  const duplicate = await trigger.onReviewEvent({ adminId: admin.id, accountId: account.id, orderNo: 'REVIEW-1', eventId: 'review-event-1' });
  assert.equal(first.status, 'succeeded');
  assert.deepEqual(duplicate, first);
  assert.deepEqual(port.calls, ['review-fact', 'reserve:gift', 'send:gift', 'commit']);

  const failedPort = new ReadyPort();
  failedPort.reviewError = new Error('REVIEW_FACT_PERSIST_FAILED');
  const failedTrigger = new ProductAutomationTrigger(store, configs, new AutomationWorkflowService(failedPort), Object.assign(failedPort, { readiness: 'ready' as const }), undefined, testLiveGate());
  const failed = await failedTrigger.onReviewEvent({ adminId: admin.id, accountId: account.id, orderNo: 'REVIEW-1', eventId: 'review-event-2' });
  assert.equal(failed.status, 'failed');
  assert.equal(failed.reason, 'REVIEW_FACT_PERSIST_FAILED');
  assert.deepEqual(failedPort.calls, ['review-fact']);
});

test('trigger reports scope mismatch and audit failure without masking the outcome', async () => {
  const { store, admin, account, product, configs } = await setup();
  const port = new ReadyPort();
  const trigger = new ProductAutomationTrigger(store, configs, new AutomationWorkflowService(port), Object.assign(port, { readiness: 'ready' as const }), async () => { throw new Error('AUDIT_STORE_DOWN'); }, testLiveGate());
  const mismatch = await trigger.onOrderRefresh({ adminId: admin.id, accountId: 'different-account', items: [order({ accountId: account.id, productId: product.id })], requestId: 'scope', traceId: 'scope' });
  assert.equal(mismatch.results[0]?.status, 'blocked');
  assert.equal(mismatch.results[0]?.reason, 'ACCOUNT_SCOPE_MISMATCH');
  const disabled = await trigger.onOrderRefresh({ adminId: admin.id, accountId: account.id, items: [order({ accountId: account.id, productId: product.id })], requestId: 'audit', traceId: 'audit' });
  assert.equal(disabled.results[0]?.status, 'skipped');
});

test('external order upsert links productId from account-scoped externalProductRef', async () => {
  const { store, admin, account, product } = await setup();
  const upserted = await store.upsertExternalOrder({
    adminId: admin.id,
    accountId: account.id,
    syncedAt: '2026-09-22T00:00:00.000Z',
    item: {
      orderNo: 'LINK-1', buyerId: 'buyer-link', buyerName: '关联买家', itemId: product.externalProductRef!, itemTitle: product.externalProductRef!, amountMinor: 1000,
      paymentStatus: 'paid', orderStatus: 'open', deliveryStatus: 'pending', afterSalesStatus: 'none', deliveryType: 'coupon_only', createdAt: '2026-09-22T00:00:00.000Z', sourcePayloadDigest: 'link-fixture',
    },
  });
  assert.equal(upserted.order.productId, product.id);
  assert.equal((await store.getOrder(admin.id, 'LINK-1', account.id))?.productId, product.id);
});
