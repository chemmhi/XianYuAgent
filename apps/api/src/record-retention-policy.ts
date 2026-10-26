import { createHash } from 'node:crypto';
import type { AuditEventRecord } from './domain.js';

export const RECORD_RETENTION_DAYS = 3;
const HOUR_MS = 60 * 60 * 1000;
const ROUTINE_ACTIONS = new Set([
  'product.automation.trigger.payment_paid',
  'product.automation.trigger.unpaid_reprice',
  'product.automation.trigger.review_gift',
  'product.automation.trigger.review_reminder',
]);

// Only repeated no-op outcomes are summaries. Unknown, successful, failed and
// manual-review outcomes, and all financial/security mutations remain detailed.
export function isRoutineAudit(action: string, payload: unknown): boolean {
  return ROUTINE_ACTIONS.has(action) && !!payload && typeof payload === 'object'
    && 'status' in payload && payload.status === 'skipped';
}

export function auditDedupeKey(event: AuditEventRecord, routine = false): string | null {
  if (!routine || event.actorType !== 'system' || !ROUTINE_ACTIONS.has(event.action)) return null;
  return hourlyKey(event.createdAt, [event.actorType, event.actorId ?? null, event.accountId ?? null,
    event.action, event.targetRef ?? null, event.payloadDigest, event.reason ?? null]);
}

export function quarantineDedupeKey(input: { accountId: string; reasonCode: string; payloadDigest: string }, now: string): string | null {
  return input.reasonCode === 'PUSH_SYSTEM_CONTENT_IGNORED'
    ? hourlyKey(now, [input.accountId, input.reasonCode, input.payloadDigest]) : null;
}

function hourlyKey(now: string, identity: unknown[]): string {
  const millis = Date.parse(now);
  if (!Number.isFinite(millis)) throw new Error('RECORD_TIMESTAMP_INVALID');
  return createHash('sha256').update(JSON.stringify([Math.floor(millis / HOUR_MS), ...identity])).digest('hex');
}

export function retentionCutoff(now: string): string {
  const millis = Date.parse(now);
  if (!Number.isFinite(millis)) throw new Error('RECORD_RETENTION_TIME_INVALID');
  return new Date(millis - RECORD_RETENTION_DAYS * 24 * HOUR_MS).toISOString();
}

export function cleanupBatchLimit(requested = 10_000): number {
  return Number.isFinite(requested) ? Math.max(1, Math.min(50_000, Math.trunc(requested))) : 10_000;
}
