import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { PostgresStore } from '../src/store-postgres.js';
import { XianyuImService } from '../src/xianyu-im-service.js';

const url = process.env.MANUAL_VERIFICATION_TEST_DATABASE_URL;
if (!url || !['localhost', '127.0.0.1'].includes(new URL(url).hostname)
  || new URL(url).pathname !== '/xianyu_manual_verification_test') throw new Error('isolated MANUAL_VERIFICATION_TEST_DATABASE_URL required');

test('real PG rejects delayed same-generation IM results and unbound/stale verification status, with atomic generation/revision risk clearing', async () => {
  const store = new PostgresStore(url);
  const admin = await store.createAdmin({ email: `${randomUUID()}@example.test`, passwordHash: 'fixture', displayName: 'credential fencing' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: `fence-${randomUUID()}` });
  const save = (cookieHeader: string) => store.upsertCredential({ adminId: admin.id, accountId: account.id, platform: 'xianyu', cookieHeader, deviceId: 'device-1', accessToken: 'initial-token' });
  let service: XianyuImService | undefined;
  try {
    const initial = structuredClone(await save('unb=seller; _m_h5_tk=initial_suffix'));
    let requestStarted!: () => void; let reply!: (value: any) => void;
    const requested = new Promise<void>(resolve => { requestStarted = resolve; });
    const response = new Promise(resolve => { reply = resolve; });
    service = new XianyuImService(store, { fetchImToken: () => { requestStarted(); return response; } } as never, {} as never);
    const task = (service as any).refreshCredential(admin.id, account, initial);
    await requested;
    const newest = await store.commitCredentialRefresh({ adminId: admin.id, accountId: account.id, expected: initial,
      cookieHeader: 'unb=seller; _m_h5_tk=newest_suffix', accessToken: 'newest-token', deviceId: 'device-1', metadata: { newest: 'true' } });
    assert.ok(newest); assert.equal(newest.generation, initial.generation);
    reply({ success: true, accessToken: 'old-response', cookieHeader: 'unb=seller; _m_h5_tk=old_suffix' });
    await assert.rejects(task, { code: 'XIANYU_VERIFICATION_CREDENTIAL_CHANGED' });
    assert.equal((await store.getCredential(admin.id, account.id))?.accessToken, 'newest-token');
    for (const status of ['active', 'expired'] as const) {
      assert.equal(await store.markCredentialVerified({ adminId: admin.id, accountId: account.id, status, expected: initial }), undefined, 'same-generation old snapshot fails');
      assert.equal(await store.markCredentialVerified({ adminId: admin.id, accountId: account.id, status }), undefined, 'missing evidence fails');
    }
    const valid = await store.markCredentialVerified({ adminId: admin.id, accountId: account.id, status: 'active', expected: newest });
    assert.ok(valid, 'current full snapshot can be verified');
    const old = structuredClone(valid);
    const fresh = structuredClone(await save('unb=seller; _m_h5_tk=fresh-login'));
    for (const status of ['active', 'expired'] as const) assert.equal(await store.markCredentialVerified({ adminId: admin.id, accountId: account.id, status, expected: old }), undefined, 'old generation fails');
    const riskAccount = await store.recordAccountRisk({ adminId: admin.id, accountId: account.id, code: 'ACCOUNT_VALIDATION_REQUIRED', source: 'im_listener' });
    const risk = (await store.listAccountVerificationRisks(admin.id, account.id))[0];
    await store.clearAccountRisk({ adminId: admin.id, accountId: account.id, episode: riskAccount!.riskEpisode!, source: risk.source,
      expectedRiskRevision: risk.revision, expectedGeneration: old.generation, startedAt: new Date(Date.now() + 1_000).toISOString() });
    assert.equal((await store.listAccountVerificationRisks(admin.id, account.id)).length, 1, 'revision alone cannot let an old socket clear a newer login');
    await store.recordAccountRisk({ adminId: admin.id, accountId: account.id, code: 'ACCOUNT_VALIDATION_REQUIRED', source: 'im_listener' });
    await store.clearAccountRisk({ adminId: admin.id, accountId: account.id, episode: risk.episode, source: risk.source,
      expectedRiskRevision: risk.revision, expectedGeneration: fresh.generation, startedAt: new Date(Date.now() + 1_000).toISOString() });
    assert.equal((await store.listAccountVerificationRisks(admin.id, account.id)).length, 1, 'a newer risk revision survives the old recovery');
    const latestRisk = (await store.listAccountVerificationRisks(admin.id, account.id))[0];
    await store.clearAccountRisk({ adminId: admin.id, accountId: account.id, episode: latestRisk.episode, source: latestRisk.source,
      expectedRiskRevision: latestRisk.revision, expectedGeneration: fresh.generation, startedAt: new Date(Date.now() + 1_000).toISOString() });
    assert.equal((await store.listAccountVerificationRisks(admin.id, account.id)).length, 0);
  } finally {
    await service?.close();
    await store.pool.query('delete from accounts.risk_alert_outbox where account_id=$1', [account.id]);
    await store.pool.query('delete from accounts.health_signals where account_id=$1', [account.id]);
    await store.pool.query('delete from auth.account_credentials where account_id=$1', [account.id]);
    await store.pool.query('delete from auth.account_scopes where account_id=$1', [account.id]);
    await store.pool.query('delete from accounts.accounts where id=$1', [account.id]);
    await store.pool.query('delete from auth.admins where id=$1', [admin.id]); await store.close();
  }
});

for (const replacement of ['login', 'same-generation-verification', 'none'] as const) test(`real PG delayed lazy expiry is one credential/account CAS: ${replacement}`, async () => {
  const store = new PostgresStore(url);
  const admin = await store.createAdmin({ email: `${randomUUID()}@example.test`, passwordHash: 'fixture', displayName: 'lazy expiry fence' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: `expiry-${randomUUID()}` });
  const query = store.pool.query.bind(store.pool);
  let release!: () => void; let observed!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { observed = resolve; });
  let blocked = false;
  try {
    const old = structuredClone(await store.upsertCredential({ adminId: admin.id, accountId: account.id, platform: 'xianyu',
      cookieHeader: 'unb=seller; cookie2=old', accessToken: 'old-token', expiresAt: new Date(Date.now() - 10_000).toISOString() }));
    // Hold the real mutation after the old SELECT has completed, while an
    // independent PG transaction commits the newer login/verification first.
    (store.pool as any).query = async (sql: any, ...args: any[]) => {
      if (!blocked && typeof sql === 'string' && sql.includes('credential_lazy_expiry')) { blocked = true; observed(); await gate; }
      return (query as any)(sql, ...args);
    };
    const reading = store.getCredential(admin.id, account.id);
    await started;
    if (replacement === 'login') await store.upsertCredential({ adminId: admin.id, accountId: account.id, platform: 'xianyu',
      cookieHeader: 'unb=seller; cookie2=fresh', accessToken: 'fresh-token', expiresAt: new Date(Date.now() + 600_000).toISOString() });
    if (replacement === 'same-generation-verification') assert.ok(await store.markCredentialVerified({ adminId: admin.id, accountId: account.id,
      status: 'active', expected: old, expiresAt: new Date(Date.now() + 600_000).toISOString() }));
    release();
    const returned = await reading;
    const persisted = await store.getCredential(admin.id, account.id);
    const health = await store.getAccount(admin.id, account.id);
    if (replacement === 'none') {
      assert.equal(returned?.status, 'expired'); assert.equal(persisted?.status, 'expired'); assert.equal(health?.status, 'expired');
    } else {
      assert.equal(returned?.status, 'active', 'the stale read returns a fresh snapshot after losing CAS');
      assert.equal(persisted?.status, 'active'); assert.notEqual(health?.status, 'expired', 'account health cannot be expired without the credential CAS winning');
      assert.equal(persisted?.generation, replacement === 'login' ? old.generation! + 1 : old.generation);
      assert.equal(persisted?.accessToken, replacement === 'login' ? 'fresh-token' : 'old-token');
    }
  } finally {
    release(); (store.pool as any).query = query;
    await store.pool.query('delete from auth.account_credentials where account_id=$1', [account.id]);
    await store.pool.query('delete from auth.account_scopes where account_id=$1', [account.id]);
    await store.pool.query('delete from accounts.accounts where id=$1', [account.id]);
    await store.pool.query('delete from auth.admins where id=$1', [admin.id]); await store.close();
  }
});

for (const pauseAt of ['risk-delete', 'final-write'] as const) test(`real PG rolls risk clearing back if the socket fence expires after ${pauseAt}`, async () => {
  const store = new PostgresStore(url);
  const admin = await store.createAdmin({ email: `${randomUUID()}@example.test`, passwordHash: 'fixture', displayName: 'heartbeat transaction fence' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: `heartbeat-${randomUUID()}` });
  let release!: () => void; let entered!: () => void; let live = true;
  const gate = new Promise<void>(resolve => { release = resolve; }); const paused = new Promise<void>(resolve => { entered = resolve; });
  const connect = store.pool.connect.bind(store.pool); let client: any; let query: any;
  try {
    const credential = await store.upsertCredential({ adminId: admin.id, accountId: account.id, platform: 'xianyu', cookieHeader: 'unb=seller; cookie2=fixture' });
    await store.recordAccountRisk({ adminId: admin.id, accountId: account.id, source: 'im_listener', code: 'ACCOUNT_VALIDATION_REQUIRED' });
    const risk = (await store.listAccountVerificationRisks(admin.id, account.id))[0];
    client = await connect(); query = client.query.bind(client);
    client.query = async (sql: any, ...args: any[]) => {
      const result = await query(sql, ...args);
      if (typeof sql === 'string' && (pauseAt === 'risk-delete'
        ? sql.startsWith('delete from accounts.health_signals')
        : sql.startsWith('update orders.payment_event_jobs set next_attempt_at=now()'))) { entered(); await gate; }
      return result;
    };
    (store.pool as any).connect = async () => client;
    const clearing = store.clearAccountRisk({ adminId: admin.id, accountId: account.id, source: risk.source, episode: risk.episode,
      expectedGeneration: credential.generation, expectedRiskRevision: risk.revision, startedAt: new Date(Date.now() + 1_000).toISOString(), isCurrent: () => live });
    (store.pool as any).connect = connect;
    await paused;
    live = false; release();
    await clearing; client.query = query;
    const remaining = await store.listAccountVerificationRisks(admin.id, account.id);
    assert.equal(remaining.length, 1, 'an already executed DELETE is rolled back on socket epoch/liveness loss');
    assert.equal(remaining[0].revision, risk.revision);
    assert.equal((await store.getAccount(admin.id, account.id))?.status, 'verification_required');
    const clearedAlerts = await store.pool.query("select 1 from accounts.risk_alert_outbox where account_id=$1 and event_type='verification_cleared'", [account.id]);
    assert.equal(clearedAlerts.rowCount, 0, 'risk-clear outbox is part of the rollback');
  } finally {
    release(); (store.pool as any).connect = connect; if (client && query) client.query = query;
    await store.pool.query('delete from accounts.risk_alert_outbox where account_id=$1', [account.id]);
    await store.pool.query('delete from accounts.health_signals where account_id=$1', [account.id]);
    await store.pool.query('delete from auth.account_credentials where account_id=$1', [account.id]);
    await store.pool.query('delete from auth.account_scopes where account_id=$1', [account.id]);
    await store.pool.query('delete from accounts.accounts where id=$1', [account.id]);
    await store.pool.query('delete from auth.admins where id=$1', [admin.id]); await store.close();
  }
});
