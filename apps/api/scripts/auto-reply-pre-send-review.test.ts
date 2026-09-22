import assert from 'node:assert/strict';
import test from 'node:test';
import { PreSendReviewEngine, PreSendReviewError, type PreSendReviewInput, type PreSendReviewPolicyInput } from '../src/auto-reply-pre-send-review.js';
import type { ActionPlan } from '../src/domain.js';

const policy: PreSendReviewPolicyInput = {
  policyVersion: 'ar-vs03-test-v1',
  preSend: {
    maxRevisionAttempts: 1,
    maxFactAgeSeconds: 900,
    allowedActionKinds: ['ANSWER_FACT', 'GUIDE_NEXT_STEP', 'CLARIFY', 'ACKNOWLEDGE_CONTINUE', 'REFUSE_SENSITIVE', 'HANDOFF'],
    fallbackActionAllowlist: ['CLARIFY', 'ACKNOWLEDGE_CONTINUE', 'REFUSE_SENSITIVE'],
    missingFactsAction: 'CLARIFY',
    validationFailureAction: 'ACKNOWLEDGE_CONTINUE',
    sensitiveFailureAction: 'REFUSE_SENSITIVE',
    allowedHandoffReasonCodes: ['USER_REQUESTED_HUMAN', 'VERIFIED_FACT_UNAVAILABLE'],
  },
};

function plan(overrides: Partial<ActionPlan> = {}): ActionPlan {
  return {
    actionPlanId: 'plan-1',
    primaryAction: 'ANSWER_FACT',
    primaryGoal: {
      objectiveId: 'goal-1',
      accountId: 'account-1',
      conversationId: 'conversation-1',
      goalType: 'product_information',
      status: 'active',
      successCriteria: ['回答当前事实问题'],
      createdAt: '2026-09-22T00:00:00.000Z',
      updatedAt: '2026-09-22T00:00:00.000Z',
    },
    requiredFacts: ['price'],
    successCriteria: ['回答当前事实问题'],
    allowedTools: [],
    questionBudget: { maxQuestionsPerTurn: 1, maxRounds: 2 },
    recommendationAllowed: false,
    handoffAllowed: false,
    nextState: { goalStatus: 'active' },
    safetyHandling: 'NONE',
    policyDecisionId: 'decision-1',
    policyVersion: 'ar-vs03-test-v1',
    reasonCodes: ['FACT_ANSWER'],
    evidenceRefs: ['fact-price-1'],
    ...overrides,
  };
}

function input(overrides: Partial<PreSendReviewInput> = {}): PreSendReviewInput {
  return {
    runId: 'run-1',
    goalId: 'goal-1',
    stateId: 'state-1',
    actionPlan: plan(),
    scope: { accountId: 'account-1', conversationId: 'conversation-1', productId: 'product-1' },
    policy,
    verifiedFacts: [{ factRef: 'fact-price-1', key: 'price', accountId: 'account-1', conversationId: 'conversation-1', productId: 'product-1', verifiedAt: '2026-09-22T00:55:00.000Z' }],
    factRefs: ['fact-price-1'],
    draftClaims: [{ claimId: 'claim-1', claimType: 'FACTUAL', factRefs: ['fact-price-1'] }],
    goalCoverage: { requiredCriteria: ['回答当前事实问题'], satisfiedCriteria: ['回答当前事实问题'], missingCriteria: [] },
    outboundSensitive: { status: 'clean' },
    idempotencyKey: 'presend-run-1-attempt-0',
    now: new Date('2026-09-22T01:00:00.000Z'),
    ...overrides,
  };
}

test('approves a clean fact-backed plan and emits a redacted review record', () => {
  const engine = new PreSendReviewEngine(() => 'review-1');
  const result = engine.review(input());
  assert.equal(result.decision, 'APPROVE');
  assert.equal(result.revisionRequired, false);
  assert.equal(result.record.reviewType, 'PRE_SEND');
  assert.equal(result.record.reviewerSource, 'POLICY_PRE_SEND');
  assert.equal(result.record.event.type, 'review.completed');
  assert.deepEqual(result.record.factRefs, ['fact-price-1']);
});

test('missing facts trigger one revision and then clarify without handoff', () => {
  const engine = new PreSendReviewEngine(() => 'review-2');
  const missing = input({ factRefs: [], verifiedFacts: [], draftClaims: [{ claimId: 'claim-1', claimType: 'FACTUAL', factRefs: [] }] });
  const first = engine.review(missing);
  assert.equal(first.decision, 'REVISE');
  assert.equal(first.revisionRequired, true);
  const second = engine.review({ ...missing, revisionAttempt: 1, idempotencyKey: 'presend-run-1-attempt-1' });
  assert.equal(second.decision, 'CLARIFY');
  assert.equal(second.nextAction, 'CLARIFY');
  assert.notEqual(second.nextAction, 'HANDOFF');
});

test('stale and cross-account facts are rejected before sending', () => {
  const engine = new PreSendReviewEngine(() => 'review-3');
  const result = engine.review(input({
    verifiedFacts: [{ factRef: 'fact-price-1', key: 'price', accountId: 'account-2', conversationId: 'conversation-1', productId: 'product-1', verifiedAt: '2026-09-21T00:00:00.000Z' }],
  }));
  assert.equal(result.decision, 'REVISE');
  assert.ok(result.reasonCodes.includes('FACT_SCOPE_MISMATCH'));
  assert.ok(result.reasonCodes.includes('FACT_STALE'));
});

test('goal coverage and undeclared evidence cannot be hidden by the draft', () => {
  const engine = new PreSendReviewEngine(() => 'review-4');
  const result = engine.review(input({
    actionPlan: plan({ evidenceRefs: ['other-fact'] }),
    factRefs: ['fact-price-1'],
    goalCoverage: { requiredCriteria: ['回答当前事实问题', '说明库存'], satisfiedCriteria: ['回答当前事实问题'], missingCriteria: ['说明库存'] },
  }));
  assert.equal(result.decision, 'REVISE');
  assert.ok(result.reasonCodes.includes('GOAL_COVERAGE_MISSING'));
  assert.ok(result.reasonCodes.includes('FACT_REF_UNDECLARED'));
});

test('extra action-plan evidence refs are rejected unless explicitly bound to verified facts', () => {
  const engine = new PreSendReviewEngine(() => 'review-4-extra');
  const result = engine.review(input({
    actionPlan: plan({ evidenceRefs: ['fact-price-1', 'fact-not-bound'] }),
  }));
  assert.equal(result.decision, 'REVISE');
  assert.ok(result.reasonCodes.includes('FACT_REF_UNDECLARED'));
});

test('objective identity must match the goal being reviewed', () => {
  const engine = new PreSendReviewEngine();
  assert.throws(() => engine.review(input({ actionPlan: plan({ primaryGoal: { ...plan().primaryGoal, objectiveId: 'other-goal' } }) })), (error: unknown) => error instanceof PreSendReviewError && error.code === 'PRESEND_INPUT_INVALID');
});

test('invalid or future fact timestamps fail freshness validation', () => {
  const engine = new PreSendReviewEngine(() => 'review-4-time');
  const invalid = engine.review(input({
    verifiedFacts: [{ factRef: 'fact-price-1', key: 'price', accountId: 'account-1', conversationId: 'conversation-1', productId: 'product-1', verifiedAt: 'not-a-date' }],
  }));
  assert.ok(invalid.reasonCodes.includes('FACT_STALE'));
  const future = engine.review(input({
    verifiedFacts: [{ factRef: 'fact-price-1', key: 'price', accountId: 'account-1', conversationId: 'conversation-1', productId: 'product-1', verifiedAt: '2026-09-22T01:00:01.000Z' }],
  }));
  assert.ok(future.reasonCodes.includes('FACT_STALE'));
});

test('sensitive outbound uncertainty fails closed after the revision budget', () => {
  const engine = new PreSendReviewEngine(() => 'review-5');
  const result = engine.review(input({
    revisionAttempt: 1,
    idempotencyKey: 'presend-run-1-attempt-1-sensitive',
    outboundSensitive: { status: 'unknown', sensitiveClass: 'EQUIVALENT_SECRET' },
  }));
  assert.equal(result.decision, 'BLOCK_SENSITIVE');
  assert.equal(result.nextAction, 'REFUSE_SENSITIVE');
  assert.ok(result.reasonCodes.includes('OUTBOUND_SENSITIVE_UNKNOWN'));
});

test('handoff requires a policy-allowed reason and structured evidence', () => {
  const engine = new PreSendReviewEngine(() => 'review-6');
  const result = engine.review(input({
    actionPlan: plan({ primaryAction: 'HANDOFF', handoffAllowed: true, requiredFacts: [], evidenceRefs: [] }),
    factRefs: [],
    verifiedFacts: [],
    draftClaims: [{ claimId: 'claim-1', claimType: 'NON_FACTUAL', factRefs: [] }],
    handoffReasonCode: 'LOW_CONFIDENCE',
    handoffEvidenceRefs: [],
  }));
  assert.equal(result.decision, 'REVISE');
  assert.ok(result.reasonCodes.includes('HANDOFF_REASON_NOT_ALLOWED'));
  assert.ok(result.reasonCodes.includes('HANDOFF_EVIDENCE_MISSING'));
});

test('handoff cannot bypass an action plan that disallows handoff', () => {
  const engine = new PreSendReviewEngine(() => 'review-6-invalid');
  const result = engine.review(input({
    actionPlan: plan({ primaryAction: 'HANDOFF', handoffAllowed: false, requiredFacts: [], evidenceRefs: [] }),
    factRefs: [],
    verifiedFacts: [],
    draftClaims: [{ claimId: 'claim-1', claimType: 'NON_FACTUAL', factRefs: [] }],
    handoffReasonCode: 'USER_REQUESTED_HUMAN',
    handoffEvidenceRefs: ['buyer-request-1'],
  }));
  assert.equal(result.decision, 'REVISE');
  assert.ok(result.reasonCodes.includes('ACTION_PLAN_INVALID'));
});

test('missing pre-send policy fails closed instead of guessing a route', () => {
  const engine = new PreSendReviewEngine();
  assert.throws(() => engine.review(input({ policy: undefined })), (error: unknown) => error instanceof PreSendReviewError && error.code === 'PRESEND_POLICY_UNAVAILABLE');
});

test('policy version mismatch is rejected before a review record is created', () => {
  const engine = new PreSendReviewEngine();
  assert.throws(() => engine.review(input({ actionPlan: plan({ policyVersion: 'old-policy' }) })), (error: unknown) => error instanceof PreSendReviewError && error.code === 'PRESEND_INPUT_INVALID');
});
