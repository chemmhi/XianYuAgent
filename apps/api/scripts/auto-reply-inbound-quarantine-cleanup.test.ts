import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import type { InboundQuarantineRecord, Store } from '../src/domain.js';
import { InboundQuarantineCleanupWorker } from '../src/inbound-quarantine-cleanup-worker.js';
import { MemoryStore } from '../src/store-memory.js';

test('quarantine cleanup worker computes the retention cutoff and deletes one bounded batch', async () => {
  const calls: Array<{ createdBefore: string; limit?: number }> = [];
  const store = {
    cleanupInboundQuarantine: async (input: { createdBefore: string; limit?: number }) => {
      calls.push(input);
      return 17;
    },
  } as unknown as Store;
  const worker = new InboundQuarantineCleanupWorker(store, { retentionDays: 7, batchSize: 250 });
  const result = await worker.pollOnce('2026-10-09T00:00:00.000Z');
  assert.deepEqual(result, { deleted: 17, cutoff: '2026-10-02T00:00:00.000Z' });
  assert.deepEqual(calls, [{ createdBefore: '2026-10-02T00:00:00.000Z', limit: 250 }]);
});

test('disabled quarantine cleanup worker does not touch the store', async () => {
  let called = false;
  const store = { cleanupInboundQuarantine: async () => { called = true; return 1; } } as unknown as Store;
  const worker = new InboundQuarantineCleanupWorker(store, { enabled: false });
  assert.deepEqual(await worker.pollOnce('2026-10-09T00:00:00.000Z'), { deleted: 0, cutoff: '2026-10-09T00:00:00.000Z' });
  assert.equal(called, false);
});

test('MemoryStore cleanup is cutoff-exclusive, bounded, and stable for equal timestamps', async () => {
  const store = new MemoryStore();
  const records = (store as unknown as { inboundQuarantine: Map<string, InboundQuarantineRecord> }).inboundQuarantine;
  const createdAt = '2026-10-01T00:00:00.000Z';
  records.set('b', { id: 'b', accountId: 'account', reasonCode: 'TEST', payloadDigest: 'b', payloadSize: 1, receivedAt: createdAt, createdAt });
  records.set('a', { id: 'a', accountId: 'account', reasonCode: 'TEST', payloadDigest: 'a', payloadSize: 1, receivedAt: createdAt, createdAt });
  records.set('boundary', { id: 'boundary', accountId: 'account', reasonCode: 'TEST', payloadDigest: 'boundary', payloadSize: 1, receivedAt: '2026-10-02T00:00:00.000Z', createdAt: '2026-10-02T00:00:00.000Z' });

  assert.equal(await store.cleanupInboundQuarantine({ createdBefore: '2026-10-02T00:00:00.000Z', limit: 1 }), 1);
  assert.equal(records.has('a'), false);
  assert.equal(records.has('b'), true);
  assert.equal(records.has('boundary'), true);
});

test('quarantine retention migration creates the index online and tunes vacuum cadence', async () => {
  const indexSql = await readFile(new URL('../migrations/051_auto_reply_quarantine_retention.sql', import.meta.url), 'utf8');
  const vacuumSql = await readFile(new URL('../migrations/052_auto_reply_quarantine_autovacuum.sql', import.meta.url), 'utf8');
  const storeSql = await readFile(new URL('../src/store-postgres.ts', import.meta.url), 'utf8');
  const migrateSql = await readFile(new URL('./migrate.mjs', import.meta.url), 'utf8');
  assert.match(indexSql, /CREATE INDEX CONCURRENTLY IF NOT EXISTS/);
  assert.match(vacuumSql, /autovacuum_vacuum_scale_factor\s*=\s*0\.02/);
  assert.match(storeSql, /for update skip locked/i);
  assert.match(migrateSql, /drop index concurrently if exists messages\.auto_reply_inbound_quarantine_created_idx/i);
});
