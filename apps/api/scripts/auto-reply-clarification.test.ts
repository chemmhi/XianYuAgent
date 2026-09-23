import assert from 'node:assert/strict';
import test from 'node:test';
import { ClarificationEngine, ClarificationError, questionFingerprint, type ClarificationPolicyInput } from '../src/auto-reply-clarification.js';
import type { ConversationState } from '../src/domain.js';

function policy(overrides: Partial<NonNullable<ClarificationPolicyInput['clarification']>> = {}): ClarificationPolicyInput {
  return { clarification: { maxQuestionsPerTurn: 1, maxRounds: 2, awaitingUserTtlSeconds: 900, ...overrides } };
}

function state(overrides: Partial<ConversationState> = {}): ConversationState {
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
    ...overrides,
  };
}

function engine(ids = ['attempt-1', 'attempt-2', 'goal-2', 'attempt-3']): ClarificationEngine {
  let index = 0;
  return new ClarificationEngine(() => ids[index++] ?? `generated-${index}`);
}

test('clarification fails closed when policy config is unavailable', () => {
  assert.throws(
    () => new ClarificationEngine().requestQuestion({ state: state(), goalId: 'goal-1', sourceMessageId: 'message-1', question: '需要什么尺寸？', policy: undefined }),
    (error: unknown) => error instanceof ClarificationError && error.code === 'POLICY_CONFIG_UNAVAILABLE',
  );
});

test('clarification asks at most one question while one is pending', () => {
  const first = engine().requestQuestion({ state: state(), goalId: 'goal-1', sourceMessageId: 'message-1', question: '需要什么尺寸？', policy: policy(), now: new Date('2026-09-22T01:00:00.000Z') });
  const second = engine().requestQuestion({ state: first.state, goalId: 'goal-1', sourceMessageId: 'message-2', question: '还需要什么颜色？', policy: policy(), now: new Date('2026-09-22T01:01:00.000Z') });
  assert.equal(second.status, 'awaiting_user');
  assert.equal(second.action, 'WAIT_FOR_USER');
  assert.equal(second.reasonCode, 'ALREADY_AWAITING_USER');
  assert.equal(second.state.clarificationRound, 1);
});

test('duplicate question fingerprints are suppressed without new facts', () => {
  const clarificationEngine = engine();
  const first = clarificationEngine.requestQuestion({ state: state(), goalId: 'goal-1', sourceMessageId: 'message-1', question: '  需要什么尺寸？  ', policy: policy(), now: new Date('2026-09-22T01:00:00.000Z') });
  const duplicate = clarificationEngine.requestQuestion({ state: first.state, goalId: 'goal-1', sourceMessageId: 'message-2', question: '需要什么尺寸？', policy: policy(), now: new Date('2026-09-22T01:01:00.000Z') });
  assert.equal(duplicate.status, 'awaiting_user');
  assert.equal(duplicate.reasonCode, 'QUESTION_DUPLICATE');
  assert.equal(duplicate.state.clarificationRound, 1);
  assert.equal(duplicate.state.lastQuestionFingerprint, questionFingerprint('需要什么尺寸？'));
});

test('new facts allow a repeated fingerprint to be asked again', () => {
  const clarificationEngine = engine();
  const first = clarificationEngine.requestQuestion({ state: state(), goalId: 'goal-1', sourceMessageId: 'message-1', question: '需要什么尺寸？', policy: policy(), now: new Date('2026-09-22T01:00:00.000Z') });
  const repeatedWithFacts = clarificationEngine.requestQuestion({ state: first.state, goalId: 'goal-1', sourceMessageId: 'message-3', question: '需要什么尺寸？', newFactsAvailable: true, policy: policy(), now: new Date('2026-09-22T01:02:00.000Z') });
  assert.equal(repeatedWithFacts.status, 'question_requested');
  assert.equal(repeatedWithFacts.action, 'CLARIFY');
  assert.equal(repeatedWithFacts.state.clarificationRound, 2);
  assert.equal(repeatedWithFacts.question?.questionFingerprint, first.question?.questionFingerprint);
});

test('max rounds stop additional questions and keep awaiting_user state', () => {
  const result = new ClarificationEngine().requestQuestion({
    state: state({ clarificationRound: 2, activeGoalId: 'goal-1', goalStatus: 'awaiting_user', awaitingUser: true }),
    goalId: 'goal-1',
    sourceMessageId: 'message-3',
    question: '请补充更多信息。',
    policy: policy({ maxRounds: 2 }),
    now: new Date('2026-09-22T01:03:00.000Z'),
  });
  assert.equal(result.status, 'awaiting_user');
  assert.equal(result.action, 'WAIT_FOR_USER');
  assert.equal(result.reasonCode, 'MAX_ROUNDS_REACHED');
  assert.equal(result.state.goalStatus, 'awaiting_user');
  assert.equal(result.state.awaitingUser, true);
});

test('the final allowed round still transitions to awaiting_user', () => {
  const result = new ClarificationEngine(() => 'attempt-1').requestQuestion({
    state: state({ clarificationRound: 1, activeGoalId: 'goal-1' }),
    goalId: 'goal-1',
    sourceMessageId: 'message-2',
    question: '请补充订单号。',
    policy: policy({ maxRounds: 2 }),
    now: new Date('2026-09-22T01:04:00.000Z'),
  });
  assert.equal(result.status, 'question_requested');
  assert.equal(result.state.clarificationRound, 2);
  assert.equal(result.state.goalStatus, 'awaiting_user');
  assert.equal(result.state.awaitingUser, true);
  assert.equal(result.event.type, 'clarification.requested');
});

test('active awaiting_user TTL keeps the conversation waiting', () => {
  const clarificationEngine = new ClarificationEngine(() => 'attempt-1');
  const requested = clarificationEngine.requestQuestion({ state: state(), goalId: 'goal-1', sourceMessageId: 'message-1', question: '需要什么尺寸？', policy: policy({ awaitingUserTtlSeconds: 900 }), now: new Date('2026-09-22T01:00:00.000Z') });
  const waiting = clarificationEngine.evaluateWaiting({ state: requested.state, policy: policy({ awaitingUserTtlSeconds: 900 }), now: new Date('2026-09-22T01:14:59.000Z') });
  assert.equal(waiting.status, 'awaiting_user');
  assert.equal(waiting.action, 'WAIT_FOR_USER');
  assert.equal(waiting.event?.type, 'clarification.awaiting_user');
  assert.equal(waiting.state.awaitingUser, true);
});

test('expired TTL marks the clarification unresolved without a handoff', () => {
  const clarificationEngine = new ClarificationEngine(() => 'attempt-1');
  const requested = clarificationEngine.requestQuestion({ state: state(), goalId: 'goal-1', sourceMessageId: 'message-1', question: '需要什么尺寸？', policy: policy({ awaitingUserTtlSeconds: 900 }), now: new Date('2026-09-22T01:00:00.000Z') });
  const exhausted = clarificationEngine.evaluateWaiting({ state: requested.state, policy: policy({ awaitingUserTtlSeconds: 900 }), now: new Date('2026-09-22T01:15:00.000Z') });
  assert.equal(exhausted.status, 'exhausted');
  assert.equal(exhausted.action, 'UNRESOLVED');
  assert.equal(exhausted.event?.type, 'clarification.exhausted');
  assert.equal(exhausted.state.goalStatus, 'unresolved');
  assert.equal(exhausted.state.awaitingUser, false);
  assert.deepEqual(exhausted.state.pendingQuestions, []);
  assert.equal(exhausted.state.lastQuestionFingerprint, undefined);
  assert.notEqual(exhausted.event?.type, 'handoff.requested');

  const reclassified = clarificationEngine.requestQuestion({ state: exhausted.state, goalId: 'goal-1', sourceMessageId: 'message-3', question: '需要什么尺寸？', policy: policy({ awaitingUserTtlSeconds: 900 }), now: new Date('2026-09-22T01:16:00.000Z') });
  assert.equal(reclassified.status, 'unresolved');
  assert.equal(reclassified.action, 'UNRESOLVED');
  assert.equal(reclassified.event.type, 'clarification.exhausted');
});

test('buyer facts resume the original goal and reset clarification state', () => {
  const clarificationEngine = new ClarificationEngine(() => 'attempt-1');
  const requested = clarificationEngine.requestQuestion({ state: state(), goalId: 'goal-1', sourceMessageId: 'message-1', question: '需要什么尺寸？', policy: policy(), now: new Date('2026-09-22T01:00:00.000Z') });
  const resumed = clarificationEngine.resumeAfterBuyerMessage({ state: requested.state, messageId: 'message-2', newFactsProvided: true, requiredFactsSatisfied: true, policy: policy(), now: new Date('2026-09-22T01:01:00.000Z') });
  assert.equal(resumed.outcome, 'resumed_goal');
  assert.equal(resumed.goalId, 'goal-1');
  assert.equal(resumed.previousGoalId, undefined);
  assert.equal(resumed.state.activeGoalId, 'goal-1');
  assert.equal(resumed.state.goalStatus, 'active');
  assert.equal(resumed.state.clarificationRound, 0);
  assert.equal(resumed.state.awaitingUser, false);
  assert.equal(resumed.state.clarificationAttemptId, 'attempt-1');
  assert.equal(resumed.event?.type, 'clarification.resumed');
});

test('an explicit new goal creates a new goal and clarification attempt', () => {
  const clarificationEngine = new ClarificationEngine(() => 'new-goal-id');
  const switched = clarificationEngine.resumeAfterBuyerMessage({
    state: state({ activeGoalId: 'goal-1', goalStatus: 'awaiting_user', awaitingUser: true, clarificationRound: 1 }),
    messageId: 'message-9',
    newFactsProvided: false,
    requiredFactsSatisfied: false,
    explicitNewGoal: { goalType: 'recommendation', successCriteria: ['推荐结果已发送'] },
    policy: policy(),
    now: new Date('2026-09-22T01:09:00.000Z'),
  });
  assert.equal(switched.outcome, 'switched_goal');
  assert.equal(switched.goalId, 'new-goal-id');
  assert.equal(switched.previousGoalId, 'goal-1');
  assert.equal(switched.state.activeGoalId, 'new-goal-id');
  assert.equal(switched.state.goalStatus, 'active');
  assert.equal(switched.state.clarificationRound, 0);
  assert.equal(switched.state.awaitingUser, false);
  assert.equal(switched.state.clarificationAttemptId, 'new-goal-id');
  assert.equal(switched.event?.type, 'goal.updated');
});

test('missing facts keep an awaiting clarification open without handoff', () => {
  const clarificationEngine = new ClarificationEngine(() => 'attempt-1');
  const requested = clarificationEngine.requestQuestion({ state: state(), goalId: 'goal-1', sourceMessageId: 'message-1', question: '需要什么尺寸？', policy: policy(), now: new Date('2026-09-22T01:00:00.000Z') });
  const stillWaiting = clarificationEngine.resumeAfterBuyerMessage({ state: requested.state, messageId: 'message-2', newFactsProvided: true, requiredFactsSatisfied: false, policy: policy(), now: new Date('2026-09-22T01:01:00.000Z') });
  assert.equal(stillWaiting.outcome, 'awaiting_user');
  assert.equal(stillWaiting.goalId, 'goal-1');
  assert.equal(stillWaiting.state.awaitingUser, true);
  assert.equal(stillWaiting.state.clarificationRound, 1);
  assert.equal(stillWaiting.event?.type, 'clarification.awaiting_user');
});
