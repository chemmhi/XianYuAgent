import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'vite';
import { chromium } from 'patchright';
import { createApp } from '../../api/src/app.ts';

// Isolated real API + MemoryStore: no external Xianyu calls or user data.
const runtime = createApp({ host: '127.0.0.1', port: 0, allowInMemory: true, cookieSecure: false, xianyuQrMode: 'stub', sessionIdleMs: 1_800_000, sessionAbsoluteMs: 28_800_000 });
const evidenceDir = process.env.E2E_EVIDENCE_DIR ?? join(tmpdir(), 'xianyu-account-feedback');
let vite;
let browser;
try {
  await runtime.listen();
  const apiUrl = `http://127.0.0.1:${runtime.server.address().port}`;
  const bootstrap = await fetch(`${apiUrl}/api/v1/auth/bootstrap`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': 'feedback-bootstrap' },
    body: JSON.stringify({ email: 'feedback-e2e@example.com', password: 'feedback-test-only-123', displayName: '回归测试' }),
  });
  assert.equal(bootstrap.status, 200);
  const adminId = (await bootstrap.json()).data.profile.id;
  const cookies = bootstrap.headers.getSetCookie().map((cookie) => cookie.split(';')[0]);
  const account = await runtime.store.createAccount({ adminId, platform: 'xianyu', sellerRef: 'feedback-seller', displayName: '风控测试账号' });
  await runtime.store.recordAccountRisk({ adminId, accountId: account.id, code: 'ACCOUNT_VALIDATION_REQUIRED', source: 'seller.orders.internal' });
  await runtime.store.flushAccountRiskAlerts(100);

  process.env.VITE_API_MODE = 'live';
  process.env.VITE_API_PROXY_TARGET = apiUrl;
  vite = await createServer({ root: join(import.meta.dirname, '..'), server: { host: '127.0.0.1', port: 0 } });
  await vite.listen();
  const webUrl = `http://127.0.0.1:${vite.httpServer.address().port}`;
  console.log(`Account feedback test URL: ${webUrl}/accounts`);
  if (process.env.E2E_ACCOUNT_FEEDBACK_INSPECT === '1') {
    // Test credentials exist only in this process's disposable MemoryStore.
    console.log('Inspect login: feedback-e2e@example.com / feedback-test-only-123');
    await new Promise((resolve) => { process.once('SIGINT', resolve); process.once('SIGTERM', resolve); });
  } else {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addCookies(cookies.map((pair) => { const [name, ...value] = pair.split('='); return { name, value: value.join('='), url: webUrl }; }));
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const waitFor = async (check, label) => {
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline) {
        if (await check()) return;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error(`Timed out: ${label}\n${(await page.locator('body').innerText()).slice(-1800)}`);
    };
    await page.goto(`${webUrl}/accounts`);
    await page.getByRole('table', { name: '账号列表' }).waitFor();
    const toast = page.locator('.app-toast');
    await toast.waitFor();
    assert.match(await toast.innerText(), /需要安全验证/);
    assert.equal(await page.locator('.account-risk-banner').count(), 0);
    assert.match(await page.getByRole('table').innerText(), /需要安全验证/);
    assert.doesNotMatch(await page.locator('body').innerHTML(), /ACCOUNT_VALIDATION_REQUIRED|seller\.orders\.internal/);
    const geometry = await toast.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return { position: getComputedStyle(element).position, right: innerWidth - box.right, bottom: innerHeight - box.bottom };
    });
    assert.equal(geometry.position, 'fixed');
    assert.ok(geometry.right >= 10 && geometry.right <= 30 && geometry.bottom >= 10 && geometry.bottom <= 30);
    await mkdir(evidenceDir, { recursive: true });
    await page.screenshot({ path: join(evidenceDir, 'accounts-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: join(evidenceDir, 'accounts-mobile.png') });
    await page.setViewportSize({ width: 1440, height: 900 });

    // Dismissing a toast must neither acknowledge notifications nor clear risk.
    await toast.getByRole('button', { name: '关闭提示' }).click();
    await page.waitForTimeout(6500); // Covers two real 3-second polling cycles.
    assert.equal(await toast.count(), 0);
    assert.equal((await runtime.store.getAccount(adminId, account.id)).status, 'verification_required');
    assert.equal((await runtime.store.listRiskNotifications(adminId)).length, 1);
    await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '仪表盘' }).click();

    // A new notification appears; a failed read remains retryable and Chinese.
    await runtime.store.clearAccountRisk({ adminId, accountId: account.id, episode: (await runtime.store.getAccount(adminId, account.id)).riskEpisode, source: 'seller.orders.internal', startedAt: new Date(Date.now() + 1000).toISOString() });
    await runtime.store.flushAccountRiskAlerts(100);
    await waitFor(async () => (await toast.innerText().catch(() => '')).includes('验证状态已更新'), 'recovery toast');
    await toast.getByRole('button', { name: '查看账号' }).click();
    assert.ok(page.url().endsWith('/accounts'));
    const acknowledge = runtime.store.acknowledgeRiskNotification.bind(runtime.store);
    runtime.store.acknowledgeRiskNotification = async () => { throw new Error('RAW_ACK_DATABASE_FAILURE'); };
    await toast.getByRole('button', { name: '已知晓' }).click();
    await waitFor(async () => (await toast.innerText()).includes('通知确认失败'), 'Chinese acknowledgement error');
    assert.doesNotMatch(await toast.innerText(), /RAW_ACK|INTERNAL_ERROR/);
    runtime.store.acknowledgeRiskNotification = acknowledge;
    await toast.getByRole('button', { name: '重试' }).click();
    await waitFor(async () => (await runtime.store.listRiskNotifications(adminId)).length === 0, 'persisted notification acknowledgement');
    await waitFor(async () => await toast.count() === 0, 'acknowledged toast dismissed');

    // Unknown future risk codes must use a Chinese fallback too.
    await runtime.store.recordAccountRisk({ adminId, accountId: account.id, code: 'FUTURE_VENDOR_CODE', source: 'seller.orders.internal' });
    await runtime.store.flushAccountRiskAlerts(100);
    await waitFor(async () => (await toast.innerText().catch(() => '')).includes('需要安全验证'), 'new risk episode');
    assert.doesNotMatch(await page.locator('body').innerHTML(), /FUTURE_VENDOR_CODE|seller\.orders\.internal/);
    await toast.getByRole('button', { name: '已知晓' }).click();
    await waitFor(async () => await toast.count() === 0, 'new risk acknowledged');
    assert.equal((await runtime.store.getAccount(adminId, account.id)).status, 'verification_required');

    // Login errors cross the real API and use Chinese global feedback too.
    runtime.xianyu.verifyLogin = async () => ({ success: false, accountInvalid: false, errorCode: 'RAW_COOKIE_CODE', message: 'RAW_COOKIE_FAILURE' });
    await page.getByRole('button', { name: '授权', exact: true }).click();
    await page.locator('[data-login-method="cookie"]').click();
    await page.locator('.account-login-form textarea').fill('unb=feedback-seller; _m_h5_tk=test-only');
    await page.getByRole('button', { name: '验证 Cookie 并更新账号' }).click();
    await waitFor(async () => (await toast.innerText().catch(() => '')).includes('登录凭证校验失败'), 'cookie error translation');
    assert.equal(await page.locator('.account-login-form .inline-error').count(), 0);
    assert.doesNotMatch(await page.locator('body').innerText(), /RAW_COOKIE/);
    await toast.getByRole('button', { name: '关闭提示' }).click();
    await page.locator('[data-login-method="password"]').click();
    await page.getByRole('textbox', { name: '闲鱼账号', exact: true }).fill('test-only');
    await page.getByRole('textbox', { name: '密码', exact: true }).fill('test-only');
    await page.getByRole('button', { name: '登录并添加账号', exact: true }).click();
    await waitFor(async () => (await toast.innerText().catch(() => '')).includes('暂不支持账号密码登录'), 'password error translation');
    assert.equal(await page.locator('.account-login-form .inline-error').count(), 0);
    await page.getByRole('button', { name: '关闭登录弹窗' }).click();
    await toast.getByRole('button', { name: '关闭提示' }).click();

    const createQr = runtime.qrLogin.create.bind(runtime.qrLogin);
    runtime.qrLogin.create = async () => { throw new Error('RAW_QR_GENERATION_FAILURE'); };
    // Exercise the real adapter route while replacing its external boundary.
    runtime.config.xianyuQrMode = 'real';
    await page.getByRole('button', { name: '授权', exact: true }).click();
    await waitFor(async () => (await toast.innerText().catch(() => '')).includes('二维码登录失败'), 'QR generation failure toast');
    assert.equal(await page.locator('.qr-login-error[role="alert"]').count(), 0);
    assert.doesNotMatch(await page.locator('body').innerText(), /RAW_QR_GENERATION_FAILURE|QR_GENERATE_FAILED/);
    await page.getByRole('button', { name: '关闭登录弹窗' }).click();
    await toast.getByRole('button', { name: '关闭提示' }).click();
    runtime.qrLogin.create = createQr;
    runtime.config.xianyuQrMode = 'stub';

    // A real API failure is presented through the same global toast.
    const listAccounts = runtime.store.listAccounts.bind(runtime.store);
    runtime.store.listAccounts = async () => { throw new Error('RAW_ACCOUNT_DATABASE_FAILURE'); };
    await page.getByRole('button', { name: '刷新', exact: true }).click();
    await waitFor(async () => (await toast.innerText().catch(() => '')).includes('账号列表加载失败'), 'list failure toast');
    assert.equal(await page.locator('.accounts-domain-state-error[role="alert"]').count(), 0);
    assert.doesNotMatch(await page.locator('body').innerText(), /RAW_ACCOUNT|INTERNAL_ERROR/);
    // Exercise this action while the backend still fails. Once restored, the
    // list's normal refresh can correctly dismiss the toast before a click.
    // Hold pageSize=20 responses to observe manual loading: the normal silent
    // poll cannot produce this state, even if it fires during the assertion.
    let releaseListRetry;
    const listRetryGate = new Promise(resolve => { releaseListRetry = resolve; });
    runtime.store.listAccounts = async (_adminId, query) => {
      if (query?.pageSize === 20) await listRetryGate;
      throw new Error('RAW_ACCOUNT_DATABASE_FAILURE');
    };
    const retriedListFailure = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname === '/api/v1/accounts' && url.searchParams.get('pageSize') === '20' && response.status() === 500;
    });
    try {
      await toast.getByRole('button', { name: '重新加载' }).click();
      await page.getByText('正在加载账号列表…', { exact: true }).waitFor({ timeout: 1500 });
    } finally { releaseListRetry(); }
    await retriedListFailure;
    await waitFor(async () => (await toast.innerText().catch(() => '')).includes('账号列表加载失败'), 'list retry still reports the active failure');
    await waitFor(async () => (await toast.innerText().catch(() => '')).includes('账号状态刷新失败'), 'global account refresh failure');
    assert.equal(await page.locator('.app-toast').count(), 1);
    assert.equal(await page.locator('.account-risk-banner').count(), 0);
    runtime.store.listAccounts = listAccounts;
    await toast.getByRole('button', { name: '重试', exact: true }).click();
    await page.getByRole('table').waitFor();
    await waitFor(async () => await toast.count() === 0, 'both recovered account reads dismiss their stale errors');

    // Delete failure keeps the dialog available and reports only via toast.
    const deleteAccount = runtime.store.deleteAccount.bind(runtime.store);
    runtime.store.deleteAccount = async () => { throw new Error('RAW_DELETE_FAILURE'); };
    await page.getByTestId('account-delete').click();
    await page.getByTestId('account-delete-confirm').click();
    await waitFor(async () => (await toast.innerText().catch(() => '')).includes('账号删除失败'), 'delete failure toast');
    assert.equal(await page.getByRole('dialog').count(), 1);
    assert.equal(await page.locator('.account-delete-error').count(), 0);
    assert.doesNotMatch(await page.locator('body').innerText(), /RAW_DELETE|INTERNAL_ERROR/);
    runtime.store.deleteAccount = deleteAccount;
    await page.getByTestId('account-delete-confirm').click();
    await waitFor(async () => await page.getByRole('dialog').count() === 0, 'delete retry succeeds');
    assert.equal((await runtime.store.getAccount(adminId, account.id)), undefined);
    assert.deepEqual(errors, []);
    await writeFile(join(evidenceDir, 'result.json'), JSON.stringify({ result: 'passed', backend: 'real createApp + isolated MemoryStore', viewport: ['1440x900', '390x844'], checks: ['Chinese known/unknown risk codes', 'no flow banners', 'fixed bottom-right toast', 'polling deduplication', 'dismiss vs acknowledge', 'acknowledgement failure/retry', 'cross-page navigation', 'cookie/password/QR failure translation', 'list failure/retry', 'global refresh failure/retry and queued feedback', 'delete failure/retry'], pageErrors: errors }, null, 2) + '\n');
    console.log('PASS account feedback browser regression');
  }
} finally {
  await browser?.close();
  await vite?.close();
  await runtime.close();
}
