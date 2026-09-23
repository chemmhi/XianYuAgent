import assert from 'node:assert/strict';
import test from 'node:test';
import { ConversationStateReducer, ConversationStateReducerError, type ConversationStateEvent } from '../src/auto-reply-state.js';

function event(overrides: Partial<ConversationStateEvent> = {}): ConversationStateEvent {
  return {
    eventId: 'event-1', accountId: 'account-1', conversationId: 'conversation-1', sourceEventId: 'source-1', sourceSequence: 1, idempotencyKey: 'idem-1', occurredAt: '2026-09-22T01:00:00.000Z', policyVersion: 'policy-v1', patch: { goalStatus: 'active', lastMessageId: 'message-1' },
    ...overrides,
  };
}

test('state reducer creates and updates a conversation state with CAS versioning', () => {
  const reducer = new ConversationStateReducer(() => 'state-1');
  const initial = reducer.createInitial({ accountId: 'account-1', conversationId: 'conversation-1', now: '2026-09-22T00:00:00.000Z' });
  const applied = reducer.reduce({ current: initial, expectedStateVersion: 0, event: event() });
  assert.equal(applied.status, 'applied');
  assert.equal(applied.state.stateId, 'state-1');
  assert.equal(applied.state.stateVersion, 1);
  assert.equal(applied.state.lastSourceSequence, 1);
  assert.equal(applied.state.lastMessageId, 'message-1');
  assert.deepEqual(applied.state.processedEventIds, ['event-1']);
  assert.deepEqual(applied.state.processedIdempotencyKeys, ['idem-1']);

  assert.throws(() => reducer.reduce({ current: applied.state, expectedStateVersion: 0, event: event({ eventId: 'event-2', sourceEventId: 'source-2', sourceSequence: 2, idempotencyKey: 'idem-2' }) }), (error: unknown) => error instanceof ConversationStateReducerError && error.code === 'STATE_VERSION_CONFLICT');
});

test('duplicate events are idempotent and do not increment state version', () => {
  const reducer = new ConversationStateReducer(() => 'state-1');
  const initial = reducer.createInitial({ accountId: 'account-1', conversationId: 'conversation-1', now: '2026-09-22T00:00:00.000Z' });
  const applied = reducer.reduce({ current: initial, expectedStateVersion: 0, event: event() });
  const duplicateByEvent = reducer.reduce({ current: applied.state, expectedStateVersion: 1, event: event() });
  assert.equal(duplicateByEvent.status, 'duplicate');
  assert.equal(duplicateByEvent.state.stateVersion, 1);

  const duplicateByIdempotency = reducer.reduce({ current: applied.state, expectedStateVersion: 1, event: event({ eventId: 'event-2', sourceEventId: 'source-2', sourceSequence: 2 }) });
  assert.equal(duplicateByIdempotency.status, 'duplicate');
  assert.equal(duplicateByIdempotency.state.stateVersion, 1);
});

test('stale replays are ignored and produce an auditable result', () => {
  const reducer = new ConversationStateReducer(() => 'state-1');
  const initial = reducer.createInitial({ accountId: 'account-1', conversationId: 'conversation-1', now: '2026-09-22T00:00:00.000Z' });
  const applied = reducer.reduce({ current: initial, expectedStateVersion: 0, event: event() });
  const stale = reducer.reduce({ current: applied.state, expectedStateVersion: 1, event: event({ eventId: 'event-old', sourceEventId: 'source-old', sourceSequence: 1, idempotencyKey: 'idem-old', occurredAt: '2026-09-22T00:30:00.000Z', patch: { lastMessageId: 'old-message' } }) });
  assert.equal(stale.status, 'stale_replay');
  assert.equal(stale.state.stateVersion, 1);
  assert.equal(stale.state.lastMessageId, 'message-1');
  assert.equal(stale.auditEvent?.eventType, 'stale_replay_ignored');
});

test('cross-account and invalid source events are rejected before mutation', () => {
  const reducer = new ConversationStateReducer(() => 'state-1');
  const initial = reducer.createInitial({ accountId: 'account-1', conversationId: 'conversation-1', now: '2026-09-22T00:00:00.000Z' });
  assert.throws(() => reducer.reduce({ current: initial, expectedStateVersion: 0, event: event({ accountId: 'account-2' }) }), (error: unknown) => error instanceof ConversationStateReducerError && error.code === 'STATE_ACCOUNT_SCOPE_MISMATCH');
  assert.throws(() => reducer.reduce({ current: initial, expectedStateVersion: 0, event: event({ sourceSequence: 0 }) }), (error: unknown) => error instanceof ConversationStateReducerError && error.code === 'STATE_SOURCE_SEQUENCE_INVALID');
});

test('state reducer clones nested fields instead of mutating caller-owned objects', () => {
  const reducer = new ConversationStateReducer(() => 'state-1');
  const initial = reducer.createInitial({ accountId: 'account-1', conversationId: 'conversation-1', now: '2026-09-22T00:00:00.000Z' });
  const pendingQuestions = [{ questionFingerprint: 'q-1' }];
  const applied = reducer.reduce({ current: initial, expectedStateVersion: 0, event: event({ patch: { pendingQuestions } }) });
  pendingQuestions[0]!.questionFingerprint = 'changed';
  assert.equal(applied.state.pendingQuestions[0]?.questionFingerprint, 'q-1');
});
