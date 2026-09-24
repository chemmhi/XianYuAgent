import assert from 'node:assert/strict';
import test from 'node:test';
import { XianyuQrLoginAdapter } from '../src/xianyu-qr-login.js';

test('QR login can wait for a user-completed verification browser and then finish login', async () => {
  const originalFetch = globalThis.fetch;
  const statuses: Array<{ status: string; verificationAutoLaunch?: boolean }> = [];
  let successCount = 0;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/mtop.gaia.nodejs.gaia.idle.data.gw.v2.index.get/1.0/')) {
      return new Response('', { status: 200, headers: { 'set-cookie': '_m_h5_tk=qr-token_suffix; Domain=.goofish.com; Path=/; Secure' } });
    }
    if (url.pathname.endsWith('/mini_login.htm')) {
      return new Response('<script>window.viewData = {"loginFormData":{"lg_token":"login-token"}};</script>', { status: 200, headers: { 'content-type': 'text/html' } });
    }
    if (url.pathname.endsWith('/newlogin/qrcode/generate.do')) {
      return new Response(JSON.stringify({ content: { success: true, data: { codeContent: 'qr-verification', t: '1', ck: 'ck-verification' } } }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.pathname.endsWith('/newlogin/qrcode/query.do')) {
      return new Response(JSON.stringify({ content: { data: { qrCodeStatus: 'CONFIRMED', iframeRedirect: true, iframeRedirectUrl: 'https://punish.goofish.com/verify?token=redacted' } } }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.hostname === 'www.goofish.com' && url.pathname === '/im') {
      return new Response(null, { status: 302, headers: { location: 'https://passport.goofish.com/bridge', 'set-cookie': 'bridge=1; Domain=.goofish.com; Path=/; Secure' } });
    }
    if (url.hostname === 'passport.goofish.com' && url.pathname === '/bridge') {
      return new Response('ok', { status: 200, headers: { 'set-cookie': 'unb=verified-user; Domain=.passport.goofish.com; Path=/; Secure' } });
    }
    throw new Error(`unexpected QR request: ${url.href}`);
  };

  try {
    const verificationBrowser = {
      enabled: true,
      waitForCompletion: async (input: { verificationUrl: string }) => {
        assert.equal(input.verificationUrl, 'https://punish.goofish.com/verify?token=redacted');
        return {
          finalUrl: 'https://www.goofish.com/im',
          cookieSnapshot: [{ name: 'x5sec', value: 'redacted', domain: '.goofish.com', path: '/', secure: true }],
        };
      },
    };
    const adapter = new XianyuQrLoginAdapter({
      pollIntervalMs: 5,
      maxWaitMs: 500,
      verificationBrowser: verificationBrowser as never,
      onStatus: async (status) => { statuses.push({ status: status.status, verificationAutoLaunch: status.verificationAutoLaunch }); },
      onSuccess: async ({ unb }) => { if (unb === 'verified-user') successCount += 1; },
    });

    const created = await adapter.create({ sessionId: 'verification-session', adminId: 'admin-1' });
    assert.equal(created.status, 'waiting');
    for (let attempt = 0; attempt < 60 && successCount === 0; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(successCount, 1);
    assert.equal(adapter.get('verification-session')?.status, 'succeeded');
    assert.ok(statuses.some((entry) => entry.status === 'verification_required' && entry.verificationAutoLaunch === true));
    assert.equal(statuses.at(-1)?.status, 'succeeded');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
