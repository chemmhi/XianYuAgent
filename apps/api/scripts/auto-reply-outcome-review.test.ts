import assert from 'node:assert/strict';
import test from 'node:test';
import { OutcomeReviewEngine, OutcomeReviewError, type OutcomeEvidence, type OutcomeReviewPolicy, type OutcomeReviewRecord } from '../src/auto-reply-outcome-review.js';

const policy: OutcomeReviewPolicy = {
  policyVersion: 'outcome-v1',
  leaseSeconds: 60,
  maxAttempts: 2,
  backoffSeconds: [10, 30],
  reopenWindowSeconds: 120,
  evidenceWindowSeconds: 60,
  closeRequiresWindow: true,
  resolvingEvidencePriority: ['DOMAIN_FACT_SATISFIED', 'BUYER_CONFIRMED', 'HUMAN_OVERRIDE'],
  reopenEvidenceTypes: ['BUYER_DENIED', 'REPEAT_QUESTION', 'FACT_REGRESSION'],
};

const t0 = new Date('2026-09-22T01:00:00.000Z');

function pending(engine = new OutcomeReviewEngine(() => 'review-1')): OutcomeReviewRecord {
  return engine.createPending({ accountId: 'account-1', conversationId: 'conversation-1', runId: 'run-1', goalId: 'goal-1', stateId: 'state-1', expectedStateVersion: 4, policy, now: t0, idempotencyKey: 'review-key-1' });
}

function evidence(type: OutcomeEvidence['type'], observedAt = '2026-09-22T01:00:10.000Z'): OutcomeEvidence {
  return { evidenceId: `${type}-1`, type, observedAt, sourceEventId: `event-${type}`, summary: 'redacted evidence', authoritative: true };
}

test('claims review atomically and rejects a second worker while lease is active', () => {
  const engine = new OutcomeReviewEngine(() => 'review-1');
  const record = pending(engine);
  const first = engine.claim({ record, policy, currentStateVersion: 4, now: t0, workerId: 'worker-a', claimKey: 'claim-a' });
  assert.equal(first.status, 'claimed');
  assert.equal(first.record.resolutionStatus, 'reviewing');
  const second = engine.claim({ record: first.record, policy, currentStateVersion: 4, now: new Date('2026-09-22T01:00:10.000Z'), workerId: 'worker-b', claimKey: 'claim-b' });
  assert.equal(second.status, 'claim_rejected');
  assert.equal(second.reasonCode, 'REVIEW_NOT_PENDING');
});

test('domain fact resolves, while transport-only evidence does not', () => {
  const engine = new OutcomeReviewEngine(() => 'review-2');
  const claimed = engine.claim({ record: pending(engine), policy, currentStateVersion: 4, now: t0, workerId: 'worker-a', claimKey: 'claim-a' });
  const result = engine.complete({ record: claimed.record, policy, currentStateVersion: 4, now: new Date('2026-09-22T01:00:20.000Z'), workerId: 'worker-a', evidence: [evidence('SENDER_PERSISTED'), evidence('DOMAIN_FACT_SATISFIED')] });
  assert.equal(result.status, 'completed');
  assert.equal(result.record.resolutionStatus, 'resolved');
  assert.equal(result.record.decision, 'RESOLVED');
});

test('no evidence before window end reschedules review and after window becomes unknown', () => {
  const engine = new OutcomeReviewEngine(() => 'review-3');
  const first = engine.claim({ record: pending(engine), policy, currentStateVersion: 4, now: t0, workerId: 'worker-a', claimKey: 'claim-a' });
  const pendingResult = engine.complete({ record: first.record, policy, currentStateVersion: 4, now: new Date('2026-09-22T01:00:20.000Z'), workerId: 'worker-a', evidence: [] });
  assert.equal(pendingResult.status, 'retry_scheduled');
  assert.equal(pendingResult.record.resolutionStatus, 'review_pending');
  const secondClaim = engine.claim({ record: pendingResult.record, policy, currentStateVersion: 4, now: new Date('2026-09-22T01:01:10.000Z'), workerId: 'worker-b', claimKey: 'claim-b' });
  const unknown = engine.complete({ record: secondClaim.record, policy, currentStateVersion: 4, now: new Date('2026-09-22T01:02:00.000Z'), workerId: 'worker-b', evidence: [] });
  assert.equal(unknown.record.resolutionStatus, 'unknown');
});

test('retry backoff dead-letters after max attempts', () => {
  const engine = new OutcomeReviewEngine(() => 'review-4');
  const record = pending(engine);
  const retry = engine.retry({ record: { ...record, attempt: 2, resolutionStatus: 'review_pending' }, policy, currentStateVersion: 4, now: t0, evidence: [] });
  assert.equal(retry.status, 'dead_lettered');
  assert.equal(retry.record.resolutionStatus, 'review_failed');
  assert.ok(retry.record.deadLetteredAt);
});

test('CAS conflict prevents review completion from overwriting newer state', () => {
  const engine = new OutcomeReviewEngine(() => 'review-5');
  const claimed = engine.claim({ record: pending(engine), policy, currentStateVersion: 4, now: t0, workerId: 'worker-a', claimKey: 'claim-a' });
  const result = engine.complete({ record: claimed.record, policy, currentStateVersion: 5, now: new Date('2026-09-22T01:00:20.000Z'), workerId: 'worker-a', evidence: [evidence('DOMAIN_FACT_SATISFIED')] });
  assert.equal(result.status, 'cas_conflict');
  assert.equal(result.reasonCode, 'STATE_VERSION_CONFLICT');
});

test('resolved result closes only after reopen window and negative evidence reopens it', () => {
  const engine = new OutcomeReviewEngine(() => 'review-6');
  const resolved = { ...pending(engine), resolutionStatus: 'resolved' as const, resolvedAt: '2026-09-22T01:00:00.000Z', decision: 'RESOLVED' as const };
  const tooSoon = engine.close({ record: resolved, policy, currentStateVersion: 4, now: new Date('2026-09-22T01:01:00.000Z') });
  assert.equal(tooSoon.reasonCode, 'REOPEN_WINDOW_OPEN');
  const closed = engine.close({ record: resolved, policy, currentStateVersion: 4, now: new Date('2026-09-22T01:03:00.000Z') });
  assert.equal(closed.record.resolutionStatus, 'closed');
  const reopened = engine.reopen({ record: resolved, policy, currentStateVersion: 4, now: new Date('2026-09-22T01:00:30.000Z'), evidence: [evidence('BUYER_DENIED', '2026-09-22T01:00:20.000Z')] });
  assert.equal(reopened.record.resolutionStatus, 'needs_followup');
});

test('missing policy and expired lease fail closed', () => {
  const engine = new OutcomeReviewEngine();
  assert.throws(() => engine.createPending({ accountId: 'account-1', conversationId: 'conversation-1', runId: 'run-1', goalId: 'goal-1', stateId: 'state-1', expectedStateVersion: 0, policy: undefined, now: t0, idempotencyKey: 'key' }), (error: unknown) => error instanceof OutcomeReviewError && error.code === 'OUTCOME_POLICY_UNAVAILABLE');
});
