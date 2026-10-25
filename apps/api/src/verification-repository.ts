import type { Pool } from 'pg';
import type { VerificationSession } from './verification-domain.js';
import { verificationSubjectKey, VERIFICATION_TERMINAL, VerificationError } from './verification-domain.js';

export interface VerificationRepository {
  create(session: VerificationSession): Promise<VerificationSession>;
  save(session: VerificationSession, expectedVersion: number): Promise<VerificationSession>;
  get(id: string): Promise<VerificationSession | undefined>;
  list(): Promise<VerificationSession[]>;
  reserve(buckets: string[], sessionId: string, attemptId: string, kind: 'session' | 'gesture', now: number): Promise<boolean>;
  abandonOtherOwners(ownerId: string): Promise<void>;
}

export class MemoryVerificationRepository implements VerificationRepository {
  private rows = new Map<string, VerificationSession>();
  private attempts: Array<{ buckets: string[]; sessionId: string; attemptId: string; kind: string; at: number }> = [];
  async create(row: VerificationSession) {
    if ([...this.rows.values()].some(other => !VERIFICATION_TERMINAL.has(other.state) && verificationSubjectKey(other.subject) === verificationSubjectKey(row.subject))) throw new VerificationError('VERIFICATION_ALREADY_ACTIVE');
    const saved = structuredClone({ ...row, eventSequence: row.version }); this.rows.set(row.id, saved); return structuredClone(saved);
  }
  async save(row: VerificationSession, version: number) {
    if (this.rows.get(row.id)?.version !== version) throw new VerificationError('VERIFICATION_VERSION_CHANGED');
    const saved = structuredClone({ ...row, version: version + 1, eventSequence: version + 1 }); this.rows.set(row.id, saved); return structuredClone(saved);
  }
  async get(id: string) { const row = this.rows.get(id); return row && structuredClone(row); }
  async list() { return structuredClone([...this.rows.values()]); }
  async reserve(buckets: string[], sessionId: string, attemptId: string, kind: 'session' | 'gesture', now: number) {
    if (this.attempts.some(row => row.attemptId === attemptId)) return false; // Never replay an unknown attempt.
    for (const bucket of buckets) {
      const used = this.attempts.filter(row => row.buckets.includes(bucket) && row.kind === kind && (kind === 'gesture' ? row.sessionId === sessionId : row.at > now - 900_000));
      if (used.length >= 3) return false;
      if (kind === 'session' && used.length && now - used.at(-1)!.at < [30_000, 120_000, 300_000][Math.min(used.length - 1, 2)]) return false;
    }
    this.attempts.push({ buckets, sessionId, attemptId, kind, at: now }); return true;
  }
  async abandonOtherOwners(ownerId: string) {
    for (const row of [...this.rows.values()]) if (row.ownerId !== ownerId && !VERIFICATION_TERMINAL.has(row.state)) {
      await this.save({ ...row, state: 'cancelled', failureCode: 'VERIFICATION_OWNER_LOST' }, row.version);
    }
  }
}

/** PG state+event commits are atomic; images, platform URLs and credentials never enter these rows.
 * Per-session eventSequence equals the CAS version. The global bigserial is audit-only,
 * never a resume cursor: list streams subscribe/buffer before taking a full snapshot.
 */
export class PostgresVerificationRepository implements VerificationRepository {
  constructor(private readonly pool: Pool) {}
  async create(row: VerificationSession) {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query('insert into accounts.verification_sessions(id,subject_key,account_id,login_session_id,owner_id,state,version,data) values($1,$2,$3,$4,$5,$6,$7,$8::jsonb)',
        [row.id, verificationSubjectKey(row.subject), row.subject.accountId ?? null, row.subject.loginSessionId ?? null, row.ownerId, row.state, row.version, JSON.stringify(row)]);
      await client.query('insert into accounts.verification_session_events(session_id,state_version,state) values($1,$2,$3)', [row.id, row.version, row.state]);
      row = { ...row, eventSequence: row.version };
      await client.query('update accounts.verification_sessions set data=$2::jsonb where id=$1', [row.id, JSON.stringify(row)]);
      await client.query('commit'); return row;
    } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
  }
  async save(row: VerificationSession, version: number) {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const updated = await client.query('update accounts.verification_sessions set state=$3,version=version+1,data=$4::jsonb,updated_at=now() where id=$1 and version=$2 and owner_id=$5 returning version',
        [row.id, version, row.state, JSON.stringify(row), row.ownerId]);
      if (!updated.rowCount) throw new VerificationError('VERIFICATION_VERSION_CHANGED');
      await client.query('insert into accounts.verification_session_events(session_id,state_version,state) values($1,$2,$3)', [row.id, version + 1, row.state]);
      const saved = { ...row, version: version + 1, eventSequence: version + 1 };
      await client.query('update accounts.verification_sessions set data=$2::jsonb where id=$1', [row.id, JSON.stringify(saved)]);
      await client.query('commit'); return saved;
    } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
  }
  async get(id: string) { return (await this.pool.query('select data from accounts.verification_sessions where id=$1', [id])).rows[0]?.data as VerificationSession | undefined; }
  async list() { return (await this.pool.query("select data from accounts.verification_sessions where updated_at>now()-interval '15 minutes' order by updated_at desc limit 200")).rows.map(row => row.data as VerificationSession); }
  async reserve(buckets: string[], sessionId: string, attemptId: string, kind: 'session' | 'gesture', _now: number) {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      for (const bucket of [...new Set(buckets)].sort()) {
        await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [`verification-budget:${bucket}`]);
        const used = await client.query(`select reserved_at from accounts.verification_budget_attempts where bucket=$1 and kind=$2
          and ($2='gesture' and session_id=$3 or $2='session' and reserved_at>now()-interval '15 minutes') order by reserved_at`, [bucket, kind, sessionId]);
        if (used.rowCount! >= 3) { await client.query('rollback'); return false; }
        if (kind === 'session' && used.rowCount) {
          const check = await client.query('select now()-$1::timestamptz >= $2::integer * interval \'1 millisecond\' as ready', [used.rows.at(-1).reserved_at, [30_000, 120_000, 300_000][Math.min(used.rowCount - 1, 2)]]);
          if (!check.rows[0].ready) { await client.query('rollback'); return false; }
        }
        const inserted = await client.query('insert into accounts.verification_budget_attempts(bucket,session_id,attempt_id,kind) values($1,$2,$3,$4) on conflict do nothing returning attempt_id', [bucket, sessionId, attemptId, kind]);
        if (!inserted.rowCount) { await client.query('rollback'); return false; }
      }
      await client.query('commit'); return true;
    } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
  }
  async abandonOtherOwners(ownerId: string) {
    const rows = await this.pool.query("select data from accounts.verification_sessions where owner_id<>$1 and state not in ('succeeded','completed_partial','failed','expired','cancelled')", [ownerId]);
    for (const { data } of rows.rows) await this.save({ ...data, state: 'cancelled', failureCode: 'VERIFICATION_OWNER_LOST' }, data.version);
  }
}
