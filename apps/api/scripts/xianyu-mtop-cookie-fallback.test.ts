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

test('prefers a newer raw cookie after a slider challenge over a stale browser snapshot', async () => {
  const originalFetch = globalThis.fetch;
  let requestCookie = '';
  globalThis.fetch = async (_input, init) => {
    requestCookie = String((init?.headers as Record<string, string> | undefined)?.cookie ?? '');
    return new Response(JSON.stringify({ ret: ['SUCCESS::调用成功'], data: { itemDO: { itemId: 'item-1' } } }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const client = new XianyuMtopClient({
      loadCredential: async () => ({
        cookieHeader: '_m_h5_tk=fresh_token; _m_h5_tk_enc=fresh_enc; x5sec=fresh_sec; unb=seller-1',
        metadata: { cookies_refresh_snapshot: JSON.stringify([
          { name: '_m_h5_tk', value: 'stale_token', domain: '.goofish.com', path: '/', secure: true },
          { name: '_m_h5_tk_enc', value: 'stale_enc', domain: '.goofish.com', path: '/', secure: true },
          { name: 'x5sec', value: 'stale_sec', domain: '.goofish.com', path: '/', secure: true },
          { name: 'unb', value: 'seller-1', domain: '.goofish.com', path: '/', secure: true },
        ]) },
      }),
      saveCookie: async () => undefined,
    });
    const result = await client.fetchItemDetail('admin-1', 'account-1', 'item-1');
    assert.equal(result.success, true);
    assert.match(requestCookie, /_m_h5_tk=fresh_token/);
    assert.match(requestCookie, /x5sec=fresh_sec/);
    assert.doesNotMatch(requestCookie, /stale_token|stale_sec/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('does not let a stale snapshot overwrite a refreshed raw Cookie when MTOP rotates cookies', async () => {
  const originalFetch = globalThis.fetch;
  let requestCookie = '';
  let savedCookie = '';
  globalThis.fetch = async (_input, init) => {
    requestCookie = String((init?.headers as Record<string, string> | undefined)?.cookie ?? '');
    return new Response(JSON.stringify({ ret: ['SUCCESS::调用成功'], data: { itemDO: { itemId: 'item-2' } } }), {
      status: 200,
      headers: { 'content-type': 'application/json', 'set-cookie': 'x5sec=fresh_rotated; Path=/; Secure' },
    });
  };
  try {
    const client = new XianyuMtopClient({
      loadCredential: async () => ({
        cookieHeader: '_m_h5_tk=fresh_token; _m_h5_tk_enc=fresh_enc; x5sec=fresh_sec; unb=seller-1',
        metadata: { cookies_refresh_snapshot: JSON.stringify([
          { name: '_m_h5_tk', value: 'stale_token', domain: '.goofish.com', path: '/', secure: true },
          { name: '_m_h5_tk_enc', value: 'stale_enc', domain: '.goofish.com', path: '/', secure: true },
          { name: 'x5sec', value: 'stale_sec', domain: '.goofish.com', path: '/', secure: true },
          { name: 'unb', value: 'seller-1', domain: '.goofish.com', path: '/', secure: true },
        ]) },
      }),
      saveCookie: async (_adminId, _accountId, cookieHeader) => { savedCookie = cookieHeader; },
    });
    const result = await client.fetchItemDetail('admin-1', 'account-1', 'item-2');
    assert.equal(result.success, true);
    assert.match(requestCookie, /_m_h5_tk=fresh_token/);
    assert.match(requestCookie, /x5sec=fresh_sec/);
    assert.doesNotMatch(requestCookie, /stale_token|stale_sec/);
    assert.match(savedCookie, /_m_h5_tk=fresh_token/);
    assert.match(savedCookie, /x5sec=fresh_rotated/);
    assert.doesNotMatch(savedCookie, /stale_token|stale_sec/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('reports final MTOP validation failures to the account health callback', async () => {
  const originalFetch = globalThis.fetch;
  const failures: Array<Record<string, unknown>> = [];
  globalThis.fetch = async () => new Response(JSON.stringify({ ret: ['FAIL_SYS_USER_VALIDATE::请完成验证'] }), { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    const client = new XianyuMtopClient({
      loadCredential: async () => ({ cookieHeader: '_m_h5_tk=token_value_1; unb=seller-1' }),
      saveCookie: async () => undefined,
      onFailure: (input) => { failures.push(input); },
    });
    const result = await client.fetchItems('admin-1', 'account-1');
    assert.equal(result.success, false);
    assert.equal(result.errorCode, 'ACCOUNT_VALIDATION_REQUIRED');
    assert.deepEqual(failures, [
      {
        adminId: 'admin-1',
        accountId: 'account-1',
        api: 'mtop.idle.web.xyh.item.list',
        errorCode: 'ACCOUNT_VALIDATION_REQUIRED',
        message: 'FAIL_SYS_USER_VALIDATE::请完成验证',
        accountInvalid: true,
      },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
