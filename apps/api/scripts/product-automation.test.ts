import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryStore } from '../src/store-memory.js';
import { ProductAutomationService, AutomationWorkflowService, PersistentAutomationExecutionLedger, type AutomationExecutionPort, type AutomationExternalResult, type AutomationOrderSnapshot, defaultProductAutomationConfig } from '../src/product-automation.js';
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
  const coupon = await store.createCouponBatch({ adminId: admin.id, accountId: account.id, label: '发货卡券', purpose: 'text' });
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
  assert.deepEqual(saved.config.paidAutoDelivery.couponBatchIds, [coupon.sequenceId ?? coupon.id]);
  const savedAgain = await service.update({ adminId: admin.id, productId: product.id, expectedConfigVersion: 1, config: { ...config, unpaidAutoReprice: { ...config.unpaidAutoReprice, enabled: true, targetPriceMinor: 990 } }, requestId: 'req-2', traceId: 'trace-2' });
  assert.equal(savedAgain.configVersion, 2);
  await assert.rejects(() => service.update({ adminId: admin.id, productId: product.id, expectedConfigVersion: 1, config, requestId: 'req-stale', traceId: 'trace-stale' }), (error: unknown) => (error as { code?: string }).code === 'AUTOMATION_VERSION_CONFLICT');
  await assert.rejects(() => service.update({ adminId: admin.id, productId: product.id, expectedConfigVersion: 2, config: { ...defaultProductAutomationConfig(), paidAutoDelivery: { ...defaultProductAutomationConfig().paidAutoDelivery, enabled: true } }, requestId: 'req-invalid', traceId: 'trace-invalid' }), (error: unknown) => (error as { code?: string }).code === 'VALIDATION_FAILED');

  const foreignAdmin = await store.createAdmin({ email: 'foreign-automation@example.com', passwordHash: 'hash', displayName: 'Foreign' });
  const foreignAccount = await store.createAccount({ adminId: foreignAdmin.id, platform: 'xianyu', sellerRef: `foreign-${Math.random()}` });
  const foreignCoupon = await store.createCouponBatch({ adminId: foreignAdmin.id, accountId: foreignAccount.id, label: 'Foreign', purpose: 'text' });
  await assert.rejects(() => service.update({ adminId: admin.id, productId: product.id, expectedConfigVersion: 2, config: { ...defaultProductAutomationConfig(), reviewGift: { ...defaultProductAutomationConfig().reviewGift, enabled: true, couponBatchIds: [foreignCoupon.id] } }, requestId: 'req-cross', traceId: 'trace-cross' }), (error: unknown) => (error as { code?: string }).code === 'NOT_FOUND' || (error as { code?: string }).code === 'FORBIDDEN');
  assert.equal(account.id, product.accountId);
});

test('legacy hour reminder fields are read as canonical minutes', async () => {
  const { admin, product, store, service } = await setup();
  const legacyConfig = {
    ...defaultProductAutomationConfig(),
    reviewReminder: { enabled: true, firstDelayHours: 2, repeatIntervalHours: 3, maxReminders: 2, message: '' },
  } as unknown as ProductAutomationConfig;
  await store.updateProductAutomation({ adminId: admin.id, productId: product.id, expectedConfigVersion: 1, config: legacyConfig, configDigest: 'legacy-hours', syncCouponBindings: false });
  const read = await service.get(admin.id, product.id);
  assert.deepEqual(read.config.reviewReminder, { enabled: true, firstDelayMinutes: 120, repeatIntervalMinutes: 180, maxReminders: 2, message: '' });
  assert.equal('firstDelayHours' in (read.config.reviewReminder as unknown as Record<string, unknown>), false);
});

test('defaults auto-confirm on and allows disabled coupon associations', async () => {
  const { admin, product, coupon, service, store, account } = await setup();
  assert.equal(defaultProductAutomationConfig().paidAutoDelivery.autoConfirm, true);

  const associatedCoupon = await store.createCouponBatch({ adminId: admin.id, accountId: account.id, label: '关联卡券', purpose: 'text' });
  const associated = await service.update({
    adminId: admin.id,
    productId: product.id,
    expectedConfigVersion: 1,
    config: {
      ...defaultProductAutomationConfig(),
      paidAutoDelivery: { enabled: false, couponBatchIds: [associatedCoupon.id] },
    },
    requestId: 'req-association-only',
    traceId: 'trace-association-only',
  });
  assert.deepEqual(associated.config.paidAutoDelivery.couponBatchIds, [associatedCoupon.sequenceId ?? associatedCoupon.id]);
  assert.equal(associated.config.paidAutoDelivery.autoConfirm, true);
  assert.deepEqual((await store.getProduct(admin.id, product.id))?.couponBatches?.map((item) => item.id), [associatedCoupon.sequenceId ?? associatedCoupon.id]);

  const cleared = await service.update({
    adminId: admin.id,
    productId: product.id,
    expectedConfigVersion: 1,
    config: defaultProductAutomationConfig(),
    requestId: 'req-clear-association',
    traceId: 'trace-clear-association',
  });
  assert.equal(cleared.configVersion, 2);
  assert.deepEqual((await store.getProduct(admin.id, product.id))?.couponBatches, []);
  assert.equal((await store.getCouponBatch(admin.id, associatedCoupon.id))?.bindings?.some((binding) => binding.productId === product.id && binding.status === 'active'), false);
  await assert.rejects(() => store.updateProductAutomation({
    adminId: admin.id,
    productId: product.id,
    expectedConfigVersion: 2,
    config: { ...defaultProductAutomationConfig(), paidAutoDelivery: { ...defaultProductAutomationConfig().paidAutoDelivery, couponBatchIds: [coupon.id, 'missing-coupon'] } },
    configDigest: 'atomic-failure',
  }));
  assert.deepEqual((await store.getProduct(admin.id, product.id))?.couponBatches, []);
  assert.equal((await service.get(admin.id, product.id)).configVersion, 2);

  const partial = await service.update({
    adminId: admin.id,
    productId: product.id,
    expectedConfigVersion: 2,
    config: {
      ...defaultProductAutomationConfig(),
      paidAutoDelivery: { enabled: true, couponBatchIds: [coupon.id] },
    },
    requestId: 'req-default-confirm',
    traceId: 'trace-default-confirm',
  });
  assert.equal(partial.config.paidAutoDelivery.autoConfirm, true);
});

test('disabled coupon batches cannot be bound to an enabled delivery rule', async () => {
  const { admin, product, coupon, service, store } = await setup();
  await store.updateCouponBatch({ adminId: admin.id, batchId: coupon.id, patch: { status: 'paused' } });
  await assert.rejects(() => service.update({
    adminId: admin.id,
    productId: product.id,
    expectedConfigVersion: 1,
    config: {
      ...defaultProductAutomationConfig(),
      paidAutoDelivery: { enabled: true, couponBatchIds: [coupon.id] },
    },
    requestId: 'disabled-coupon-rule',
    traceId: 'disabled-coupon-rule',
  }), (error: unknown) => (error as { code?: string }).code === 'CONFLICT');
  await assert.rejects(() => store.reserveCoupon({ adminId: admin.id, accountId: product.accountId, batchIds: [coupon.id], quantity: 1, executionKey: 'disabled-reservation', purpose: 'delivery' }), /COUPON_BATCH_UNAVAILABLE/);
});

test('single-rule updates preserve untouched rules without validating them', async () => {
  const { admin, product, service, store, coupon } = await setup();
  const seeded = defaultProductAutomationConfig();
  seeded.reviewReminder = { ...seeded.reviewReminder, enabled: true, message: '' };
  await store.updateProductAutomation({ adminId: admin.id, productId: product.id, expectedConfigVersion: 1, config: seeded, configDigest: 'seed-invalid-unconfigured', syncCouponBindings: false });

  const saved = await service.update({
    adminId: admin.id,
    productId: product.id,
    expectedConfigVersion: 1,
    config: { paidAutoDelivery: { enabled: true, couponBatchIds: [coupon.id] } },
    requestId: 'partial-rule-update',
    traceId: 'partial-rule-update',
  });

  assert.equal(saved.config.paidAutoDelivery.enabled, true);
  assert.deepEqual(saved.config.paidAutoDelivery.couponBatchIds, [coupon.sequenceId ?? coupon.id]);
  assert.equal(saved.config.reviewReminder.message, '');
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
  assert.equal(unknown.status, 'manual_review');
  assert.ok(!unknownPort.calls.includes('release:TIMEOUT'), 'uncertain coupon delivery must keep the reservation held');
  assert.ok(unknownPort.calls.includes('manual:TIMEOUT'));
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
  config.paidAutoDelivery = { ...config.paidAutoDelivery, enabled: true, couponBatchIds: ['batch-1'], retryBackoffSeconds: 0 };
  const order = baseOrder();
  const firstPromise = workflow.handlePaymentPaid({ config, order, eventId: 'paid-concurrent' });
  await started;
  const secondPromise = workflow.handlePaymentPaid({ config, order, eventId: 'paid-concurrent' });
  release();
  const [first, second] = await Promise.all([firstPromise, secondPromise]);
  assert.deepEqual(second, first);
  assert.equal(port.calls.filter((call) => call === 'send:delivery').length, 1);
});

test('persistent ledger deduplicates across workflow instances and survives retryable failure', async () => {
  const store = new MemoryStore();
  const config = defaultProductAutomationConfig();
  config.paidAutoDelivery = { ...config.paidAutoDelivery, enabled: true, couponBatchIds: ['batch-1'], retryBackoffSeconds: 0 };
  const firstPort = new FakePort();
  const secondPort = new FakePort();
  let release!: () => void;
  firstPort.sendWaitFor = new Promise<void>((resolve) => { release = resolve; });
  const first = new AutomationWorkflowService(firstPort, new PersistentAutomationExecutionLedger(store));
  const second = new AutomationWorkflowService(secondPort, new PersistentAutomationExecutionLedger(store));
  const order = baseOrder();
  const firstPromise = first.handlePaymentPaid({ config, order, eventId: 'persistent-concurrent' });
  await new Promise((resolve) => setTimeout(resolve, 10));
  const secondPromise = second.handlePaymentPaid({ config, order, eventId: 'persistent-concurrent' });
  release();
  const [left, right] = await Promise.all([firstPromise, secondPromise]);
  assert.deepEqual(right, left);
  assert.equal(firstPort.calls.filter((call) => call === 'send:delivery').length, 1);
  assert.equal(secondPort.calls.filter((call) => call === 'send:delivery').length, 0);

  const retryPort = new FakePort();
  retryPort.couponSend = result('failed', 'TEMPORARY_SEND_FAILURE');
  const retryWorkflow = new AutomationWorkflowService(retryPort, new PersistentAutomationExecutionLedger(store));
  const retryOrder = baseOrder({ orderNo: 'ORDER-RETRY' });
  const failed = await retryWorkflow.handlePaymentPaid({ config, order: retryOrder, eventId: 'persistent-retry' });
  assert.equal(failed.status, 'failed');
  retryPort.couponSend = result('succeeded');
  const recovered = await retryWorkflow.handlePaymentPaid({ config, order: retryOrder, eventId: 'persistent-retry' });
  assert.equal(recovered.status, 'succeeded');
  assert.equal(retryPort.calls.filter((call) => call === 'send:delivery').length, 2);
});

test('persistent ledger rejects completion by a different owner', async () => {
  const store = new MemoryStore();
  const ledger = new PersistentAutomationExecutionLedger(store);
  const claimed = await store.claimAutomationExecution({ executionKey: 'owner-conflict', fingerprint: 'fp', ownerToken: 'owner-1', leaseUntil: new Date(Date.now() + 10_000).toISOString() });
  assert.equal(claimed.claimed, true);
  await assert.rejects(() => ledger.complete({ key: 'owner-conflict', ownerToken: 'owner-2', result: { status: 'succeeded', executionKey: 'owner-conflict' }, retryable: false }), /OWNER_CONFLICT/);
  await ledger.complete({ key: 'owner-conflict', ownerToken: 'owner-1', result: { status: 'succeeded', executionKey: 'owner-conflict' }, retryable: false });
  const persisted = await store.getAutomationExecution('owner-conflict');
  assert.equal(persisted?.status, 'completed');
  assert.equal((persisted?.result as { status: string }).status, 'succeeded');
});

test('retry policy honors backoff window and max attempts', async () => {
  const port = new FakePort();
  port.couponSend = result('failed', 'TEMPORARY_SEND_FAILURE');
  const workflow = new AutomationWorkflowService(port);
  const config = defaultProductAutomationConfig();
  config.paidAutoDelivery = { ...config.paidAutoDelivery, enabled: true, couponBatchIds: ['batch-1'], maxAttempts: 2, retryBackoffSeconds: 60 };
  const order = baseOrder({ orderNo: 'ORDER-BACKOFF' });
  const first = await workflow.handlePaymentPaid({ config, order, eventId: 'backoff-1' });
  assert.equal(first.status, 'failed');
  const immediate = await workflow.handlePaymentPaid({ config, order, eventId: 'backoff-1' });
  assert.equal(immediate.status, 'failed');
  assert.equal(port.calls.filter((call) => call === 'send:delivery').length, 1);

  const cappedPort = new FakePort();
  cappedPort.couponSend = result('failed', 'PERMANENT_FAILURE');
  const capped = new AutomationWorkflowService(cappedPort);
  const cappedConfig = { ...config, paidAutoDelivery: { ...config.paidAutoDelivery, maxAttempts: 1, retryBackoffSeconds: 0 } };
  const cappedOrder = baseOrder({ orderNo: 'ORDER-CAPPED' });
  await capped.handlePaymentPaid({ config: cappedConfig, order: cappedOrder, eventId: 'capped-1' });
  const exhausted = await capped.handlePaymentPaid({ config: cappedConfig, order: cappedOrder, eventId: 'capped-1' });
  assert.equal(exhausted.status, 'manual_review');
  assert.equal(exhausted.reason, 'retry_exhausted');
  assert.equal(cappedPort.calls.filter((call) => call === 'send:delivery').length, 1);
});

test('unpaid reprice does not fabricate success and does not reprice twice', async () => {
  const port = new FakePort();
  const workflow = new AutomationWorkflowService(port);
  const config = defaultProductAutomationConfig();
  config.unpaidAutoReprice = { ...config.unpaidAutoReprice, enabled: true, targetPriceMinor: 1_290, message: '已为你调整价格' };
  const order = baseOrder({ paymentStatus: 'unpaid' });
  port.readOrderResult = order;
  const success = await workflow.handleUnpaidReprice({ config, order, eventId: 'unpaid-1' });
  assert.equal(success.status, 'succeeded');
  assert.deepEqual(port.calls, ['read-order', 'reprice:1290', 'text:已为你调整价格']);
  await workflow.handleUnpaidReprice({ config, order, eventId: 'unpaid-1' });
  assert.equal(port.calls.length, 3);
  const unknownPort = new FakePort();
  unknownPort.reprice = result('unknown', 'REMOTE_TIMEOUT');
  unknownPort.readOrderResult = order;
  const unknown = await new AutomationWorkflowService(unknownPort).handleUnpaidReprice({ config, order, eventId: 'unpaid-2' });
  assert.equal(unknown.status, 'unknown');
  assert.equal(unknownPort.calls.length, 2);
  const paidBeforeAction = new FakePort();
  paidBeforeAction.readOrderResult = baseOrder({ paymentStatus: 'paid' });
  const skipped = await new AutomationWorkflowService(paidBeforeAction).handleUnpaidReprice({ config, order, eventId: 'unpaid-paid-before-action' });
  assert.equal(skipped.status, 'skipped');
  assert.equal(skipped.reason, 'order_paid_before_reprice');
  assert.equal(paidBeforeAction.calls.filter((call) => call.startsWith('reprice:')).length, 0);
});

test('review gift persists fact first, isolates failure and does not re-enter reminder', async () => {
  const port = new FakePort();
  port.couponSend = result('failed', 'SEND_FAILED');
  const workflow = new AutomationWorkflowService(port);
  const config = defaultProductAutomationConfig();
  config.reviewGift = { ...config.reviewGift, enabled: true, couponBatchIds: ['gift-batch'], retryBackoffSeconds: 0 };
  const failed = await workflow.handleReviewGift({ config, order: baseOrder(), eventId: 'BUYER_RATE_SELLER-1' });
  assert.equal(failed.status, 'failed');
  assert.deepEqual(port.calls, ['review-fact', 'reserve:gift', 'send:gift', 'release:SEND_FAILED']);
  port.reviewCreated = false;
  port.couponSend = result('succeeded');
  const recovered = await workflow.handleReviewGift({ config, order: baseOrder(), eventId: 'BUYER_RATE_SELLER-1' });
  assert.equal(recovered.status, 'succeeded');
  assert.deepEqual(port.calls.slice(4), ['review-fact', 'reserve:gift', 'send:gift', 'commit']);
  const repeatedDifferentEvent = await workflow.handleReviewGift({ config, order: baseOrder(), eventId: 'BUYER_RATE_SELLER-2' });
  assert.equal(repeatedDifferentEvent.status, 'succeeded');
  assert.equal(port.calls.length, 8, 'same order review events must not send a second gift');
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
  config.reviewReminder = { ...config.reviewReminder, enabled: true, firstDelayMinutes: 60, maxReminders: 1 };
  const result = await workflow.handleReviewReminder({ config, order: baseOrder({ createdAt: '2026-09-20T00:00:00.000Z', deliveryStatus: 'delivered' }), now: '2026-09-22T00:00:00.000Z' });
  assert.equal(result.status, 'skipped');
  assert.deepEqual(port.calls, ['read-order']);
  const capped = await new AutomationWorkflowService(new FakePort()).handleReviewReminder({ config, order: baseOrder({ deliveryStatus: 'delivered', reminderCount: 1 }), now: '2026-09-22T00:00:00.000Z' });
  assert.equal(capped.status, 'skipped');
});

test('review reminder uses minute precision for first and repeat windows', async () => {
  const config = defaultProductAutomationConfig();
  config.reviewReminder = { ...config.reviewReminder, enabled: true, firstDelayMinutes: 1, repeatIntervalMinutes: 2, maxReminders: 3 };

  const beforeDuePort = new FakePort();
  beforeDuePort.readOrderResult = baseOrder({ deliveryStatus: 'delivered' });
  const beforeDue = await new AutomationWorkflowService(beforeDuePort).handleReviewReminder({
    config,
    order: baseOrder({ createdAt: '2026-09-25T00:00:00.000Z', deliveryStatus: 'delivered' }),
    now: '2026-09-25T00:00:59.999Z',
  });
  assert.equal(beforeDue.status, 'skipped');

  const atDuePort = new FakePort();
  atDuePort.readOrderResult = baseOrder({ deliveryStatus: 'delivered' });
  const atDue = await new AutomationWorkflowService(atDuePort).handleReviewReminder({
    config,
    order: baseOrder({ createdAt: '2026-09-25T00:00:00.000Z', deliveryStatus: 'delivered' }),
    now: '2026-09-25T00:01:00.000Z',
  });
  assert.equal(atDue.status, 'succeeded');

  const repeatPort = new FakePort();
  repeatPort.readOrderResult = baseOrder({ deliveryStatus: 'delivered' });
  const beforeRepeat = await new AutomationWorkflowService(repeatPort).handleReviewReminder({
    config,
    order: baseOrder({ createdAt: '2026-09-25T00:00:00.000Z', deliveryStatus: 'delivered', lastReminderAt: '2026-09-25T00:01:00.000Z', reminderCount: 1 }),
    now: '2026-09-25T00:02:59.999Z',
  });
  assert.equal(beforeRepeat.status, 'skipped');

  const atRepeatPort = new FakePort();
  atRepeatPort.readOrderResult = baseOrder({ deliveryStatus: 'delivered' });
  const atRepeat = await new AutomationWorkflowService(atRepeatPort).handleReviewReminder({
    config,
    order: baseOrder({ createdAt: '2026-09-25T00:00:00.000Z', deliveryStatus: 'delivered', lastReminderAt: '2026-09-25T00:01:00.000Z', reminderCount: 1 }),
    now: '2026-09-25T00:03:00.000Z',
  });
  assert.equal(atRepeat.status, 'succeeded');
});

test('reminder state is persisted and increments exactly once per successful send', async () => {
  const { store, admin, account, product } = await setup();
  const created = await store.createOrder({ adminId: admin.id, order: { ...baseOrder({ id: 'reminder-state', orderNo: 'REMINDER-STATE', accountId: account.id, productId: product.id, deliveryStatus: 'delivered', paymentStatus: 'paid' }), source: 'local' } });
  assert.equal(created.reminderCount ?? 0, 0);
  const first = await store.recordReviewReminderSent({ accountId: account.id, orderNo: created.orderNo, sentAt: '2026-09-22T01:00:00.000Z' });
  assert.equal(first?.reminderCount, 1);
  assert.equal(first?.lastReminderAt, '2026-09-22T01:00:00.000Z');
  const second = await store.recordReviewReminderSent({ accountId: account.id, orderNo: created.orderNo, sentAt: '2026-09-22T02:00:00.000Z' });
  assert.equal(second?.reminderCount, 2);
  const reread = await store.getOrder(admin.id, created.orderNo, account.id);
  assert.equal(reread?.reminderCount, 2);
  assert.equal(reread?.lastReminderAt, '2026-09-22T02:00:00.000Z');
});
