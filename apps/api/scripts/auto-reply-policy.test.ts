import assert from 'node:assert/strict';
import test from 'node:test';
import { PolicyConfigValidationError, PolicyEngine, PolicyEngineError, withComputedPolicyHash } from '../src/auto-reply-policy.js';
import { AUTO_REPLY_ACTION_KINDS, type ConversationState, type Objective, type PolicyConfig } from '../src/domain.js';

function policyConfig(overrides: Partial<PolicyConfig> = {}): PolicyConfig {
  const base: Omit<PolicyConfig, 'policyHash'> = {
    policyVersion: 'ar-vs01-test-v1',
    status: 'ACTIVE',
    accountScope: 'account-1',
    effectiveFrom: '2026-09-22T00:00:00.000Z',
    activatedAt: '2026-09-22T00:00:00.000Z',
    immutable: true,
    actionPriority: Object.fromEntries(AUTO_REPLY_ACTION_KINDS.map((action, index) => [action, 1000 - index])) as PolicyConfig['actionPriority'],
    actionMutex: [],
    precedenceRules: [
      { ruleId: 'SECURE.PURE.001', predicate: { sensitiveClass: 'EQUIVALENT_SECRET', safeBusinessPart: false }, primaryAction: 'REFUSE_SENSITIVE', safetyHandling: 'FULL_REFUSAL', nextState: { goalStatus: 'active' }, priority: 1000, specificity: 100, requiredEvidenceCount: 0, successCriteria: ['敏感片段被明确拒绝'], reasonCodes: ['SENSITIVE_REQUEST'] },
      { ruleId: 'ANSWER.FACT.001', predicate: { factQuestion: true, currentGoalFactsSufficient: true }, primaryAction: 'ANSWER_FACT', safetyHandling: 'NONE', nextState: { goalStatus: 'active' }, priority: 550, specificity: 50, requiredEvidenceCount: 1, successCriteria: ['回答当前事实问题'], reasonCodes: ['FACT_ANSWER'] },
      { ruleId: 'ANSWER.FACT.TIE', predicate: { factQuestion: true, currentGoalFactsSufficient: true }, primaryAction: 'ANSWER_FACT', safetyHandling: 'NONE', nextState: { goalStatus: 'active' }, priority: 550, specificity: 60, requiredEvidenceCount: 1, successCriteria: ['回答当前事实问题'], reasonCodes: ['FACT_ANSWER_TIE'] },
    ],
    clarification: { maxQuestionsPerTurn: 1, maxRounds: 2, awaitingUserTtlSeconds: 900 },
    handoff: { allowedReasonCodes: ['USER_REQUESTED_HUMAN'], factUnavailable: { minAttempts: 2, windowSeconds: 300, deadlineSeconds: 60, requiredSourceIds: ['catalog'], requiredErrorCodes: ['NOT_FOUND'] } },
    resolution: { reopenWindowSeconds: 900, reopenEvidenceTypes: ['BUYER_DENIED', 'REPEAT_QUESTION'], closeRequiresWindow: true },
    review: { leaseSeconds: 30, maxAttempts: 3, backoffSeconds: [5, 15, 60] },
  };
  return withComputedPolicyHash({ ...base, ...overrides } as Omit<PolicyConfig, 'policyHash'> & { policyHash?: string });
}

function state(): ConversationState {
  return {
    stateId: 'state-1', accountId: 'account-1', conversationId: 'conversation-1', stateVersion: 3, goalStatus: 'active', pendingQuestions: [], clarificationRound: 0, awaitingUser: false, transitionAt: '2026-09-22T00:00:00.000Z', lastSourceSequence: 3, processedEventIds: [], processedIdempotencyKeys: [],
  };
}

function objective(): Objective {
  return { objectiveId: 'goal-1', accountId: 'account-1', conversationId: 'conversation-1', goalType: 'product_information', status: 'active', successCriteria: ['事实回答已发出'], createdAt: '2026-09-22T00:00:00.000Z', updatedAt: '2026-09-22T00:00:00.000Z' };
}

test('policy engine validates canonical config and selects one primary action deterministically', () => {
  const engine = new PolicyEngine(policyConfig(), (() => { let index = 0; return () => `id-${++index}`; })());
  const result = engine.evaluate({ signals: { factQuestion: true, currentGoalFactsSufficient: true }, verifiedFacts: [{ key: 'price', value: 1999 }], conversationState: state(), objective: objective(), accountScope: 'account-1', now: new Date('2026-09-22T01:00:00.000Z') });
  assert.equal(result.actionPlan.primaryAction, 'ANSWER_FACT');
  assert.equal(result.matchedRuleId, 'ANSWER.FACT.TIE');
  assert.equal(result.trace.primaryAction, 'ANSWER_FACT');
  assert.equal(result.trace.stateVersionBefore, 3);
  assert.equal(result.trace.stateVersionAfter, 4);
  assert.equal(result.trace.policyVersion, 'ar-vs01-test-v1');
  assert.equal(result.actionPlan.policyDecisionId, result.trace.policyDecisionId);
});

test('policy engine applies partial sensitive refusal without discarding the safe business action', () => {
  const config = policyConfig({
    precedenceRules: [
      { ruleId: 'ANSWER.FACT.SAFE.001', predicate: { sensitiveClass: 'EQUIVALENT_SECRET', safeBusinessPart: true, factQuestion: true, currentGoalFactsSufficient: true }, primaryAction: 'ANSWER_FACT', safetyHandling: 'NONE', nextState: { goalStatus: 'active' }, priority: 600, specificity: 70, requiredEvidenceCount: 1, successCriteria: ['回答非敏感事实'], reasonCodes: ['PARTIAL_SAFE_CONTINUATION'] },
      ...policyConfig().precedenceRules,
    ],
  });
  const result = new PolicyEngine(config).evaluate({ signals: { sensitiveClass: 'EQUIVALENT_SECRET', safeBusinessPart: true, factQuestion: true, currentGoalFactsSufficient: true }, verifiedFacts: [{ key: 'price', value: 1999 }], conversationState: state(), objective: objective(), accountScope: 'account-1' });
  assert.equal(result.actionPlan.primaryAction, 'ANSWER_FACT');
  assert.equal(result.actionPlan.safetyHandling, 'PARTIAL_REFUSAL');
  assert.deepEqual(result.actionPlan.reasonCodes, ['PARTIAL_SAFE_CONTINUATION']);
});

test('pure sensitive requests require a canonical REFUSE_SENSITIVE route', () => {
  const result = new PolicyEngine(policyConfig()).evaluate({ signals: { sensitiveClass: 'EQUIVALENT_SECRET', safeBusinessPart: false }, verifiedFacts: [], conversationState: state(), objective: objective(), accountScope: 'account-1' });
  assert.equal(result.actionPlan.primaryAction, 'REFUSE_SENSITIVE');
  assert.equal(result.actionPlan.safetyHandling, 'FULL_REFUSAL');
});

test('policy config rejects a stale hash and duplicate action priorities', () => {
  const invalidHash = { ...policyConfig(), policyHash: 'stale' };
  assert.throws(() => new PolicyEngine(invalidHash), (error: unknown) => error instanceof PolicyConfigValidationError && error.code === 'POLICY_CONFIG_INVALID');
  const duplicatePriority = policyConfig({ actionPriority: { ...policyConfig().actionPriority, ANSWER_FACT: 999, GUIDE_NEXT_STEP: 999 } });
  assert.throws(() => new PolicyEngine(duplicatePriority), (error: unknown) => error instanceof PolicyConfigValidationError && error.code === 'POLICY_CONFIG_INVALID');
});

test('full sensitive overlay fails closed when the policy has no refusal rule', () => {
  const config = policyConfig({ precedenceRules: policyConfig().precedenceRules.filter((rule) => rule.primaryAction !== 'REFUSE_SENSITIVE') });
  const engine = new PolicyEngine(config);
  assert.throws(() => engine.evaluate({ signals: { sensitiveClass: 'EQUIVALENT_SECRET', safeBusinessPart: false, factQuestion: true, currentGoalFactsSufficient: true }, verifiedFacts: [], conversationState: state(), objective: objective(), accountScope: 'account-1' }), (error: unknown) => error instanceof PolicyEngineError && error.code === 'POLICY_SENSITIVE_ROUTE_MISSING');
});
