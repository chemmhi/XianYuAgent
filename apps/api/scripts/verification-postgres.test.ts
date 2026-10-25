import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { PostgresStore } from '../src/store-postgres.js';
import { PostgresVerificationRepository } from '../src/verification-repository.js';
import type { VerificationSession } from '../src/verification-domain.js';

const databaseUrl = process.env.MANUAL_VERIFICATION_TEST_DATABASE_URL;
if (!databaseUrl || !['localhost', '127.0.0.1'].includes(new URL(databaseUrl).hostname)
  || new URL(databaseUrl).pathname !== '/xianyu_manual_verification_test') throw new Error('isolated MANUAL_VERIFICATION_TEST_DATABASE_URL required');

test('real PG: state/event transaction, competing CAS, stable budgets and owner restart persist correctly', async () => {
  const store = new PostgresStore(databaseUrl); const repo = new PostgresVerificationRepository(store.pool);
  const admin = await store.createAdmin({ email: `verification-${randomUUID()}@example.test`, passwordHash: 'fixture', displayName: 'verification test' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: `verification-${randomUUID()}` });
  const otherAccount = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: `verification-${randomUUID()}` });
  const otherSessionId = randomUUID();
  const now = Date.now(), sessionId = randomUUID();
  const row: VerificationSession = { id: sessionId, ownerId: randomUUID(), subject: { adminId: admin.id, accountId: account.id },
    state: 'preparing', mode: 'manual_then_auto', version: 1, eventSequence: 0, createdAt: now, updatedAt: now,
    readyAt: now, setupDeadline: now + 8_000, discoveryDeadline: now + 2_000, priorityConsumed: false,
    expiresAt: now + 300_000, controlEpoch: 0, autoAttempts: 0, challengeGeneration: 1 };
  try {
    const saved = await repo.create(row); assert.ok(saved.eventSequence > 0);
    const other = await repo.create({ ...row, id: otherSessionId, subject: { adminId: admin.id, accountId: otherAccount.id } });
    assert.equal(other.eventSequence, 1, 'each session begins at one despite global audit IDs');
    await assert.rejects(repo.create({ ...row, id: randomUUID() }), /unique|duplicate/i);
    const results = await Promise.allSettled([repo.save({ ...saved, state: 'priority_wait' }, 1), repo.save({ ...saved, state: 'auto_active' }, 1)]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal((await repo.get(sessionId))!.version, 2);
    assert.equal((await repo.get(sessionId))!.eventSequence, 2, 'interleaved session and failed transaction cannot introduce gaps');
    assert.equal((await repo.save(other, 1)).eventSequence, 2);
    const events = await store.pool.query('select * from accounts.verification_session_events where session_id=$1 order by sequence', [sessionId]);
    assert.equal(events.rows.length, 2); assert.equal(Number(events.rows[1].state_version), 2);
    const bucket = `account:${account.id}`;
    const attempts = await Promise.all(Array.from({ length: 8 }, () => repo.reserve([bucket], sessionId, randomUUID(), 'gesture', now)));
    assert.equal(attempts.filter(Boolean).length, 3, 'transactional pre-reservations must limit concurrent dispatch');
    const restart = new PostgresVerificationRepository(store.pool);
    assert.equal(await restart.reserve([bucket], sessionId, randomUUID(), 'gesture', now), false, 'restart cannot refund attempts');
    const flowBuckets = [`flow:${randomUUID()}`, `admin:${admin.id}`];
    assert.equal(await repo.reserve(flowBuckets, sessionId, randomUUID(), 'session', now), true);
    assert.equal(await restart.reserve([`flow:${randomUUID()}`, `admin:${admin.id}`], randomUUID(), randomUUID(), 'session', now), false, 'new QR flow cannot bypass administrator cooldown');
    await restart.abandonOtherOwners(randomUUID());
    const cancelled = (await restart.get(sessionId))!; assert.equal(cancelled.state, 'cancelled'); assert.equal(cancelled.version, 3);
    assert.ok(cancelled.eventSequence > saved.eventSequence);
    const actual = await store.pool.query('select state,version from accounts.verification_sessions where id=$1', [sessionId]);
    assert.equal(actual.rows[0].state, cancelled.state); assert.equal(Number(actual.rows[0].version), cancelled.version);
  } finally {
    await store.pool.query('delete from accounts.verification_budget_attempts where session_id=$1', [sessionId]);
    await store.pool.query('delete from accounts.verification_sessions where id=any($1::uuid[])', [[sessionId, otherSessionId]]);
    await store.pool.query('delete from auth.account_scopes where account_id=any($1::uuid[])', [[account.id, otherAccount.id]]);
    await store.pool.query('delete from accounts.accounts where id=any($1::uuid[])', [[account.id, otherAccount.id]]);
    await store.pool.query('delete from auth.admins where id=$1', [admin.id]);
    await store.close();
  }
});

test('real PG: login reservation fences every old refresh, concurrent QR collision and revoke cannot resurrect credentials', async () => {
  const store = new PostgresStore(databaseUrl);
  const admin = await store.createAdmin({ email: `credential-fence-${randomUUID()}@example.test`, passwordHash: 'fixture', displayName: 'fence' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: randomUUID() });
  const login = await store.createLoginSession({ adminId: admin.id, accountId: account.id, loginMethod: 'qr', expiresAt: new Date(Date.now() + 300_000).toISOString() });
  const second = await store.createLoginSession({ adminId: admin.id, accountId: account.id, loginMethod: 'qr', expiresAt: new Date(Date.now() + 300_000).toISOString() });
  try {
    const old = await store.upsertCredential({ adminId: admin.id, accountId: account.id, platform: 'xianyu', cookieHeader: 'unb=fixture; cookie2=old', accessToken: 'old', metadata: {} });
    const reservation = await store.beginCredentialLogin({ adminId: admin.id, accountId: account.id, loginSessionId: login.id });
    assert.ok(reservation.generation > old.generation!);
    assert.deepEqual(await store.beginCredentialLogin({ adminId: admin.id, accountId: account.id, loginSessionId: login.id }), reservation);
    await assert.rejects(store.beginCredentialLogin({ adminId: admin.id, accountId: account.id, loginSessionId: second.id }), /LOGIN_ACCOUNT_BUSY/);
    assert.equal(await store.commitCredentialRefresh({ adminId: admin.id, accountId: account.id, expected: old, cookieHeader: 'old callback', metadata: {} }), undefined);
    await assert.rejects(store.upsertCredential({ adminId: admin.id, accountId: account.id, platform: 'xianyu', cookieHeader: 'unreserved writer' }), /LOGIN_ACCOUNT_BUSY/);
    const saved = await store.upsertCredential({ adminId: admin.id, accountId: account.id, platform: 'xianyu', cookieHeader: 'unb=fixture; cookie2=new',
      accessToken: 'new', loginReservation: { ...reservation, loginSessionId: login.id } });
    assert.equal(saved.generation, reservation.generation);
    assert.equal(await store.commitCredentialRefresh({ adminId: admin.id, accountId: account.id, expected: old, cookieHeader: 'late callback', metadata: {} }), undefined);
    await store.setAccountTransport({ adminId: admin.id, accountId: account.id, status: 'connected', expectedGeneration: old.generation });
    assert.notEqual((await store.getAccount(admin.id, account.id))!.transportStatus, 'connected', 'old socket must not publish fresh health');
    await store.revokeCredential(admin.id, account.id);
    assert.equal(await store.markCredentialVerified({ adminId: admin.id, accountId: account.id, status: 'active', expectedGeneration: saved.generation }), undefined);
    assert.equal(await store.commitCredentialRefresh({ adminId: admin.id, accountId: account.id, expected: saved, cookieHeader: 'revive', metadata: {} }), undefined);
    assert.equal((await store.getCredential(admin.id, account.id))!.status, 'revoked');
  } finally {
    await store.pool.query('delete from accounts.verification_account_claims where account_id=$1', [account.id]);
    await store.pool.query('delete from auth.account_login_sessions where account_id=$1', [account.id]);
    await store.pool.query('delete from auth.account_credentials where account_id=$1', [account.id]);
    await store.pool.query('delete from auth.account_scopes where account_id=$1', [account.id]);
    await store.pool.query('delete from accounts.accounts where id=$1', [account.id]);
    await store.pool.query('delete from auth.admins where id=$1', [admin.id]); await store.close();
  }
});
