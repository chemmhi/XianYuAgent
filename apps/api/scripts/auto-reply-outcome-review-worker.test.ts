import assert from 'node:assert/strict';
import test from 'node:test';
import { OutcomeReviewWorker } from '../src/auto-reply-outcome-review-worker.js';
import type { OutcomeEvidence, OutcomeReviewPolicy } from '../src/auto-reply-outcome-review.js';
import { AutoReplyRepairRepository, type PersistedRepairReviewEvent, type PersistedRepairReviewRecord } from '../src/auto-reply-repair-repository.js';
import { MemoryStore } from '../src/store-memory.js';
import type { ConversationState } from '../src/domain.js';

const policy: OutcomeReviewPolicy = {
  policyVersion: 'outcome-worker-test-v1',
  leaseSeconds: 60,
  maxAttempts: 2,
  backoffSeconds: [1, 2],
  reopenWindowSeconds: 30,
  evidenceWindowSeconds: 60,
  closeRequiresWindow: true,
  resolvingEvidencePriority: ['DOMAIN_FACT_SATISFIED', 'BUYER_CONFIRMED', 'HUMAN_OVERRIDE'],
  reopenEvidenceTypes: ['BUYER_DENIED', 'REPEAT_QUESTION'],
};

function state(): ConversationState {
  return { stateId: '11111111-1111-4111-8111-111111111111', accountId: '22222222-2222-4222-8222-222222222222', conversationId: '33333333-3333-4333-8333-333333333333', stateVersion: 1, goalStatus: 'active', pendingQuestions: [], clarificationRound: 0, awaitingUser: false, transitionAt: '2026-09-23T00:00:00.000Z', lastSourceSequence: 1, processedEventIds: [], processedIdempotencyKeys: [] };
}

function review(overrides: Partial<PersistedRepairReviewRecord> = {}): PersistedRepairReviewRecord {
  return {
    reviewId: '44444444-4444-4444-8444-444444444444', accountId: state().accountId, conversationId: state().conversationId, runId: '55555555-5555-4555-8555-555555555555', goalId: '66666666-6666-4666-8666-666666666666', stateId: state().stateId, reviewType: 'OUTCOME', resolutionStatus: 'review_pending', reasonCodes: [], evidenceRefs: [], evidenceTypes: [], evidenceWindowStart: '2026-09-23T00:00:00.000Z', evidenceWindowEnd: '2026-09-23T00:01:00.000Z', reviewerSource: 'OUTCOME_WORKER', attempt: 0, idempotencyKey: 'outcome:worker-test', expectedStateVersion: 1, ...overrides,
  };
}

function event(record: PersistedRepairReviewRecord, suffix: string): PersistedRepairReviewEvent {
  return { eventId: `77777777-7777-4777-8777-77777777777${suffix}`, reviewId: record.reviewId, accountId: record.accountId, conversationId: record.conversationId, eventType: 'seed', sourceEventId: `source:${record.reviewId}`, sourceSequence: 1, stateVersion: record.expectedStateVersion, policyVersion: policy.policyVersion, idempotencyKey: `${record.idempotencyKey}:${suffix}`, occurredAt: '2026-09-23T00:00:00.000Z', payload: {} };
}

async function fixture(record = review()) {
  const store = new MemoryStore();
  const repository = new AutoReplyRepairRepository(store);
  await repository.saveConversationState(state(), 0);
  await repository.insertReview(record);
  await repository.insertReviewEvent(event(record, 'seed'));
  return { store, repository, record };
}

test('Outcome Review worker claims and persists a resolving result atomically', async () => {
  const { repository, record } = await fixture();
  const worker = new OutcomeReviewWorker(repository, { workerId: 'worker-a', policyProvider: () => policy, evidenceProvider: async () => [{ evidenceId: 'evidence-1', type: 'DOMAIN_FACT_SATISFIED', observedAt: '2026-09-23T00:00:10.000Z', sourceEventId: 'fact-1', summary: 'fact satisfied', authoritative: true }] });
  const result = await worker.pollOnce();
  assert.deepEqual(result, { claimed: 1, completed: 1, retried: 0, failed: 0, skipped: 0 });
  const stored = await repository.getReview(record.reviewId);
  assert.equal(stored?.resolutionStatus, 'resolved');
  assert.equal(stored?.decision, 'RESOLVED');
  assert.deepEqual(stored?.evidenceTypes, ['DOMAIN_FACT_SATISFIED']);
  assert.equal((await repository.listReviewEvents(record.accountId, record.conversationId)).length, 3);
});

test('active lease fences a second worker and heartbeat extends only the owner lease', async () => {
  const { repository, record } = await fixture();
  const claimed = await repository.claimOutcomeReview({ reviewId: record.reviewId, workerId: 'worker-a', claimKey: 'claim-a', leaseSeconds: 60, expectedStateVersion: 1, now: '2026-09-23T00:00:01.000Z', event: event(record, 'claim') });
  assert.equal(claimed.status, 'updated');
  const rejected = await repository.claimOutcomeReview({ reviewId: record.reviewId, workerId: 'worker-b', claimKey: 'claim-b', leaseSeconds: 60, expectedStateVersion: 1, now: '2026-09-23T00:00:02.000Z', event: event(record, 'claim-b') });
  assert.equal(rejected.status, 'lease_lost');
  assert.equal(await repository.heartbeatOutcomeReview({ reviewId: record.reviewId, workerId: 'worker-b', claimKey: 'claim-a', leaseSeconds: 60, now: '2026-09-23T00:00:03.000Z' }), false);
  assert.equal(await repository.heartbeatOutcomeReview({ reviewId: record.reviewId, workerId: 'worker-a', claimKey: 'claim-a', leaseSeconds: 60, now: '2026-09-23T00:00:03.000Z' }), true);
});

test('worker retries and dead-letters after the configured attempt budget', async () => {
  const { repository, record } = await fixture();
  const worker = new OutcomeReviewWorker(repository, { workerId: 'worker-a', policyProvider: () => ({ ...policy, maxAttempts: 1 }), evidenceProvider: async () => { throw Object.assign(new Error('evidence timeout'), { code: 'EVIDENCE_TIMEOUT' }); } });
  const result = await worker.pollOnce();
  assert.equal(result.claimed, 1);
  assert.equal(result.failed, 1);
  const stored = await repository.getReview(record.reviewId);
  assert.equal(stored?.resolutionStatus, 'review_failed');
  assert.equal(stored?.decision, 'FAILED');
  assert.ok(stored?.deadLetteredAt);
});

test('close and reopen are persisted through the same CAS/idempotent mutation path', async () => {
  const resolved = review({ resolutionStatus: 'resolved', decision: 'RESOLVED', reviewedAt: '2026-09-23T00:00:10.000Z', resolvedAt: '2026-09-23T00:00:10.000Z', evidenceRefs: ['evidence-1'], evidenceTypes: ['DOMAIN_FACT_SATISFIED'] });
  const { repository } = await fixture(resolved);
  const worker = new OutcomeReviewWorker(repository, { workerId: 'worker-a', policyProvider: () => policy });
  const earlyClose = await worker.close({ record: resolved, policy, now: new Date('2026-09-23T00:00:20.000Z') });
  assert.equal(earlyClose, 'rejected');
  assert.equal((await repository.getReview(resolved.reviewId))?.resolutionStatus, 'resolved');
  const closed = await worker.close({ record: resolved, policy, now: new Date('2026-09-23T00:01:00.000Z') });
  assert.equal(closed, 'updated');
  assert.equal((await repository.getReview(resolved.reviewId))?.resolutionStatus, 'closed');

  const reopened = review({ reviewId: '88888888-8888-4888-8888-888888888888', idempotencyKey: 'outcome:worker-test:reopen', resolutionStatus: 'resolved', decision: 'RESOLVED', reviewedAt: '2026-09-23T00:00:10.000Z', resolvedAt: '2026-09-23T00:00:10.000Z', evidenceRefs: ['evidence-1'], evidenceTypes: ['DOMAIN_FACT_SATISFIED'] });
  await repository.insertReview(reopened);
  const result = await worker.reopen({ record: reopened, policy, evidence: [{ evidenceId: 'negative-1', type: 'BUYER_DENIED', observedAt: '2026-09-23T00:00:20.000Z', sourceEventId: 'buyer-1', summary: 'buyer denied' }], now: new Date('2026-09-23T00:00:30.000Z') });
  assert.equal(result, 'updated');
  assert.equal((await repository.getReview(reopened.reviewId))?.resolutionStatus, 'needs_followup');
});

test('worker start and stop run scheduled polls without leaving a live timer', async () => {
  const { repository } = await fixture();
  let evidenceCalls = 0;
  const worker = new OutcomeReviewWorker(repository, {
    workerId: 'worker-scheduler',
    pollMs: 50,
    policyProvider: () => policy,
    evidenceProvider: async () => {
      evidenceCalls += 1;
      return [{ evidenceId: `evidence-${evidenceCalls}`, type: 'DOMAIN_FACT_SATISFIED', observedAt: '2026-09-23T00:00:10.000Z', sourceEventId: 'fact-1', summary: 'fact satisfied', authoritative: true }];
    },
  });
  worker.start();
  await new Promise((resolve) => setTimeout(resolve, 80));
  await worker.stop();
  assert.ok(evidenceCalls >= 1);
});
