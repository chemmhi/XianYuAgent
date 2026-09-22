import assert from 'node:assert/strict';
import test from 'node:test';
import { LifecycleEngine, LifecyclePolicyError, type LifecyclePolicy } from '../src/auto-reply-lifecycle.js';

const policy: LifecyclePolicy = {
  policyVersion: 'lifecycle-v1',
  fallback: { stage: 'discovery', targetStage: 'evaluation', nextAction: 'ANSWER_FACT', successCriteria: ['识别商品与需求'] },
  ambiguity: { nextAction: 'CLARIFY', successCriteria: ['确认买家对应订单'] },
  reviewGate: { allowedStages: ['delivered_pending_review'], nextAction: 'GUIDE_NEXT_STEP' },
  rules: [
    { ruleId: 'stage-after-sales', priority: 100, specificity: 4, conditions: [{ path: 'afterSalesStatus', operator: 'in', value: ['requested', 'refunding', 'refunded', 'rejected'] }], stage: 'after_sales', targetStage: 'after_sales', nextAction: 'ACKNOWLEDGE_CONTINUE', successCriteria: ['确认售后诉求并给出下一步'], evidenceKeys: ['afterSalesStatus'] },
    { ruleId: 'stage-delivered-review', priority: 90, specificity: 3, conditions: [{ path: 'deliveryStatus', operator: 'equals', value: 'delivered' }, { path: 'buyerConfirmedReceived', operator: 'equals', value: true }], stage: 'delivered_pending_review', targetStage: 'completed', nextAction: 'GUIDE_NEXT_STEP', successCriteria: ['引导确认收货与评价'], evidenceKeys: ['deliveryStatus', 'buyerConfirmedReceived'] },
    { ruleId: 'stage-paid-shipment', priority: 80, specificity: 2, conditions: [{ path: 'paymentStatus', operator: 'equals', value: 'paid' }, { path: 'deliveryStatus', operator: 'equals', value: 'pending' }], stage: 'paid_pending_shipment', targetStage: 'shipped_pending_delivery', nextAction: 'GUIDE_NEXT_STEP', successCriteria: ['引导等待发货'], evidenceKeys: ['paymentStatus', 'deliveryStatus'] },
    { ruleId: 'stage-unpaid', priority: 70, specificity: 2, conditions: [{ path: 'orderStatus', operator: 'equals', value: 'open' }, { path: 'paymentStatus', operator: 'equals', value: 'unpaid' }], stage: 'unpaid_order', targetStage: 'paid_pending_shipment', nextAction: 'GUIDE_NEXT_STEP', successCriteria: ['引导买家完成付款'], evidenceKeys: ['orderStatus', 'paymentStatus'] },
  ],
};

test('projects observed stage from verified order facts and keeps next action data-driven', () => {
  const result = new LifecycleEngine().evaluate({
    accountId: 'account-1',
    conversationId: 'conversation-1',
    facts: [{ orderRef: 'order-1', accountId: 'account-1', paymentStatus: 'unpaid', orderStatus: 'open', deliveryStatus: 'pending', sourceEventId: 'event-1' }],
    policy,
    previous: { observedStage: 'discovery' },
  });
  assert.equal(result.observedStage, 'unpaid_order');
  assert.equal(result.targetStage, 'paid_pending_shipment');
  assert.equal(result.nextAction, 'GUIDE_NEXT_STEP');
  assert.equal(result.stageChanged, true);
  assert.ok(result.evidenceRefs.includes('order:order-1')); 
  assert.ok(result.evidenceRefs.includes('event:event-1'));
});

test('after-sales rule outranks ordinary delivery rules', () => {
  const result = new LifecycleEngine().evaluate({
    accountId: 'account-1',
    conversationId: 'conversation-1',
    facts: [{ orderRef: 'order-1', accountId: 'account-1', paymentStatus: 'paid', deliveryStatus: 'delivered', buyerConfirmedReceived: true, afterSalesStatus: 'requested' }],
    policy,
  });
  assert.equal(result.observedStage, 'after_sales');
  assert.equal(result.nextAction, 'ACKNOWLEDGE_CONTINUE');
});

test('multiple matching orders require clarification instead of guessing', () => {
  const result = new LifecycleEngine().evaluate({
    accountId: 'account-1',
    conversationId: 'conversation-1',
    facts: [
      { orderRef: 'order-a', accountId: 'account-1', paymentStatus: 'unpaid', orderStatus: 'open' },
      { orderRef: 'order-b', accountId: 'account-1', paymentStatus: 'paid', deliveryStatus: 'pending' },
    ],
    policy,
  });
  assert.equal(result.ambiguous, true);
  assert.equal(result.nextAction, 'CLARIFY');
  assert.deepEqual(result.evidenceRefs, ['order:order-a', 'order:order-b']);
});

test('selected order resolves ambiguity and cross-account facts fail closed', () => {
  const engine = new LifecycleEngine();
  const selected = engine.evaluate({
    accountId: 'account-1',
    conversationId: 'conversation-1',
    selectedOrderRef: 'order-b',
    facts: [
      { orderRef: 'order-a', accountId: 'account-1', paymentStatus: 'unpaid', orderStatus: 'open' },
      { orderRef: 'order-b', accountId: 'account-1', paymentStatus: 'paid', deliveryStatus: 'pending' },
    ],
    policy,
  });
  assert.equal(selected.orderRef, 'order-b');
  assert.equal(selected.observedStage, 'paid_pending_shipment');
  assert.throws(() => engine.evaluate({ accountId: 'account-1', conversationId: 'conversation-1', facts: [{ orderRef: 'foreign', accountId: 'account-2' }], policy }), (error: unknown) => error instanceof LifecyclePolicyError && error.code === 'LIFECYCLE_FACT_SCOPE_MISMATCH');
});

test('missing policy is rejected instead of using a hard-coded route', () => {
  assert.throws(() => new LifecycleEngine().evaluate({ accountId: 'account-1', conversationId: 'conversation-1', facts: [], policy: undefined }), (error: unknown) => error instanceof LifecyclePolicyError && error.code === 'LIFECYCLE_POLICY_UNAVAILABLE');
});
