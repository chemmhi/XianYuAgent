import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryStore } from '../src/store-memory.js';
import { XianyuMtopClient } from '../src/xianyu-mtop.js';
import { XianyuImService } from '../src/xianyu-im-service.js';

test('native handoff never revives a snapshot explicitly invalidated by the request-local MTOP session', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'review-native-stale@example.test', passwordHash: 'test', displayName: 'Review' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'seller' });
  const credential = await store.upsertCredential({ adminId: admin.id, accountId: account.id, platform: 'xianyu',
    cookieHeader: '_m_h5_tk=fresh_suffix; unb=seller; cookie2=fresh-session; x5sec=fresh-ticket', deviceId: 'original-device',
    metadata: { cookies_refresh_snapshot: JSON.stringify([
      { name: '_m_h5_tk', value: 'stale_suffix', domain: '.goofish.com', path: '/' },
      { name: 'x5sec', value: 'stale-ticket', domain: '.goofish.com', path: '/' },
    ]) } });
  let passedSnapshot: unknown;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    assert.match((init?.headers as Record<string, string>).cookie, /fresh-session/);
    return new Response(JSON.stringify({ ret: ['FAIL_SYS_USER_VALIDATE::verify'], data: {
      url: 'https://h5api.m.goofish.com/h5/mtop.test.read/1.0/_____tmd_____/punish',
    } }), { headers: { 'content-type': 'application/json', 'set-cookie': '_m_h5_tk=rotated_suffix; Domain=.goofish.com; Path=/; Secure' } });
  };
  const mtop = new XianyuMtopClient({ loadCredential: (a, b) => store.getCredential(a, b), saveCookie: async () => {
    throw new Error('the request-local session must buffer response cookies');
  } });
  const browser = { enabled: true, waitForCompletion: async (input: any) => {
    passedSnapshot = input.initialCookieSnapshot;
    throw new Error('REVIEW_STOP_BEFORE_BROWSER');
  } };
  const service = new XianyuImService(store, mtop, {} as never, undefined, undefined, browser as never);
  try {
    await assert.rejects((service as any).refreshCredential(admin.id, account, credential));
    assert.ok(passedSnapshot);
    assert.doesNotMatch(JSON.stringify(passedSnapshot), /stale_suffix|stale-ticket/);
    for (const value of ['rotated_suffix', 'fresh-session', 'fresh-ticket']) assert.ok(JSON.stringify(passedSnapshot).includes(value), value);
    assert.equal((await store.getCredential(admin.id, account.id))?.cookieHeader, credential.cookieHeader);
  } finally { globalThis.fetch = originalFetch; await service.close(); }
});
