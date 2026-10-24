import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryStore } from '../src/store-memory.js';
import { XianyuImService } from '../src/xianyu-im-service.js';
import { XianyuImClient, XIANYU_IM_TOKEN_API } from '../src/xianyu-im.js';
import { cookieSnapshotFromMetadata } from '../src/xianyu-cookie-jar.js';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { XianyuVerificationRecoveryBridge } from '../src/xianyu-verification-recovery-bridge.js';
import { Redis } from 'ioredis';

export async function until(predicate: () => boolean | Promise<boolean>): Promise<void> {
  const deadline = performance.now() + 3_000;
  while (!await predicate()) {
    if (performance.now() > deadline) throw new Error('Expected immediate verification recovery did not run');
    await new Promise(resolve => setImmediate(resolve));
  }
}

export async function fixture() {
  const store = new MemoryStore();
  const account = await store.createAccount({ adminId: 'admin-1', platform: 'xianyu', sellerRef: 'seller-1' });
  await store.upsertCredential({ adminId: 'admin-1', accountId: account.id, platform: 'xianyu',
    cookieHeader: 'unb=seller-1; _m_h5_tk=old_suffix', accessToken: 'cached-access', deviceId: 'device-1' });
  let browserCalls = 0;
  let fail = false;
  let release: Promise<void> = Promise.resolve();
  let service: XianyuImService;
  const browser = { enabled: true, waitForCompletion: async () => {
    browserCalls++;
    await release;
    if (fail) throw new Error('XIANYU_VERIFICATION_AUTO_SOLVE_FAILED');
    return { finalUrl: 'https://www.goofish.com/im', cookieSnapshot: [
      { name: 'unb', value: 'seller-1', domain: '.goofish.com', path: '/' },
      { name: '_m_h5_tk', value: 'native_suffix', domain: '.goofish.com', path: '/' },
      { name: 'x5sec', value: 'passed', domain: '.goofish.com', path: '/', partitionKey: 'https://goofish.com', _crHasCrossSiteAncestor: false },
    ], imToken: { accessToken: 'native-access', deviceId: 'device-1', userId: 'seller-1' } };
  } };
  service = new XianyuImService(store, { fetchImToken: async () => {
    await store.recordAccountRisk({ adminId: 'admin-1', accountId: account.id, source: XIANYU_IM_TOKEN_API, code: 'ACCOUNT_VALIDATION_REQUIRED' });
    // The MTOP failure hook fires while the current recovery is requesting a token.
    service.requestVerificationRecovery('admin-1', account.id, XIANYU_IM_TOKEN_API);
    return { success: false, accountInvalid: true, errorCode: 'ACCOUNT_VALIDATION_REQUIRED',
      verificationUrl: 'https://www.goofish.com/punish', cookieHeader: 'unb=seller-1; _m_h5_tk=old_suffix' };
  } } as never, {} as never, undefined, undefined, browser as never);
  const internal = service as any;
  internal.scheduleRecentMessageRecovery = () => undefined;
  internal.clients.set(`admin-1:${account.id}`, { connected: true, connect: async () => undefined,
    refreshSession: async () => internal.refreshCredential('admin-1', await store.getAccount('admin-1', account.id), await store.getCredential('admin-1', account.id)),
    disconnect: async () => undefined });
  const risk = () => store.recordAccountRisk({ adminId: 'admin-1', accountId: account.id, source: XIANYU_IM_TOKEN_API, code: 'ACCOUNT_VALIDATION_REQUIRED' });
  const settled = () => until(() => internal.verificationRecoveryInFlight.size === 0);
  return { store, service, account, internal, risk, settled, browserCalls: () => browserCalls,
    fail: () => { fail = true; }, hold: (promise: Promise<void>) => { release = promise; } };
}

test('startup immediately recovers persisted verification risk despite a connected cached token', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const f = await fixture();
  try {
    await f.risk();
    await f.service.startListener('admin-1', f.account.id);
    await until(() => f.browserCalls() === 1);
    await f.settled();
    assert.equal((await f.store.getCredential('admin-1', f.account.id))?.accessToken, 'native-access');
    assert.equal((await f.store.getAccount('admin-1', f.account.id))?.riskEpisode, undefined);
    assert.equal(cookieSnapshotFromMetadata((await f.store.getCredential('admin-1', f.account.id))?.metadata)?.length, 3);
    // No periodic timer was advanced to make recovery happen.
  } finally { await f.service.close(); }
});

test('concurrent risk signals share one recovery and recursive MTOP signals cannot deadlock it', async () => {
  const f = await fixture();
  let release!: () => void;
  f.hold(new Promise<void>(resolve => { release = resolve; }));
  try {
    await f.risk();
    for (let index = 0; index < 20; index++) f.service.requestVerificationRecovery('admin-1', f.account.id, 'im_listener');
    await until(() => f.browserCalls() === 1);
    assert.equal(f.internal.verificationRecoveryInFlight.size, 1);
    release();
    await f.settled();
    assert.equal(f.browserCalls(), 1);
  } finally { release(); await f.service.close(); }
});

test('failed verification keeps credentials and a new signal retries after the short cooldown', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.now() });
  const f = await fixture();
  try {
    await f.risk();
    f.fail();
    f.service.requestVerificationRecovery('admin-1', f.account.id, 'im_listener');
    await f.settled();
    assert.equal(f.browserCalls(), 1);
    f.service.requestVerificationRecovery('admin-1', f.account.id, 'im_listener');
    await f.settled();
    assert.equal(f.internal.verificationRecoveryTimers.size, 1);
    assert.equal(f.browserCalls(), 1);
    assert.equal((await f.store.getCredential('admin-1', f.account.id))?.accessToken, 'cached-access');
    assert.equal((await f.store.getAccount('admin-1', f.account.id))?.status, 'verification_required');
    t.mock.timers.tick(30_001);
    await f.settled();
    assert.equal(f.browserCalls(), 2, 'must not wait for scheduled session maintenance');
  } finally { await f.service.close(); }
});

test('healthy, revoked and disabled accounts do not launch recovery, and shutdown ignores late signals', async () => {
  for (const state of ['healthy', 'revoked', 'disabled', 'closed']) {
    const f = await fixture();
    try {
      if (state !== 'healthy') await f.risk();
      if (state === 'revoked') await f.store.revokeCredential('admin-1', f.account.id);
      if (state === 'disabled') await f.store.deleteAccount('admin-1', f.account.id);
      if (state === 'closed') await f.service.close();
      f.service.requestVerificationRecovery('admin-1', f.account.id, 'im_listener');
      await f.settled();
      assert.equal(f.browserCalls(), 0, state);
    } finally { await f.service.close(); }
  }
});

test('forced recovery refreshes a cached credential before constructing a replacement IM client', async () => {
  const f = await fixture();
  const connect = XianyuImClient.prototype.connect;
  const registeredTokens: string[] = [];
  XianyuImClient.prototype.connect = async function () { registeredTokens.push((this as any).credential.accessToken); };
  try {
    f.internal.clients.clear();
    await f.internal.ensureClient('admin-1', f.account.id, { forceCredentialRefresh: true });
    assert.equal(f.browserCalls(), 1);
    assert.deepEqual(registeredTokens, ['native-access']);
    await f.settled();
  } finally { XianyuImClient.prototype.connect = connect; await f.service.close(); }
});

test('startup with persisted risk obtains a fresh token before registering a cached credential', async () => {
  const f = await fixture();
  const connect = XianyuImClient.prototype.connect;
  const registeredTokens: string[] = [];
  XianyuImClient.prototype.connect = async function () { registeredTokens.push((this as any).credential.accessToken); };
  try {
    f.internal.clients.clear();
    await f.risk();
    await f.service.startListener('admin-1', f.account.id);
    await f.settled();
    assert.equal(f.browserCalls(), 1);
    assert.deepEqual(registeredTokens, ['native-access']);
  } finally { XianyuImClient.prototype.connect = connect; await f.service.close(); }
});

test('production MTOP failure hook commits risk before waking immediate recovery', async () => {
  const runtime = createApp(loadConfig({ ALLOW_IN_MEMORY: 'true', DATABASE_URL: '', REDIS_URL: '', XIANYU_QR_MODE: 'stub' }));
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  try {
    const account = await runtime.store.createAccount({ adminId: 'admin-1', platform: 'xianyu', sellerRef: 'seller-1' });
    await runtime.store.upsertCredential({ adminId: 'admin-1', accountId: account.id, platform: 'xianyu', cookieHeader: 'unb=seller-1; _m_h5_tk=old_suffix' });
    runtime.xianyuIm.requestVerificationRecovery = (adminId, accountId, source) => { calls.push(`${adminId}:${accountId}:${source}`); };
    globalThis.fetch = async () => new Response(JSON.stringify({ ret: ['FAIL_SYS_USER_VALIDATE::请完成验证'], data: {} }), { headers: { 'content-type': 'application/json' } });
    const result = await runtime.xianyu.fetchItemDetail('admin-1', account.id, 'item-1');
    assert.equal(result.errorCode, 'ACCOUNT_VALIDATION_REQUIRED');
    assert.equal((await runtime.store.getAccount('admin-1', account.id))?.status, 'verification_required');
    assert.deepEqual((await runtime.store.listAccountVerificationRisks('admin-1', account.id))[0].recoveryRequest, { kind: 'item_detail', itemId: 'item-1' });
    assert.deepEqual(calls, [`admin-1:${account.id}:mtop.taobao.idle.pc.detail`]);
  } finally { globalThis.fetch = originalFetch; await runtime.close(); }
});

const redisUrl = process.env.VERIFICATION_RECOVERY_TEST_REDIS_URL;
if (redisUrl) {
  assert.ok(['127.0.0.1', 'localhost'].includes(new URL(redisUrl).hostname), 'recovery transport tests require isolated local Redis');
  test('a worker risk wake travels through real Redis to the API recovery owner', async () => {
    const f = await fixture();
    const owner = new XianyuVerificationRecoveryBridge(redisUrl, request => f.service.requestVerificationRecovery(request.adminId, request.accountId, request.source));
    const worker = new XianyuVerificationRecoveryBridge(redisUrl, () => assert.fail('worker must not subscribe'));
    let subscribed!: () => void;
    const ready = new Promise<void>(resolve => { subscribed = resolve; });
    try {
      owner.startConsumer(async () => { subscribed(); });
      worker.startPublisher();
      await ready;
      await f.risk();
      await Promise.all(Array.from({ length: 10 }, () => worker.publish({ adminId: 'admin-1', accountId: f.account.id, source: XIANYU_IM_TOKEN_API })));
      await until(() => f.browserCalls() === 1);
      await f.settled();
      assert.equal((await f.store.getCredential('admin-1', f.account.id))?.accessToken, 'native-access');
    } finally { await owner.close(); await worker.close(); await f.service.close(); }
  });

  test('resubscribing replays database risk when Redis missed the original wake', async () => {
    const f = await fixture();
    const owner = new XianyuVerificationRecoveryBridge(redisUrl, request => f.service.requestVerificationRecovery(request.adminId, request.accountId, request.source));
    const worker = new XianyuVerificationRecoveryBridge(redisUrl, () => undefined);
    const control = new Redis(redisUrl);
    let subscribed = 0;
    const subscriber = (owner as unknown as { subscriber: Redis }).subscriber;
    try {
      owner.startConsumer(async () => {
        subscribed++;
        f.service.requestVerificationRecovery('admin-1', f.account.id, 'redis_resubscribe');
      });
      worker.startPublisher();
      await until(() => subscribed === 1);
      await f.settled();
      subscriber.disconnect();
      await until(async () => Number((await control.pubsub('NUMSUB', 'xianyu:verification-recovery:v1') as [string, string])[1]) === 0);
      await f.risk();
      await worker.publish({ adminId: 'admin-1', accountId: f.account.id, source: XIANYU_IM_TOKEN_API });
      assert.equal(f.browserCalls(), 0);
      await subscriber.connect();
      await until(() => subscribed === 2 && f.browserCalls() === 1);
      await f.settled();
      assert.equal((await f.store.getAccount('admin-1', f.account.id))?.riskEpisode, undefined);
    } finally { control.disconnect(); await owner.close(); await worker.close(); await f.service.close(); }
  });
}
