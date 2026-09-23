import assert from 'node:assert/strict';
import test from 'node:test';
import { createDefaultAutoReplyRepairPolicy } from '../src/auto-reply-repair-config.js';
import { withComputedPolicyHash } from '../src/auto-reply-policy.js';
import { MemoryStore } from '../src/store-memory.js';

test('AR-RA-023 stores one account ACTIVE policy and supports rollback', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'policy-registry@example.com', passwordHash: 'hash', displayName: 'Policy Registry' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'policy-registry-account' });
  const first = createDefaultAutoReplyRepairPolicy(account.id, new Date('2026-09-23T00:00:00.000Z'));
  const secondVersion = 'ar-vs08-policy-registry-v2';
  const secondConfig = withComputedPolicyHash({ ...first.policyConfig, policyVersion: secondVersion, previousPolicyVersion: first.policyConfig.policyVersion });
  const second = { ...first, policyConfig: secondConfig, preSendPolicy: { ...first.preSendPolicy, policyVersion: secondVersion }, outcomePolicy: { ...first.outcomePolicy, policyVersion: secondVersion } };

  await store.publishAutoReplyRepairPolicy({ accountId: account.id, bundle: first });
  assert.equal((await store.getActiveAutoReplyRepairPolicy(account.id))?.policyConfig.policyVersion, first.policyConfig.policyVersion);
  await store.publishAutoReplyRepairPolicy({ accountId: account.id, bundle: second, expectedActiveVersion: first.policyConfig.policyVersion });
  assert.equal((await store.getActiveAutoReplyRepairPolicy(account.id))?.policyConfig.policyVersion, secondVersion);

  await assert.rejects(() => store.publishAutoReplyRepairPolicy({ accountId: account.id, bundle: first }), /AUTO_REPLY_POLICY_VERSION_EXISTS/);
  const rolledBack = await store.rollbackAutoReplyRepairPolicy({ accountId: account.id, targetPolicyVersion: first.policyConfig.policyVersion, expectedActiveVersion: secondVersion });
  assert.equal(rolledBack.policyConfig.policyVersion, first.policyConfig.policyVersion);
  assert.equal((await store.getActiveAutoReplyRepairPolicy(account.id))?.policyConfig.policyHash, first.policyConfig.policyHash);
});

test('AR-RA-023 rejects account scope and stale policy hashes', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'policy-registry-invalid@example.com', passwordHash: 'hash', displayName: 'Policy Registry Invalid' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'policy-registry-invalid-account' });
  const valid = createDefaultAutoReplyRepairPolicy(account.id, new Date('2026-09-23T00:00:00.000Z'));
  const wrongScope = { ...valid, policyConfig: { ...valid.policyConfig, accountScope: 'other-account' } };
  await assert.rejects(() => store.publishAutoReplyRepairPolicy({ accountId: account.id, bundle: wrongScope }), /AUTO_REPLY_POLICY_ACCOUNT_SCOPE_MISMATCH|policyHash/);
  const staleHash = { ...valid, policyConfig: { ...valid.policyConfig, policyHash: 'stale' } };
  await assert.rejects(() => store.publishAutoReplyRepairPolicy({ accountId: account.id, bundle: staleHash }), /policyHash/);
});
