import { createId } from './security.js';
import type { ConversationState } from './domain.js';

export interface ConversationStateEvent {
  eventId: string;
  accountId: string;
  conversationId: string;
  sourceEventId: string;
  sourceSequence: number;
  idempotencyKey: string;
  occurredAt: string;
  policyVersion?: string;
  patch: Partial<Pick<ConversationState, 'activeGoalId' | 'goalStatus' | 'observedStage' | 'targetStage' | 'emotionSnapshot' | 'topicRelation' | 'pendingQuestions' | 'clarificationRound' | 'recommendationState' | 'awaitingUser' | 'awaitingUserSince' | 'awaitingUserTtl' | 'lastMessageId'>>;
}

export interface ConversationStateReductionInput {
  current?: ConversationState;
  expectedStateVersion: number;
  event: ConversationStateEvent;
  now?: string;
}

export type ConversationStateReductionStatus = 'applied' | 'duplicate' | 'stale_replay';

export interface ConversationStateReductionResult {
  status: ConversationStateReductionStatus;
  state: ConversationState;
  auditEvent?: {
    eventType: 'stale_replay_ignored';
    sourceEventId: string;
    sourceSequence: number;
    observedAt: string;
  };
}

export class ConversationStateReducerError extends Error {
  readonly code: string;

  constructor(code: string, message = code) {
    super(message);
    this.name = 'ConversationStateReducerError';
    this.code = code;
  }
}

export class ConversationStateReducer {
  constructor(private readonly idFactory: () => string = createId, private readonly maxRecentKeys = 128) {}

  createInitial(input: { accountId: string; conversationId: string; now?: string; policyVersion?: string; stateId?: string }): ConversationState {
    const now = input.now ?? new Date().toISOString();
    return {
      stateId: input.stateId ?? this.idFactory(),
      accountId: input.accountId,
      conversationId: input.conversationId,
      stateVersion: 0,
      goalStatus: 'active',
      pendingQuestions: [],
      clarificationRound: 0,
      awaitingUser: false,
      transitionAt: now,
      policyVersion: input.policyVersion,
      lastSourceSequence: 0,
      processedEventIds: [],
      processedIdempotencyKeys: [],
    };
  }

  reduce(input: ConversationStateReductionInput): ConversationStateReductionResult {
    const { event } = input;
    if (!Number.isInteger(input.expectedStateVersion) || input.expectedStateVersion < 0) throw new ConversationStateReducerError('STATE_EXPECTED_VERSION_INVALID');
    if (!event.eventId.trim() || !event.sourceEventId.trim() || !event.idempotencyKey.trim()) throw new ConversationStateReducerError('STATE_EVENT_ID_REQUIRED');
    if (!Number.isInteger(event.sourceSequence) || event.sourceSequence <= 0) throw new ConversationStateReducerError('STATE_SOURCE_SEQUENCE_INVALID');
    if (!Number.isFinite(Date.parse(event.occurredAt))) throw new ConversationStateReducerError('STATE_EVENT_TIME_INVALID');

    const current = input.current ?? this.createInitial({ accountId: event.accountId, conversationId: event.conversationId, now: event.occurredAt, policyVersion: event.policyVersion });
    if (current.accountId !== event.accountId || current.conversationId !== event.conversationId) throw new ConversationStateReducerError('STATE_ACCOUNT_SCOPE_MISMATCH');
    if (input.current === undefined && input.expectedStateVersion !== 0) throw new ConversationStateReducerError('STATE_VERSION_CONFLICT');
    if (input.current !== undefined && input.expectedStateVersion !== current.stateVersion) throw new ConversationStateReducerError('STATE_VERSION_CONFLICT');

    if (current.processedEventIds.includes(event.eventId) || current.processedIdempotencyKeys.includes(event.idempotencyKey)) {
      return { status: 'duplicate', state: cloneState(current) };
    }
    if (event.sourceSequence <= current.lastSourceSequence || Date.parse(event.occurredAt) < Date.parse(current.transitionAt)) {
      return {
        status: 'stale_replay',
        state: cloneState(current),
        auditEvent: { eventType: 'stale_replay_ignored', sourceEventId: event.sourceEventId, sourceSequence: event.sourceSequence, observedAt: input.now ?? new Date().toISOString() },
      };
    }

    const next: ConversationState = {
      ...cloneState(current),
      ...clonePatch(event.patch),
      stateVersion: current.stateVersion + 1,
      transitionAt: event.occurredAt,
      policyVersion: event.policyVersion ?? current.policyVersion,
      lastSourceEventId: event.sourceEventId,
      lastSourceSequence: event.sourceSequence,
      processedEventIds: appendRecent(current.processedEventIds, event.eventId, this.maxRecentKeys),
      processedIdempotencyKeys: appendRecent(current.processedIdempotencyKeys, event.idempotencyKey, this.maxRecentKeys),
    };
    return { status: 'applied', state: next };
  }
}

function clonePatch(patch: ConversationStateEvent['patch']): ConversationStateEvent['patch'] {
  const result: ConversationStateEvent['patch'] = { ...patch };
  if (patch.pendingQuestions) result.pendingQuestions = patch.pendingQuestions.map((question) => ({ ...question }));
  else delete result.pendingQuestions;
  if (patch.emotionSnapshot) result.emotionSnapshot = { ...patch.emotionSnapshot };
  else delete result.emotionSnapshot;
  if (patch.recommendationState) result.recommendationState = { ...patch.recommendationState };
  else delete result.recommendationState;
  return result;
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

function appendRecent(values: string[], value: string, max: number): string[] {
  const next = [...values.filter((item) => item !== value), value];
  return next.slice(Math.max(0, next.length - max));
}
