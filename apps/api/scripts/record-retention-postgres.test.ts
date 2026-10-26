import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { PostgresStore } from '../src/store-postgres.js';
import { RecordRetentionWorker } from '../src/record-retention-worker.js';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { retentionCutoff } from '../src/record-retention-policy.js';
import type { AuditEventRecord } from '../src/domain.js';

const run = promisify(execFile);
const databaseUrl = process.env.RECORD_RETENTION_TEST_DATABASE_URL;
assert.ok(databaseUrl, 'RECORD_RETENTION_TEST_DATABASE_URL must name an isolated test database');
assert.match(new URL(databaseUrl).pathname, /^\/xianyu_retention_test[_a-z0-9]*$/);
const store = new PostgresStore(databaseUrl);
let accountId: string;
let actorId: string;
const audit = (patch: Partial<AuditEventRecord> = {}): AuditEventRecord => ({ id: crypto.randomUUID(), actorType: 'system', actorId,
  accountId, action: 'product.automation.trigger.payment_paid', targetRef: 'order', requestId: crypto.randomUUID(),
  traceId: crypto.randomUUID(), payloadDigest: 'skipped-digest', createdAt: '2026-10-27T01:00:00.000Z', ...patch });

before(async () => {
  for (let repeat = 0; repeat < 2; repeat++) await run(process.execPath, ['scripts/migrate.mjs'], {
    cwd: new URL('../', import.meta.url), env: { ...process.env, DATABASE_URL: databaseUrl }, maxBuffer: 2_000_000,
  });
  // The database-name guard above makes this an explicitly disposable test DB.
  // Remove fixtures left by an interrupted previous run before count assertions.
  await store.pool.query('truncate observability.audit_events, messages.auto_reply_inbound_quarantine');
  const admin = await store.createAdmin({ email: `retention-${crypto.randomUUID()}@example.com`, passwordHash: 'test', displayName: 'Retention' });
  actorId = admin.id;
  accountId = (await store.createAccount({ adminId: actorId, platform: 'xianyu', sellerRef: crypto.randomUUID() })).id;
});
after(async () => { await store.close(); });

test('Postgres concurrently aggregates only routine events and system messages; critical events remain individual', async () => {
  await Promise.all(Array.from({ length: 24 }, () => store.recordAudit(audit(), { routine: true })));
  const aggregate = await store.pool.query('select occurrence_count,created_at,last_seen_at from observability.audit_events where account_id=$1', [accountId]);
  assert.equal(aggregate.rows.length, 1);
  assert.equal(Number(aggregate.rows[0].occurrence_count), 24);
  assert.equal(aggregate.rows[0].created_at.toISOString(), '2026-10-27T01:00:00.000Z');
  await Promise.all(Array.from({ length: 4 }, () => store.recordAudit(audit({ action: 'delivery.partial_recovery_verified' }), { routine: true })));
  assert.equal((await store.pool.query("select count(*)::int count from observability.audit_events where action='delivery.partial_recovery_verified' and account_id=$1", [accountId])).rows[0].count, 4);
  const input = { accountId, reasonCode: 'PUSH_SYSTEM_CONTENT_IGNORED', payloadDigest: 'replayed', payloadSize: 1 };
  const rows = await Promise.all(Array.from({ length: 24 }, () => store.recordInboundQuarantine(input)));
  assert.equal(new Set(rows.map(row => row.id)).size, 1);
  const row = await store.pool.query('select occurrence_count from messages.auto_reply_inbound_quarantine where id=$1', [rows[0]!.id]);
  assert.equal(Number(row.rows[0].occurrence_count), 24);
  const errors = await Promise.all([1, 2].map(() => store.recordInboundQuarantine({ ...input, reasonCode: 'PUSH_PAYLOAD_DECODE_FAILED' })));
  assert.notEqual(errors[0]!.id, errors[1]!.id);
  const indexes = await store.pool.query("select c.relname,i.indisvalid from pg_index i join pg_class c on c.oid=i.indexrelid where c.relname in ('audit_events_created_idx','audit_events_dedupe_idx','auto_reply_inbound_quarantine_dedupe_idx')");
  assert.equal(indexes.rows.length, 3);
  assert.ok(indexes.rows.every(row => row.indisvalid));
});

test('real application assembly summarizes repeated skipped order triggers', async () => {
  const runtime = createApp(loadConfig({ NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '0', DATABASE_URL: databaseUrl,
    ALLOW_IN_MEMORY: 'false', XIANYU_QR_MODE: 'stub', AGENT_RUNTIME: 'in-process', AUTO_REPLY_MODEL_ENABLED: 'false' }));
  try {
    const product = await runtime.store.createProduct({ adminId: actorId, accountId, title: 'No-op product' });
    const order = await runtime.store.createOrder({ adminId: actorId, order: { orderNo: crypto.randomUUID(), accountId,
      productId: product.id, itemId: 'test-item', itemTitle: 'No-op product', buyerId: 'buyer', buyerName: 'Buyer', amountMinor: 100, paymentStatus: 'paid', orderStatus: 'open',
      deliveryStatus: 'pending', afterSalesStatus: 'none', deliveryType: 'coupon_only' } });
    // A disabled rule resolves to skipped without contacting the external platform.
    for (let repeat = 0; repeat < 3; repeat++) {
      const result = await runtime.productAutomationTrigger.onOrderRefresh({ adminId: actorId, accountId, items: [order], requestId: crypto.randomUUID(), traceId: crypto.randomUUID() });
      assert.equal(result.results[0]!.status, 'skipped');
    }
    const result = await store.pool.query('select occurrence_count,dedupe_key from observability.audit_events where account_id=$1 and target_ref=$2', [accountId, order.orderNo]);
    assert.equal(result.rows.length, 1);
    assert.equal(Number(result.rows[0].occurrence_count), 3);
    assert.ok(result.rows[0].dedupe_key);
  } finally { await runtime.close(); }
});

test('retention worker skips locked rows, preserves the boundary, and retries them after unlock', async () => {
  const now = '2026-10-27T01:00:00.000Z';
  const cutoff = retentionCutoff(now);
  const old = audit({ createdAt: '2026-10-24T00:59:59.999Z', action: 'auth.critical' });
  const boundary = audit({ createdAt: cutoff, action: 'auth.critical' });
  await store.recordAudit(old);
  await store.recordAudit(boundary);
  const quarantine = await store.recordInboundQuarantine({ accountId, reasonCode: 'TEST', payloadDigest: 'old', payloadSize: 1 });
  await store.pool.query('update messages.auto_reply_inbound_quarantine set created_at=$2 where id=$1', [quarantine.id, old.createdAt]);
  const lock = await store.pool.connect();
  try {
    await lock.query('begin');
    await lock.query('select 1 from observability.audit_events where id=$1 for update', [old.id]);
    const worker = new RecordRetentionWorker(store, { batchSize: 1, maxBatches: 10 });
    assert.equal((await worker.pollOnce(now)).quarantineDeleted, 1);
    assert.equal((await store.pool.query('select count(*)::int count from observability.audit_events where id=$1', [old.id])).rows[0].count, 1);
    await lock.query('commit');
    assert.equal((await worker.pollOnce(now)).auditDeleted, 1);
    assert.equal((await store.pool.query('select count(*)::int count from observability.audit_events where id=$1', [boundary.id])).rows[0].count, 1);
  } finally { await lock.query('rollback'); lock.release(); }
});

test('maintenance CLI dry-run is read-only, apply removes expired rows in both tables, and reruns are idempotent', async () => {
  const old = new Date(Date.now() - 4 * 86400_000).toISOString();
  const event = audit({ createdAt: old, action: 'auth.critical' });
  await store.recordAudit(event);
  const quarantine = await store.recordInboundQuarantine({ accountId, reasonCode: 'TEST', payloadDigest: 'cli', payloadSize: 1 });
  await store.pool.query('update messages.auto_reply_inbound_quarantine set created_at=$2 where id=$1', [quarantine.id, old]);
  const invoke = (args: string[]) => run(process.execPath, ['scripts/cleanup-retained-records.mjs', ...args], {
    cwd: new URL('../', import.meta.url), env: { ...process.env, DATABASE_URL: databaseUrl }, maxBuffer: 2_000_000,
  });
  assert.match((await invoke([])).stdout, /"apply":false/);
  assert.equal((await store.pool.query('select count(*)::int count from observability.audit_events where id=$1', [event.id])).rows[0].count, 1);
  assert.match((await invoke(['--apply'])).stdout, /"expiredRemaining":"0"/);
  for (const table of ['observability.audit_events', 'messages.auto_reply_inbound_quarantine']) {
    assert.equal((await store.pool.query(`select count(*)::int count from ${table} where created_at<$1`, [retentionCutoff(new Date().toISOString())])).rows[0].count, 0);
  }
  assert.match((await invoke(['--apply'])).stdout, /"deleted":0/);
});

test('production worker entrypoint automatically purges both tables with legacy seven-day environment ignored', async () => {
  const old = new Date(Date.now() - 4 * 86400_000).toISOString();
  const event = audit({ createdAt: old, action: 'auth.critical' });
  await store.recordAudit(event);
  const quarantine = await store.recordInboundQuarantine({ accountId, reasonCode: 'TEST', payloadDigest: 'worker-entry', payloadSize: 1 });
  await store.pool.query('update messages.auto_reply_inbound_quarantine set created_at=$2 where id=$1', [quarantine.id, old]);
  const child = spawn(process.execPath, ['dist/worker.js'], { cwd: new URL('../', import.meta.url),
    env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: databaseUrl, REDIS_URL: '', ALLOW_IN_MEMORY: 'false',
      XIANYU_QR_MODE: 'stub', AGENT_RUNTIME: 'in-process', AUTO_REPLY_MODEL_ENABLED: 'false',
      XIANYU_IM_OWNER_SECRET: crypto.randomUUID(), XIANYU_IM_OWNER_URL: 'http://127.0.0.1:9',
      INBOUND_QUARANTINE_RETENTION_DAYS: '7', INBOUND_QUARANTINE_CLEANUP_ENABLED: 'false' },
    stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', chunk => { output = (output + chunk).slice(-30_000); });
  child.stderr.on('data', chunk => { output = (output + chunk).slice(-30_000); });
  const closed = new Promise<void>((resolve, reject) => { child.once('close', () => resolve()); child.once('error', reject); });
  try {
    let remaining = 2;
    const deadline = Date.now() + 15_000;
    while (remaining > 0 && Date.now() < deadline && child.exitCode === null) {
      const result = await store.pool.query(`select
        (select count(*) from observability.audit_events where id=$1)::int +
        (select count(*) from messages.auto_reply_inbound_quarantine where id=$2)::int as remaining`, [event.id, quarantine.id]);
      remaining = result.rows[0].remaining;
      if (remaining > 0) await new Promise(resolve => setTimeout(resolve, 30));
    }
    assert.equal(remaining, 0, output);
    assert.match(output, /recordRetentionDays=3/);
  } finally { child.kill('SIGTERM'); await closed; }
});
