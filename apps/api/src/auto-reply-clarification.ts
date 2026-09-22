import { digestJson } from './security.js';
import type { AutoReplyGoalStatus, ConversationState, PolicyConfig } from './domain.js';

export interface ClarificationQuestion {
  question: string;
  questionFingerprint: string;
  expectedAnswerType?: string;
  sourceMessageId: string;
  askedAt: string;
}

export interface ClarificationPolicyInput {
  clarification?: Partial<PolicyConfig['clarification']>;
}

export interface ClarificationRequestInput {
  state: ConversationState;
  goalId: string;
  sourceMessageId: string;
  question: string;
  questionFingerprint?: string;
  expectedAnswerType?: string;
  newFactsAvailable?: boolean;
  policy: ClarificationPolicyInput | undefined;
  now?: Date;
}

export interface ClarificationRequestResult {
  status: 'question_requested' | 'awaiting_user' | 'unresolved';
  action: 'CLARIFY' | 'WAIT_FOR_USER' | 'UNRESOLVED';
  state: ConversationState;
  question?: ClarificationQuestion;
  reasonCode?: 'QUESTION_DUPLICATE' | 'MAX_ROUNDS_REACHED' | 'ALREADY_AWAITING_USER';
  event: {
    type: 'clarification.requested' | 'clarification.awaiting_user' | 'clarification.exhausted';
    goalId: string;
    clarificationAttemptId?: string;
    clarificationRound: number;
    questionFingerprint?: string;
    reasonCode?: 'MAX_ROUNDS_REACHED' | 'CLARIFICATION_EXHAUSTED';
  };
}

export interface ClarificationWaitingInput {
  state: ConversationState;
  policy: ClarificationPolicyInput | undefined;
  now?: Date;
}

export interface ClarificationWaitingResult {
  status: 'not_waiting' | 'awaiting_user' | 'exhausted';
  action: 'WAIT_FOR_USER' | 'UNRESOLVED' | 'NONE';
  state: ConversationState;
  event?: {
    type: 'clarification.awaiting_user' | 'clarification.exhausted';
    goalId?: string;
    clarificationRound: number;
    reasonCode: 'TTL_ACTIVE' | 'CLARIFICATION_EXHAUSTED';
  };
}

export interface ClarificationResumeInput {
  state: ConversationState;
  goalId?: string;
  messageId: string;
  newFactsProvided: boolean;
  requiredFactsSatisfied: boolean;
  explicitNewGoal?: {
    goalType: string;
    successCriteria?: string[];
  };
  policy: ClarificationPolicyInput | undefined;
  now?: Date;
}

export interface ClarificationResumeResult {
  outcome: 'resumed_goal' | 'switched_goal' | 'awaiting_user' | 'no_action';
  state: ConversationState;
  goalId?: string;
  previousGoalId?: string;
  clarificationAttemptId?: string;
  event?: {
    type: 'clarification.resumed' | 'goal.updated' | 'clarification.awaiting_user';
    goalId?: string;
    previousGoalId?: string;
    clarificationAttemptId?: string;
  };
}

export class ClarificationError extends Error {
  readonly code: string;

  constructor(code: string, message = code) {
    super(message);
    this.name = 'ClarificationError';
    this.code = code;
  }
}

export function questionFingerprint(question: string, expectedAnswerType?: string): string {
  const normalizedQuestion = question.replace(/\s+/g, ' ').trim().toLowerCase();
  return digestJson({ question: normalizedQuestion, expectedAnswerType: expectedAnswerType?.trim() || undefined });
}

export class ClarificationEngine {
  constructor(private readonly idFactory: () => string = defaultId) {}

  requestQuestion(input: ClarificationRequestInput): ClarificationRequestResult {
    const policy = resolvePolicy(input.policy);
    const now = input.now ?? new Date();
    const nowIso = now.toISOString();
    if (!input.goalId.trim()) throw new ClarificationError('GOAL_ID_REQUIRED');
    if (!input.sourceMessageId.trim()) throw new ClarificationError('SOURCE_MESSAGE_ID_REQUIRED');
    const text = input.question.replace(/\s+/g, ' ').trim();
    if (!text) throw new ClarificationError('CLARIFICATION_QUESTION_REQUIRED');
    if (input.state.activeGoalId && input.state.activeGoalId !== input.goalId) throw new ClarificationError('CLARIFICATION_GOAL_MISMATCH');

    const currentQuestions = readQuestions(input.state);
    const fingerprint = input.questionFingerprint?.trim() || questionFingerprint(text, input.expectedAnswerType);
    const duplicate = input.state.awaitingUser && !input.newFactsAvailable && (input.state.lastQuestionFingerprint === fingerprint || currentQuestions.some((item) => item.questionFingerprint === fingerprint));
    if (duplicate) return awaitingResult(input.state, input.goalId, 'QUESTION_DUPLICATE', 'questionFingerprint');
    if (input.state.awaitingUser && currentQuestions.length > 0 && !input.newFactsAvailable) return awaitingResult(input.state, input.goalId, 'ALREADY_AWAITING_USER', 'awaiting');
    if (input.state.clarificationRound >= policy.maxRounds) {
      if (!input.state.awaitingUser) return unresolvedResult(input.state, input.goalId, 'MAX_ROUNDS_REACHED');
      return awaitingResult(input.state, input.goalId, 'MAX_ROUNDS_REACHED', 'round');
    }
    if (!input.newFactsAvailable && currentQuestions.length >= policy.maxQuestionsPerTurn) return awaitingResult(input.state, input.goalId, 'ALREADY_AWAITING_USER', 'budget');

    const attemptId = input.state.clarificationAttemptId ?? this.idFactory();
    const round = input.state.clarificationRound + 1;
    const questionRecord: ClarificationQuestion = { question: text, questionFingerprint: fingerprint, expectedAnswerType: input.expectedAnswerType?.trim() || undefined, sourceMessageId: input.sourceMessageId, askedAt: nowIso };
    const nextState = cloneState(input.state);
    nextState.activeGoalId = input.goalId;
    nextState.goalStatus = 'awaiting_user';
    nextState.pendingQuestions = [questionRecord as unknown as Record<string, unknown>];
    nextState.clarificationRound = round;
    nextState.clarificationAttemptId = attemptId;
    nextState.lastQuestionFingerprint = fingerprint;
    nextState.awaitingUser = true;
    nextState.awaitingUserSince = nowIso;
    nextState.awaitingUserTtl = new Date(now.getTime() + policy.awaitingUserTtlSeconds * 1_000).toISOString();
    nextState.lastMessageId = input.sourceMessageId;
    nextState.transitionAt = nowIso;
    return {
      status: 'question_requested',
      action: 'CLARIFY',
      state: nextState,
      question: questionRecord,
      event: { type: 'clarification.requested', goalId: input.goalId, clarificationAttemptId: attemptId, clarificationRound: round, questionFingerprint: fingerprint },
    };
  }

  evaluateWaiting(input: ClarificationWaitingInput): ClarificationWaitingResult {
    const policy = resolvePolicy(input.policy);
    const now = input.now ?? new Date();
    if (!input.state.awaitingUser) return { status: 'not_waiting', action: 'NONE', state: cloneState(input.state) };
    if (!input.state.awaitingUserSince || !input.state.awaitingUserTtl || !Number.isFinite(Date.parse(input.state.awaitingUserSince)) || !Number.isFinite(Date.parse(input.state.awaitingUserTtl))) throw new ClarificationError('CLARIFICATION_STATE_INVALID');
    const ttlEnd = Date.parse(input.state.awaitingUserTtl);
    if (now.getTime() < ttlEnd) return { status: 'awaiting_user', action: 'WAIT_FOR_USER', state: cloneState(input.state), event: { type: 'clarification.awaiting_user', goalId: input.state.activeGoalId, clarificationRound: input.state.clarificationRound, reasonCode: 'TTL_ACTIVE' } };
    // The last sent question remains in history, but no longer blocks a new
    // inbound message from being reclassified after the TTL expires.
    const nextState = cloneState(input.state);
    nextState.goalStatus = 'unresolved';
    nextState.awaitingUser = false;
    nextState.pendingQuestions = [];
    nextState.lastQuestionFingerprint = undefined;
    nextState.transitionAt = now.toISOString();
    return { status: 'exhausted', action: 'UNRESOLVED', state: nextState, event: { type: 'clarification.exhausted', goalId: input.state.activeGoalId, clarificationRound: input.state.clarificationRound, reasonCode: 'CLARIFICATION_EXHAUSTED' } };
  }

  resumeAfterBuyerMessage(input: ClarificationResumeInput): ClarificationResumeResult {
    resolvePolicy(input.policy);
    if (!input.messageId.trim()) throw new ClarificationError('MESSAGE_ID_REQUIRED');
    const nowIso = (input.now ?? new Date()).toISOString();
    const previousGoalId = input.state.activeGoalId ?? input.goalId;
    if (!previousGoalId) throw new ClarificationError('GOAL_ID_REQUIRED');

    if (input.explicitNewGoal) {
      if (!input.explicitNewGoal.goalType.trim()) throw new ClarificationError('NEW_GOAL_TYPE_REQUIRED');
      const newGoalId = this.idFactory();
      const attemptId = this.idFactory();
      const nextState = resetClarificationState(input.state, nowIso, newGoalId, attemptId, input.messageId, 'active');
      return { outcome: 'switched_goal', state: nextState, goalId: newGoalId, previousGoalId, clarificationAttemptId: attemptId, event: { type: 'goal.updated', goalId: newGoalId, previousGoalId, clarificationAttemptId: attemptId } };
    }

    if (input.newFactsProvided && input.requiredFactsSatisfied) {
      const attemptId = this.idFactory();
      const nextState = resetClarificationState(input.state, nowIso, previousGoalId, attemptId, input.messageId, 'active');
      return { outcome: 'resumed_goal', state: nextState, goalId: previousGoalId, clarificationAttemptId: attemptId, event: { type: 'clarification.resumed', goalId: previousGoalId, clarificationAttemptId: attemptId } };
    }

    if (input.state.awaitingUser) {
      const nextState = cloneState(input.state);
      nextState.lastMessageId = input.messageId;
      nextState.transitionAt = nowIso;
      return { outcome: 'awaiting_user', state: nextState, goalId: previousGoalId, event: { type: 'clarification.awaiting_user', goalId: previousGoalId } };
    }
    return { outcome: 'no_action', state: cloneState(input.state), goalId: previousGoalId };
  }
}

function resolvePolicy(policy: ClarificationPolicyInput | undefined): { maxQuestionsPerTurn: 1; maxRounds: number; awaitingUserTtlSeconds: number } {
  const clarification = policy?.clarification;
  const maxRounds = clarification?.maxRounds;
  const awaitingUserTtlSeconds = clarification?.awaitingUserTtlSeconds;
  if (clarification?.maxQuestionsPerTurn !== 1 || typeof maxRounds !== 'number' || !Number.isInteger(maxRounds) || maxRounds < 1 || maxRounds > 3 || typeof awaitingUserTtlSeconds !== 'number' || !Number.isInteger(awaitingUserTtlSeconds) || awaitingUserTtlSeconds <= 0) {
    throw new ClarificationError('POLICY_CONFIG_UNAVAILABLE', 'clarification.maxRounds and awaitingUserTtlSeconds are required');
  }
  return { maxQuestionsPerTurn: 1, maxRounds, awaitingUserTtlSeconds };
}

function awaitingResult(state: ConversationState, goalId: string, reasonCode: ClarificationRequestResult['reasonCode'], _reason: string): ClarificationRequestResult {
  const nextState = cloneState(state);
  nextState.activeGoalId = state.activeGoalId ?? goalId;
  nextState.goalStatus = 'awaiting_user';
  nextState.awaitingUser = true;
  return { status: 'awaiting_user', action: 'WAIT_FOR_USER', state: nextState, reasonCode, event: { type: 'clarification.awaiting_user', goalId: nextState.activeGoalId ?? goalId, clarificationRound: nextState.clarificationRound, questionFingerprint: nextState.lastQuestionFingerprint } };
}

function unresolvedResult(state: ConversationState, goalId: string, reasonCode: 'MAX_ROUNDS_REACHED' | 'CLARIFICATION_EXHAUSTED'): ClarificationRequestResult {
  const nextState = cloneState(state);
  nextState.activeGoalId = state.activeGoalId ?? goalId;
  nextState.goalStatus = 'unresolved';
  nextState.awaitingUser = false;
  nextState.pendingQuestions = [];
  nextState.lastQuestionFingerprint = undefined;
  return { status: 'unresolved', action: 'UNRESOLVED', state: nextState, reasonCode, event: { type: 'clarification.exhausted', goalId: nextState.activeGoalId ?? goalId, clarificationRound: nextState.clarificationRound, reasonCode: reasonCode === 'MAX_ROUNDS_REACHED' ? 'MAX_ROUNDS_REACHED' : 'CLARIFICATION_EXHAUSTED' } };
}

function resetClarificationState(state: ConversationState, now: string, goalId: string, attemptId: string, messageId: string, goalStatus: AutoReplyGoalStatus): ConversationState {
  const nextState = cloneState(state);
  nextState.activeGoalId = goalId;
  nextState.goalStatus = goalStatus;
  nextState.pendingQuestions = [];
  nextState.clarificationRound = 0;
  nextState.clarificationAttemptId = attemptId;
  nextState.lastQuestionFingerprint = undefined;
  nextState.awaitingUser = false;
  nextState.awaitingUserSince = undefined;
  nextState.awaitingUserTtl = undefined;
  nextState.lastMessageId = messageId;
  nextState.transitionAt = now;
  return nextState;
}

function readQuestions(state: ConversationState): ClarificationQuestion[] {
  return (state.pendingQuestions ?? []).flatMap((item) => {
    if (!item || typeof item !== 'object' || typeof item.question !== 'string' || typeof item.questionFingerprint !== 'string' || typeof item.sourceMessageId !== 'string' || typeof item.askedAt !== 'string') return [];
    return [{ question: item.question, questionFingerprint: item.questionFingerprint, expectedAnswerType: typeof item.expectedAnswerType === 'string' ? item.expectedAnswerType : undefined, sourceMessageId: item.sourceMessageId, askedAt: item.askedAt }];
  });
}

function cloneState(state: ConversationState): ConversationState {
  return {
    ...state,
    pendingQuestions: (state.pendingQuestions ?? []).map((question) => ({ ...question })),
    emotionSnapshot: state.emotionSnapshot ? { ...state.emotionSnapshot } : undefined,
    recommendationState: state.recommendationState ? { ...state.recommendationState } : undefined,
    processedEventIds: [...(state.processedEventIds ?? [])],
    processedIdempotencyKeys: [...(state.processedIdempotencyKeys ?? [])],
  };
}

function defaultId(): string {
  return `clarification-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
