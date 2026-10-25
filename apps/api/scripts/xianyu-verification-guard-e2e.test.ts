import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { hashPassword } from '../src/security.js';
import { PostgresStore } from '../src/store-postgres.js';
import { XianyuVerificationBrowser } from '../src/xianyu-verification-browser.js';
import { createVerificationReadRequest } from '../src/xianyu-verification-request.js';
import { readBrowserFixture } from './helpers/verification-read-browser.js';

const ITEMS = 'mtop.idle.web.xyh.item.list';
const ORDERS = 'mtop.taobao.idle.trade.merchant.sold.get';
const databaseUrl = process.env.NATIVE_RECOVERY_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('NATIVE_RECOVERY_TEST_DATABASE_URL must point to an isolated xianyu_native_recovery_test database');
if (databaseUrl) {
  const url = new URL(databaseUrl);
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname) && url.pathname === '/xianyu_native_recovery_test');
  for (const api of [ITEMS, ORDERS]) test(`HTTP manual ${api === ITEMS ? 'product sync' : 'order refresh'} -> native Chrome challenge -> PostgreSQL -> successful retry`, async () => {
    const userId = randomUUID();
    const native = readBrowserFixture(api, userId);
    const profile = await mkdtemp(join(tmpdir(), 'xianyu-read-e2e-'));
    const runtime = createApp(loadConfig({ ALLOW_IN_MEMORY: 'false', DATABASE_URL: databaseUrl, REDIS_URL: '', PORT: '0',
      COOKIE_SECURE: 'false', XIANYU_QR_MODE: 'stub', XIANYU_VERIFICATION_BROWSER_MODE: 'launch', XIANYU_VERIFICATION_SLIDER_MODE: 'auto',
      XIANYU_VERIFICATION_BROWSER_HEADLESS: 'true', XIANYU_VERIFICATION_BROWSER_USER_DATA_DIR: profile }), { verificationBrowserFactory: native.factory });
    const originalFetch = globalThis.fetch;
    const remoteRequests: string[] = [];
    const remote = createServer((req, res) => {
      const currentApi = req.url!.split('/')[2];
      remoteRequests.push(currentApi);
      const passed = req.headers.cookie?.includes('x5sec=read-passed');
      const data = currentApi === ITEMS ? { totalCount: 1, pageCount: 1, cardList: [{ cardData: { detailParams: { itemId: 'item-e2e' }, title: '恢复后的商品', priceInfo: { price: '19.90' } } }] }
        : currentApi === ORDERS ? { module: { nextPage: 'false', totalCount: '1', items: [{ commonData: { orderId: 'order-e2e', itemId: 'item-e2e', itemInfo: { itemName: '恢复后的订单商品' }, orderStatus: '交易关闭' },
          buyerInfoVO: { buyerId: 'buyer-e2e', nick: '测试买家' }, priceVO: { totalPrice: '19.90' }, rightVO: { btnList: [] } }] } }
          : currentApi.endsWith('login.token') ? { accessToken: 'already-healthy' } : { itemDO: { itemId: 'item-e2e', title: '恢复后的商品' } };
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(!passed && currentApi === api ? { ret: ['FAIL_SYS_USER_VALIDATE::verify'], data: { url: 'https://www.goofish.com/punish?source=server' } }
        : { ret: ['SUCCESS::ok'], data }));
    });
    await new Promise<void>(resolve => remote.listen(0, '127.0.0.1', resolve));
    globalThis.fetch = (url, init) => {
      const parsed = new URL(String(url));
      if (parsed.hostname === 'h5api.m.goofish.com') return originalFetch(`http://127.0.0.1:${(remote.address() as any).port}${parsed.pathname}${parsed.search}`, init);
      return originalFetch(url, init);
    };
    try {
      await runtime.listen();
      const email = `guard-e2e-${randomUUID()}@example.com`;
      const admin = await runtime.store.createAdmin({ email, displayName: 'Guard E2E', passwordHash: await hashPassword('password-123') });
      const account = await runtime.store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: userId });
      await runtime.store.upsertCredential({ adminId: admin.id, accountId: account.id, platform: 'xianyu',
        cookieHeader: `unb=${userId}; _m_h5_tk=initial_suffix`, accessToken: 'healthy-im-token', deviceId: 'e2e-device' });
      // The socket is unrelated to this test. A healthy connected IM must not
      // prevent the real API assembly from recovering an independent read API.
      (runtime.xianyuIm as any).clients.set(`${admin.id}:${account.id}`, { connected: true, disconnect: async () => undefined });
      const base = `http://127.0.0.1:${(runtime.server.address() as any).port}`;
      const login = await originalFetch(`${base}/api/v1/auth/password-login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'password-123' }) });
      assert.equal(login.status, 200, await login.clone().text());
      const cookie = login.headers.getSetCookie().map(value => value.split(';', 1)[0]).join('; ');
      const csrf = decodeURIComponent(cookie.match(/csrf_token=([^;]+)/)?.[1] ?? '');
      const route = api === ITEMS ? '/api/v1/products/sync' : '/api/v1/orders/refresh';
      const submit = () => originalFetch(`${base}${route}`, { method: 'POST', headers: { 'content-type': 'application/json', cookie, 'X-CSRF-Token': csrf,
        'Idempotency-Key': randomUUID() }, body: JSON.stringify({ accountId: account.id, maxPages: 1 }) });
      const first = await submit();
      assert.equal(first.status, 409, await first.clone().text());
      const deadline = Date.now() + 20_000;
      while ((runtime.xianyuIm as any).verificationRecoveryInFlight.size && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
      assert.equal((runtime.xianyuIm as any).verificationRecoveryInFlight.size, 0);
      const reader = new PostgresStore(databaseUrl);
      try {
        const saved = await reader.getCredential(admin.id, account.id);
        assert.match(saved!.cookieHeader!, /x5sec=read-passed/);
        assert.equal(saved?.accessToken, 'healthy-im-token');
        assert.equal((await reader.listAccountVerificationRisks(admin.id, account.id)).length, 0);
        const retried = await submit();
        const body = await retried.json() as any;
        assert.equal(retried.status, 200, JSON.stringify(body));
        assert.equal(body.data.createdCount, 1);
        if (api === ITEMS) assert.equal((await reader.listProducts(admin.id, { accountId: account.id })).items[0].title, '恢复后的商品');
        else assert.equal((await reader.listOrders(admin.id, { accountId: account.id })).items[0].orderNo, 'order-e2e');
      } finally { await reader.close(); }
      assert.equal(native.slides(), 1);
      assert.ok(!native.requests.some(value => value.endsWith('login.token')));
      assert.ok(!remoteRequests.some(value => value.endsWith('login.token')));
    } finally {
      globalThis.fetch = originalFetch;
      await runtime.close(); remote.closeAllConnections(); await new Promise<void>(resolve => remote.close(() => resolve()));
      await rm(profile, { recursive: true, force: true });
    }
  });
}

for (const [api, outcome] of [[ITEMS, 'identity-challenge'], [ITEMS, 'top-level-url'], [ITEMS, 'html-challenge-link'], [ITEMS, 'html-without-url'], [ORDERS, 'wrong-account'], ['mtop.taobao.idle.pc.detail', 'persistent'], ['mtop.idle.web.trade.order.detail', 'session-expired']]) {
  test(`native read browser ${api}: ${outcome}`, async () => {
    const native = readBrowserFixture(api, '123456', outcome);
    const profile = await mkdtemp(join(tmpdir(), 'xianyu-read-browser-'));
    const browser = new XianyuVerificationBrowser({ mode: 'launch', sliderMode: 'auto', headless: true, userDataDir: profile,
      browserFactory: native.factory, maxWaitMs: 6_000 });
    try {
      const verify = () => browser.waitForCompletion({ verificationUrl: 'https://www.goofish.com/punish', initialCookieSnapshot: [
        { name: 'unb', value: '123456', domain: '.goofish.com', path: '/' },
        { name: '_m_h5_tk', value: 'initial_suffix', domain: '.goofish.com', path: '/' },
      ], readRequest: { request: createVerificationReadRequest(api, '1.0', { itemId: 'item-1', tid: 'order-1' })!, expectedUserId: '123456' } });
      if (['identity-challenge', 'top-level-url', 'html-challenge-link'].includes(outcome)) {
        assert.equal((await verify()).verifiedRead?.userId, '123456');
        assert.equal(native.slides(), outcome === 'identity-challenge' ? 2 : 1, 'all challenge shapes use the same bounded recovery transport');
      } else {
        await assert.rejects(verify, new RegExp(outcome === 'wrong-account' ? 'IDENTITY_MISMATCH' : outcome === 'persistent' ? 'CHALLENGE_UNRESOLVED' : outcome === 'html-without-url' ? 'CHALLENGE_REQUIRED' : 'SESSION_EXPIRED'));
        assert.equal(native.slides(), outcome === 'persistent' ? 2 : ['session-expired', 'html-without-url'].includes(outcome) ? 0 : 1);
      }
    } finally { await rm(profile, { recursive: true, force: true }); }
  });
}
