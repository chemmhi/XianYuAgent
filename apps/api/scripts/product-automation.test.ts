import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryStore } from '../src/store-memory.js';
import { ProductAutomationService, AutomationWorkflowService, type AutomationExecutionPort, type AutomationExternalResult, type AutomationOrderSnapshot, defaultProductAutomationConfig } from '../src/product-automation.js';
import type { ProductAutomationConfig } from '../src/domain.js';

function result(status: AutomationExternalResult['status'], errorCode?: string): AutomationExternalResult { return { status, errorCode, externalRef: status === 'succeeded' ? `ext-${Math.random().toString(16).slice(2)}` : undefined }; }
function baseOrder(overrides: Partial<AutomationOrderSnapshot> = {}): AutomationOrderSnapshot {
  return {
    id: 'order-id', orderNo: 'ORDER-1', accountId: 'account-id', buyerId: 'buyer-id', buyerName: '买家', itemId: 'item-id', itemTitle: '资料包', amountMinor: 1990,
    paymentStatus: 'paid', orderStatus: 'open', deliveryStatus: 'pending', afterSalesStatus: 'none', deliveryType: 'coupon_only', createdAt: '2026-09-20T00:00:00.000Z', updatedAt: '2026-09-20T00:00:00.000Z', configVersion: 1, source: 'local', conversationId: 'conversation-id', quantity: 1, ...overrides,
  };
}

async function setup() {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'automation@example.com', passwordHash: 'hash', displayName: 'Automation' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: `automation-${Math.random()}` });
  const product = await store.createProduct({ adminId: admin.id, accountId: account.id, title: '自动化商品', status: 'published' });
  const coupon = await store.createCouponBatch({ adminId: admin.id, accountId: account.id, label: '发货卡券', purpose: 'text', deliveryScope: 'buyer_deliverable' });
  await store.importCouponItems({ adminId: admin.id, batchId: coupon.id, contents: ['coupon-1', 'coupon-2'] });
  const service = new ProductAutomationService(store, async () => 'audit-id');
  return { store, admin, account, product, coupon, service };
}

test('automation config defaults, validation, optimistic locking and account isolation', async () => {
  const { account, admin, product, coupon, service, store } = await setup();
  const initial = await service.get(admin.id, product.id);
  assert.equal(initial.configVersion, 1);
  assert.deepEqual(initial.config, defaultProductAutomationConfig());

  const config = { ...defaultProductAutomationConfig(), paidAutoDelivery: { ...defaultProductAutomationConfig().paidAutoDelivery, enabled: true, couponBatchIds: [coupon.id], autoConfirm: true } } satisfies ProductAutomationConfig;
  const saved = await service.update({ adminId: admin.id, productId: product.id, expectedConfigVersion: 1, config, requestId: 'req-1', traceId: 'trace-1' });
  assert.equal(saved.configVersion, 1);
  const savedAgain = await service.update({ adminId: admin.id, productId: product.id, expectedConfigVersion: 1, config: { ...config, unpaidAutoReprice: { ...config.unpaidAutoReprice, enabled: true, targetPriceMinor: 990 } }, requestId: 'req-2', traceId: 'trace-2' });
  assert.equal(savedAgain.configVersion, 2);
  await assert.rejects(() => service.update({ adminId: admin.id, productId: product.id, expectedConfigVersion: 1, config, requestId: 'req-stale', traceId: 'trace-stale' }), (error: unknown) => (error as { code?: string }).code === 'AUTOMATION_VERSION_CONFLICT');
  await assert.rejects(() => service.update({ adminId: admin.id, productId: product.id, expectedConfigVersion: 2, config: { ...defaultProductAutomationConfig(), paidAutoDelivery: { ...defaultProductAutomationConfig().paidAutoDelivery, enabled: true } }, requestId: 'req-invalid', traceId: 'trace-invalid' }), (error: unknown) => (error as { code?: string }).code === 'VALIDATION_FAILED');

  const foreignAdmin = await store.createAdmin({ email: 'foreign-automation@example.com', passwordHash: 'hash', displayName: 'Foreign' });
  const foreignAccount = await store.createAccount({ adminId: foreignAdmin.id, platform: 'xianyu', sellerRef: `foreign-${Math.random()}` });
  const foreignCoupon = await store.createCouponBatch({ adminId: foreignAdmin.id, accountId: foreignAccount.id, label: 'Foreign', purpose: 'text', deliveryScope: 'buyer_deliverable' });
  await assert.rejects(() => service.update({ adminId: admin.id, productId: product.id, expectedConfigVersion: 2, config: { ...defaultProductAutomationConfig(), reviewGift: { ...defaultProductAutomationConfig().reviewGift, enabled: true, couponBatchIds: [foreignCoupon.id] } }, requestId: 'req-cross', traceId: 'trace-cross' }), (error: unknown) => (error as { code?: string }).code === 'NOT_FOUND' || (error as { code?: string }).code === 'FORBIDDEN');
  assert.equal(account.id, product.accountId);
});

test('batch update is all-or-nothing for version conflict and cross-account products', async () => {
  const { store, admin, account, product, coupon, service } = await setup();
  const second = await store.createProduct({ adminId: admin.id, accountId: account.id, title: '第二商品', status: 'published' });
  const config = { ...defaultProductAutomationConfig(), reviewGift: { ...defaultProductAutomationConfig().reviewGift, enabled: true, couponBatchIds: [coupon.id] } } satisfies ProductAutomationConfig;
  const batch = await service.updateBatch({ adminId: admin.id, productIds: [product.id, second.id], expectedConfigVersions: { [product.id]: 1, [second.id]: 1 }, config, requestId: 'batch-1', traceId: 'trace-batch-1' });
  assert.deepEqual(batch.updatedProductIds.sort(), [product.id, second.id].sort());
  await assert.rejects(() => service.updateBatch({ adminId: admin.id, productIds: [product.id, second.id], expectedConfigVersions: { [product.id]: 1, [second.id]: 2 }, config, requestId: 'batch-stale', traceId: 'trace-batch-stale' }), (error: unknown) => (error as { code?: string }).code === 'AUTOMATION_VERSION_CONFLICT');
  assert.equal((await service.get(admin.id, product.id)).configVersion, 1);
  assert.equal((await service.get(admin.id, second.id)).configVersion, 1);
});

test('batch partial config preserves unselected rules per product', async () => {
  const { store, admin, account, product, coupon, service } = await setup();
  const second = await store.createProduct({ adminId: admin.id, accountId: account.id, title: '第二商品', status: 'published' });
  const secondConfig = { ...defaultProductAutomationConfig(), unpaidAutoReprice: { ...defaultProductAutomationConfig().unpaidAutoReprice, enabled: true, targetPriceMinor: 1_290, message: '第二商品专属价格' } } satisfies ProductAutomationConfig;
  await service.update({ adminId: admin.id, productId: second.id, expectedConfigVersion: 1, config: secondConfig, requestId: 'partial-seed', traceId: 'partial-seed' });
  const batch = await service.updateBatch({ adminId: admin.id, productIds: [product.id, second.id], expectedConfigVersions: { [product.id]: 1, [second.id]: 1 }, config: { paidAutoDelivery: { enabled: true, couponBatchIds: [coupon.id] } }, requestId: 'partial-batch', traceId: 'partial-batch' });
  assert.equal(batch.items.length, 2);
  const preserved = await service.get(admin.id, second.id);
  assert.equal(preserved.config.unpaidAutoReprice.enabled, true);
  assert.equal(preserved.config.unpaidAutoReprice.targetPriceMinor, 1_290);
  assert.equal(preserved.config.paidAutoDelivery.enabled, true);
});

class FakePort implements AutomationExecutionPort {
  calls: string[] = [];
  couponSend: AutomationExternalResult = result('succeeded');
  confirm: AutomationExternalResult = result('succeeded');
  reprice: AutomationExternalResult = result('succeeded');
  text: AutomationExternalResult = result('succeeded');
  reviewCreated = true;
  reviewError?: Error;
  sendWaitFor?: Promise<void>;
  sendStarted?: { resolve: () => void };
  readOrderResult: AutomationOrderSnapshot | undefined;
  async reserveCoupon(input: { accountId: string; batchIds: string[]; quantity: number; executionKey: string; purpose: 'delivery' | 'gift' }): Promise<{ reservationId: string; quantity: number }> { this.calls.push(`reserve:${input.purpose}`); return { reservationId: `reservation-${input.executionKey}`, quantity: input.quantity }; }
  async sendCoupon(input: { accountId: string; orderNo: string; reservationId: string; executionKey: string; purpose: 'delivery' | 'gift' }): Promise<AutomationExternalResult> { this.calls.push(`send:${input.purpose}`); this.sendStarted?.resolve(); if (this.sendWaitFor) await this.sendWaitFor; return this.couponSend; }
  async commitCoupon(input: { reservationId: string; executionKey: string }): Promise<void> { this.calls.push('commit'); }
  async releaseCoupon(input: { reservationId: string; executionKey: string; reason: string }): Promise<void> { this.calls.push(`release:${input.reason}`); }
  async confirmShipment(input: { accountId: string; orderNo: string; executionKey: string }): Promise<AutomationExternalResult> { this.calls.push('confirm'); return this.confirm; }
  async repriceOrder(input: { accountId: string; orderNo: string; targetPriceMinor: number; executionKey: string }): Promise<AutomationExternalResult> { this.calls.push(`reprice:${input.targetPriceMinor}`); return this.reprice; }
  async sendText(input: { accountId: string; conversationId: string; text: string; executionKey: string }): Promise<AutomationExternalResult> { this.calls.push(`text:${input.text}`); return this.text; }
  async persistReviewFact(input: { accountId: string; orderNo: string; eventId: string; executionKey: string }): Promise<{ created: boolean }> { this.calls.push('review-fact'); if (this.reviewError) throw this.reviewError; return { created: this.reviewCreated }; }
  async readOrder(input: { accountId: string; orderNo: string }): Promise<AutomationOrderSnapshot | undefined> { this.calls.push('read-order'); return this.readOrderResult; }
  async markManualReview(input: { accountId: string; orderNo: string; executionKey: string; reason: string }): Promise<void> { this.calls.push(`manual:${input.reason}`); }
}

test('payment automation is ordered, idempotent, quantity-aware and never confirms on unknown send', async () => {
  const port = new FakePort();
  const workflow = new AutomationWorkflowService(port);
  const config = defaultProductAutomationConfig();
  config.paidAutoDelivery = { ...config.paidAutoDelivery, enabled: true, couponBatchIds: ['batch-1'], autoConfirm: true };
  const first = await workflow.handlePaymentPaid({ config, order: baseOrder({ quantity: 3 }), eventId: 'paid-1' });
  assert.equal(first.status, 'succeeded');
  assert.deepEqual(port.calls.slice(0, 4), ['reserve:delivery', 'send:delivery', 'commit', 'confirm']);
  const duplicate = await workflow.handlePaymentPaid({ config, order: baseOrder({ quantity: 3 }), eventId: 'paid-1' });
  assert.deepEqual(duplicate, first);
  assert.equal(port.calls.length, 4);

  const unknownPort = new FakePort();
  unknownPort.couponSend = result('unknown', 'TIMEOUT');
  const unknownWorkflow = new AutomationWorkflowService(unknownPort);
  const unknown = await unknownWorkflow.handlePaymentPaid({ config, order: baseOrder(), eventId: 'paid-unknown' });
  assert.equal(unknown.status, 'unknown');
  assert.ok(unknownPort.calls.includes('release:TIMEOUT'));
  assert.ok(!unknownPort.calls.includes('confirm'));

  const confirmationUnknownPort = new FakePort();
  confirmationUnknownPort.confirm = result('unknown', 'CONFIRM_TIMEOUT');
  const confirmationUnknown = await new AutomationWorkflowService(confirmationUnknownPort).handlePaymentPaid({ config, order: baseOrder(), eventId: 'paid-confirm-unknown' });
  assert.equal(confirmationUnknown.status, 'manual_review');
  assert.ok(confirmationUnknownPort.calls.includes('manual:shipment_confirmation_unknown'));
});

test('concurrent duplicate event shares one in-flight execution', async () => {
  const port = new FakePort();
  let release!: () => void;
  const sendWaitFor = new Promise<void>((resolve) => { release = resolve; });
  port.sendWaitFor = sendWaitFor;
  let startedResolve!: () => void;
  const started = new Promise<void>((resolve) => { startedResolve = resolve; });
  port.sendStarted = { resolve: startedResolve };
  const workflow = new AutomationWorkflowService(port);
  const config = defaultProductAutomationConfig();
  config.paidAutoDelivery = { ...config.paidAutoDelivery, enabled: true, couponBatchIds: ['batch-1'] };
  const order = baseOrder();
  const firstPromise = workflow.handlePaymentPaid({ config, order, eventId: 'paid-concurrent' });
  await started;
  const secondPromise = workflow.handlePaymentPaid({ config, order, eventId: 'paid-concurrent' });
  release();
  const [first, second] = await Promise.all([firstPromise, secondPromise]);
  assert.deepEqual(second, first);
  assert.equal(port.calls.filter((call) => call === 'send:delivery').length, 1);
});

test('unpaid reprice does not fabricate success and does not reprice twice', async () => {
  const port = new FakePort();
  const workflow = new AutomationWorkflowService(port);
  const config = defaultProductAutomationConfig();
  config.unpaidAutoReprice = { ...config.unpaidAutoReprice, enabled: true, targetPriceMinor: 1_290, message: '已为你调整价格' };
  const order = baseOrder({ paymentStatus: 'unpaid' });
  const success = await workflow.handleUnpaidReprice({ config, order, eventId: 'unpaid-1' });
  assert.equal(success.status, 'succeeded');
  assert.deepEqual(port.calls, ['reprice:1290', 'text:已为你调整价格']);
  await workflow.handleUnpaidReprice({ config, order, eventId: 'unpaid-1' });
  assert.equal(port.calls.length, 2);
  const unknownPort = new FakePort();
  unknownPort.reprice = result('unknown', 'REMOTE_TIMEOUT');
  const unknown = await new AutomationWorkflowService(unknownPort).handleUnpaidReprice({ config, order, eventId: 'unpaid-2' });
  assert.equal(unknown.status, 'unknown');
  assert.equal(unknownPort.calls.length, 1);
});

test('review gift persists fact first, isolates failure and does not re-enter reminder', async () => {
  const port = new FakePort();
  port.couponSend = result('failed', 'SEND_FAILED');
  const workflow = new AutomationWorkflowService(port);
  const config = defaultProductAutomationConfig();
  config.reviewGift = { ...config.reviewGift, enabled: true, couponBatchIds: ['gift-batch'] };
  const failed = await workflow.handleReviewGift({ config, order: baseOrder(), eventId: 'BUYER_RATE_SELLER-1' });
  assert.equal(failed.status, 'failed');
  assert.deepEqual(port.calls, ['review-fact', 'reserve:gift', 'send:gift', 'release:SEND_FAILED']);
  await workflow.handleReviewGift({ config, order: baseOrder(), eventId: 'BUYER_RATE_SELLER-1' });
  assert.equal(port.calls.length, 4);
  const alreadyRecorded = new FakePort();
  alreadyRecorded.reviewCreated = false;
  const skipped = await new AutomationWorkflowService(alreadyRecorded).handleReviewGift({ config, order: baseOrder(), eventId: 'BUYER_RATE_SELLER-2' });
  assert.equal(skipped.status, 'skipped');
  assert.deepEqual(alreadyRecorded.calls, ['review-fact']);
  const persistenceFailure = new FakePort();
  persistenceFailure.reviewError = new Error('PERSIST_FAILED');
  const failedPersistence = await assert.rejects(() => new AutomationWorkflowService(persistenceFailure).handleReviewGift({ config, order: baseOrder(), eventId: 'BUYER_RATE_SELLER-3' }), /PERSIST_FAILED/);
  assert.equal(failedPersistence, undefined);
  assert.deepEqual(persistenceFailure.calls, ['review-fact']);
});

test('review reminder re-checks order state before sending and caps repeat count', async () => {
  const port = new FakePort();
  port.readOrderResult = baseOrder({ deliveryStatus: 'delivered', reviewedAt: '2026-09-22T00:00:00.000Z' });
  const workflow = new AutomationWorkflowService(port);
  const config = defaultProductAutomationConfig();
  config.reviewReminder = { ...config.reviewReminder, enabled: true, firstDelayHours: 1, maxReminders: 1 };
  const result = await workflow.handleReviewReminder({ config, order: baseOrder({ createdAt: '2026-09-20T00:00:00.000Z', deliveryStatus: 'delivered' }), now: '2026-09-22T00:00:00.000Z' });
  assert.equal(result.status, 'skipped');
  assert.deepEqual(port.calls, ['read-order']);
  const capped = await new AutomationWorkflowService(new FakePort()).handleReviewReminder({ config, order: baseOrder({ deliveryStatus: 'delivered', reminderCount: 1 }), now: '2026-09-22T00:00:00.000Z' });
  assert.equal(capped.status, 'skipped');
});
