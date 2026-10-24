import assert from 'node:assert/strict';
import test from 'node:test';
import { planXianyuChatRefresh } from '../src/xianyu-chat-refresh-policy.js';
import { XianyuImService } from '../src/xianyu-im-service.js';
import { MemoryStore } from '../src/store-memory.js';

const minute = 60_000;
const at = (time: string) => Date.parse(`2026-10-24T${time}:00+08:00`);
const flush = async () => { for (let i = 0; i < 60; i++) await Promise.resolve(); };

test('Shanghai schedule uses distinct random day, evening and night ranges', () => {
  for (const [hour, period, min, max] of [['10:00', 'day', 25, 45], ['21:00', 'evening', 45, 90], ['00:00', 'night', 90, 180], ['07:00', 'evening', 45, 90]] as const) {
    const start = planXianyuChatRefresh(at(hour), () => 0);
    const end = planXianyuChatRefresh(at(hour), () => 1 - Number.EPSILON);
    assert.equal(start.period, period);
    assert.equal(start.delayMs, min * minute);
    assert.equal(end.delayMs, max * minute);
    assert.equal(start.refresh, true);
    assert.equal(end.refresh, true);
    assert.ok(planXianyuChatRefresh(at(hour), () => 0.3).delayMs > start.delayMs);
  }
});

test('boundary wakeups recalculate without requesting a refresh at the hour', () => {
  for (const [before, after, period] of [['06:59', '07:00', 'evening'], ['08:59', '09:00', 'day'], ['20:59', '21:00', 'evening'], ['23:59', '00:00', 'night']] as const) {
    const checkpoint = planXianyuChatRefresh(at(before), () => 0);
    assert.equal(checkpoint.delayMs, minute);
    assert.equal(checkpoint.refresh, false);
    assert.equal(planXianyuChatRefresh(at(after), () => 0).period, period);
  }
});

test('invalid time and random samples fail explicitly', () => {
  for (const value of [NaN, Infinity, -Infinity, 1e20]) assert.throws(() => planXianyuChatRefresh(value), RangeError);
  for (const value of [NaN, Infinity, -0.1, 1, 2]) assert.throws(() => planXianyuChatRefresh(at('10:00'), () => value), RangeError);
});

async function fixture() {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'refresh@example.com', passwordHash: 'test', displayName: 'Refresh' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'seller-1' });
  await store.upsertCredential({ adminId: admin.id, accountId: account.id, platform: 'xianyu',
    cookieHeader: 'unb=seller-1; _m_h5_tk=original_suffix', accessToken: 'original-access', deviceId: 'device-1', metadata: { loginMethod: 'test' } });
  let calls = 0;
  let disconnects = 0;
  let refreshes = 0;
  let updates = 0;
  let hold = Promise.resolve();
  let failure: Error | undefined;
  const mtop = {
    createCredentialSession: () => ({ client: mtop, getCredential: () => ({ metadata: { loginMethod: 'test' } }) }),
    verifyLogin: async () => { calls++; await hold; if (failure) throw failure; return { success: true, response: { data: { userId: 'seller-1' } } }; },
    fetchImToken: async () => ({ success: true, accessToken: 'new-access', cookieHeader: (await store.getCredential(admin.id, account.id))?.cookieHeader }),
  };
  const service = new XianyuImService(store, mtop as never, {} as never);
  const internal = service as any;
  internal.scheduleRecentMessageRecovery = () => undefined;
  internal.clients.set(`${admin.id}:${account.id}`, { connected: true, deviceId: 'device-1', connect: async () => undefined,
    disconnect: async () => { disconnects++; }, refreshSession: async () => { refreshes++; }, updateCredential: () => { updates++; } });
  return { store, admin, account, service, internal, calls: () => calls, disconnects: () => disconnects, refreshes: () => refreshes,
    updates: () => updates, hold: (p: Promise<void>) => { hold = p; }, fail: () => { failure = new Error('temporary network failure'); } };
}

test('fixed ten-minute refresh is removed; slow calls are single flight and do not interrupt messages', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: at('10:00') });
  t.mock.method(Math, 'random', () => 0);
  const f = await fixture();
  let release!: () => void;
  f.hold(new Promise<void>(resolve => { release = resolve; }));
  try {
    await f.service.startListener(f.admin.id, f.account.id);
    t.mock.timers.tick(10 * minute); await flush();
    assert.equal(f.calls(), 0);
    t.mock.timers.tick(15 * minute); await flush();
    assert.equal(f.calls(), 1);
    await f.service.startListener(f.admin.id, f.account.id);
    t.mock.timers.tick(60 * minute); await flush();
    assert.equal(f.calls(), 1);
    release(); await flush();
    assert.equal(f.updates(), 1);
    assert.equal(f.disconnects(), 0);
    assert.equal(f.refreshes(), 0);
    assert.equal((await f.store.getCredential(f.admin.id, f.account.id))?.accessToken, 'new-access');
    assert.equal(f.internal.credentialRefreshTimers.size, 1);
  } finally { release(); await f.service.close(); }
});

test('period transitions do not run a request at the boundary', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: at('20:59') });
  t.mock.method(Math, 'random', () => 0);
  const f = await fixture();
  try {
    await f.service.startListener(f.admin.id, f.account.id);
    t.mock.timers.tick(minute); await flush(); assert.equal(f.calls(), 0);
    t.mock.timers.tick(44 * minute); await flush(); assert.equal(f.calls(), 0);
    t.mock.timers.tick(minute); await flush(); assert.equal(f.calls(), 1);
  } finally { await f.service.close(); }
});

test('transient failure preserves credentials and schedules the next low-frequency attempt', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: at('10:00') });
  t.mock.method(Math, 'random', () => 0);
  const f = await fixture(); f.fail();
  try {
    await f.service.startListener(f.admin.id, f.account.id);
    t.mock.timers.tick(25 * minute); await flush();
    assert.equal(f.calls(), 1); assert.equal(f.internal.credentialRefreshTimers.size, 1);
    t.mock.timers.tick(24 * minute); await flush(); assert.equal(f.calls(), 1);
    t.mock.timers.tick(minute); await flush(); assert.equal(f.calls(), 2);
    assert.equal((await f.store.getCredential(f.admin.id, f.account.id))?.accessToken, 'original-access');
    assert.equal(f.disconnects(), 0);
  } finally { await f.service.close(); }
});

test('revoked, disabled and missing accounts stop scheduling without sending HTTP requests', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: at('10:00') });
  t.mock.method(Math, 'random', () => 0);
  for (const state of ['revoked', 'disabled', 'missing']) {
    const f = await fixture();
    try {
      if (state === 'revoked') await f.store.revokeCredential(f.admin.id, f.account.id);
      if (state === 'disabled') await f.store.deleteAccount(f.admin.id, f.account.id);
      f.internal.scheduleCredentialRefresh(f.admin.id, state === 'missing' ? 'missing' : f.account.id);
      t.mock.timers.tick(25 * minute); await flush();
      assert.equal(f.calls(), 0, state);
      assert.equal(f.internal.credentialRefreshTimers.size, 0, state);
    } finally { await f.service.close(); }
  }
});

test('shutdown waits for in-flight HTTP, prevents token writes and prevents rescheduling', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: at('10:00') });
  t.mock.method(Math, 'random', () => 0);
  const f = await fixture();
  let release!: () => void;
  f.hold(new Promise<void>(resolve => { release = resolve; }));
  await f.service.startListener(f.admin.id, f.account.id);
  t.mock.timers.tick(25 * minute); await flush();
  let closed = false;
  const closing = f.service.close().then(() => { closed = true; });
  await flush(); assert.equal(closed, false);
  release(); await closing; await flush();
  assert.equal(f.internal.credentialRefreshTimers.size, 0);
  assert.equal(f.updates(), 0);
  assert.equal((await f.store.getCredential(f.admin.id, f.account.id))?.accessToken, 'original-access');
  t.mock.timers.tick(180 * minute); await flush(); assert.equal(f.calls(), 1);
});

test('a concurrent manual credential replacement is not overwritten by periodic refresh', async () => {
  const f = await fixture();
  let release!: () => void;
  f.hold(new Promise<void>(resolve => { release = resolve; }));
  try {
    const refresh = f.internal.refreshChatSession(f.admin.id, f.account.id);
    await flush();
    await f.store.upsertCredential({ adminId: f.admin.id, accountId: f.account.id, platform: 'xianyu',
      cookieHeader: 'unb=seller-1; _m_h5_tk=manual_suffix', accessToken: 'manual-access', deviceId: 'manual-device', metadata: { loginMethod: 'manual' } });
    release(); await refresh;
    assert.equal((await f.store.getCredential(f.admin.id, f.account.id))?.accessToken, 'manual-access');
    assert.equal(f.updates(), 0);
  } finally { release(); await f.service.close(); }
});
