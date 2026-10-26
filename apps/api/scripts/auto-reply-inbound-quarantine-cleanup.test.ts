import assert from 'node:assert/strict';
import test from 'node:test';
import { RecordRetentionWorker } from '../src/record-retention-worker.js';
import { auditDedupeKey, isRoutineAudit, quarantineDedupeKey, retentionCutoff } from '../src/record-retention-policy.js';
import { MemoryStore } from '../src/store-memory.js';
import type { AuditEventRecord, InboundQuarantineRecord } from '../src/domain.js';

const now = '2026-10-27T01:00:00.000Z';
const cutoff = '2026-10-24T01:00:00.000Z';
const audit = (patch: Partial<AuditEventRecord> = {}): AuditEventRecord => ({ id: crypto.randomUUID(), actorType: 'system',
  actorId: 'actor', accountId: 'account', action: 'product.automation.trigger.payment_paid', targetRef: 'order',
  requestId: 'request', traceId: 'trace', payloadDigest: 'skipped-digest', createdAt: now, ...patch });

test('retention is exactly 72 hours, including timezone boundaries and invalid inputs', () => {
  assert.equal(retentionCutoff(now), cutoff);
  assert.equal(retentionCutoff('2026-10-27T09:00:00+08:00'), cutoff);
  assert.throws(() => retentionCutoff('bad'), /TIME_INVALID/);
});

test('both tables drain multiple bounded batches and keep the exact cutoff boundary', async () => {
  const store = new MemoryStore();
  const quarantine = (store as unknown as { inboundQuarantine: Map<string, InboundQuarantineRecord> }).inboundQuarantine;
  for (const createdAt of ['2026-10-23T00:00:00Z', '2026-10-24T00:59:59.999Z', cutoff, now]) {
    const event = audit({ createdAt, action: 'delivery.partial_recovery_verified' });
    await store.recordAudit(event);
    quarantine.set(event.id, { id: event.id, accountId: 'account', reasonCode: 'TEST', payloadDigest: 'digest', payloadSize: 1, receivedAt: createdAt, createdAt });
  }
  const worker = new RecordRetentionWorker(store, { batchSize: 1, maxBatches: 5 });
  assert.deepEqual(await worker.pollOnce(now), { cutoff, quarantineDeleted: 2, auditDeleted: 2 });
  assert.deepEqual(store.audits.map(event => event.createdAt), [cutoff, now]);
  assert.deepEqual([...quarantine.values()].map(event => event.createdAt), [cutoff, now]);
  assert.equal((await worker.pollOnce(now)).auditDeleted, 0);
});

test('batch budget, overlapping polls and failures cannot starve the other table', async () => {
  let quarantineCalls = 0;
  let auditCalls = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const store = {
    cleanupInboundQuarantine: async () => { quarantineCalls++; await gate; return 2; },
    cleanupAuditEvents: async () => { auditCalls++; return 2; },
  };
  const worker = new RecordRetentionWorker(store, { batchSize: 2, maxBatches: 2 });
  const first = worker.pollOnce(now);
  const overlap = worker.pollOnce(now);
  release();
  assert.deepEqual(await first, await overlap);
  assert.equal(quarantineCalls, 2);
  assert.equal(auditCalls, 2);
  store.cleanupInboundQuarantine = async () => { throw new Error('database unavailable'); };
  await assert.rejects(worker.pollOnce(now), /RETENTION_FAILED/);
  assert.equal(auditCalls, 4);
  store.cleanupInboundQuarantine = async () => 0;
  assert.equal((await worker.pollOnce(now)).auditDeleted, 4, 'failed polls are retried');
});

test('disabled worker and invalid clock cause no storage effects; stop drains the current batch', async () => {
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const store = { cleanupInboundQuarantine: async () => { calls++; await gate; return 1; }, cleanupAuditEvents: async () => 0 };
  await new RecordRetentionWorker(store, { enabled: false }).pollOnce(now);
  const worker = new RecordRetentionWorker(store, { batchSize: 1 });
  await assert.rejects(worker.pollOnce('bad'), /TIME_INVALID/);
  assert.equal(calls, 0);
  const work = worker.pollOnce(now);
  const stopped = worker.stop();
  release();
  await Promise.all([work, stopped]);
  assert.equal(calls, 1);
});

test('only allowlisted skipped automation is routine; critical and unknown events stay detailed', async () => {
  const action = audit().action;
  assert.equal(isRoutineAudit(action, { status: 'skipped' }), true);
  for (const status of ['succeeded', 'failed', 'manual_review', 'unknown', 'blocked']) assert.equal(isRoutineAudit(action, { status }), false);
  for (const other of ['delivery.partial_recovery_verified', 'auth.invite.created', 'product.automation.coupon.sent', 'unknown']) {
    assert.equal(isRoutineAudit(other, { status: 'skipped' }), false);
    assert.equal(auditDedupeKey(audit({ action: other }), true), null);
  }
  assert.equal(auditDedupeKey(audit({ actorType: 'admin' }), true), null);
  const store = new MemoryStore();
  const event = audit();
  await store.recordAudit(event, { routine: true });
  await store.recordAudit({ ...event, id: crypto.randomUUID(), requestId: 'new', traceId: 'new', createdAt: '2026-10-27T01:59:00Z' }, { routine: true });
  assert.equal(store.audits.length, 1);
  assert.equal(store.audits[0]!.occurrenceCount, 2);
  assert.equal(store.audits[0]!.createdAt, now, 'dedupe never refreshes retention');
  await store.recordAudit(audit({ action: 'delivery.partial_recovery_verified' }));
  await store.recordAudit(audit({ action: 'delivery.partial_recovery_verified' }));
  assert.equal(store.audits.length, 3);
});

test('dedupe separates hour, tenant, actor, action, target, digest and reason', () => {
  const event = audit();
  const key = auditDedupeKey(event, true);
  for (const patch of [{ createdAt: '2026-10-27T02:00:00Z' }, { accountId: 'other' }, { actorId: 'other' },
    { action: 'product.automation.trigger.review_reminder' }, { targetRef: 'other' }, { payloadDigest: 'other' }, { reason: 'other' }]) {
    assert.notEqual(auditDedupeKey({ ...event, ...patch }, true), key);
  }
  assert.equal(quarantineDedupeKey({ accountId: 'account', reasonCode: 'PUSH_SENDER_REF_MISSING', payloadDigest: 'x' }, now), null);
});

test('ignored system messages aggregate counts; genuine parse exceptions remain individual', async () => {
  const store = new MemoryStore();
  const input = { accountId: 'account', reasonCode: 'PUSH_SYSTEM_CONTENT_IGNORED', payloadDigest: 'x', payloadSize: 1 };
  const first = await store.recordInboundQuarantine(input);
  const second = await store.recordInboundQuarantine(input);
  assert.equal(first.id, second.id);
  assert.equal(second.occurrenceCount, 2);
  assert.notEqual((await store.recordInboundQuarantine({ ...input, reasonCode: 'PUSH_PAYLOAD_DECODE_FAILED' })).id,
    (await store.recordInboundQuarantine({ ...input, reasonCode: 'PUSH_PAYLOAD_DECODE_FAILED' })).id);
});
