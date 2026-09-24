import assert from 'node:assert/strict';
import { Client } from 'pg';
import { AccountService } from '../dist/services.js';
import { PostgresStore } from '../dist/store-postgres.js';

const connectionString = process.env.DATABASE_URL || 'postgres://xianyu:xianyu_dev_only@127.0.0.1:5432/xianyu_agent';
const store = new PostgresStore(connectionString);
const cleanup = new Client({ connectionString });
let admin;
let account;

try {
  admin = await store.createAdmin({ email: `qr-recovery-pg-${Date.now()}@example.com`, passwordHash: 'hash', displayName: 'QR Recovery PG' });
  account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: `qr-recovery-pg-${Date.now()}` });
  await store.deleteAccount(admin.id, account.id);

  const service = new AccountService(store, async () => 'audit-id');
  const session = await service.createLoginSession({ adminId: admin.id, accountId: account.id, loginMethod: 'qr', requestId: 'qr-session-pg', traceId: 'qr-session-pg' });
  assert.equal(session.accountId, account.id);

  const restored = await service.resolveForLogin({ adminId: admin.id, platform: 'xianyu', sellerRef: account.sellerRef, requestId: 'qr-recovery-pg', traceId: 'qr-recovery-pg' });
  assert.equal(restored.id, account.id);
  assert.equal(restored.status, 'pending');
  assert.equal(await store.hasAccountScope(admin.id, account.id), true);
  console.log('postgres qr login recovery passed');
} finally {
  await cleanup.connect();
  if (admin && account) {
    await cleanup.query('begin');
    await cleanup.query('delete from auth.account_login_sessions where account_id=$1', [account.id]);
    await cleanup.query('delete from auth.account_scopes where account_id=$1', [account.id]);
    await cleanup.query('delete from accounts.accounts where id=$1', [account.id]);
    await cleanup.query('delete from auth.admins where id=$1', [admin.id]);
    await cleanup.query('commit');
  }
  await cleanup.end();
  await store.close();
}
