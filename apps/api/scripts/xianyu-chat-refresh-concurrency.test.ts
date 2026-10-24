import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { MemoryStore } from '../src/store-memory.js';
import { PostgresStore } from '../src/store-postgres.js';
import { XianyuImService } from '../src/xianyu-im-service.js';
import { XianyuMtopClient } from '../src/xianyu-mtop.js';
import type { Store } from '../src/domain.js';

const modes = process.env.CHAT_REFRESH_TEST_DATABASE_URL ? ['memory', 'postgres'] as const : ['memory'] as const;
async function fixture(mode: string, enableRecovery = false) {
  const databaseUrl = process.env.CHAT_REFRESH_TEST_DATABASE_URL;
  if (mode === 'postgres') {
    const url = new URL(databaseUrl!);
    assert.equal(url.hostname, '127.0.0.1');
    assert.equal(url.pathname, '/xianyu_chat_refresh_test');
  }
  const store: Store = mode === 'postgres' ? new PostgresStore(databaseUrl!) : new MemoryStore();
  const admin = await store.createAdmin({ email: `refresh-${randomUUID()}@example.com`, displayName: 'CAS test', passwordHash: 'test' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: `seller-${randomUUID()}` });
  const credential = await store.upsertCredential({ adminId: admin.id, accountId: account.id, platform: 'xianyu',
    cookieHeader: `unb=${account.sellerRef}; cookie2=original; _m_h5_tk=original_suffix`, accessToken: 'original-access', deviceId: 'device-1',
    metadata: { loginMethod: 'fixture' } });
  let tokenCalls = 0;
  let updates = 0;
  let release!: () => void;
  let enter!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const entered = new Promise<void>(resolve => { enter = resolve; });
  let holdApi = 'loginuser.get';
  let challenge = false;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    const api = new URL(String(input)).searchParams.get('api')!;
    if (api.endsWith(holdApi)) { enter(); await held; }
    if (api.endsWith('login.token')) tokenCalls++;
    return new Response(JSON.stringify(api.endsWith('login.token')
      ? challenge ? { ret: ['FAIL_SYS_USER_VALIDATE::verification required'], data: { url: 'https://www.goofish.com/punish' } }
        : { ret: ['SUCCESS::调用成功'], data: { accessToken: 'periodic-access' } }
      : { ret: ['SUCCESS::调用成功'], data: { userId: account.sellerRef } }), {
      headers: { 'content-type': 'application/json', 'set-cookie': '_m_h5_tk=rotated_suffix; Domain=.goofish.com; Path=/; Secure' },
    });
  };
  let service: XianyuImService;
  let riskSignals = 0;
  let browserCalls = 0;
  let liveCookieWrites = 0;
  const mtop = new XianyuMtopClient({ loadCredential: async () => store.getCredential(admin.id, account.id),
    saveCookie: async (_admin, _account, cookieHeader, metadata) => {
      liveCookieWrites++;
      const current = await store.getCredential(admin.id, account.id);
      await store.upsertCredential({ ...current!, adminId: admin.id, accountId: account.id, platform: 'xianyu', cookieHeader, metadata });
    },
    onFailure: async ({ api }) => {
      riskSignals++;
      await store.recordAccountRisk({ adminId: admin.id, accountId: account.id, source: api, code: 'ACCOUNT_VALIDATION_REQUIRED' });
      service.requestVerificationRecovery(admin.id, account.id, api);
    } });
  const browser = { enabled: enableRecovery, waitForCompletion: async () => {
    browserCalls++;
    return { finalUrl: 'https://www.goofish.com/im', cookieSnapshot: [
      { name: 'unb', value: account.sellerRef, domain: '.goofish.com', path: '/' },
      { name: '_m_h5_tk', value: 'native_suffix', domain: '.goofish.com', path: '/' },
    ], imToken: { accessToken: 'native-access', deviceId: 'device-1', userId: account.sellerRef } };
  } };
  service = new XianyuImService(store, mtop, {} as never, undefined, undefined, browser as never);
  const internal = service as any;
  internal.clients.set(`${admin.id}:${account.id}`, { connected: true, deviceId: 'device-1', updateCredential: () => { updates++; },
    refreshSession: async () => internal.refreshCredential(admin.id, await store.getAccount(admin.id, account.id), await store.getCredential(admin.id, account.id)),
    disconnect: async () => undefined });
  return { store, admin, account, credential, service, internal, release, entered,
    holdToken: () => { holdApi = 'login.token'; }, challenge: () => { challenge = true; }, riskSignals: () => riskSignals,
    tokenCalls: () => tokenCalls, updates: () => updates, browserCalls: () => browserCalls, liveCookieWrites: () => liveCookieWrites,
    close: async () => { release(); await service.close(); globalThis.fetch = realFetch; if (mode === 'postgres') await (store as PostgresStore).close(); } };
}

for (const mode of modes) {
  for (const mutation of ['manual', 'revoke', 'disable'] as const) {
    test(`${mode}: in-flight Set-Cookie cannot overwrite ${mutation} or reactivate revoked credentials`, async () => {
      const f = await fixture(mode);
      try {
        const refresh = f.internal.refreshChatSession(f.admin.id, f.account.id);
        const outcome = refresh.then(() => 'ok', () => 'superseded');
        await f.entered;
        if (mutation === 'manual') await f.store.upsertCredential({ adminId: f.admin.id, accountId: f.account.id, platform: 'xianyu',
          cookieHeader: `unb=${f.account.sellerRef}; cookie2=manual; _m_h5_tk=manual_suffix`, accessToken: 'manual-access', deviceId: 'device-1', metadata: { loginMethod: 'manual' } });
        if (mutation === 'revoke') await f.store.revokeCredential(f.admin.id, f.account.id);
        if (mutation === 'disable') await f.store.deleteAccount(f.admin.id, f.account.id);
        f.release(); await outcome;
        const saved = await f.store.getCredential(f.admin.id, f.account.id);
        assert.equal(f.updates(), 0);
        assert.equal(f.liveCookieWrites(), 0, 'periodic Set-Cookie writes must remain isolated');
        if (mutation === 'manual') {
          assert.equal(saved?.accessToken, 'manual-access');
          assert.equal(saved?.cookieHeader, `unb=${f.account.sellerRef}; cookie2=manual; _m_h5_tk=manual_suffix`);
          assert.equal(saved?.metadata.loginMethod, 'manual');
        } else {
          assert.notEqual(saved?.accessToken, 'periodic-access');
          assert.doesNotMatch(saved?.cookieHeader ?? '', /rotated_suffix/);
          if (mutation === 'revoke') assert.equal(saved?.status, 'revoked');
        }
      } finally { await f.close(); }
    });
  }

  test(`${mode}: socket 401 and periodic maintenance share one HTTP token request`, async () => {
    const f = await fixture(mode); f.holdToken();
    try {
      const periodic = f.internal.refreshChatSession(f.admin.id, f.account.id);
      await f.entered;
      const onDemand = f.internal.refreshCredential(f.admin.id, f.account, f.credential);
      f.release();
      const [, renewed] = await Promise.all([periodic, onDemand]);
      assert.equal(f.tokenCalls(), 1);
      assert.equal(renewed.accessToken, 'periodic-access');
      assert.equal((await f.store.getCredential(f.admin.id, f.account.id))?.accessToken, 'periodic-access');
      assert.equal(f.internal.tokenRefreshInFlight.size, 0);
    } finally { await f.close(); }
  });

  test(`${mode}: concurrent conditional commits have one winner and do not bypass scope`, async () => {
    const f = await fixture(mode);
    try {
      const expected = structuredClone(await f.store.getCredential(f.admin.id, f.account.id));
      const input = { adminId: f.admin.id, accountId: f.account.id, expected: expected!, cookieHeader: 'new-cookie',
        accessToken: 'one-winner', deviceId: 'device-1', metadata: { loginMethod: 'fixture' } };
      const [a, b] = await Promise.all([f.store.commitCredentialRefresh(input), f.store.commitCredentialRefresh(input)]);
      assert.equal(Number(Boolean(a)) + Number(Boolean(b)), 1);
      assert.equal(await f.store.commitCredentialRefresh({ ...input, adminId: randomUUID() }), undefined);
      assert.equal((await f.store.getCredential(f.admin.id, f.account.id))?.accessToken, 'one-winner');
    } finally { await f.close(); }
  });

  test(`${mode}: periodic challenge fails without self-deadlock and releases the token recovery slot`, async () => {
    const f = await fixture(mode); f.challenge();
    try {
      const refresh = f.internal.refreshChatSession(f.admin.id, f.account.id);
      f.release();
      await assert.rejects(refresh, { code: 'ACCOUNT_VALIDATION_REQUIRED' });
      assert.equal(f.riskSignals(), 1);
      assert.equal(f.internal.tokenRefreshInFlight.size, 0);
      assert.equal((await f.store.getCredential(f.admin.id, f.account.id))?.accessToken, 'original-access');
    } finally { await f.close(); }
  });

  test(`${mode}: existing automatic challenge recovery starts after periodic HTTP releases its token slot`, async () => {
    const f = await fixture(mode, true); f.challenge();
    try {
      const refresh = f.internal.refreshChatSession(f.admin.id, f.account.id);
      f.release();
      await assert.rejects(refresh, { code: 'ACCOUNT_VALIDATION_REQUIRED' });
      const recovery = [...f.internal.verificationRecoveryInFlight.values()];
      assert.equal(recovery.length, 1);
      await Promise.all(recovery);
      assert.equal(f.browserCalls(), 1);
      assert.equal((await f.store.getCredential(f.admin.id, f.account.id))?.accessToken, 'native-access');
      assert.equal((await f.store.getAccount(f.admin.id, f.account.id))?.riskEpisode, undefined);
      assert.equal(f.internal.tokenRefreshInFlight.size, 0);
    } finally { await f.close(); }
  });

  test(`${mode}: conditional storage failure leaves the previous credential and live client intact`, async () => {
    const f = await fixture(mode);
    try {
      f.store.commitCredentialRefresh = async () => { throw new Error('FIXTURE_DATABASE_WRITE_FAILED'); };
      const refresh = f.internal.refreshChatSession(f.admin.id, f.account.id);
      f.release();
      await assert.rejects(refresh, /FIXTURE_DATABASE_WRITE_FAILED/);
      const saved = await f.store.getCredential(f.admin.id, f.account.id);
      assert.equal(saved?.accessToken, 'original-access');
      assert.doesNotMatch(saved?.cookieHeader ?? '', /rotated_suffix/);
      assert.equal(f.updates(), 0);
      assert.equal(f.internal.tokenRefreshInFlight.size, 0);
    } finally { await f.close(); }
  });
}
