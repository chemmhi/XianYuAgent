import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { PostgresStore } from '../src/store-postgres.js';
import { PostgresPasswordLoginRepository } from '../src/password-login-postgres.js';
import { PasswordLoginVault } from '../src/password-login-vault.js';
// @ts-expect-error The existing database harness convention uses an ESM helper.
import { passwordTestDatabase } from './password-login-test-database.mjs';

test('real PostgreSQL persists encrypted passwords across repository restart, enforces CAS/leases and fences terminal login commits', async () => {
  const db = await passwordTestDatabase(), store = new PostgresStore(db.url);
  const admin = await store.createAdmin({ email: `${randomUUID()}@example.test`, passwordHash: 'fixture', displayName: 'password PG' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: randomUUID() });
  const first = new PostgresPasswordLoginRepository(db.pool), second = new PostgresPasswordLoginRepository(store.pool);
  const key = 'password-integration-encryption-key';
  const vault = new PasswordLoginVault(first, key);
  try {
    await vault.save({ adminId: admin.id, accountId: account.id, account: 'fixture-phone', password: 'fixture-secret', profileKey: randomUUID(), expectedVersion: 0 });
    const restored = (await second.get(admin.id, account.id))!;
    const aliasDigest=vault.loginDigest(admin.id,'fixture-phone');await first.bindDeviceAlias(admin.id,aliasDigest,account.id,restored.profileKey);
    assert.deepEqual(await second.deviceAlias(admin.id,aliasDigest),{accountId:account.id,profileKey:restored.profileKey});assert.equal(await second.deviceAlias(randomUUID(),aliasDigest),undefined);
    const replacementProfile=randomUUID();await first.bindDeviceAlias(admin.id,vault.loginDigest(admin.id,'verified-alias'),account.id,replacementProfile);
    assert.deepEqual(await second.deviceAlias(admin.id,aliasDigest),{accountId:account.id,profileKey:replacementProfile});assert.ok((await first.profiles(account.id)).includes(restored.profileKey));assert.ok((await first.profiles(account.id)).includes(replacementProfile));
    assert.deepEqual(new PasswordLoginVault(second, key).open(restored), { account: 'fixture-phone', password: 'fixture-secret' });
    assert.equal(JSON.stringify(restored).includes('fixture-secret'), false);
    await assert.rejects(vault.save({ adminId: admin.id, accountId: account.id, account: 'another-phone', password: 'bad-update', profileKey: randomUUID(), expectedVersion: 0 }), /PASSWORD_SECRET_CHANGED/);
    await first.settle(restored, Date.now(), 'PASSWORD_REJECTED', true); await second.settle(restored, Date.now());
    assert.equal((await first.get(admin.id, account.id))?.enabled, false, 'a stale worker cannot undo disabling');
    const owner = randomUUID(), other = randomUUID();
    assert.equal(await first.claim(account.id, owner, Date.now() + 60_000), true); assert.equal(await second.claim(account.id, other, Date.now() + 60_000), false);
    await second.release(account.id, other); assert.equal(await first.renew(account.id, owner, Date.now() + 60_000), true);
    const saved = await store.upsertCredential({ adminId: admin.id, accountId: account.id, platform: 'xianyu', cookieHeader: 'unb=fixture', expectedGeneration: account.credentialGeneration });
    await assert.rejects(store.upsertCredential({ adminId: admin.id, accountId: account.id, platform: 'xianyu', cookieHeader: 'stale', expectedGeneration: (saved.generation ?? 1) - 1 }), /CREDENTIAL_CHANGED/);
    const session = () => store.createLoginSession({ adminId: admin.id, accountId: account.id, loginMethod: 'password', expiresAt: new Date(Date.now() + 60_000).toISOString() });
    const commit = (sessionId: string, leaseOwner = owner) => store.completePasswordLogin({ adminId: admin.id, accountId: account.id, sessionId, generation: saved.generation!, leaseOwner });
    const wrongLease = await session(); assert.equal(await commit(wrongLease.id, other), false);
    const expired = await session(); await store.updateLoginSession(admin.id, undefined, expired.id, { expiresAt: '2020-01-01T00:00:00Z' }); assert.equal(await commit(expired.id), false);
    const cancelled = await session(); await store.updateLoginSession(admin.id, undefined, cancelled.id, { status: 'cancelled' }); assert.equal(await commit(cancelled.id), false);
    const revoked = await session(); await store.grantScope({ adminId: admin.id, accountId: account.id, scope: 'read' }); await store.revokeScope(admin.id, account.id, 'manage');
    assert.equal(await commit(revoked.id), false, 'remaining read permission cannot finish password login');
    await store.grantScope({ adminId: admin.id, accountId: account.id, scope: 'manage' });
    const valid = await session(); assert.equal(await commit(valid.id), true); assert.equal((await store.getLoginSessionById(admin.id, valid.id))?.status, 'succeeded');
    assert.equal(await commit(valid.id), false, 'terminal session is immutable through completion');
  } finally { await store.close(); await db.close(); }
});
