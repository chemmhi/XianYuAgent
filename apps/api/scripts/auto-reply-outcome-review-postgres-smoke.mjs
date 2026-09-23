import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { PostgresStore } from '../dist/store-postgres.js';
import { hashPassword } from '../dist/security.js';
import { AutoReplyRepairRepository } from '../dist/auto-reply-repair-repository.js';
import { OutcomeReviewWorker } from '../dist/auto-reply-outcome-review-worker.js';

const databaseUrl = process.env.DATABASE_URL ?? 'postgres://xianyu:xianyu_dev_only@127.0.0.1:5432/xianyu_agent';
const suffix = `${process.pid}-${Date.now()}`;
const ids = { accountId: undefined, adminId: undefined, conversationId: crypto.randomUUID(), stateId: crypto.randomUUID(), reviewId: crypto.randomUUID(), runId: crypto.randomUUID(), goalId: crypto.randomUUID() };
const policy = { policyVersion: 'outcome-worker-postgres-smoke-v1', leaseSeconds: 60, maxAttempts: 2, backoffSeconds: [1, 2], reopenWindowSeconds: 30, evidenceWindowSeconds: 60, closeRequiresWindow: true, resolvingEvidencePriority: ['DOMAIN_FACT_SATISFIED', 'BUYER_CONFIRMED', 'HUMAN_OVERRIDE'], reopenEvidenceTypes: ['BUYER_DENIED', 'REPEAT_QUESTION'] };
const state = { stateId: ids.stateId, accountId: '', conversationId: ids.conversationId, stateVersion: 1, goalStatus: 'active', pendingQuestions: [], clarificationRound: 0, awaitingUser: false, transitionAt: '2026-09-23T00:00:00.000Z', lastSourceSequence: 1, processedEventIds: [], processedIdempotencyKeys: [] };
const review = { reviewId: ids.reviewId, accountId: '', conversationId: ids.conversationId, runId: ids.runId, goalId: ids.goalId, stateId: ids.stateId, reviewType: 'OUTCOME', resolutionStatus: 'review_pending', reasonCodes: [], evidenceRefs: [], evidenceTypes: [], evidenceWindowStart: '2026-09-23T00:00:00.000Z', evidenceWindowEnd: '2026-09-23T00:01:00.000Z', reviewerSource: 'OUTCOME_WORKER', attempt: 0, idempotencyKey: `outcome:postgres:${suffix}`, expectedStateVersion: 1 };
const event = { eventId: crypto.randomUUID(), reviewId: ids.reviewId, accountId: '', conversationId: ids.conversationId, eventType: 'seed', sourceEventId: `review:${ids.reviewId}`, sourceSequence: 1, stateVersion: 1, policyVersion: policy.policyVersion, idempotencyKey: `seed:${suffix}`, occurredAt: '2026-09-23T00:00:00.000Z', payload: {} };

const store = new PostgresStore(databaseUrl);
const repository = new AutoReplyRepairRepository(store);
try {
  const admin = await store.createAdmin({ email: `outcome-worker-pg-${suffix}@example.com`, passwordHash: await hashPassword('password-123'), displayName: 'Outcome Review Worker PostgreSQL Smoke' });
  ids.adminId = admin.id;
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: `outcome-worker-pg-${suffix}` });
  ids.accountId = account.id;
  state.accountId = account.id;
  review.accountId = account.id;
  event.accountId = account.id;
  assert.equal(await repository.saveConversationState(state, 0), true);
  assert.equal(await repository.insertReview(review), true);
  assert.equal(await repository.insertReviewEvent(event), true);

  const worker = new OutcomeReviewWorker(repository, { workerId: `pg-worker-${suffix}`, policyProvider: () => policy, evidenceProvider: async () => [{ evidenceId: `fact:${suffix}`, type: 'DOMAIN_FACT_SATISFIED', observedAt: '2026-09-23T00:00:10.000Z', sourceEventId: `fact:${suffix}`, summary: 'postgres smoke fact', authoritative: true }] });
  const result = await worker.pollOnce();
  assert.deepEqual(result, { claimed: 1, completed: 1, retried: 0, failed: 0, skipped: 0 });
  const stored = await repository.getReview(ids.reviewId);
  assert.equal(stored?.resolutionStatus, 'resolved');
  assert.equal(stored?.decision, 'RESOLVED');
  const closed = await worker.close({ record: stored, policy, now: new Date(Date.parse(stored.resolvedAt) + 31_000) });
  assert.equal(closed, 'updated');
  assert.equal((await repository.getReview(ids.reviewId))?.resolutionStatus, 'closed');
  assert.equal((await repository.listReviewEvents(account.id, ids.conversationId)).length, 4);
  console.log(JSON.stringify({ outcomeReviewPostgres: true, resolutionStatus: 'closed', eventCount: 4 }));
} finally {
  if (ids.accountId) {
    await store.pool.query('delete from auto_reply_review_events where account_id=$1', [ids.accountId]);
    await store.pool.query('delete from auto_reply_review_records where account_id=$1', [ids.accountId]);
    await store.pool.query('delete from auto_reply_conversation_state where account_id=$1', [ids.accountId]);
    await store.pool.query('delete from auth.account_scopes where account_id=$1', [ids.accountId]);
    await store.pool.query('delete from accounts.accounts where id=$1', [ids.accountId]);
  }
  if (ids.adminId) {
    await store.pool.query('delete from auth.sessions where admin_id=$1', [ids.adminId]);
    await store.pool.query('delete from auth.admins where id=$1', [ids.adminId]);
  }
  await store.close();
}
