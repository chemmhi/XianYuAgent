import assert from 'node:assert/strict';
import { XianyuQrLoginAdapter } from '../dist/xianyu-qr-login.js';

const originalFetch = globalThis.fetch;
let generateCount = 0;
let queryCount = 0;
let firstQuerySeenResolve;
let releaseFirstQuery;
const firstQuerySeen = new Promise((resolve) => { firstQuerySeenResolve = resolve; });

globalThis.fetch = async (input) => {
  const url = new URL(String(input));
  if (url.pathname.endsWith('/mtop.gaia.nodejs.gaia.idle.data.gw.v2.index.get/1.0/')) {
    return new Response('', { status: 200, headers: { 'set-cookie': '_m_h5_tk=qr-token_suffix; Domain=.goofish.com; Path=/; Secure' } });
  }
  if (url.pathname.endsWith('/mini_login.htm')) {
    return new Response('<script>window.viewData = {"loginFormData":{"lg_token":"login-token"}};</script>', { status: 200, headers: { 'content-type': 'text/html' } });
  }
  if (url.pathname.endsWith('/newlogin/qrcode/generate.do')) {
    generateCount += 1;
    return new Response(JSON.stringify({ content: { success: true, data: { codeContent: `qr-${generateCount}`, t: String(Date.now()), ck: `ck-${generateCount}` } } }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (url.pathname.endsWith('/newlogin/qrcode/query.do')) {
    queryCount += 1;
    if (queryCount === 1) {
      firstQuerySeenResolve();
      return await new Promise((resolve) => { releaseFirstQuery = resolve; });
    }
    return new Response(JSON.stringify({ content: { data: { qrCodeStatus: 'SCANED' } } }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  throw new Error(`unexpected QR request: ${url.pathname}`);
};

try {
  const statuses = [];
  const adapter = new XianyuQrLoginAdapter({
    pollIntervalMs: 5,
    maxWaitMs: 250,
    onStatus: async (status) => { statuses.push(status.status); },
  });

  const first = await adapter.create({ sessionId: 'same-session', adminId: 'admin-1' });
  assert.equal(first.status, 'waiting');
  await firstQuerySeen;

  const second = await adapter.create({ sessionId: 'same-session', adminId: 'admin-1' });
  assert.equal(second.status, 'waiting');
  releaseFirstQuery(new Response(JSON.stringify({ content: { data: { qrCodeStatus: 'EXPIRED' } } }), { status: 200, headers: { 'content-type': 'application/json' } }));
  await new Promise((resolve) => setTimeout(resolve, 25));

  assert.equal(adapter.get('same-session')?.status, 'scanned');
  assert.equal(statuses.includes('expired'), false);
  console.log('xianyu qr login renewal smoke passed');
} finally {
  globalThis.fetch = originalFetch;
}
