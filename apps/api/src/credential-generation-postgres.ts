import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
export interface ExplicitCredentialWrite {
  adminId: string; accountId: string; platform: string; cookieHeader?: string; accessToken?: string;
  deviceId?: string; metadata?: Record<string, string>; expiresAt?: string;
  loginReservation?: { loginSessionId: string; reservationId: string; generation: number };
}
async function lockedAccount(client: PoolClient, adminId: string, accountId: string) {
  const result = await client.query(`select a.* from accounts.accounts a where a.id=$1 and a.status<>'disabled' and a.deletion_started_at is null
    and exists(select 1 from auth.account_scopes s where s.account_id=a.id and s.admin_id=$2 and s.scope='manage'
    and s.status='active' and (s.expires_at is null or s.expires_at>now())) for update`, [accountId, adminId]);
  if (!result.rows[0]) throw new Error('ACCOUNT_SCOPE_FORBIDDEN'); return result.rows[0];
}
export async function beginPostgresCredentialLogin(pool: Pool, input: { adminId: string; accountId: string; loginSessionId: string }) {
  const client = await pool.connect();
  try {
    await client.query('begin'); await lockedAccount(client, input.adminId, input.accountId);
    const login = await client.query(`select id from auth.account_login_sessions where id=$1 and admin_id=$2 and status not in ('cancelled','expired','failed','succeeded') and expires_at>now() for update`, [input.loginSessionId, input.adminId]);
    if (!login.rowCount) throw new Error('LOGIN_SESSION_EXPIRED');
    const claim = (await client.query('select * from accounts.verification_account_claims where account_id=$1 and expires_at>now()', [input.accountId])).rows[0];
    if (claim) {
      if (claim.login_session_id !== input.loginSessionId) throw new Error('LOGIN_ACCOUNT_BUSY');
      await client.query('commit'); return { reservationId: String(claim.reservation_id), generation: Number(claim.generation) };
    }
    const generation = Number((await client.query('update accounts.accounts set credential_generation=credential_generation+1 where id=$1 returning credential_generation', [input.accountId])).rows[0].credential_generation);
    const reservationId = randomUUID();
    await client.query(`insert into accounts.verification_account_claims(account_id,reservation_id,login_session_id,generation,expires_at)
      values($1,$2,$3,$4,now()+interval '5 minutes') on conflict(account_id) do update set reservation_id=excluded.reservation_id,
      login_session_id=excluded.login_session_id,generation=excluded.generation,expires_at=excluded.expires_at`, [input.accountId, reservationId, input.loginSessionId, generation]);
    await client.query('commit'); return { reservationId, generation };
  } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
}
/** Explicit import/login only. Background writers must use snapshot+generation CAS. */
export async function writePostgresCredential(pool: Pool, input: ExplicitCredentialWrite) {
  const client = await pool.connect();
  try {
    await client.query('begin'); const account = await lockedAccount(client, input.adminId, input.accountId);
    let generation: number;
    if (input.loginReservation) {
      const r = input.loginReservation;
      const claim = await client.query(`select 1 from accounts.verification_account_claims c join auth.account_login_sessions l on l.id=c.login_session_id
        where c.account_id=$1 and c.reservation_id=$2 and c.login_session_id=$3 and c.generation=$4 and c.expires_at>now()
        and l.admin_id=$5 and l.expires_at>now() and l.status not in ('failed','cancelled','expired','succeeded')`, [input.accountId, r.reservationId, r.loginSessionId, r.generation, input.adminId]);
      if (!claim.rowCount || Number(account.credential_generation) !== r.generation) throw new Error('XIANYU_VERIFICATION_CREDENTIAL_CHANGED');
      generation = r.generation;
      await client.query('update auth.account_login_sessions set account_id=$2 where id=$1', [r.loginSessionId, input.accountId]);
    } else {
      if ((await client.query('select 1 from accounts.verification_account_claims where account_id=$1 and expires_at>now()', [input.accountId])).rowCount) throw new Error('LOGIN_ACCOUNT_BUSY');
      generation = Number((await client.query('update accounts.accounts set credential_generation=credential_generation+1 where id=$1 returning credential_generation', [input.accountId])).rows[0].credential_generation);
    }
    const result = await client.query(`insert into auth.account_credentials(id,account_id,platform,status,cookie_header,access_token,device_id,metadata_json,expires_at,generation)
      values($1,$2,$3,'active',$4,$5,$6,$7::jsonb,$8,$9) on conflict(account_id) do update set status='active',platform=excluded.platform,
      cookie_header=excluded.cookie_header,access_token=excluded.access_token,device_id=excluded.device_id,metadata_json=excluded.metadata_json,
      expires_at=excluded.expires_at,generation=excluded.generation,updated_at=now() returning *`, [randomUUID(), input.accountId, input.platform,
      input.cookieHeader ?? null, input.accessToken ?? null, input.deviceId ?? null, JSON.stringify(input.metadata ?? {}), input.expiresAt ?? null, generation]);
    if (input.loginReservation) await client.query('delete from accounts.verification_account_claims where account_id=$1 and reservation_id=$2', [input.accountId, input.loginReservation.reservationId]);
    await client.query('commit'); return result.rows[0];
  } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
}
