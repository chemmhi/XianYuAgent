import assert from 'node:assert/strict';
import test from 'node:test';
import { XianyuMtopClient } from '../src/xianyu-mtop.js';

test('replays raw saved cookie when persisted snapshot has expired _m_h5_tk metadata', async () => {
  const originalFetch = globalThis.fetch;
  const staleSnapshot = JSON.stringify([{ name: '_m_h5_tk', value: 'token_value_1', domain: '.goofish.com', path: '/', secure: true, expires: Math.floor(Date.now() / 1000) - 60 }]);
  let requestCookie = '';
  globalThis.fetch = async (_input, init) => {
    requestCookie = String((init?.headers as Record<string, string> | undefined)?.cookie ?? '');
    return new Response(JSON.stringify({ ret: ['SUCCESS::调用成功'], data: { itemTopicList: [], totalCount: 0, nextPage: false } }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const client = new XianyuMtopClient({
      loadCredential: async () => ({ cookieHeader: '_m_h5_tk=token_value_1; unb=1903703477', metadata: { cookies_refresh_snapshot: staleSnapshot } }),
      saveCookie: async () => undefined,
    });
    const result = await client.fetchItemsPage('admin-1', 'account-1');
    assert.equal(result.success, true);
    assert.match(requestCookie, /_m_h5_tk=token_value_1/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
