import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import test from 'node:test';
import { MemoryStore } from '../src/store-memory.js';
import { PostgresStore } from '../src/store-postgres.js';
import type { Store } from '../src/domain.js';
import { XianyuMtopClient } from '../src/xianyu-mtop.js';
import { XianyuImService } from '../src/xianyu-im-service.js';
import { recoverVerificationReads } from '../src/xianyu-verification-read-recovery.js';
import { createVerificationReadRequest, resolveVerificationReadRequest } from '../src/xianyu-verification-request.js';

const ITEMS = 'mtop.idle.web.xyh.item.list';
const ORDERS = 'mtop.taobao.idle.trade.merchant.sold.get';
const dbUrl = process.env.NATIVE_RECOVERY_TEST_DATABASE_URL;
if (dbUrl) {
  const url = new URL(dbUrl);
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname) && url.pathname === '/xianyu_native_recovery_test');
}

test('read replay policy validates persisted source, version, origin, payload and write boundaries', () => {
  const request = createVerificationReadRequest(ITEMS, '1.0', { pageNumber: 2 })!;
  assert.ok(resolveVerificationReadRequest(ITEMS, request));
  for (const malformed of [null, {}, { ...request, api: ORDERS }, { ...request, version: '2.0' },
    { ...request, data: { accessToken: 'secret' } }, { ...request, data: { nested: { cookie: 'secret' } } },
    { ...request, data: { huge: 'x'.repeat(9000) } }, { ...request, referer: 'https://evil.example/' },
    { ...request, extraParams: { api: 'write' } }, { ...request, data: [] }]) {
    assert.equal(resolveVerificationReadRequest(ITEMS, malformed as never), undefined);
  }
  for (const api of ['mtop.taobao.idle.logistic.consign.dummy', 'mtop.taobao.idle.trade.user.adjust.price', '__proto__', 'unknown.get']) {
    assert.equal(createVerificationReadRequest(api, '1.0', {}), undefined);
  }
});

for (const kind of dbUrl ? ['memory', 'postgres'] : ['memory']) {
  async function fixture() {
    const store: Store = kind === 'postgres' ? new PostgresStore(dbUrl!) : new MemoryStore();
    const admin = await store.createAdmin({ email: `read-${randomUUID()}@example.com`, passwordHash: 'test', displayName: 'Guard' });
    const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: randomUUID() });
    await store.upsertCredential({ adminId: admin.id, accountId: account.id, platform: 'xianyu', cookieHeader: `unb=${account.sellerRef}; _m_h5_tk=old_suffix`, accessToken: 'healthy-im-token', deviceId: 'device' });
    const risk = (api = ITEMS) => store.recordAccountRisk({ adminId: admin.id, accountId: account.id, source: api,
      code: 'ACCOUNT_VALIDATION_REQUIRED', recoveryRequest: createVerificationReadRequest(api, '1.0', { pageNumber: 1 }) });
    const originalFetch = globalThis.fetch;
    const solved = new Set<string>();
    const requests: string[] = [];
    const server = createServer((req, res) => {
      const api = req.url!.split('/')[2];
      requests.push(api);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ret: [solved.has(api) ? 'SUCCESS::ok' : 'FAIL_SYS_USER_VALIDATE::verify'], data: {} }));
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    globalThis.fetch = (url, init) => {
      const target = new URL(String(url));
      return originalFetch(`http://127.0.0.1:${(server.address() as any).port}${target.pathname}`, init);
    };
    const mtop = new XianyuMtopClient({ loadCredential: (a, b) => store.getCredential(a, b), saveCookie: async () => undefined });
    const browserCalls: string[] = [];
    let duringBrowser: (api: string) => Promise<void> = async () => undefined;
    const browser: any = { enabled: true, waitForCompletion: async (input: any) => {
      assert.equal(input.imTokenRequest, undefined, 'must not depend on IM Token requiring validation');
      const api = input.readRequest.request.api;
      browserCalls.push(api);
      await duringBrowser(api);
      solved.add(api);
      return { finalUrl: 'https://www.goofish.com/robots.txt', cookieSnapshot: [
        { name: 'unb', value: account.sellerRef, domain: '.goofish.com', path: '/' },
        { name: '_m_h5_tk', value: 'fresh_suffix', domain: '.goofish.com', path: '/' },
      ], verifiedRead: { api, userId: account.sellerRef } };
    } };
    const close = async () => {
      globalThis.fetch = originalFetch;
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
      if (kind === 'postgres') await (store as PostgresStore).close();
    };
    return { store, admin, account, risk, mtop, browser, browserCalls, requests, solved, close,
      during: (fn: typeof duringBrowser) => { duringBrowser = fn; },
      recover: () => recoverVerificationReads(store, mtop, browser, admin.id, account.id) };
  }

  for (const outcome of ['success', 'browser-failed', 'wrong-identity', 'write-failed', 'new-credential', 'revoked', 'new-risk', 'server-still-blocked', 'login-during-server-recheck']) {
    test(`${kind}: original read recovery ${outcome} preserves credential/risk fences`, async () => {
      const f = await fixture();
      try {
        await f.risk();
        await f.store.recordAccountRisk({ adminId: f.admin.id, accountId: f.account.id, source: 'unknown.write', code: 'ACCOUNT_VALIDATION_REQUIRED' });
        if (outcome === 'browser-failed') f.browser.waitForCompletion = async () => { throw new Error('controlled failure'); };
        if (outcome === 'wrong-identity') {
          const original = f.browser.waitForCompletion;
          f.browser.waitForCompletion = async (input: any) => ({ ...await original(input), verifiedRead: { api: ITEMS, userId: '654321' } });
        }
        if (outcome === 'write-failed') f.store.commitCredentialRefresh = async () => { throw new Error('controlled database failure'); };
        if (outcome === 'new-credential') f.during(async () => {
          await f.store.upsertCredential({ adminId: f.admin.id, accountId: f.account.id, platform: 'xianyu', cookieHeader: 'unb=123456; _m_h5_tk=new-login_suffix', accessToken: 'new-login-token' });
        });
        if (outcome === 'revoked') f.during(async () => { await f.store.revokeCredential(f.admin.id, f.account.id); });
        if (outcome === 'new-risk') f.during(async () => { await f.risk(); });
        if (outcome === 'login-during-server-recheck') {
          const createSession = f.mtop.createCredentialSession.bind(f.mtop);
          f.mtop.createCredentialSession = (...args) => {
            const session = createSession(...args);
            const recheck = session.client.recheckReadRequest.bind(session.client);
            session.client.recheckReadRequest = async (...input) => {
              const result = await recheck(...input);
              await f.store.upsertCredential({ adminId: f.admin.id, accountId: f.account.id, platform: 'xianyu', cookieHeader: 'unb=new-login; _m_h5_tk=new-login_suffix', accessToken: 'new-login-token' });
              return result;
            };
            return session;
          };
        }
        if (outcome === 'server-still-blocked') {
          const original = f.browser.waitForCompletion;
          f.browser.waitForCompletion = async (input: any) => { const result = await original(input); f.solved.clear(); return result; };
        }
        if (['browser-failed', 'wrong-identity', 'write-failed', 'new-credential', 'revoked', 'login-during-server-recheck'].includes(outcome)) await assert.rejects(f.recover);
        else await f.recover();
        const risks = await f.store.listAccountVerificationRisks(f.admin.id, f.account.id);
        assert.equal(risks.some(r => r.source === ITEMS), outcome !== 'success');
        assert.ok(risks.some(r => r.source === 'unknown.write'), 'unrelated and mutation risks must remain');
        const saved = await f.store.getCredential(f.admin.id, f.account.id);
        assert.equal(saved?.accessToken, ['new-credential', 'login-during-server-recheck'].includes(outcome) ? 'new-login-token' : 'healthy-im-token');
        if (['new-credential', 'login-during-server-recheck'].includes(outcome)) assert.match(saved!.cookieHeader!, /new-login/);
        if (['browser-failed', 'wrong-identity', 'write-failed', 'revoked'].includes(outcome)) assert.match(saved!.cookieHeader!, /old_suffix/);
        assert.ok(!f.requests.some(api => api.endsWith('login.token')));
      } finally { await f.close(); }
    });
  }

  test(`${kind}: another API signalled during recovery is drained without a lost wake`, async () => {
    const f = await fixture();
    const service = new XianyuImService(f.store, f.mtop, {} as never, undefined, undefined, f.browser);
    const internal = service as any;
    internal.clients.set(`${f.admin.id}:${f.account.id}`, { connected: true, disconnect: async () => undefined });
    f.during(async api => {
      if (api === ITEMS) {
        await f.risk(ORDERS);
        service.requestVerificationRecovery(f.admin.id, f.account.id, ORDERS);
      }
    });
    try {
      await f.risk();
      service.requestVerificationRecovery(f.admin.id, f.account.id, ITEMS);
      const deadline = Date.now() + 3_000;
      while (internal.verificationRecoveryInFlight.size && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
      assert.deepEqual(f.browserCalls, [ITEMS, ORDERS]);
      assert.equal((await f.store.listAccountVerificationRisks(f.admin.id, f.account.id)).length, 0);
    } finally { await service.close(); await f.close(); }
  });

  test(`${kind}: a newer revision from the same API gets a follow-up recovery`, async () => {
    const f = await fixture();
    const service = new XianyuImService(f.store, f.mtop, {} as never, undefined, undefined, f.browser);
    const internal = service as any;
    internal.clients.set(`${f.admin.id}:${f.account.id}`, { connected: true, disconnect: async () => undefined });
    let raised = false;
    f.during(async () => {
      if (!raised) {
        raised = true;
        await f.risk();
        service.requestVerificationRecovery(f.admin.id, f.account.id, ITEMS);
      }
    });
    try {
      await f.risk();
      service.requestVerificationRecovery(f.admin.id, f.account.id, ITEMS);
      const deadline = Date.now() + 3_000;
      while (internal.verificationRecoveryInFlight.size && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
      // The second pass may clear the new revision by its server probe alone.
      assert.equal(internal.verificationRecoveryInFlight.size, 0);
      assert.equal(internal.verificationRecoveryTimers.size, 0);
      assert.equal((await f.store.listAccountVerificationRisks(f.admin.id, f.account.id)).length, 0);
    } finally { await service.close(); await f.close(); }
  });

  test(`${kind}: unknown/write risk starts a browser probe with a healthy IM and never replays the write`, async () => {
    const f = await fixture();
    const service = new XianyuImService(f.store, f.mtop, {} as never, undefined, undefined, f.browser);
    const internal = service as any;
    internal.clients.set(`${f.admin.id}:${f.account.id}`, { connected: true, disconnect: async () => undefined });
    try {
      await f.store.recordAccountRisk({ adminId: f.admin.id, accountId: f.account.id, source: 'unknown.write', code: 'ACCOUNT_VALIDATION_REQUIRED' });
      service.requestVerificationRecovery(f.admin.id, f.account.id, 'unknown.write');
      await internal.verificationRecoveryInFlight.get(`${f.admin.id}:${f.account.id}`);
      assert.deepEqual(f.browserCalls, ['mtop.taobao.idlemessage.pc.loginuser.get']);
      assert.deepEqual(f.requests, []);
      assert.equal((await f.store.listAccountVerificationRisks(f.admin.id, f.account.id))[0].source, 'unknown.write');
      assert.equal((await f.store.getCredential(f.admin.id, f.account.id))?.accessToken, 'healthy-im-token');
    } finally { await service.close(); await f.close(); }
  });

  test(`${kind}: a notification arriving during the final risk snapshot cannot be dropped`, async () => {
    const f = await fixture();
    const service = new XianyuImService(f.store, f.mtop, {} as never, undefined, undefined, f.browser);
    const internal = service as any;
    const key = `${f.admin.id}:${f.account.id}`;
    internal.clients.set(key, { connected: true, disconnect: async () => undefined });
    f.during(async () => { service.requestVerificationRecovery(f.admin.id, f.account.id, ITEMS); });
    const list = f.store.listAccountVerificationRisks.bind(f.store);
    let clearedScans = 0;
    let injected = false;
    f.store.listAccountVerificationRisks = async (a, b) => {
      const snapshot = await list(a, b);
      if (!snapshot.length && f.solved.has(ITEMS) && internal.verificationRecoverySignals.has(key)) {
        clearedScans++;
        if (clearedScans === 2 && !injected) {
          injected = true;
          await f.risk(ORDERS);
          service.requestVerificationRecovery(f.admin.id, f.account.id, ORDERS);
        }
      }
      return snapshot;
    };
    try {
      await f.risk();
      service.requestVerificationRecovery(f.admin.id, f.account.id, ITEMS);
      const deadline = Date.now() + 3_000;
      while (internal.verificationRecoveryInFlight.size && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
      assert.equal(injected, true);
      assert.deepEqual(f.browserCalls, [ITEMS, ORDERS]);
      assert.equal((await list(f.admin.id, f.account.id)).length, 0);
    } finally { await service.close(); await f.close(); }
  });
}
