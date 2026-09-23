import assert from 'node:assert/strict';
import test from 'node:test';
import { AutoReplyRepairOrchestrator } from '../src/auto-reply-repair-orchestrator.js';
import { withComputedPolicyHash } from '../src/auto-reply-policy.js';
import type { ActionPlan, ConversationState, Objective, PolicyConfig } from '../src/domain.js';
import type { OutcomeReviewPolicy } from '../src/auto-reply-outcome-review.js';
import type { PreSendReviewPolicyInput } from '../src/auto-reply-pre-send-review.js';

const state: ConversationState = {
  stateId: 'state-1', accountId: 'account-1', conversationId: 'conversation-1', stateVersion: 2, goalStatus: 'active', pendingQuestions: [], clarificationRound: 0, awaitingUser: false, transitionAt: '2026-09-22T01:00:00.000Z', lastSourceSequence: 2, processedEventIds: [], processedIdempotencyKeys: [],
};
const objective: Objective = { objectiveId: 'goal-1', accountId: 'account-1', conversationId: 'conversation-1', goalType: 'product_information', status: 'active', successCriteria: ['回答价格'], createdAt: '2026-09-22T01:00:00.000Z', updatedAt: '2026-09-22T01:00:00.000Z' };

function policy(): PolicyConfig {
  const actionPriority = { ANSWER_FACT: 1, GUIDE_NEXT_STEP: 2, CLARIFY: 3, ACKNOWLEDGE_CONTINUE: 4, REDIRECT: 5, SWITCH_GOAL: 6, RECOMMEND: 7, WAIT_FOR_USER: 8, HANDOFF: 9, REFUSE_SENSITIVE: 10 } as const;
  return withComputedPolicyHash({ policyVersion: 'policy-v1', status: 'ACTIVE', accountScope: 'account-1', effectiveFrom: '2026-09-22T00:00:00.000Z', activatedAt: '2026-09-22T00:00:00.000Z', immutable: true, actionPriority, actionMutex: [{ left: 'HANDOFF', right: 'REFUSE_SENSITIVE' }], precedenceRules: [{ ruleId: 'answer-price', predicate: { intent: 'price' }, primaryAction: 'ANSWER_FACT', safetyHandling: 'NONE', nextState: { goalStatus: 'active' }, priority: 100, specificity: 1, requiredEvidenceCount: 1, successCriteria: ['回答价格'], reasonCodes: ['FACT_ANSWER'] }], clarification: { maxQuestionsPerTurn: 1, maxRounds: 2, awaitingUserTtlSeconds: 60 }, handoff: { allowedReasonCodes: ['USER_REQUESTED_HUMAN'], factUnavailable: { minAttempts: 1, windowSeconds: 60, deadlineSeconds: 120, requiredSourceIds: ['catalog'], requiredErrorCodes: ['NOT_FOUND'] } }, resolution: { reopenWindowSeconds: 120, reopenEvidenceTypes: ['BUYER_DENIED'], closeRequiresWindow: true }, review: { leaseSeconds: 60, maxAttempts: 2, backoffSeconds: [10, 30] } });
}

const preSendPolicy: PreSendReviewPolicyInput = { policyVersion: 'policy-v1', preSend: { maxRevisionAttempts: 1, maxFactAgeSeconds: 900, allowedActionKinds: ['ANSWER_FACT', 'CLARIFY', 'ACKNOWLEDGE_CONTINUE', 'REFUSE_SENSITIVE', 'HANDOFF'], fallbackActionAllowlist: ['CLARIFY', 'ACKNOWLEDGE_CONTINUE', 'REFUSE_SENSITIVE'], missingFactsAction: 'CLARIFY', validationFailureAction: 'ACKNOWLEDGE_CONTINUE', sensitiveFailureAction: 'REFUSE_SENSITIVE', allowedHandoffReasonCodes: ['USER_REQUESTED_HUMAN'] } };
const outcomePolicy: OutcomeReviewPolicy = { policyVersion: 'outcome-v1', leaseSeconds: 60, maxAttempts: 2, backoffSeconds: [10, 30], reopenWindowSeconds: 120, evidenceWindowSeconds: 60, closeRequiresWindow: true, resolvingEvidencePriority: ['DOMAIN_FACT_SATISFIED', 'BUYER_CONFIRMED', 'HUMAN_OVERRIDE'], reopenEvidenceTypes: ['BUYER_DENIED'] };

function input(overrides: Partial<Parameters<AutoReplyRepairOrchestrator['execute']>[0]> = {}) {
  return {
    policyConfig: policy(), preSendPolicy, outcomePolicy, policyEvaluation: { signals: { intent: 'price', requiredFacts: ['price'], evidenceRefs: ['fact-price'] }, verifiedFacts: [{ factRef: 'fact-price' }], conversationState: state, objective, accountScope: 'account-1' },
    preSend: { runId: 'run-1', goalId: 'goal-1', stateId: 'state-1', scope: { accountId: 'account-1', conversationId: 'conversation-1', productId: 'product-1' }, verifiedFacts: [{ factRef: 'fact-price', key: 'price', accountId: 'account-1', conversationId: 'conversation-1', productId: 'product-1', verifiedAt: '2026-09-22T01:00:00.000Z' }], factRefs: ['fact-price'], draftClaims: [{ claimId: 'claim-1', claimType: 'FACTUAL' as const, factRefs: ['fact-price'] }], goalCoverage: { requiredCriteria: ['回答价格'], satisfiedCriteria: ['回答价格'], missingCriteria: [] }, outboundSensitive: { status: 'clean' as const }, idempotencyKey: 'pre-1' }, send: async () => ({ outcome: 'known_success' as const, externalMessageRef: 'external-1' }), now: new Date('2026-09-22T01:00:10.000Z'), ...overrides,
  };
}

test('orchestrator enforces policy → pre-send → send → review_pending order', async () => {
  const result = await new AutoReplyRepairOrchestrator(undefined, undefined, undefined).execute(input());
  assert.equal(result.policy.actionPlan.primaryAction, 'ANSWER_FACT');
  assert.equal(result.preSend.decision, 'APPROVE');
  assert.equal(result.sent, true);
  assert.equal(result.senderOutcome, 'known_success');
  assert.equal(result.outcomeReview?.resolutionStatus, 'review_pending');
  assert.deepEqual(result.outcomeReview?.evidenceTypes, ['SENDER_PERSISTED']);
});

test('pre-send failure blocks sender and does not fabricate outcome resolution', async () => {
  let sendCalls = 0;
  const result = await new AutoReplyRepairOrchestrator().execute(input({ preSend: { ...input().preSend, factRefs: [], verifiedFacts: [], idempotencyKey: 'pre-2' }, send: async () => { sendCalls += 1; return { outcome: 'known_success' as const }; } }));
  assert.equal(result.preSend.decision, 'REVISE');
  assert.equal(result.sent, false);
  assert.equal(sendCalls, 0);
  assert.equal(result.outcomeReview, undefined);
});

test('sensitive pre-send block never calls sender', async () => {
  let sendCalls = 0;
  const result = await new AutoReplyRepairOrchestrator().execute(input({ preSend: { ...input().preSend, revisionAttempt: 1, outboundSensitive: { status: 'unknown', sensitiveClass: 'EQUIVALENT_SECRET' }, idempotencyKey: 'pre-3' }, send: async () => { sendCalls += 1; return { outcome: 'known_success' as const }; } }));
  assert.equal(result.preSend.decision, 'BLOCK_SENSITIVE');
  assert.equal(result.sent, false);
  assert.equal(sendCalls, 0);
});
