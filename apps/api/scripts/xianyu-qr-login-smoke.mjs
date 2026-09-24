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

  let confirmedCount = 0;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/mtop.gaia.nodejs.gaia.idle.data.gw.v2.index.get/1.0/')) {
      return new Response('', { status: 200, headers: { 'set-cookie': '_m_h5_tk=confirm-token_suffix; Domain=.goofish.com; Path=/; Secure' } });
    }
    if (url.pathname.endsWith('/mini_login.htm')) {
      return new Response('<script>window.viewData = {"loginFormData":{"lg_token":"login-token"}};</script>', { status: 200, headers: { 'content-type': 'text/html' } });
    }
    if (url.pathname.endsWith('/newlogin/qrcode/generate.do')) {
      return new Response(JSON.stringify({ content: { success: true, data: { codeContent: 'qr-confirm', t: String(Date.now()), ck: 'ck-confirm' } } }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.pathname.endsWith('/newlogin/qrcode/query.do')) {
      return new Response(JSON.stringify({ content: { data: { qrCodeStatus: 'CONFIRMED' } } }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.hostname === 'www.goofish.com' && url.pathname === '/im') {
      assert.equal(init.redirect, 'manual');
      return new Response(null, { status: 302, headers: { location: 'https://passport.goofish.com/bridge', 'set-cookie': 'bridge=1; Domain=.goofish.com; Path=/; Secure' } });
    }
    if (url.hostname === 'passport.goofish.com' && url.pathname === '/bridge') {
      return new Response('ok', { status: 200, headers: { 'set-cookie': 'unb=confirmed-user; Domain=.passport.goofish.com; Path=/; Secure' } });
    }
    throw new Error(`unexpected confirmed QR request: ${url.href}`);
  };
  const confirmed = new XianyuQrLoginAdapter({
    pollIntervalMs: 5,
    maxWaitMs: 250,
    onSuccess: async (result) => { confirmedCount += result.unb === 'confirmed-user' ? 1 : 0; },
  });
  await confirmed.create({ sessionId: 'confirmed-session', adminId: 'admin-1' });
  for (let attempt = 0; attempt < 40 && confirmedCount === 0; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(confirmedCount, 1);
  assert.equal(confirmed.get('confirmed-session')?.status, 'succeeded');

  const failureStatuses = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/mtop.gaia.nodejs.gaia.idle.data.gw.v2.index.get/1.0/')) return new Response('', { status: 200, headers: { 'set-cookie': '_m_h5_tk=failed-token_suffix; Domain=.goofish.com; Path=/; Secure' } });
    if (url.pathname.endsWith('/mini_login.htm')) return new Response('<script>window.viewData = {"loginFormData":{"lg_token":"login-token"}};</script>', { status: 200, headers: { 'content-type': 'text/html' } });
    if (url.pathname.endsWith('/newlogin/qrcode/generate.do')) return new Response(JSON.stringify({ content: { success: true, data: { codeContent: 'qr-failed-callback', t: String(Date.now()), ck: 'ck-failed-callback' } } }), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.pathname.endsWith('/newlogin/qrcode/query.do')) return new Response(JSON.stringify({ content: { data: { qrCodeStatus: 'CONFIRMED' } } }), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.hostname === 'www.goofish.com' && url.pathname === '/im') return new Response(null, { status: 302, headers: { location: 'https://passport.goofish.com/bridge', 'set-cookie': 'bridge=1; Domain=.goofish.com; Path=/; Secure' } });
    if (url.hostname === 'passport.goofish.com' && url.pathname === '/bridge') return new Response('ok', { status: 200, headers: { 'set-cookie': 'unb=failed-callback-user; Domain=.passport.goofish.com; Path=/; Secure' } });
    throw new Error(`unexpected failed callback request: ${url.href}`);
  };
  const failedCallback = new XianyuQrLoginAdapter({
    pollIntervalMs: 5,
    maxWaitMs: 250,
    onStatus: async (status) => { failureStatuses.push({ status: status.status, errorCode: status.errorCode }); },
    onSuccess: async () => { const error = new Error('slider validation required'); error.code = 'ACCOUNT_VALIDATION_REQUIRED'; throw error; },
  });
  await failedCallback.create({ sessionId: 'failed-callback-session', adminId: 'admin-1' });
  for (let attempt = 0; attempt < 40 && failedCallback.get('failed-callback-session')?.status !== 'failed'; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(failedCallback.get('failed-callback-session'), { sessionId: 'failed-callback-session', accountId: undefined, status: 'failed', qrImageDataUrl: failedCallback.get('failed-callback-session')?.qrImageDataUrl, expiresAt: failedCallback.get('failed-callback-session')?.expiresAt, pollAfterMs: 5, errorCode: 'ACCOUNT_VALIDATION_REQUIRED', verificationUrl: undefined });
  assert.ok(failureStatuses.some((entry) => entry.status === 'failed' && entry.errorCode === 'ACCOUNT_VALIDATION_REQUIRED'));
  console.log('xianyu qr login renewal smoke passed');
} finally {
  globalThis.fetch = originalFetch;
}
