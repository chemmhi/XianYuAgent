import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { XianyuMtopClient } from '../src/xianyu-mtop.js';
import { CredentialService } from '../src/services.js';
import { MemoryStore } from '../src/store-memory.js';
import { cookieSnapshotFromMetadata } from '../src/xianyu-cookie-jar.js';

test('risk persistence failure is surfaced instead of returning a stale healthy account result', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ ret: ['FAIL_SYS_USER_VALIDATE::verification required'], data: {} }), { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    const client = new XianyuMtopClient({
      loadCredential: async () => ({ cookieHeader: '_m_h5_tk=token_value_1; unb=seller-1' }),
      saveCookie: async () => undefined,
      onFailure: async () => { throw new Error('DATABASE_UNAVAILABLE'); },
    });
    await assert.rejects(() => client.fetchImToken('admin-1', 'account-1', 'device-1'), /ACCOUNT_HEALTH_PERSIST_FAILED/);
  } finally { globalThis.fetch = originalFetch; }
});

test('successful image upload reports recovery on the same upload source', async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  let fail = true;
  globalThis.fetch = async () => new Response(fail ? 'temporary failure' : JSON.stringify({ object: { url: 'https://img.example/recovered.png' } }), { status: fail ? 503 : 200 });
  try {
    const client = new XianyuMtopClient({
      loadCredential: async () => ({ cookieHeader: 'unb=seller-1' }),
      saveCookie: async () => undefined,
      onFailure: async ({ api }) => { calls.push(`failure:${api}`); },
      onSuccess: async ({ api }) => { calls.push(`success:${api}`); },
    });
    const first = await client.uploadChatImage('admin-1', 'account-1', 'image.png', 'image/png', Buffer.from([1]));
    fail = false;
    const recovered = await client.uploadChatImage('admin-1', 'account-1', 'image.png', 'image/png', Buffer.from([1]));
    assert.equal(first.success, false);
    assert.equal(recovered.success, true);
    assert.deepEqual(calls, ['failure:stream-upload.goofish.com/api/upload.api', 'success:stream-upload.goofish.com/api/upload.api']);
  } finally { globalThis.fetch = originalFetch; }
});

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

test('exposes the live verification URL from an IM token challenge', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    ret: ['FAIL_SYS_USER_VALIDATE::请完成验证'],
    data: { url: 'https://punish.goofish.com/verify?token=redacted' },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    const client = new XianyuMtopClient({
      loadCredential: async () => ({ cookieHeader: '_m_h5_tk=token_value_1; unb=seller-1' }),
      saveCookie: async () => undefined,
    });
    const result = await client.fetchImToken('admin-1', 'account-1', 'device-1');
    assert.equal(result.success, false);
    assert.equal(result.errorCode, 'ACCOUNT_VALIDATION_REQUIRED');
    assert.equal(result.verificationUrl, 'https://punish.goofish.com/verify?token=redacted');
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
        recoveryRequest: { kind: 'mtop_read', api: 'mtop.idle.web.xyh.item.list', version: '1.0', data: {}, extraParams: {}, referer: 'https://www.goofish.com/im' },
      },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

for (const retryTokenRotation of [false, true]) {
  test(`retains complete session cookies when a mismatched snapshot receives token rotation (retry=${retryTokenRotation})`, async () => {
    const originalFetch = globalThis.fetch;
    const requests: string[] = [];
    const saved: Array<{ cookieHeader: string; metadata?: Record<string, string> }> = [];
    let current = {
      cookieHeader: '_m_h5_tk=fresh_1; _m_h5_tk_enc=fresh_enc; unb=seller-1; cookie2=session-cookie; sgcookie=session-signature; x5sec=fresh-ticket',
      metadata: { loginMethod: 'cookie', cookies_refresh_snapshot: JSON.stringify([
        { name: '_m_h5_tk', value: 'stale_1', domain: '.goofish.com', path: '/' },
        { name: 'unb', value: 'seller-1', domain: '.goofish.com', path: '/' },
        { name: 'x5sec', value: 'stale-ticket', domain: '.goofish.com', path: '/' },
      ]) } as Record<string, string>,
    };
    globalThis.fetch = async (_input, init) => {
      requests.push(String((init?.headers as Record<string, string>)?.cookie ?? ''));
      const rotate = requests.length === 1;
      const headers = new Headers({ 'content-type': 'application/json' });
      if (rotate) {
        headers.append('set-cookie', '_m_h5_tk=rotated_2; Domain=.goofish.com; Path=/; Secure');
        headers.append('set-cookie', '_m_h5_tk_enc=rotated_enc; Domain=.goofish.com; Path=/; Secure');
        headers.append('set-cookie', 'mtop_partitioned_detect=1; Path=/; Secure');
      }
      return new Response(JSON.stringify({
        ret: [rotate && retryTokenRotation ? 'FAIL_SYS_TOKEN_EXPIRED::令牌过期' : 'SUCCESS::调用成功'],
        data: { accessToken: 'rotated-im-token' },
      }), { headers });
    };
    try {
      const client = new XianyuMtopClient({
        loadCredential: async () => current,
        saveCookie: async (_adminId, _accountId, cookieHeader, metadata) => {
          saved.push({ cookieHeader, metadata });
          current = { cookieHeader, metadata: metadata ?? {} };
        },
      });
      assert.equal((await client.fetchImToken('admin-1', 'account-1', 'device-1')).success, true);
      assert.equal(saved.length > 0, true);
      for (const write of saved) {
        for (const pair of ['unb=seller-1', 'cookie2=session-cookie', 'sgcookie=session-signature', 'x5sec=fresh-ticket', '_m_h5_tk=rotated_2']) {
          assert.ok(write.cookieHeader.split('; ').includes(pair), `persisted Cookie lost ${pair.split('=')[0]}`);
        }
        assert.equal(write.metadata?.loginMethod, 'cookie');
        assert.doesNotMatch(JSON.stringify(write.metadata), /stale-ticket|stale_1/);
      }
      // A subsequent request must use the complete persisted session too.
      assert.equal((await client.fetchImToken('admin-1', 'account-1', 'device-1')).success, true);
      for (const header of requests.slice(1)) {
        assert.match(header, /unb=seller-1/);
        assert.match(header, /cookie2=session-cookie/);
        assert.match(header, /sgcookie=session-signature/);
        assert.match(header, /_m_h5_tk=rotated_2/);
        assert.doesNotMatch(header, /stale-ticket|stale_1/);
      }
    } finally { globalThis.fetch = originalFetch; }
  });
}

test('invalidates a mismatched snapshot through the real merge-based credential service', async () => {
  const originalFetch = globalThis.fetch;
  const store = new MemoryStore();
  const account = await store.createAccount({ adminId: 'admin-1', platform: 'xianyu', sellerRef: 'seller-1' });
  const credentials = new CredentialService(store, async () => 'audit-1');
  const stale = JSON.stringify([{ name: '_m_h5_tk', value: 'stale_1', domain: '.goofish.com', path: '/' }]);
  await credentials.save({ adminId: 'admin-1', accountId: account.id, cookieHeader: '_m_h5_tk=fresh_1; unb=seller-1; cookie2=session-cookie',
    metadata: { loginMethod: 'cookie', cookies_refresh_snapshot: stale, cookie_refresh_snapshot: stale, cookieSnapshot: stale }, requestId: 'setup', traceId: 'setup' });
  globalThis.fetch = async () => new Response(JSON.stringify({ ret: ['SUCCESS::调用成功'], data: { accessToken: 'im-token' } }), {
    headers: { 'content-type': 'application/json', 'set-cookie': '_m_h5_tk=rotated_2; Domain=.goofish.com; Path=/' },
  });
  try {
    const client = new XianyuMtopClient({
      loadCredential: (adminId, accountId) => store.getCredential(adminId, accountId),
      saveCookie: async (adminId, accountId, cookieHeader, metadata) => {
        await credentials.save({ adminId, accountId, cookieHeader, metadata, requestId: 'mtop', traceId: 'mtop' });
      },
    });
    assert.equal((await client.fetchImToken('admin-1', account.id, 'device-1')).success, true);
    const persisted = await store.getCredential('admin-1', account.id);
    assert.match(persisted?.cookieHeader ?? '', /unb=seller-1; cookie2=session-cookie/);
    assert.equal(persisted?.metadata?.loginMethod, 'cookie');
    assert.equal(cookieSnapshotFromMetadata(persisted?.metadata), undefined);
  } finally { globalThis.fetch = originalFetch; }
});

test('keeps the native Goofish header compatible with a complete cross-domain browser snapshot', async () => {
  const originalFetch = globalThis.fetch;
  const store = new MemoryStore();
  const account = await store.createAccount({ adminId: 'admin-1', platform: 'xianyu', sellerRef: 'seller-1' });
  const credentials = new CredentialService(store, async () => 'audit-1');
  const snapshot = [
    { name: '_m_h5_tk', value: 'taobao_1', domain: '.taobao.com', path: '/', secure: true },
    { name: '_m_h5_tk_enc', value: 'taobao-enc', domain: '.taobao.com', path: '/', secure: true },
    { name: 'tfstk', value: 'taobao-fingerprint', domain: '.taobao.com', path: '/', secure: true },
    { name: '_m_h5_tk', value: 'goofish_1', domain: '.goofish.com', path: '/', secure: true },
    { name: '_m_h5_tk_enc', value: 'goofish-enc', domain: '.goofish.com', path: '/', secure: true },
    { name: 'tfstk', value: 'goofish-fingerprint', domain: '.goofish.com', path: '/', secure: true },
    { name: 'unb', value: 'seller-1', domain: '.goofish.com', path: '/', secure: true },
    { name: 'mtop_partitioned_detect', value: 'same-site', domain: '.goofish.com', path: '/', secure: true,
      partitionKey: 'https://goofish.com', _crHasCrossSiteAncestor: false },
    { name: 'mtop_partitioned_detect', value: 'cross-site', domain: '.goofish.com', path: '/', secure: true,
      partitionKey: 'https://goofish.com', _crHasCrossSiteAncestor: true },
  ];
  await credentials.save({ adminId: 'admin-1', accountId: account.id,
    cookieHeader: '_m_h5_tk=goofish_1; _m_h5_tk_enc=goofish-enc; tfstk=goofish-fingerprint; unb=seller-1',
    metadata: { loginMethod: 'cookie', cookies_refresh_snapshot: JSON.stringify(snapshot) }, requestId: 'native', traceId: 'native' });
  let requests = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const token = requests++ === 0 ? 'goofish' : 'rotated';
    // The body is form encoded; MTOP signs the decoded JSON data value.
    const data = new URLSearchParams(String(init?.body)).get('data');
    const expectedSign = createHash('md5').update(`${token}&${url.searchParams.get('t')}&${url.searchParams.get('appKey')}&${data}`).digest('hex');
    assert.equal(url.searchParams.get('sign'), expectedSign);
    assert.doesNotMatch(String((init?.headers as Record<string, string>)?.cookie), /taobao/);
    return new Response(JSON.stringify({ ret: ['SUCCESS::调用成功'], data: { accessToken: 'business-token' } }), {
      headers: { 'content-type': 'application/json', 'set-cookie': '_m_h5_tk=rotated_2; Domain=.goofish.com; Path=/; Secure' },
    });
  };
  try {
    const client = new XianyuMtopClient({
      loadCredential: (adminId, accountId) => store.getCredential(adminId, accountId),
      saveCookie: async (adminId, accountId, cookieHeader, metadata) => {
        await credentials.save({ adminId, accountId, cookieHeader, metadata, requestId: 'mtop', traceId: 'mtop' });
      },
    });
    for (let attempt = 0; attempt < 2; attempt++) {
      assert.equal((await client.fetchImToken('admin-1', account.id, 'device-1')).success, true);
      const persisted = await store.getCredential('admin-1', account.id);
      const saved = cookieSnapshotFromMetadata(persisted?.metadata);
      assert.equal(saved?.find(cookie => cookie.domain === '.taobao.com' && cookie.name === '_m_h5_tk')?.value, 'taobao_1');
      assert.equal(saved?.find(cookie => cookie.domain === '.goofish.com' && cookie.name === '_m_h5_tk')?.value, 'rotated_2');
      assert.deepEqual(saved?.filter(cookie => cookie.partitionKey), snapshot.filter(cookie => cookie.partitionKey));
    }
    assert.equal(requests, 2);
  } finally { globalThis.fetch = originalFetch; }
});
