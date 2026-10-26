import { PostgresStore } from '../dist/store-postgres.js';
import { retentionCutoff } from '../dist/record-retention-policy.js';

const args = process.argv.slice(2);
if (args.some(arg => arg !== '--apply')) throw new Error('Usage: node scripts/cleanup-retained-records.mjs [--apply]');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const store = new PostgresStore(process.env.DATABASE_URL);
const cutoff = retentionCutoff(new Date().toISOString());
const tables = [
  ['messages.auto_reply_inbound_quarantine', input => store.cleanupInboundQuarantine(input)],
  ['observability.audit_events', input => store.cleanupAuditEvents(input)],
];
try {
  // Refuse to purge until the business recovery evidence has been migrated.
  const evidence = await store.pool.query(`select 1 from orders.delivery_send_steps s
    where s.recovery_verified_at is null and s.status='succeeded' and s.step_key like '%:image:0'
    and exists(select 1 from observability.audit_events a
      where a.trace_id='delivery-recovery:' || s.order_no || ':' || s.external_ref
        and a.account_id=s.account_id and a.action='delivery.partial_recovery_verified') limit 1`);
  if (evidence.rows.length) throw new Error('DELIVERY_RECOVERY_BACKFILL_REQUIRED');
  for (const [table, remove] of tables) {
    const before = await store.pool.query(`select count(*)::text as expired from ${table} where created_at<$1`, [cutoff]);
    console.log(JSON.stringify({ table, cutoff, expired: before.rows[0].expired, apply: args.includes('--apply') }));
    if (!args.includes('--apply')) continue;
    let deleted = 0;
    for (;;) {
      const count = await remove({ createdBefore: cutoff, limit: 10_000 });
      deleted += count;
      if (deleted && deleted % 100_000 === 0) console.log(JSON.stringify({ table, deleted }));
      if (count === 0) break;
    }
    const remaining = await store.pool.query(`select count(*)::text as expired from ${table} where created_at<$1`, [cutoff]);
    console.log(JSON.stringify({ table, deleted, expiredRemaining: remaining.rows[0].expired }));
    if (remaining.rows[0].expired !== '0') throw new Error(`RECORD_CLEANUP_LOCKED_ROWS:${table}`);
    await store.pool.query(`vacuum (analyze) ${table}`);
  }
} finally { await store.close(); }
