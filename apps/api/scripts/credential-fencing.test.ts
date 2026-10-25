import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import WebSocket, { WebSocketServer } from 'ws';
import { MemoryStore } from '../src/store-memory.js';
import { XianyuMtopClient } from '../src/xianyu-mtop.js';
import { XianyuImClient, XIANYU_IM_TOKEN_API } from '../src/xianyu-im.js';
import { XianyuImService } from '../src/xianyu-im-service.js';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

const deferred = <T = void>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
async function until(check: () => Promise<boolean> | boolean) {
  const deadline = Date.now() + 2_000;
  while (!await check()) { if (Date.now() >= deadline) throw new Error('condition timeout'); await new Promise(done => setTimeout(done, 5)); }
}
async function fixture() {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: `${randomUUID()}@example.test`, passwordHash: 'test', displayName: 'fence' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'seller-1' });
  const credential = structuredClone(await store.upsertCredential({ adminId: admin.id, accountId: account.id, platform: 'xianyu', cookieHeader: 'unb=seller-1; _m_h5_tk=start_suffix', deviceId: 'device-1', accessToken: 'start-access' }));
  return { store, admin, account, credential };
}

for (const fallback of [false, true]) test(`late ${fallback ? 'browser fallback' : 'ordinary'} token response cannot overwrite a newer snapshot in the same generation`, async () => {
  const f = await fixture(); const requested = deferred(); const response = deferred<Response>();
  const originalFetch = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (fallback && calls === 1) return new Response(JSON.stringify({ ret: ['FAIL_SYS_USER_VALIDATE::verification'], data: { url: 'https://www.goofish.com/punish' } }), { headers: { 'content-type': 'application/json' } });
    requested.resolve(); return response.promise;
  };
  const mtop = new XianyuMtopClient({ loadCredential: async () => f.store.getCredential(f.admin.id, f.account.id), saveCookie: async () => { throw new Error('request-local session must buffer cookies'); } });
  const service = new XianyuImService(f.store, mtop, {} as never, undefined, undefined, fallback ? {
    enabled: true, waitForCompletion: async () => ({ finalUrl: 'https://www.goofish.com/im', cookieSnapshot: [
      { name: 'unb', value: 'seller-1', domain: '.goofish.com', path: '/' },
      { name: '_m_h5_tk', value: 'browser_suffix', domain: '.goofish.com', path: '/' },
    ] }),
  } as never : undefined);
  try {
    const task = (service as any).refreshCredential(f.admin.id, f.account, f.credential);
    await requested.promise;
    const current = structuredClone((await f.store.getCredential(f.admin.id, f.account.id))!);
    const newest = await f.store.commitCredentialRefresh({ adminId: f.admin.id, accountId: f.account.id, expected: current,
      cookieHeader: 'unb=seller-1; _m_h5_tk=newest_suffix', accessToken: 'newest-access', deviceId: current.deviceId, metadata: { newest: 'true' } });
    assert.ok(newest); assert.equal(newest.generation, f.credential.generation);
    response.resolve(new Response(JSON.stringify({ ret: ['SUCCESS::OK'], data: { accessToken: 'old-response' } }), { headers: { 'set-cookie': '_m_h5_tk=old_suffix; Path=/', 'content-type': 'application/json' } }));
    await assert.rejects(task, { code: 'XIANYU_VERIFICATION_CREDENTIAL_CHANGED' });
    assert.equal((await f.store.getCredential(f.admin.id, f.account.id))?.accessToken, 'newest-access');
    assert.equal((await f.store.getCredential(f.admin.id, f.account.id))?.cookieHeader, 'unb=seller-1; _m_h5_tk=newest_suffix');
  } finally { globalThis.fetch = originalFetch; await service.close(); }
});

test('verification status requires the complete request snapshot across login, same-generation refresh and revoke', async () => {
  for (const next of ['login', 'refresh', 'revoke']) for (const status of ['active', 'expired'] as const) {
    const f = await fixture();
    if (next === 'login') await f.store.upsertCredential({ adminId: f.admin.id, accountId: f.account.id, platform: 'xianyu', cookieHeader: 'unb=seller-1; _m_h5_tk=new-login' });
    if (next === 'refresh') assert.ok(await f.store.commitCredentialRefresh({ adminId: f.admin.id, accountId: f.account.id, expected: f.credential, cookieHeader: 'unb=seller-1; _m_h5_tk=new-refresh', accessToken: 'new-refresh-token', metadata: {}, deviceId: 'device-1' }));
    if (next === 'revoke') await f.store.revokeCredential(f.admin.id, f.account.id);
    const before = structuredClone(await f.store.getCredential(f.admin.id, f.account.id));
    assert.equal(await f.store.markCredentialVerified({ adminId: f.admin.id, accountId: f.account.id, status, expected: f.credential }), undefined, `${next}/${status}`);
    assert.equal(await f.store.markCredentialVerified({ adminId: f.admin.id, accountId: f.account.id, status }), undefined, 'unbound result is never assigned the execution-time generation');
    assert.deepEqual(await f.store.getCredential(f.admin.id, f.account.id), before);
  }
});

test('production MTOP failure callback carries request evidence and cannot expire a subsequent login or refreshed snapshot', async () => {
  for (const replacement of ['login', 'refresh']) {
    const runtime = createApp(loadConfig({ ALLOW_IN_MEMORY: 'true', DATABASE_URL: '', REDIS_URL: '', XIANYU_QR_MODE: 'stub' }));
    const originalFetch = globalThis.fetch; const requested = deferred(); const response = deferred<Response>();
    globalThis.fetch = async () => { requested.resolve(); return response.promise; };
    try {
      const account = await runtime.store.createAccount({ adminId: 'admin-1', platform: 'xianyu', sellerRef: randomUUID() });
      const initial = structuredClone(await runtime.store.upsertCredential({ adminId: 'admin-1', accountId: account.id, platform: 'xianyu', cookieHeader: 'unb=seller-1; _m_h5_tk=old_suffix', accessToken: 'old-access' }));
      const task = runtime.xianyu.verifyLogin('admin-1', account.id);
      await requested.promise;
      if (replacement === 'login') await runtime.store.upsertCredential({ adminId: 'admin-1', accountId: account.id, platform: 'xianyu', cookieHeader: 'unb=seller-1; _m_h5_tk=new_suffix', accessToken: 'new-access' });
      else assert.ok(await runtime.store.commitCredentialRefresh({ adminId: 'admin-1', accountId: account.id, expected: initial,
        cookieHeader: 'unb=seller-1; _m_h5_tk=new_suffix', accessToken: 'new-access', metadata: {} }));
      response.resolve(new Response(JSON.stringify({ ret: ['FAIL_SYS_SESSION_EXPIRED::expired'] }), { headers: { 'content-type': 'application/json' } }));
      const result = await task;
      assert.equal(result.success, false);
      assert.equal((await runtime.store.getCredential('admin-1', account.id))?.status, 'active', replacement);
      assert.equal((await runtime.store.getCredential('admin-1', account.id))?.accessToken, 'new-access');
      assert.notEqual((await runtime.store.getAccount('admin-1', account.id))?.status, 'expired');
      assert.equal(Object.keys(result).includes('credential'), false, 'internal evidence is never part of serialized API results');
      assert.equal(result.credential?.generation, initial.generation, 'failure result remains bound to its original request');
    } finally { globalThis.fetch = originalFetch; await runtime.close(); }
  }
});

for (const interference of ['none', 'new-risk', 'new-login', 'registration-failed', 'heartbeat-timeout', 'disconnect-during-credential', 'disconnect-during-transport', 'disconnect-during-clear'] as const) test(`real WS registration needs a matched fresh heartbeat; ${interference} is fenced`, async () => {
  const f = await fixture();
  for (const source of [XIANYU_IM_TOKEN_API, 'im_listener']) await f.store.recordAccountRisk({ adminId: f.admin.id, accountId: f.account.id, code: 'ACCOUNT_VALIDATION_REQUIRED', source });
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' }); await once(server, 'listening');
  const address = server.address() as { port: number }; const probes: Array<{ socket: WebSocket; mid: string }> = [];
  server.on('connection', socket => socket.on('message', raw => {
    const frame = JSON.parse(raw.toString());
    if (frame.lwp === '/reg') socket.send(JSON.stringify({ code: interference === 'registration-failed' ? 500 : 200, headers: { mid: frame.headers.mid } }));
    if (frame.lwp === '/!') probes.push({ socket, mid: frame.headers.mid });
  }));
  const mtop = { fetchImToken: async () => {
    if (interference === 'new-risk') await f.store.recordAccountRisk({ adminId: f.admin.id, accountId: f.account.id, code: 'ACCOUNT_VALIDATION_REQUIRED', source: XIANYU_IM_TOKEN_API });
    return { success: true, accessToken: 'fresh-access', cookieHeader: f.credential.cookieHeader };
  } };
  const service = new XianyuImService(f.store, mtop as never, {} as never, undefined, undefined, { enabled: true } as never,
    undefined, undefined, undefined, options => new XianyuImClient({ ...options, heartbeatIntervalMs: interference === 'heartbeat-timeout' ? 100 : 1_000,
      webSocketFactory: () => new WebSocket(`ws://127.0.0.1:${address.port}`) as never }));
  // No history fixture is needed: this test exercises registration/liveness only.
  (service as any).scheduleRecentMessageRecovery = () => undefined;
  try {
    if (interference === 'registration-failed') {
      await assert.rejects((service as any).ensureClient(f.admin.id, f.account.id), { code: 500 });
      assert.equal(probes.length, 0);
      assert.equal((await f.store.listAccountVerificationRisks(f.admin.id, f.account.id)).length, 2, 'token persistence cannot clear risk after registration fails');
      assert.notEqual((await f.store.getAccount(f.admin.id, f.account.id))?.transportStatus, 'connected');
      return;
    }
    const client = await (service as any).ensureClient(f.admin.id, f.account.id);
    await until(() => probes.length === 1);
    assert.equal((await f.store.listAccountVerificationRisks(f.admin.id, f.account.id)).length, 2, 'registration is not recovery');
    assert.notEqual((await f.store.getAccount(f.admin.id, f.account.id))?.transportStatus, 'connected');
    if (interference === 'heartbeat-timeout') {
      await until(() => probes.length >= 2);
      assert.equal((await f.store.listAccountVerificationRisks(f.admin.id, f.account.id)).length, 2, 'at least one full unanswered heartbeat timeout leaves recovery pending');
      assert.notEqual((await f.store.getAccount(f.admin.id, f.account.id))?.transportStatus, 'connected');
      return;
    }
    probes[0].socket.send(JSON.stringify({ code: 200, headers: { mid: 'unrelated-heartbeat' } }));
    await new Promise(done => setTimeout(done, 20));
    assert.equal((await f.store.listAccountVerificationRisks(f.admin.id, f.account.id)).length, 2, 'unsolicited/wrong-mid message is not heartbeat evidence');
    if (interference === 'new-login') await f.store.upsertCredential({ adminId: f.admin.id, accountId: f.account.id, platform: 'xianyu', cookieHeader: 'unb=seller-1; _m_h5_tk=new-login' });
    const entered = deferred(); const gate = deferred(); let armed = true;
    if (interference === 'disconnect-during-credential') {
      const original = f.store.getCredential.bind(f.store);
      f.store.getCredential = async (...args) => { if (armed) { armed = false; entered.resolve(); await gate.promise; } return original(...args); };
    }
    if (interference === 'disconnect-during-transport') {
      const original = f.store.setAccountTransport.bind(f.store);
      f.store.setAccountTransport = async input => { if (armed && input.status === 'connected') { armed = false; entered.resolve(); await gate.promise; } return original(input); };
    }
    if (interference === 'disconnect-during-clear') {
      const original = f.store.clearAccountRisk.bind(f.store);
      f.store.clearAccountRisk = async input => { if (armed) { armed = false; entered.resolve(); await gate.promise; } return original(input); };
    }
    probes[0].socket.send(JSON.stringify({ code: 200, headers: { mid: probes[0].mid } }));
    if (interference.startsWith('disconnect-')) {
      await entered.promise;
      probes[0].socket.terminate();
      await until(() => !client.connected);
      await f.store.recordAccountRisk({ adminId: f.admin.id, accountId: f.account.id, code: 'ACCOUNT_VALIDATION_REQUIRED', source: XIANYU_IM_TOKEN_API });
      gate.resolve();
      await until(async () => (await f.store.getAccount(f.admin.id, f.account.id))?.transportStatus === 'disconnected');
      await new Promise(done => setTimeout(done, 20));
      assert.equal(client.connected, false);
      assert.equal((await f.store.getAccount(f.admin.id, f.account.id))?.transportStatus, 'disconnected', 'late heartbeat storage cannot overwrite the ordered disconnect');
      assert.equal((await f.store.listAccountVerificationRisks(f.admin.id, f.account.id)).length, 2, 'disconnect invalidates pending risk clearing, including the newer token risk');
      return;
    }
    if (interference !== 'new-login') await until(async () => (await f.store.getAccount(f.admin.id, f.account.id))?.transportStatus === 'connected');
    await new Promise(done => setTimeout(done, 20));
    const risks = await f.store.listAccountVerificationRisks(f.admin.id, f.account.id);
    assert.equal(risks.length, interference === 'none' ? 0 : interference === 'new-risk' ? 1 : 2);
    if (interference === 'new-risk') assert.equal(risks[0].source, XIANYU_IM_TOKEN_API);
    if (interference === 'new-login') assert.notEqual((await f.store.getAccount(f.admin.id, f.account.id))?.transportStatus, 'connected', 'old socket cannot make the new login healthy');
  } finally {
    await service.close(); for (const socket of server.clients) socket.terminate(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
