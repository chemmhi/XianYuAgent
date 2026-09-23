import assert from 'node:assert/strict';
import { XianyuMtopClient } from '../dist/xianyu-mtop.js';

const originalFetch = globalThis.fetch;
const capturedRequests = [];
let savedCookie;
let savedMetadata;
let responseMode = 'success';
let uploadAttempts = 0;
let credential = {
  cookieHeader: 'unb=legacy; _m_h5_tk=legacy_token',
  metadata: {
    cookies_refresh_snapshot: JSON.stringify([
      { name: '_m_h5_tk', value: 'fresh_token_suffix', domain: '.goofish.com', path: '/', secure: true },
      { name: 'unb', value: 'seller-1', domain: '.goofish.com', path: '/', secure: true },
      { name: 'seller_only', value: '1', domain: 'seller.goofish.com', path: '/', secure: true },
    ]),
  },
};

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  capturedRequests.push({ url, headers: init.headers, body: init.body });
  if (url.hostname === 'stream-upload.goofish.com') {
    uploadAttempts += 1;
    if (responseMode === 'expired' || (responseMode === 'expired-then-refresh' && uploadAttempts === 1)) {
      return new Response('<html><body>SESSION_EXPIRED</body></html>', { status: 200, headers: { 'content-type': 'text/html' } });
    }
    return new Response(JSON.stringify({ object: { url: 'https://img.alicdn.com/chat/uploaded.png', pix: '640x480' } }), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'set-cookie': 'rotated=1; Domain=.goofish.com; Path=/; Secure',
      },
    });
  }
  if (url.hostname === 'h5api.m.goofish.com') {
    const api = url.searchParams.get('api');
    if (api === 'mtop.taobao.idlemessage.pc.loginuser.get') {
      return new Response(JSON.stringify({ ret: ['FAIL_SYS_SESSION_EXPIRED::登录态已过期'], data: {} }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ ret: ['SUCCESS::调用成功'], data: { accessToken: 'refreshed-im-token' } }), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'set-cookie': '_m_h5_tk=refreshed_token_suffix; Domain=.goofish.com; Path=/; Secure',
      },
    });
  }
  throw new Error(`unexpected fetch host: ${url.hostname}`);
};

try {
  const client = new XianyuMtopClient({
    loadCredential: async () => credential,
    saveCookie: async (_adminId, _accountId, cookieHeader, metadata) => {
      savedCookie = cookieHeader;
      savedMetadata = metadata;
      credential = { cookieHeader, metadata: metadata ?? credential.metadata };
    },
  });

  const result = await client.uploadChatImage('admin-1', 'account-1', 'photo.png', 'image/png', Buffer.from([137, 80, 78, 71]));
  assert.equal(result.success, true);
  assert.equal(result.url, 'https://img.alicdn.com/chat/uploaded.png');
  assert.equal(result.width, 640);
  assert.equal(result.height, 480);
  assert.match(capturedRequests[0].url.hostname, /stream-upload\.goofish\.com/);
  assert.match(capturedRequests[0].headers.cookie, /_m_h5_tk=fresh_token_suffix/);
  assert.match(capturedRequests[0].headers.cookie, /unb=seller-1/);
  assert.doesNotMatch(capturedRequests[0].headers.cookie, /legacy_token|seller_only/);
  assert.match(savedCookie, /rotated=1/);
  assert.match(savedMetadata.cookies_refresh_snapshot, /rotated/);

  capturedRequests.length = 0;
  uploadAttempts = 0;
  responseMode = 'expired-then-refresh';
  const recovered = await client.uploadChatImage('admin-1', 'account-1', 'photo.png', 'image/png', Buffer.from([1]));
  assert.equal(recovered.success, true);
  assert.equal(capturedRequests.length, 3);
  assert.match(capturedRequests[0].url.hostname, /stream-upload\.goofish\.com/);
  assert.match(capturedRequests[1].url.hostname, /h5api\.m\.goofish\.com/);
  assert.match(capturedRequests[2].url.hostname, /stream-upload\.goofish\.com/);
  assert.match(capturedRequests[2].headers.cookie, /_m_h5_tk=refreshed_token_suffix/);

  responseMode = 'expired';
  uploadAttempts = 0;
  const expired = await client.uploadChatImage('admin-1', 'account-1', 'photo.png', 'image/png', Buffer.from([1]));
  assert.equal(expired.success, false);
  assert.equal(expired.accountInvalid, true);
  assert.equal(expired.errorCode, 'SESSION_EXPIRED');
  assert.equal(expired.message, 'xianyu session expired');
  console.log('xianyu image upload smoke passed');
} finally {
  globalThis.fetch = originalFetch;
}
