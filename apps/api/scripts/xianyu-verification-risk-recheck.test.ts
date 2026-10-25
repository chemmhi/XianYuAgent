import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import test from 'node:test';
import type { Store } from '../src/domain.js';
import { MemoryStore } from '../src/store-memory.js';
import { PostgresStore } from '../src/store-postgres.js';
import { XianyuImService } from '../src/xianyu-im-service.js';
import { XianyuMtopClient } from '../src/xianyu-mtop.js';
import { cookieSnapshotFromMetadata } from '../src/xianyu-cookie-jar.js';
import { ITEM_DETAIL_RISK_SOURCE, recheckVerificationRisks } from '../src/xianyu-verification-risk-recheck.js';

const databaseUrl = process.env.NATIVE_RECOVERY_TEST_DATABASE_URL;
function readProbeStub(probe: (...args: any[]) => Promise<{ success: boolean }>) {
  return { createCredentialSession: (admin: string, account: string, credential: any) => ({
    client: { recheckReadRequest: (_a: string, _b: string, request: any) => probe(admin, account, request.data.itemId) },
    getCredential: () => credential,
  }) } as never;
}
if (databaseUrl) {
  const db = new URL(databaseUrl);
  assert.ok(['127.0.0.1', 'localhost'].includes(db.hostname) && db.pathname === '/xianyu_native_recovery_test', 'isolated test database required');
}
for (const kind of databaseUrl ? ['memory', 'postgres'] : ['memory']) {
  async function fixture() {
    const store: Store = kind === 'postgres' ? new PostgresStore(databaseUrl!) : new MemoryStore();
    const admin = await store.createAdmin({ email: `${randomUUID()}@example.com`, passwordHash: 'test', displayName: 'risk' });
    const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: randomUUID() });
    await store.upsertCredential({ adminId: admin.id, accountId: account.id, platform: 'xianyu', cookieHeader: `unb=${account.sellerRef}; _m_h5_tk=old_suffix`, accessToken: 'cached-token', deviceId: 'test-device' });
    const risk = (itemId = 'original-item') => store.recordAccountRisk({ adminId: admin.id, accountId: account.id, source: ITEM_DETAIL_RISK_SOURCE, code: 'ACCOUNT_VALIDATION_REQUIRED', recoveryRequest: { kind: 'item_detail', itemId } });
    const close = async () => { if (kind === 'postgres') await (store as PostgresStore).close(); };
    return { store, admin, account, risk, close };
  }

  test(`${kind}: successful original API recheck clears its persisted source only`, async () => {
    const f = await fixture();
    try {
      await f.risk();
      await f.store.recordAccountRisk({ adminId: f.admin.id, accountId: f.account.id, source: 'another-api', code: 'ACCOUNT_VALIDATION_REQUIRED' });
      const calls: unknown[] = [];
      await recheckVerificationRisks(f.store, readProbeStub(async (...args: unknown[]) => { calls.push(args); return { success: true }; }), f.admin.id, f.account.id);
      assert.deepEqual(calls, [[f.admin.id, f.account.id, 'original-item']]);
      assert.deepEqual((await f.store.listAccountVerificationRisks(f.admin.id, f.account.id)).map(r => r.source), ['another-api']);
      assert.equal((await f.store.getAccount(f.admin.id, f.account.id))?.status, 'verification_required');
    } finally { await f.close(); }
  });

  test(`${kind}: failed recheck and a successful stale request cannot erase a newer risk`, async () => {
    const f = await fixture();
    try {
      await f.risk();
      await recheckVerificationRisks(f.store, readProbeStub(async () => ({ success: false })), f.admin.id, f.account.id);
      assert.equal((await f.store.listAccountVerificationRisks(f.admin.id, f.account.id)).length, 1);
      const old = (await f.store.listAccountVerificationRisks(f.admin.id, f.account.id))[0];
      await recheckVerificationRisks(f.store, readProbeStub(async () => { await f.risk('new-item'); return { success: true }; }), f.admin.id, f.account.id);
      const current = (await f.store.listAccountVerificationRisks(f.admin.id, f.account.id))[0];
      assert.notEqual(current.revision, old.revision);
      assert.equal(current.recoveryRequest?.itemId, 'new-item');
    } finally { await f.close(); }
  });

  test(`${kind}: legacy risk probes an account-scoped product and refuses another admin`, async () => {
    const f = await fixture();
    try {
      await f.store.createProduct({ adminId: f.admin.id, accountId: f.account.id, externalProductRef: 'legacy-item', title: 'legacy', status: 'published' });
      await f.store.recordAccountRisk({ adminId: f.admin.id, accountId: f.account.id, source: ITEM_DETAIL_RISK_SOURCE, code: 'ACCOUNT_VALIDATION_REQUIRED' });
      let calls = 0;
      const mtop = readProbeStub(async (_a: string, _b: string, item: string) => { calls++; assert.equal(item, 'legacy-item'); return { success: true }; });
      const other = await f.store.createAdmin({ email: `${randomUUID()}@example.com`, passwordHash: 'test', displayName: 'other' });
      await recheckVerificationRisks(f.store, mtop, other.id, f.account.id);
      assert.equal(calls, 0);
      await recheckVerificationRisks(f.store, mtop, f.admin.id, f.account.id);
      assert.equal(calls, 1);
      assert.equal((await f.store.getAccount(f.admin.id, f.account.id))?.riskEpisode, undefined);
    } finally { await f.close(); }
  });

  test(`${kind}: preflight Set-Cookie and success cannot overwrite a concurrent new login`, async () => {
    const f = await fixture();
    const originalFetch = globalThis.fetch;
    let received!: () => void;
    const arrived = new Promise<void>(resolve => { received = resolve; });
    let finish!: () => void;
    const server = createServer((_req, res) => {
      finish = () => {
        res.setHeader('content-type', 'application/json');
        res.setHeader('set-cookie', '_m_h5_tk=stale_suffix; Domain=.goofish.com; Path=/');
        res.end(JSON.stringify({ ret: ['SUCCESS::ok'], data: {} }));
      };
      received();
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    globalThis.fetch = (url, init) => originalFetch(`http://127.0.0.1:${(server.address() as any).port}/`, init);
    try {
      await f.risk();
      const mtop = new XianyuMtopClient({ loadCredential: (a, b) => f.store.getCredential(a, b),
        saveCookie: async () => { assert.fail('preflight must buffer cookies instead of calling production saveCookie'); } });
      const pending = recheckVerificationRisks(f.store, mtop, f.admin.id, f.account.id);
      await arrived;
      await f.store.upsertCredential({ adminId: f.admin.id, accountId: f.account.id, platform: 'xianyu',
        cookieHeader: 'unb=new-login; _m_h5_tk=new-login_suffix', accessToken: 'new-login-token' });
      finish();
      await pending;
      assert.match((await f.store.getCredential(f.admin.id, f.account.id))!.cookieHeader!, /new-login_suffix/);
      assert.equal((await f.store.listAccountVerificationRisks(f.admin.id, f.account.id)).length, 1);
    } finally {
      globalThis.fetch = originalFetch;
      server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await f.close();
    }
  });

  for (const outcome of ['recovered', 'still-blocked', 'storage-failed']) test(`${kind}: native recovery ${outcome} preserves the database-first order through real HTTP`, async () => {
    const f = await fixture();
    const events: string[] = [];
    let browserCalls = 0;
    const server = createServer((req, res) => {
      const api = req.url?.split('/')[2];
      const fresh = req.headers.cookie?.includes('_m_h5_tk=native_suffix');
      events.push(`${api}:${fresh ? 'fresh' : 'cached'}`);
      res.setHeader('content-type', 'application/json');
      if (api === ITEM_DETAIL_RISK_SOURCE && fresh && outcome !== 'still-blocked') res.end(JSON.stringify({ ret: ['SUCCESS::ok'], data: { itemDO: { itemId: 'original-item' } } }));
      else res.end(JSON.stringify({ ret: ['FAIL_SYS_USER_VALIDATE::verify'], data: { url: 'https://www.goofish.com/punish' } }));
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (url, init) => { const target = new URL(String(url)); return originalFetch(`http://127.0.0.1:${(server.address() as { port: number }).port}${target.pathname}${target.search}`, init); };
    const mtop = new XianyuMtopClient({ loadCredential: (admin, account) => f.store.getCredential(admin, account), saveCookie: async () => undefined });
    const service = new XianyuImService(f.store, mtop, {} as never, undefined, undefined, {
      enabled: true, waitForCompletion: async () => {
        browserCalls++;
        return { finalUrl: 'https://www.goofish.com/im', cookieSnapshot: [
          { name: 'unb', value: f.account.sellerRef, domain: '.goofish.com', path: '/' },
          { name: '_m_h5_tk', value: 'native_suffix', domain: '.goofish.com', path: '/', partitionKey: 'https://goofish.com', _crHasCrossSiteAncestor: false },
        ], verifiedRead: { api: ITEM_DETAIL_RISK_SOURCE, userId: f.account.sellerRef } };
      },
    } as never);
    const internal = service as any;
    internal.clients.set(`${f.admin.id}:${f.account.id}`, { connected: true, disconnect: async () => undefined,
      refreshSession: async () => internal.refreshCredential(f.admin.id, await f.store.getAccount(f.admin.id, f.account.id), await f.store.getCredential(f.admin.id, f.account.id)) });
    const info = console.info;
    const warnings = console.warn;
    const recoveryEvents: string[] = [];
    console.info = (message: unknown) => { const event = JSON.parse(String(message)); recoveryEvents.push(event.event); };
    console.warn = (message: unknown) => { const event = JSON.parse(String(message)); recoveryEvents.push(event.event); };
    try {
      await f.risk();
      if (outcome === 'storage-failed') f.store.commitCredentialRefresh = async () => { throw new Error('controlled database failure'); };
      service.requestVerificationRecovery(f.admin.id, f.account.id, ITEM_DETAIL_RISK_SOURCE);
      await internal.verificationRecoveryInFlight.get(`${f.admin.id}:${f.account.id}`);
      assert.equal(browserCalls, 1);
      const reader = kind === 'postgres' ? new PostgresStore(databaseUrl!) : f.store;
      try {
        const saved = await reader.getCredential(f.admin.id, f.account.id);
        assert.equal(saved?.accessToken, 'cached-token', 'read API recovery must not replace the independent IM token');
        if (outcome !== 'storage-failed') {
          assert.equal(saved?.deviceId, 'test-device');
          assert.equal(cookieSnapshotFromMetadata(saved?.metadata)?.[1].partitionKey, 'https://goofish.com');
          assert.ok(events.includes(`${ITEM_DETAIL_RISK_SOURCE}:fresh`), 'the source probe reads the already committed new cookie');
        }
        const account = await reader.getAccount(f.admin.id, f.account.id);
        assert.equal(Boolean(account?.riskEpisode), outcome !== 'recovered');
        assert.equal(recoveryEvents.includes('verification_recovery_completed'), outcome === 'recovered');
        if (outcome === 'still-blocked') assert.ok(recoveryEvents.includes('verification_recovery_pending'));
      } finally { if (reader !== f.store) await (reader as PostgresStore).close(); }
    } finally {
      console.info = info; console.warn = warnings; globalThis.fetch = originalFetch;
      await service.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await f.close();
    }
  });
}
