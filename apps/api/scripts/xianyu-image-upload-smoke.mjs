import assert from 'node:assert/strict';
import { XianyuMtopClient } from '../dist/xianyu-mtop.js';

const originalFetch = globalThis.fetch;
let captured;
let savedCookie;
let savedMetadata;
let responseMode = 'success';

globalThis.fetch = async (input, init = {}) => {
  captured = { url: new URL(String(input)), headers: init.headers, body: init.body };
  if (responseMode === 'expired') return new Response('<html><body>SESSION_EXPIRED</body></html>', { status: 200, headers: { 'content-type': 'text/html' } });
  return new Response(JSON.stringify({ object: { url: 'https://img.alicdn.com/chat/uploaded.png', pix: '640x480' } }), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'set-cookie': 'rotated=1; Domain=.goofish.com; Path=/; Secure',
    },
  });
};

try {
  const client = new XianyuMtopClient({
    loadCredential: async () => ({
      cookieHeader: 'unb=legacy; _m_h5_tk=legacy_token',
      metadata: {
        cookies_refresh_snapshot: JSON.stringify([
          { name: '_m_h5_tk', value: 'fresh_token_suffix', domain: '.goofish.com', path: '/', secure: true },
          { name: 'unb', value: 'seller-1', domain: '.goofish.com', path: '/', secure: true },
          { name: 'seller_only', value: '1', domain: 'seller.goofish.com', path: '/', secure: true },
        ]),
      },
    }),
    saveCookie: async (_adminId, _accountId, cookieHeader, metadata) => {
      savedCookie = cookieHeader;
      savedMetadata = metadata;
    },
  });

  const result = await client.uploadChatImage('admin-1', 'account-1', 'photo.png', 'image/png', Buffer.from([137, 80, 78, 71]));
  assert.equal(result.success, true);
  assert.equal(result.url, 'https://img.alicdn.com/chat/uploaded.png');
  assert.equal(result.width, 640);
  assert.equal(result.height, 480);
  assert.match(captured.url.hostname, /stream-upload\.goofish\.com/);
  assert.match(captured.headers.cookie, /_m_h5_tk=fresh_token_suffix/);
  assert.match(captured.headers.cookie, /unb=seller-1/);
  assert.doesNotMatch(captured.headers.cookie, /legacy_token|seller_only/);
  assert.match(savedCookie, /rotated=1/);
  assert.match(savedMetadata.cookies_refresh_snapshot, /rotated/);

  responseMode = 'expired';
  const expired = await client.uploadChatImage('admin-1', 'account-1', 'photo.png', 'image/png', Buffer.from([1]));
  assert.equal(expired.success, false);
  assert.equal(expired.accountInvalid, true);
  assert.equal(expired.errorCode, 'SESSION_EXPIRED');
  assert.equal(expired.message, 'xianyu session expired');
  console.log('xianyu image upload smoke passed');
} finally {
  globalThis.fetch = originalFetch;
}
