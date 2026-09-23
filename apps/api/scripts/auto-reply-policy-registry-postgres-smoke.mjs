import assert from 'node:assert/strict';
import { createDefaultAutoReplyRepairPolicy } from '../dist/auto-reply-repair-config.js';
import { withComputedPolicyHash } from '../dist/auto-reply-policy.js';
import { PostgresStore } from '../dist/store-postgres.js';
import { hashPassword } from '../dist/security.js';

const databaseUrl = process.env.DATABASE_URL ?? 'postgres://xianyu:xianyu_dev_only@127.0.0.1:5432/xianyu_agent';
const suffix = `${process.pid}-${Date.now()}`;
const store = new PostgresStore(databaseUrl);
let admin;
let account;
try {
  admin = await store.createAdmin({ email: `ar-ra-023-${suffix}@example.com`, passwordHash: await hashPassword('password-123'), displayName: 'AR-RA-023 Policy Registry' });
  account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: `ar-ra-023-${suffix}` });
  const first = createDefaultAutoReplyRepairPolicy(account.id, new Date('2026-09-23T00:00:00.000Z'));
  const secondVersion = `ar-ra-023-v2-${suffix}`;
  const secondConfig = withComputedPolicyHash({ ...first.policyConfig, policyVersion: secondVersion, previousPolicyVersion: first.policyConfig.policyVersion });
  const second = { ...first, policyConfig: secondConfig, preSendPolicy: { ...first.preSendPolicy, policyVersion: secondVersion }, outcomePolicy: { ...first.outcomePolicy, policyVersion: secondVersion } };
  await store.publishAutoReplyRepairPolicy({ accountId: account.id, bundle: first });
  assert.equal((await store.getActiveAutoReplyRepairPolicy(account.id))?.policyConfig.policyVersion, first.policyConfig.policyVersion);
  await store.publishAutoReplyRepairPolicy({ accountId: account.id, bundle: second, expectedActiveVersion: first.policyConfig.policyVersion });
  assert.equal((await store.getActiveAutoReplyRepairPolicy(account.id))?.policyConfig.policyHash, second.policyConfig.policyHash);
  await store.rollbackAutoReplyRepairPolicy({ accountId: account.id, targetPolicyVersion: first.policyConfig.policyVersion, expectedActiveVersion: secondVersion });
  assert.equal((await store.getActiveAutoReplyRepairPolicy(account.id))?.policyConfig.policyVersion, first.policyConfig.policyVersion);
  console.log(JSON.stringify({ arRa023Postgres: true, activeVersionAfterRollback: first.policyConfig.policyVersion, hashVerified: true, casVerified: true }));
} finally {
  try {
    if (account?.id) await store.pool.query('delete from settings.auto_reply_repair_policies where account_id=$1', [account.id]);
    if (account?.id) {
      await store.pool.query('delete from auth.account_scopes where account_id=$1', [account.id]);
      await store.pool.query('delete from accounts.accounts where id=$1', [account.id]);
    }
    if (admin?.id) await store.pool.query('delete from auth.admins where id=$1', [admin.id]);
  } finally {
    await store.close();
  }
}
