import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = join(import.meta.dirname, '..', '..', '..');
const { createApp } = await import(pathToFileURL(join(root, 'apps', 'api', 'dist', 'app.js')).href);
const { buildRefreshOrderFixture, seedOrderFixture, ORDER_FIXTURE_PRIMARY_NAME, ORDER_FIXTURE_SECONDARY_NAME } = await import(pathToFileURL(join(root, 'apps', 'api', 'scripts', 'orders-e2e-fixture.mjs')).href);
const children = [];
const chromeProfile = join(tmpdir(), `xianyu-agent-orders-chrome-${process.pid}`);
const chromePath = process.env.CHROME_PATH ?? join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe');
const screenshotDir = join(root, 'docs', 'evidence', 'stage5', 'S4-VS4A', 'screenshots');
let apiRuntime;

async function freePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function spawnProcess(command, args, options = {}) {
  const child = spawn(command, args, { cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, shell: command.endsWith('.cmd'), ...options });
  child.stdout.on('data', (chunk) => process.stdout.write(`[orders-e2e:${command}] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[orders-e2e:${command}] ${chunk}`));
  children.push(child);
  return child;
}

async function waitFor(check, label, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const result = await check();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`${label} did not become ready${lastError ? `: ${lastError.message}` : ''}`);
}

function cookiesFrom(response) {
  return (response.headers.getSetCookie?.() ?? []).map((value) => value.split(';', 1)[0]).join('; ');
}

async function createCdpClient(debugPort) {
  const target = await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
    if (!response.ok) return false;
    const pages = await response.json();
    return pages.find((item) => item.type === 'page' && item.webSocketDebuggerUrl) ?? false;
  }, 'Chrome DevTools Protocol');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  const events = [];
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (!message.id && message.method) events.push(message);
    if (!message.id || !pending.has(message.id)) return;
    const entry = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(message.error.message));
    else entry.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  return { socket, send, events };
}

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? 'browser script failed');
  return result.result?.value;
}

async function captureViewport(cdp, width, height, filename) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
  const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  mkdirSync(screenshotDir, { recursive: true });
  writeFileSync(join(screenshotDir, filename), Buffer.from(screenshot.data, 'base64'));
}

function apiEvent(events, method, pathname, predicate = () => true) {
  return events.some((event) => {
    if (event.method !== 'Network.requestWillBeSent' || event.params?.request?.method !== method) return false;
    const url = new URL(event.params.request.url);
    return url.pathname === pathname && predicate(url);
  });
}

function setSelectScript(label, value) {
  return `(() => { const input = document.querySelector(${JSON.stringify(`[aria-label="${label}"]`)}); if (!input) return false; input.value = ${JSON.stringify(value)}; input.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`;
}

function setInputScript(label, value) {
  return `(() => { const input = document.querySelector(${JSON.stringify(`[aria-label="${label}"]`)}); if (!input) return false; const setter = Object.getOwnPropertyDescriptor(input.__proto__, 'value')?.set; setter?.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`;
}

async function run() {
  const apiPort = await freePort();
  const webPort = await freePort();
  const debugPort = await freePort();
  const apiUrl = `http://127.0.0.1:${apiPort}`;
  const webUrl = `http://127.0.0.1:${webPort}`;
  mkdirSync(chromeProfile, { recursive: true });
  const npm = process.env.npm_execpath ? process.execPath : (process.platform === 'win32' ? 'npm.cmd' : 'npm');
  const npmArgs = (args) => process.env.npm_execpath ? [process.env.npm_execpath, ...args] : args;

  const apiBuild = spawnProcess(npm, npmArgs(['--workspace', 'apps/api', 'run', 'build']));
  const buildExit = await new Promise((resolve) => apiBuild.once('exit', resolve));
  if (buildExit !== 0) throw new Error(`API build failed with ${buildExit}`);

  apiRuntime = createApp({ host: '127.0.0.1', port: apiPort, cookieSecure: false, allowInMemory: true, sessionIdleMs: 1_800_000, sessionAbsoluteMs: 28_800_000, xianyuQrMode: 'stub' });
  await apiRuntime.listen();
  await waitFor(async () => (await fetch(`${apiUrl}/healthz`)).ok, 'API');

  const bootstrap = await fetch(`${apiUrl}/api/v1/auth/bootstrap`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'Idempotency-Key': `orders-bootstrap-${process.pid}` },
    body: JSON.stringify({ email: 'orders-e2e@example.com', password: 'password-123', displayName: 'Orders E2E' }),
  });
  if (!bootstrap.ok) throw new Error(`bootstrap failed: ${bootstrap.status}`);
  const bootstrapPayload = await bootstrap.json();
  const adminId = bootstrapPayload.data.profile.id;
  const account = await apiRuntime.store.createAccount({ adminId, platform: 'xianyu', sellerRef: `orders-e2e-${process.pid}`, displayName: ORDER_FIXTURE_PRIMARY_NAME });
  const secondaryAccount = await apiRuntime.store.createAccount({ adminId, platform: 'xianyu', sellerRef: `orders-e2e-secondary-${process.pid}`, displayName: ORDER_FIXTURE_SECONDARY_NAME });
  const { fixture } = await seedOrderFixture(apiRuntime, { adminId, accountId: account.id, secondaryAccountId: secondaryAccount.id, processId: process.pid });
  if (typeof apiRuntime.store.listOrders !== 'function') throw new Error('Orders E2E requires runtime.store.listOrders() for persistence verification');
  const seededRows = await apiRuntime.store.listOrders(adminId, { accountId: account.id, page: 1, pageSize: 100, sortBy: 'createdAt', sortOrder: 'desc' });
  if (seededRows.total !== 21) throw new Error(`store seed count mismatch: expected 21, got ${seededRows.total}`);

  const refreshFixture = buildRefreshOrderFixture({ processId: process.pid, accountId: account.id });
  const fetchOrders = async () => ({ items: [refreshFixture], orders: [refreshFixture], pages: [{ success: true, accountInvalid: false, items: [refreshFixture], orders: [refreshFixture], pageNumber: 1, pageSize: 20, totalCount: 1, totalPages: 1, hasMore: false }], hasMore: false });
  // Keep the e2e deterministic even though the production adapter normally calls Goofish.
  apiRuntime.xianyu.fetchOrdersAll = fetchOrders;
  apiRuntime.xianyu.fetchOrders = fetchOrders;
  apiRuntime.xianyu.fetchOrderList = fetchOrders;

  const cookie = cookiesFrom(bootstrap);
  spawnProcess(npm, npmArgs(['--workspace', 'apps/web', 'run', 'dev', '--', '--host', '127.0.0.1', '--port', String(webPort)]), {
    env: { ...process.env, VITE_API_MODE: 'live', VITE_API_BASE_URL: '', VITE_API_PROXY_TARGET: apiUrl },
  });
  await waitFor(async () => (await fetch(`${webUrl}/orders`)).ok, 'Vite frontend');

  const chrome = spawnProcess(chromePath, ['--headless=new', '--disable-gpu', '--disable-extensions', '--no-first-run', '--no-default-browser-check', '--remote-allow-origins=*', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${chromeProfile}`, '--window-size=1440,900', 'about:blank']);
  await waitFor(async () => chrome.exitCode === null && (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).ok, 'local Chrome');
  const cdp = await createCdpClient(debugPort);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable');
  for (const pair of cookie.split('; ')) {
    const [name, ...valueParts] = pair.split('=');
    await cdp.send('Network.setCookie', { name, value: valueParts.join('='), url: `${webUrl}/` });
  }

  await cdp.send('Page.navigate', { url: `${webUrl}/accounts` });
  await waitFor(async () => String(await evaluate(cdp, 'document.readyState')) === 'complete', 'accounts page');
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('账号列表'), 'accounts list');
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes(account.displayName), 'primary account row');
  const switched = await evaluate(cdp, `(() => { const rows = Array.from(document.querySelectorAll('[role="row"]')); const row = rows.find((candidate) => candidate.textContent?.includes(${JSON.stringify(account.displayName)})); const button = row?.querySelector('[data-testid="account-switch"]'); if (!button || button.disabled) return false; button.click(); return true; })()`);
  if (!switched) throw new Error('primary account switch button missing or disabled');
  await waitFor(async () => String(await evaluate(cdp, 'localStorage.getItem("xianyu.activeAccountId") ?? ""')) === account.id, 'primary account selection');

  await cdp.send('Page.navigate', { url: `${webUrl}/orders` });
  await waitFor(async () => String(await evaluate(cdp, 'document.readyState')) === 'complete', 'orders page');
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('订单列表'), 'orders heading');
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('订单验收商品'), 'seeded order row');
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('订单验收昵称'), 'seeded buyer nickname');
  await waitFor(async () => Boolean(await evaluate(cdp, 'document.querySelectorAll("[data-order-no] .orders-avatar img").length > 0')), 'seeded buyer avatar');
  await waitFor(async () => apiEvent(cdp.events, 'GET', '/api/v1/orders', (url) => url.searchParams.get('accountId') === account.id), 'scoped orders request');
  if (!String(await evaluate(cdp, 'document.body.innerText')).includes('共 21 单')) throw new Error('initial order total missing');
  const tableHeaders = String(await evaluate(cdp, 'document.querySelector("[data-testid=orders-table]")?.textContent ?? ""'));
  for (const header of ['订单号', '买家昵称', '商品名称', '金额', '下单时间', '当前状态', '操作']) if (!tableHeaders.includes(header)) throw new Error(`orders table header missing: ${header}`);
  for (const removed of ['支付状态', '订单状态', '发货状态', '售后', '账号']) if (tableHeaders.includes(removed)) throw new Error(`legacy orders column remains: ${removed}`);
  if (!await evaluate(cdp, 'Boolean(document.querySelector("[data-order-no] [title^=\\"买家姓名：\\"]"))')) throw new Error('buyer nickname tooltip missing');
  const initialPagination = String(await evaluate(cdp, 'document.querySelector("[data-testid=orders-pagination]")?.textContent ?? ""'));
  if (!initialPagination.includes('第 1 / 2 页')) throw new Error('orders pagination missing');
  if (await evaluate(cdp, 'document.querySelector(".orders-risk-note") !== null')) throw new Error('risk note must not appear on first page fixture');

  const statusFilterMark = cdp.events.length;
  if (!await evaluate(cdp, setSelectScript('订单状态', 'pending_payment'))) throw new Error('order status filter missing');
  await waitFor(async () => apiEvent(cdp.events.slice(statusFilterMark), 'GET', '/api/v1/orders', (url) => url.searchParams.get('paymentStatus') === 'unpaid'), 'order status request');
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('待付款'), 'order status filtered rows');

  const statusResetMark = cdp.events.length;
  if (!await evaluate(cdp, setSelectScript('订单状态', 'all'))) throw new Error('order status reset missing');
  await waitFor(async () => apiEvent(cdp.events.slice(statusResetMark), 'GET', '/api/v1/orders', (url) => !url.searchParams.has('paymentStatus') && !url.searchParams.has('deliveryStatus') && !url.searchParams.has('orderStatus') && !url.searchParams.has('afterSalesStatus')), 'order status reset request');

  const keywordMark = cdp.events.length;
  if (!await evaluate(cdp, setInputScript('搜索订单', '订单验收昵称'))) throw new Error('order search input missing');
  await waitFor(async () => apiEvent(cdp.events.slice(keywordMark), 'GET', '/api/v1/orders', (url) => url.searchParams.get('keyword') === '订单验收昵称'), 'keyword request');
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('E2E-'), 'keyword result');

  // Reset filters before exercising detail, pagination and sync.
  await evaluate(cdp, `(() => { const input = document.querySelector('[aria-label="搜索订单"]'); if (input) { const setter = Object.getOwnPropertyDescriptor(input.__proto__, 'value')?.set; setter?.call(input, ''); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); } const select = document.querySelector('[aria-label="订单状态"]'); if (select) { select.value = 'all'; select.dispatchEvent(new Event('change', { bubbles: true })); } return true; })()`);
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('共 21 单'), 'orders filter reset');

  const detailOpened = await evaluate(cdp, '(() => { const button = document.querySelector("[data-order-no] .orders-order-link"); if (!button) return false; button.click(); return true; })()');
  if (!detailOpened) throw new Error('order detail link missing');
  await waitFor(async () => String(await evaluate(cdp, 'document.querySelector("[role=dialog]")?.textContent ?? ""')).includes('订单验收商品'), 'order detail drawer');
  if (await evaluate(cdp, 'String(document.querySelector("[role=dialog]")?.textContent ?? "").includes("卡券正文")')) throw new Error('order detail leaked sensitive delivery content');
  await evaluate(cdp, 'document.querySelector("[aria-label=关闭订单详情]")?.click()');
  await waitFor(async () => !(await evaluate(cdp, 'document.querySelector("[role=dialog]") !== null')), 'detail drawer close');

  const pageTwoMark = cdp.events.length;
  if (!await evaluate(cdp, '(() => { const button = document.querySelector("[data-testid=orders-page-2]"); if (!button || button.disabled) return false; button.click(); return true; })()')) throw new Error('orders page 2 button missing or disabled');
  await waitFor(async () => apiEvent(cdp.events.slice(pageTwoMark), 'GET', '/api/v1/orders', (url) => url.searchParams.get('page') === '2'), 'orders page 2 request');
  await waitFor(async () => String(await evaluate(cdp, 'document.querySelector("[data-testid=orders-page-2][aria-current=page]") ? document.body.innerText : ""')).includes('第 2 / 2 页'), 'orders page 2 state');
  await evaluate(cdp, 'document.querySelector("[data-testid=orders-page-1]")?.click()');
  await waitFor(async () => String(await evaluate(cdp, 'document.querySelector("[data-testid=orders-page-1][aria-current=page]") ? document.body.innerText : ""')).includes('第 1 / 2 页'), 'orders page 1 state');

  const localRefreshMark = cdp.events.length;
  if (!await evaluate(cdp, '(() => { const button = document.querySelector("[data-testid=refresh-orders]"); if (!button || button.disabled) return false; button.click(); return true; })()')) throw new Error('local orders refresh button missing or disabled');
  await waitFor(async () => apiEvent(cdp.events.slice(localRefreshMark), 'GET', '/api/v1/orders'), 'local orders refresh request');
  await waitFor(async () => Boolean(await evaluate(cdp, '(() => { const button = document.querySelector("[data-testid=refresh-orders]"); return Boolean(button && !button.disabled); })()')), 'local orders refresh completion');
  await waitFor(async () => Boolean(await evaluate(cdp, '(() => { const button = document.querySelector("[data-testid=sync-orders]"); return Boolean(button && !button.disabled); })()')), 'Xianyu orders refresh enabled');
  if (cdp.events.slice(localRefreshMark).some((event) => event.method === 'Network.requestWillBeSent' && event.params?.request?.url?.includes('/api/v1/orders/refresh'))) throw new Error('local refresh called Xianyu refresh endpoint');

  const syncMark = cdp.events.length;
  if (!await evaluate(cdp, '(() => { const button = document.querySelector("[data-testid=sync-orders]"); if (!button || button.disabled) return false; button.click(); return true; })()')) throw new Error('Xianyu order refresh button missing or disabled');
  await waitFor(async () => apiEvent(cdp.events.slice(syncMark), 'POST', '/api/v1/orders/refresh'), 'Xianyu orders refresh request');
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('闲鱼刷新订单'), 'refreshed order row');
  const afterRefresh = await apiRuntime.store.listOrders(adminId, { accountId: account.id, page: 1, pageSize: 100, sortBy: 'createdAt', sortOrder: 'desc' });
  if (afterRefresh.total !== 22) throw new Error(`store refresh count mismatch: expected 22, got ${afterRefresh.total}`);

  await captureViewport(cdp, 1440, 900, 'orders-desktop-1440x900.png');
  await captureViewport(cdp, 390, 844, 'orders-mobile-390x844.png');

  await cdp.send('Page.navigate', { url: `${webUrl}/accounts` });
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('账号列表'), 'accounts page after order flow');
  const switchedSecondary = await evaluate(cdp, `(() => { const rows = Array.from(document.querySelectorAll('[role="row"]')); const row = rows.find((candidate) => candidate.textContent?.includes(${JSON.stringify(secondaryAccount.displayName)})); const button = row?.querySelector('[data-testid="account-switch"]'); if (!button || button.disabled) return false; button.click(); return true; })()`);
  if (!switchedSecondary) throw new Error('secondary account switch button missing or disabled');
  await waitFor(async () => String(await evaluate(cdp, 'localStorage.getItem("xianyu.activeAccountId") ?? ""')) === secondaryAccount.id, 'secondary account selection');
  const secondaryOrdersMark = cdp.events.length;
  await cdp.send('Page.navigate', { url: `${webUrl}/orders` });
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes(`当前账号：${secondaryAccount.displayName}`), 'secondary orders context');
  await waitFor(async () => apiEvent(cdp.events.slice(secondaryOrdersMark), 'GET', '/api/v1/orders', (url) => url.searchParams.get('accountId') === secondaryAccount.id), 'secondary scoped orders request');
  if (String(await evaluate(cdp, 'document.body.innerText')).includes('订单验收商品')) throw new Error('secondary account leaked primary order');
  if (!String(await evaluate(cdp, 'document.body.innerText')).includes('共 3 单')) throw new Error('secondary order total missing');

  await cdp.send('Emulation.clearDeviceMetricsOverride');
  console.log('local Chrome orders E2E passed: store seed -> scoped list -> filters -> detail -> pagination -> local refresh -> Xianyu refresh -> screenshots -> account isolation');
  cdp.socket.close();
}

try {
  await run();
} finally {
  for (const child of children.reverse()) {
    if (!child.killed && child.exitCode === null) {
      if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      else child.kill('SIGTERM');
    }
    child.stdout?.destroy();
    child.stderr?.destroy();
  }
  if (apiRuntime) await apiRuntime.close();
  try { rmSync(chromeProfile, { recursive: true, force: true }); } catch (error) { console.warn(`Chrome temporary profile cleanup failed: ${error.message}`); }
}
