import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TopicEmotionEngine,
  TopicEmotionEngineError,
  TopicEmotionPolicyValidationError,
  withComputedTopicEmotionPolicyHash,
} from '../src/auto-reply-topic-emotion.js';
import { AUTO_REPLY_ACTION_KINDS, type ConversationState } from '../src/domain.js';
import type { TopicEmotionPolicy } from '../src/auto-reply-topic-emotion.js';

function policyConfig(overrides: Partial<TopicEmotionPolicy> = {}): TopicEmotionPolicy {
  const base: Omit<TopicEmotionPolicy, 'policyHash'> = {
    policyVersion: 'ar-vs05-test-v1',
    status: 'ACTIVE',
    accountScope: 'account-1',
    effectiveFrom: '2026-09-22T00:00:00.000Z',
    activatedAt: '2026-09-22T00:00:00.000Z',
    immutable: true,
    actionRules: [
      {
        ruleId: 'EMOTION.CONFUSED.001',
        predicate: { emotionLabel: 'confused' },
        primaryAction: 'CLARIFY',
        transition: 'KEEP_CURRENT',
        recommendationAllowed: false,
        reviewRequestAllowed: false,
        tone: 'CLARIFY',
        questionAllowed: true,
        nextState: { goalStatus: 'awaiting_user' },
        priority: 820,
        specificity: 80,
        requiredEvidenceCount: 0,
        successCriteria: ['补齐一个最小必要事实'],
        reasonCodes: ['CONFUSED_CLARIFICATION'],
      },
      {
        ruleId: 'EMOTION.NEGATIVE.001',
        predicate: { strongNegativeEmotion: true, safeContinuationFactsSufficient: true },
        primaryAction: 'ACKNOWLEDGE_CONTINUE',
        transition: 'KEEP_CURRENT',
        recommendationAllowed: false,
        reviewRequestAllowed: false,
        tone: 'ACKNOWLEDGE',
        questionAllowed: false,
        nextState: { goalStatus: 'active' },
        priority: 800,
        specificity: 75,
        requiredEvidenceCount: 1,
        successCriteria: ['承接情绪并继续当前目标'],
        reasonCodes: ['NEGATIVE_EMOTION_CONTINUE'],
      },
      {
        ruleId: 'GOAL.NEW.READY.001',
        predicate: { explicitNewGoal: true, newGoalFactsSufficient: true },
        primaryAction: 'SWITCH_GOAL',
        transition: 'SWITCH_GOAL',
        recommendationAllowed: false,
        reviewRequestAllowed: false,
        tone: 'NEUTRAL',
        questionAllowed: false,
        nextState: { goalStatus: 'active' },
        priority: 750,
        specificity: 70,
        requiredEvidenceCount: 1,
        successCriteria: ['创建或切换到新目标'],
        reasonCodes: ['EXPLICIT_NEW_GOAL'],
      },
      {
        ruleId: 'GOAL.NEW.GAP.001',
        predicate: { explicitNewGoal: true, newGoalFactsSufficient: false },
        primaryAction: 'CLARIFY',
        transition: 'KEEP_CURRENT',
        recommendationAllowed: false,
        reviewRequestAllowed: false,
        tone: 'CLARIFY',
        questionAllowed: true,
        nextState: { goalStatus: 'awaiting_user' },
        priority: 740,
        specificity: 70,
        requiredEvidenceCount: 0,
        successCriteria: ['补齐新目标所需事实'],
        reasonCodes: ['NEW_GOAL_FACT_GAP'],
      },
      {
        ruleId: 'TOPIC.OFF_TOPIC.REPEAT.001',
        predicate: { topicRelation: 'off_topic', consecutiveOffTopicCount: 2, candidateGoalAvailable: true },
        primaryAction: 'SWITCH_GOAL',
        transition: 'SWITCH_GOAL',
        recommendationAllowed: false,
        reviewRequestAllowed: false,
        tone: 'NEUTRAL',
        questionAllowed: false,
        nextState: { goalStatus: 'active' },
        priority: 650,
        specificity: 65,
        requiredEvidenceCount: 1,
        successCriteria: ['将连续跑题转为明确的新目标'],
        reasonCodes: ['REPEATED_OFF_TOPIC_SWITCH'],
      },
      {
        ruleId: 'TOPIC.ADJACENT.001',
        predicate: { topicRelation: 'adjacent', safeAdjacentAnswer: true },
        primaryAction: 'ANSWER_FACT',
        transition: 'REDIRECT_TO_CURRENT',
        recommendationAllowed: false,
        reviewRequestAllowed: false,
        tone: 'NEUTRAL',
        questionAllowed: false,
        nextState: { goalStatus: 'active' },
        priority: 525,
        specificity: 45,
        requiredEvidenceCount: 1,
        successCriteria: ['先回答邻近事实并回到主线'],
        reasonCodes: ['ADJACENT_ANSWER_REDIRECT'],
      },
      {
        ruleId: 'TOPIC.OFF_TOPIC.001',
        predicate: { topicRelation: 'off_topic', explicitNewGoal: false, safeAdjacentAnswer: false },
        primaryAction: 'REDIRECT',
        transition: 'REDIRECT_TO_CURRENT',
        recommendationAllowed: false,
        reviewRequestAllowed: false,
        tone: 'NEUTRAL',
        questionAllowed: false,
        nextState: { goalStatus: 'active' },
        priority: 400,
        specificity: 40,
        requiredEvidenceCount: 0,
        successCriteria: ['承接一句并拉回当前目标'],
        reasonCodes: ['OFF_TOPIC_REDIRECT'],
      },
      {
        ruleId: 'TOPIC.CURRENT.TIE.A.001',
        predicate: { topicRelation: 'current', emotionLabel: 'neutral', currentGoalFactsSufficient: true },
        primaryAction: 'ANSWER_FACT',
        transition: 'KEEP_CURRENT',
        recommendationAllowed: true,
        reviewRequestAllowed: true,
        tone: 'NEUTRAL',
        questionAllowed: false,
        nextState: { goalStatus: 'active' },
        priority: 300,
        specificity: 30,
        requiredEvidenceCount: 1,
        successCriteria: ['继续当前目标'],
        reasonCodes: ['CURRENT_GOAL_CONTINUE_A'],
      },
      {
        ruleId: 'TOPIC.CURRENT.TIE.B.001',
        predicate: { topicRelation: 'current', emotionLabel: 'neutral', currentGoalFactsSufficient: true },
        primaryAction: 'ANSWER_FACT',
        transition: 'KEEP_CURRENT',
        recommendationAllowed: true,
        reviewRequestAllowed: true,
        tone: 'NEUTRAL',
        questionAllowed: false,
        nextState: { goalStatus: 'active' },
        priority: 300,
        specificity: 30,
        requiredEvidenceCount: 1,
        successCriteria: ['继续当前目标'],
        reasonCodes: ['CURRENT_GOAL_CONTINUE_B'],
      },
    ],
    gateRules: [
      {
        ruleId: 'GATE.NEGATIVE.001',
        predicate: { strongNegativeEmotion: true },
        recommendationAllowed: false,
        reviewRequestAllowed: false,
        priority: 900,
        specificity: 90,
        requiredEvidenceCount: 1,
        reasonCodes: ['NEGATIVE_EMOTION_GATE'],
      },
      {
        ruleId: 'GATE.AWAITING.001',
        predicate: { awaitingUser: true },
        recommendationAllowed: false,
        reviewRequestAllowed: false,
        priority: 880,
        specificity: 80,
        requiredEvidenceCount: 0,
        reasonCodes: ['AWAITING_USER_GATE'],
      },
      {
        ruleId: 'GATE.STABLE.001',
        predicate: { strongNegativeEmotion: false, awaitingUser: false, complaintOpen: false, afterSalesOpen: false },
        recommendationAllowed: true,
        reviewRequestAllowed: true,
        priority: 100,
        specificity: 10,
        requiredEvidenceCount: 0,
        reasonCodes: ['STABLE_GATE'],
      },
    ],
  };
  return withComputedTopicEmotionPolicyHash({ ...base, ...overrides } as Omit<TopicEmotionPolicy, 'policyHash'> & { policyHash?: string });
}

function state(): ConversationState {
  return {
    stateId: 'state-1',
    accountId: 'account-1',
    conversationId: 'conversation-1',
    stateVersion: 3,
    goalStatus: 'active',
    pendingQuestions: [],
    clarificationRound: 0,
    awaitingUser: false,
    transitionAt: '2026-09-22T00:00:00.000Z',
    lastSourceSequence: 3,
    processedEventIds: [],
    processedIdempotencyKeys: [],
  };
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    accountScope: 'account-1',
    conversationId: 'conversation-1',
    currentGoalId: 'goal-1',
    topic: {
      relation: 'current',
      explicitNewGoal: false,
      safeAdjacentAnswer: false,
      consecutiveOffTopicCount: 0,
      candidateGoalAvailable: false,
      signals: ['topic-classifier'],
      sourceVersion: 'topic-v1',
    },
    emotion: {
      label: 'neutral',
      intensity: 0.1,
      confidence: 0.98,
      signals: ['no-negative-cue'],
      sourceVersion: 'emotion-v1',
    },
    signals: {
      currentGoalFactsSufficient: true,
      newGoalFactsSufficient: false,
      strongNegativeEmotion: false,
      safeContinuationFactsSufficient: true,
      complaintOpen: false,
      afterSalesOpen: false,
    },
    state: state(),
    policy: policyConfig(),
    now: new Date('2026-09-22T01:00:00.000Z'),
    ...overrides,
  } as any;
}

test('policy hash and slice scope are validated, and escalation/refusal routes are rejected', () => {
  assert.throws(() => new TopicEmotionEngine({ ...policyConfig(), policyHash: 'stale' }), (error: unknown) => error instanceof TopicEmotionPolicyValidationError && error.code === 'TOPIC_EMOTION_POLICY_INVALID');
  const invalid = policyConfig({
    actionRules: [{ ...policyConfig().actionRules[0]!, primaryAction: 'HANDOFF' }],
  });
  assert.throws(() => new TopicEmotionEngine(invalid), (error: unknown) => error instanceof TopicEmotionPolicyValidationError && error.code === 'TOPIC_EMOTION_POLICY_INVALID');
  assert.throws(() => new TopicEmotionEngine(policyConfig()).evaluate({ ...input(), accountScope: 'account-2' }), (error: unknown) => error instanceof TopicEmotionEngineError && error.code === 'TOPIC_EMOTION_ACCOUNT_SCOPE_MISMATCH');
});

test('adjacent topic answers the safe fact first and emits a redirect event', () => {
  const engine = new TopicEmotionEngine(policyConfig(), (() => { let n = 0; return () => `decision-${++n}`; })());
  const result = engine.evaluate(input({ topic: { ...input().topic, relation: 'adjacent', safeAdjacentAnswer: true }, signals: { ...input().signals, currentGoalFactsSufficient: false } }));
  assert.equal(result.action, 'ANSWER_FACT');
  assert.equal(result.transition, 'REDIRECT_TO_CURRENT');
  assert.equal(result.matchedRuleId, 'TOPIC.ADJACENT.001');
  assert.equal(result.recommendationAllowed, false);
  assert.equal(result.events.at(-1)?.type, 'topic.redirected');
  assert.equal(result.nextState?.topicRelation, 'adjacent');
});

test('off-topic without a new goal is redirected, while repeated off-topic switches when a candidate exists', () => {
  const engine = new TopicEmotionEngine(policyConfig(), (() => { let n = 0; return () => `decision-${++n}`; })());
  const redirected = engine.evaluate(input({ topic: { ...input().topic, relation: 'off_topic' }, signals: { ...input().signals, currentGoalFactsSufficient: false } }));
  assert.equal(redirected.action, 'REDIRECT');
  assert.equal(redirected.transition, 'REDIRECT_TO_CURRENT');
  assert.equal(redirected.events.at(-1)?.type, 'topic.redirected');

  const switched = engine.evaluate(input({
    topic: { ...input().topic, relation: 'off_topic', consecutiveOffTopicCount: 2, candidateGoalAvailable: true, candidateGoalId: 'goal-2' },
    signals: { ...input().signals, currentGoalFactsSufficient: false },
  }));
  assert.equal(switched.action, 'SWITCH_GOAL');
  assert.equal(switched.transition, 'SWITCH_GOAL');
  assert.equal(switched.nextState?.activeGoalId, 'goal-2');
  assert.equal(switched.events.at(-1)?.type, 'topic.switched');
});

test('explicit new goal with missing facts asks one question, and ready goal switches', () => {
  const engine = new TopicEmotionEngine(policyConfig());
  const clarify = engine.evaluate(input({
    topic: { ...input().topic, relation: 'new_goal', explicitNewGoal: true, candidateGoalAvailable: true },
    signals: { ...input().signals, newGoalFactsSufficient: false },
  }));
  assert.equal(clarify.action, 'CLARIFY');
  assert.equal(clarify.questionAllowed, true);
  assert.equal(clarify.recommendationAllowed, false);

  const switched = engine.evaluate(input({
    topic: { ...input().topic, relation: 'new_goal', explicitNewGoal: true, candidateGoalAvailable: true, candidateGoalId: 'goal-3' },
    signals: { ...input().signals, newGoalFactsSufficient: true },
  }));
  assert.equal(switched.action, 'SWITCH_GOAL');
  assert.equal(switched.nextState?.activeGoalId, 'goal-3');
});

test('negative emotion acknowledges and disables recommendation and review request', () => {
  const engine = new TopicEmotionEngine(policyConfig());
  const result = engine.evaluate(input({
    emotion: { ...input().emotion, label: 'angry', intensity: 0.9, confidence: 0.91 },
    signals: { ...input().signals, strongNegativeEmotion: true },
  }));
  assert.equal(result.action, 'ACKNOWLEDGE_CONTINUE');
  assert.equal(result.tone, 'ACKNOWLEDGE');
  assert.equal(result.recommendationAllowed, false);
  assert.equal(result.reviewRequestAllowed, false);
  assert.deepEqual(result.emotion.signals, ['no-negative-cue']);
  assert.equal(result.events[0]?.type, 'emotion.observed');
});

test('confusion is clarification-only and awaiting state blocks recommendation through the gate', () => {
  const waitingState = { ...state(), awaitingUser: true, goalStatus: 'awaiting_user' as const };
  const engine = new TopicEmotionEngine(policyConfig());
  const result = engine.evaluate(input({
    state: waitingState,
    emotion: { ...input().emotion, label: 'confused' },
    signals: { ...input().signals, strongNegativeEmotion: false },
  }));
  assert.equal(result.action, 'CLARIFY');
  assert.equal(result.questionAllowed, true);
  assert.equal(result.matchedGateRuleId, 'GATE.AWAITING.001');
  assert.equal(result.recommendationAllowed, false);
  assert.equal(result.reviewRequestAllowed, false);
});

test('same signals select the same rule and clone state/evidence without mutation', () => {
  const ids = ['d-1', 'd-2'];
  const engine = new TopicEmotionEngine(policyConfig(), () => ids.shift() ?? 'd-n');
  const original = input();
  const result = engine.evaluate(original);
  const second = engine.evaluate({ ...original, state: result.nextState });
  assert.equal(result.matchedRuleId, 'TOPIC.CURRENT.TIE.A.001');
  assert.equal(second.matchedRuleId, 'TOPIC.CURRENT.TIE.A.001');
  assert.notEqual(result.nextState, original.state);
  assert.notEqual(result.topic.signals, original.topic.signals);
  assert.notEqual(result.emotion.signals, original.emotion.signals);
  assert.equal(original.state.topicRelation, undefined);
});

test('missing gate evidence fails closed instead of applying a hidden default', () => {
  const config = policyConfig({ gateRules: policyConfig().gateRules.filter((rule) => rule.ruleId !== 'GATE.STABLE.001') });
  const engine = new TopicEmotionEngine(config);
  assert.throws(() => engine.evaluate(input()), (error: unknown) => error instanceof TopicEmotionEngineError && error.code === 'TOPIC_EMOTION_NO_GATE_MATCH');
});

test('the test policy covers canonical action kinds without adding a hidden route', () => {
  const config = policyConfig();
  const actions = new Set(config.actionRules.map((rule) => rule.primaryAction));
  assert.ok([...actions].every((action) => AUTO_REPLY_ACTION_KINDS.includes(action)));
  assert.equal(actions.has('HANDOFF'), false);
  assert.equal(actions.has('REFUSE_SENSITIVE'), false);
});
