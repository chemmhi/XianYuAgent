import type { Pool } from 'pg';
import type { PasswordLoginRepository, PasswordLoginSecret } from './password-login-repository.js';

export class PostgresPasswordLoginRepository implements PasswordLoginRepository {
  constructor(private readonly pool: Pool) {}
  private row(r: Record<string, unknown>): PasswordLoginSecret {
    return { adminId: String(r.admin_id), accountId: String(r.account_id), ciphertext: String(r.secret_ciphertext),
      profileKey: String(r.profile_key), version: Number(r.version), enabled: r.enabled === true, attempts: Number(r.attempts),
      nextAttemptAt: new Date(String(r.next_attempt_at)).getTime(), failureCode: r.failure_code ? String(r.failure_code) : undefined };
  }
  async get(adminId: string, accountId: string) {
    const result = await this.pool.query('select * from auth.account_login_secrets where admin_id=$1 and account_id=$2', [adminId, accountId]);
    return result.rows[0] ? this.row(result.rows[0]) : undefined;
  }
  async save(input: Pick<PasswordLoginSecret, 'adminId' | 'accountId' | 'ciphertext' | 'profileKey'> & { expectedVersion: number }) {
    const result = input.expectedVersion === 0
      ? await this.pool.query(`insert into auth.account_login_secrets(admin_id,account_id,secret_ciphertext,profile_key,next_attempt_at)
          values($1,$2,$3,$4,now()+interval '30 seconds') on conflict do nothing`, [input.adminId, input.accountId, input.ciphertext, input.profileKey])
      : await this.pool.query(`update auth.account_login_secrets set secret_ciphertext=$3,profile_key=$4,version=version+1,enabled=true,
          attempts=0,failure_code=null,next_attempt_at=now()+interval '30 seconds',updated_at=now()
          where admin_id=$1 and account_id=$2 and version=$5`, [input.adminId, input.accountId, input.ciphertext, input.profileKey, input.expectedVersion]);
    if (result.rowCount !== 1) throw new Error('PASSWORD_SECRET_CHANGED');
  }
  async due(now: number, limit: number) {
    const result = await this.pool.query('select * from auth.account_login_secrets where enabled and next_attempt_at<=$1 order by next_attempt_at limit $2', [new Date(now), Math.max(1, Math.min(100, limit))]);
    return result.rows.map(r => this.row(r));
  }
  async settle(row: PasswordLoginSecret, next: number, failureCode?: string, disable = false) {
    await this.pool.query(`update auth.account_login_secrets set next_attempt_at=$4,failure_code=$5,enabled=enabled and $6,
      attempts=case when $5::text is null then 0 else attempts+1 end,updated_at=now() where admin_id=$1 and account_id=$2 and version=$3`,
    [row.adminId, row.accountId, row.version, new Date(next), failureCode ?? null, !disable]);
  }
  async claim(accountId: string, owner: string, until: number) {
    const result = await this.pool.query(`insert into auth.password_login_leases(account_id,owner,expires_at) values($1,$2,$3)
      on conflict(account_id) do update set owner=excluded.owner,expires_at=excluded.expires_at
      where auth.password_login_leases.expires_at<=now() or auth.password_login_leases.owner=excluded.owner`, [accountId, owner, new Date(until)]);
    return result.rowCount === 1;
  }
  async renew(accountId: string, owner: string, until: number) {
    return (await this.pool.query('update auth.password_login_leases set expires_at=$3 where account_id=$1 and owner=$2 and expires_at>now()', [accountId, owner, new Date(until)])).rowCount === 1;
  }
  async release(accountId: string, owner: string) { await this.pool.query('delete from auth.password_login_leases where account_id=$1 and owner=$2', [accountId, owner]); }
  async removeAccount(accountId: string) { await this.pool.query('delete from auth.password_device_profiles where account_id=$1',[accountId]);await this.pool.query('delete from auth.password_device_aliases where account_id=$1',[accountId]);await this.pool.query('delete from auth.account_login_secrets where account_id=$1', [accountId]); }
  async profiles(accountId: string) { return (await this.pool.query('select profile_key from auth.account_login_secrets where account_id=$1 union select profile_key from auth.password_device_aliases where account_id=$1 union select profile_key from auth.password_device_profiles where account_id=$1', [accountId])).rows.map(r => String(r.profile_key)); }
  async deviceAlias(adminId:string,loginDigest:string){const row=(await this.pool.query('select account_id,profile_key from auth.password_device_aliases where admin_id=$1 and login_digest=$2',[adminId,loginDigest])).rows[0];return row?{accountId:String(row.account_id),profileKey:String(row.profile_key)}:undefined;}
  async bindDeviceAlias(adminId:string,loginDigest:string,accountId:string,profileKey:string){await this.pool.query(`with profile as (insert into auth.password_device_profiles(admin_id,account_id,profile_key) values($1,$3,$4) on conflict do nothing),
    canonical as (update auth.password_device_aliases set profile_key=$4 where admin_id=$1 and account_id=$3 and login_digest<>$2)
    insert into auth.password_device_aliases(admin_id,login_digest,account_id,profile_key) values($1,$2,$3,$4)
    on conflict(admin_id,login_digest) do update set account_id=excluded.account_id,profile_key=excluded.profile_key`,[adminId,loginDigest,accountId,profileKey]);}
}
