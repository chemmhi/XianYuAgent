import type { Pool } from 'pg';
import type { AuditEventRecord, InboundQuarantineRecord } from './domain.js';
import { auditDedupeKey, cleanupBatchLimit, quarantineDedupeKey } from './record-retention-policy.js';

export async function writeAuditEvent(pool: Pool, event: AuditEventRecord, routine = false): Promise<void> {
  await pool.query(`insert into observability.audit_events
    (id,actor_type,actor_id,action,target_ref,request_id,trace_id,payload_digest,account_id,reason,created_at,dedupe_key,last_seen_at)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$11)
    on conflict (dedupe_key) where dedupe_key is not null do update
      set occurrence_count=audit_events.occurrence_count+1,
          last_seen_at=greatest(audit_events.last_seen_at,excluded.last_seen_at)`,
  [event.id, event.actorType, event.actorId ?? null, event.action, event.targetRef ?? null, event.requestId,
    event.traceId, event.payloadDigest, event.accountId ?? null, event.reason ?? null, event.createdAt, auditDedupeKey(event, routine)]);
}

export async function writeInboundQuarantine(pool: Pool, input: {
  accountId: string; reasonCode: string; payloadDigest: string; payloadPreview?: string; payloadSize: number; receivedAt?: string;
}): Promise<InboundQuarantineRecord> {
  const now = new Date().toISOString();
  const result = await pool.query(`insert into messages.auto_reply_inbound_quarantine
    (account_id,reason_code,payload_digest,payload_preview,payload_size,received_at,created_at,dedupe_key,last_seen_at)
    values ($1,$2,$3,$4,$5,coalesce($6::timestamptz,$7::timestamptz),$7,$8,$7)
    on conflict (dedupe_key) where dedupe_key is not null do update
      set occurrence_count=auto_reply_inbound_quarantine.occurrence_count+1,
          last_seen_at=greatest(auto_reply_inbound_quarantine.last_seen_at,excluded.last_seen_at)
    returning *`, [input.accountId, input.reasonCode, input.payloadDigest, input.payloadPreview?.slice(0, 500) ?? null,
    Math.max(0, Math.trunc(input.payloadSize)), input.receivedAt ?? null, now, quarantineDedupeKey(input, now)]);
  const row = result.rows[0];
  return { id: row.id, accountId: row.account_id, reasonCode: row.reason_code, payloadDigest: row.payload_digest,
    payloadPreview: row.payload_preview ?? undefined, payloadSize: Number(row.payload_size),
    receivedAt: row.received_at.toISOString(), createdAt: row.created_at.toISOString(),
    resolvedAt: row.resolved_at?.toISOString(), occurrenceCount: Number(row.occurrence_count), lastSeenAt: row.last_seen_at?.toISOString() };
}

export async function cleanupRecordTable(pool: Pool, table: 'observability.audit_events' | 'messages.auto_reply_inbound_quarantine', input: {
  createdBefore: string; limit?: number;
}): Promise<number> {
  if (!Number.isFinite(Date.parse(input.createdBefore))) throw new Error('RECORD_RETENTION_TIME_INVALID');
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query("set local statement_timeout='15s'");
    await client.query("set local lock_timeout='2s'");
    const result = await client.query(`with victims as (
      select id from ${table} where created_at < $1::timestamptz
      order by created_at,id for update skip locked limit $2
    ) delete from ${table} records using victims where records.id=victims.id`,
    [input.createdBefore, cleanupBatchLimit(input.limit)]);
    await client.query('commit');
    return result.rowCount ?? 0;
  } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
}
