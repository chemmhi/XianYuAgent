import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = join(import.meta.dirname, '..', '..', '..');
const { createApp } = await import(pathToFileURL(join(root, 'apps', 'api', 'dist', 'app.js')).href);
const children = [];
const chromeProfile = join(tmpdir(), `xianyu-agent-products-chrome-${process.pid}`);
const chromePath = process.env.CHROME_PATH ?? join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe');
const screenshotDir = join(root, 'docs', 'evidence', 'stage5', 'S4-VS2', 'screenshots');
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
  child.stdout.on('data', (chunk) => process.stdout.write(`[products-e2e:${command}] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[products-e2e:${command}] ${chunk}`));
  children.push(child);
  return child;
}

async function waitFor(check, label, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try { const result = await check(); if (result) return result; } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`${label} did not become ready${lastError ? `: ${lastError.message}` : ''}`);
}

function cookiesFrom(response) { return (response.headers.getSetCookie?.() ?? []).map((value) => value.split(';', 1)[0]).join('; '); }

async function createCdpClient(debugPort) {
  const target = await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
    if (!response.ok) return false;
    const pages = await response.json();
    return pages.find((item) => item.type === 'page' && item.webSocketDebuggerUrl) ?? false;
  }, 'Chrome DevTools Protocol');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let nextId = 0;
  const pending = new Map();
  const events = [];
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (!message.id && message.method) events.push(message);
    if (!message.id || !pending.has(message.id)) return;
    const entry = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(message.error.message)); else entry.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++nextId; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
  return { socket, send, events };
}

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? 'browser script failed');
  return result.result?.value;
}

async function captureViewport(cdp, width, height, filename) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  mkdirSync(screenshotDir, { recursive: true });
  writeFileSync(join(screenshotDir, filename), Buffer.from(screenshot.data, 'base64'));
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
  const bootstrap = await fetch(`${apiUrl}/api/v1/auth/bootstrap`, { method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': `products-bootstrap-${process.pid}` }, body: JSON.stringify({ email: 'products-e2e@example.com', password: 'password-123', displayName: 'Products E2E' }) });
  if (!bootstrap.ok) throw new Error(`bootstrap failed: ${bootstrap.status}`);
  const bootstrapPayload = await bootstrap.json();
  const adminId = bootstrapPayload.data.profile.id;
  const account = await apiRuntime.store.createAccount({ adminId, platform: 'xianyu', sellerRef: `products-e2e-${process.pid}`, displayName: 'Chrome 商品账号' });
  const secondaryAccount = await apiRuntime.store.createAccount({ adminId, platform: 'xianyu', sellerRef: `products-e2e-secondary-${process.pid}`, displayName: 'Secondary 商品账号' });
  await apiRuntime.store.createProduct({ adminId, accountId: account.id, externalProductRef: `ITEM-${process.pid}`, title: 'Chrome E2E 商品', description: '商品详情来自独立 detail API', categoryCode: 'digital', attributes: { source: 'chrome-e2e' }, priceMinor: 3990, status: 'published' });
  apiRuntime.xianyu.fetchItemsAll = async () => {
    const items = Array.from({ length: 29 }, (_, index) => ({ externalProductRef: `SYNC-${process.pid}-${index + 1}`, title: `Chrome E2E 同步商品 ${index + 1}`, description: '来自闲鱼同步 fixture', categoryCode: 'digital', priceMinor: 1290 + index, detailUrl: `https://www.goofish.com/item?id=SYNC-${process.pid}-${index + 1}`, imageUrls: ['https://img.example/sync.jpg'], attributes: { source: 'chrome-sync-e2e' }, sourcePayloadDigest: `sync-${process.pid}-${index + 1}` }));
    return { pages: [{ success: true, accountInvalid: false, cookieHeader: '', items, pageNumber: 1, pageSize: 20, totalCount: items.length, totalPages: 1, hasMore: false }], items, hasMore: false };
  };
  const cookie = cookiesFrom(bootstrap);
  spawnProcess(npm, npmArgs(['--workspace', 'apps/web', 'run', 'dev', '--', '--host', '127.0.0.1', '--port', String(webPort)]), { env: { ...process.env, VITE_API_MODE: 'live', VITE_API_BASE_URL: '', VITE_API_PROXY_TARGET: apiUrl } });
  await waitFor(async () => (await fetch(`${webUrl}/products`)).ok, 'Vite frontend');
  const chrome = spawnProcess(chromePath, ['--headless=new', '--disable-gpu', '--disable-extensions', '--no-first-run', '--no-default-browser-check', '--remote-allow-origins=*', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${chromeProfile}`, '--window-size=1440,900', 'about:blank']);
  await waitFor(async () => chrome.exitCode === null && (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).ok, 'local Chrome');
  const cdp = await createCdpClient(debugPort);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable');
  for (const pair of cookie.split('; ')) { const [name, ...valueParts] = pair.split('='); await cdp.send('Network.setCookie', { name, value: valueParts.join('='), url: `${webUrl}/` }); }
  await cdp.send('Page.navigate', { url: `${webUrl}/products` });
  await waitFor(async () => String(await evaluate(cdp, 'document.readyState')) === 'complete', 'products page');
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('商品目录'), 'products list');
  await evaluate(cdp, `localStorage.setItem('xianyu.activeAccountId', ${JSON.stringify(account.id)}); location.reload();`);
  await waitFor(async () => String(await evaluate(cdp, 'document.querySelector("[data-testid=product-account-context]")?.textContent ?? ""')).includes('Chrome 商品账号'), 'active account context');
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('Chrome E2E 商品'), 'product row');
  const syncButton = await evaluate(cdp, '(() => { const button = document.querySelector("[data-testid=sync-products]"); if (!button || button.disabled) return false; button.click(); return true; })()');
  if (!syncButton) throw new Error('sync products button missing or disabled');
  await waitFor(async () => cdp.events.some((event) => event.method === 'Network.requestWillBeSent' && event.params?.request?.method === 'POST' && event.params?.request?.url?.includes('/api/v1/products/sync')), 'xianyu product sync request');
  await waitFor(async () => String(await evaluate(cdp, 'document.querySelector("[data-testid=products-total]")?.textContent ?? ""')).includes('30'), '29 synced products plus local product');
  const refreshMark = cdp.events.length;
  if (!await evaluate(cdp, '(() => { const button = document.querySelector("[data-testid=refresh-products]"); if (!button || button.disabled) return false; button.click(); return true; })()')) throw new Error('refresh products button missing or disabled');
  await waitFor(async () => cdp.events.slice(refreshMark).some((event) => event.method === 'Network.requestWillBeSent' && event.params?.request?.method === 'GET' && event.params?.request?.url?.match(/\/api\/v1\/products(?:\?|$)/)), 'local product refresh request');
  if (cdp.events.slice(refreshMark).some((event) => event.method === 'Network.requestWillBeSent' && event.params?.request?.url?.includes('/api/v1/products/sync'))) throw new Error('refresh must not call xianyu sync endpoint');
  const publishMark = cdp.events.length;
  if (!await evaluate(cdp, '(() => { const button = document.querySelector("[data-testid=publish-product]"); if (!button || button.disabled) return false; button.click(); return true; })()')) throw new Error('publish product button missing or disabled');
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('新建商品草稿'), 'create draft drawer');
  if (cdp.events.slice(publishMark).some((event) => event.method === 'Network.requestWillBeSent' && /publish|bulk-publish|mtop/i.test(event.params?.request?.url ?? ''))) throw new Error('publish draft entry must not call a real publish endpoint');
  await evaluate(cdp, '(() => { const set = (label, value) => { const input = document.querySelector(`[aria-label="${label}"]`); if (!input) throw new Error(`missing ${label}`); const setter = Object.getOwnPropertyDescriptor(input.__proto__, "value")?.set; setter?.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true })); }; set("商品标题", "Chrome 创建草稿"); set("分类编码", "digital"); set("价格（分）", "2990"); set("商品描述", "来自 Chrome E2E 的草稿"); })()');
  const savedCreate = await evaluate(cdp, '(() => { const button = Array.from(document.querySelectorAll("button")).find((item) => item.textContent?.includes("保存草稿")); if (!button || button.disabled) return false; button.click(); return true; })()');
  if (!savedCreate) throw new Error('save draft button disabled');
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('Chrome 创建草稿'), 'created draft row');
  const opened = await evaluate(cdp, '(() => { const button = Array.from(document.querySelectorAll("button")).find((item) => item.textContent?.includes("查看详情")); if (!button) return false; button.click(); return true; })()');
  if (!opened) throw new Error('product detail button missing');
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('Chrome 创建草稿'), 'product detail');
  const openedEdit = await evaluate(cdp, '(() => { const button = Array.from(document.querySelectorAll("button")).find((item) => item.textContent?.includes("编辑草稿")); if (!button) return false; button.click(); return true; })()');
  if (!openedEdit) throw new Error('edit draft button missing');
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('编辑商品草稿'), 'edit draft drawer');
  await evaluate(cdp, '(() => { const input = document.querySelector(`[aria-label="商品标题"]`); if (!input) throw new Error("missing title"); const setter = Object.getOwnPropertyDescriptor(input.__proto__, "value")?.set; setter?.call(input, "Chrome 编辑草稿"); input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true })); })()');
  const savedEdit = await evaluate(cdp, '(() => { const button = Array.from(document.querySelectorAll("button")).find((item) => item.textContent?.includes("保存草稿")); if (!button || button.disabled) return false; button.click(); return true; })()');
  if (!savedEdit) throw new Error('edit save button disabled');
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('Chrome 编辑草稿'), 'updated draft row');
  await cdp.send('Page.reload', { ignoreCache: true });
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('Chrome 编辑草稿'), 'products persisted after reload');
  await captureViewport(cdp, 1440, 900, 'products-desktop-1440x900.png');
  await captureViewport(cdp, 390, 844, 'products-mobile-390x844.png');
  await cdp.send('Page.navigate', { url: `${webUrl}/accounts` });
  await waitFor(async () => String(await evaluate(cdp, 'document.readyState')) === 'complete', 'accounts page after product flow');
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('账号列表'), 'accounts list for UI switch');
  const switched = await evaluate(cdp, `(() => { const rows = Array.from(document.querySelectorAll('[role="row"]')); const row = rows.find((candidate) => candidate.textContent?.includes(${JSON.stringify(secondaryAccount.displayName)}) && candidate.querySelector('[data-testid="account-switch"]')?.textContent?.includes('切换账号')); const button = row?.querySelector('[data-testid="account-switch"]'); if (!button) return false; button.click(); return true; })()`);
  if (!switched) throw new Error('secondary account switch button missing or disabled');
  await waitFor(async () => String(await evaluate(cdp, 'localStorage.getItem("xianyu.activeAccountId") ?? ""')) === secondaryAccount.id, 'ui account switch persisted');
  const secondaryProductsMark = cdp.events.length;
  await cdp.send('Page.navigate', { url: `${webUrl}/products` });
  await waitFor(async () => String(await evaluate(cdp, 'document.readyState')) === 'complete', 'products page after account switch');
  await waitFor(async () => String(await evaluate(cdp, 'document.querySelector("[data-testid=product-account-context]")?.textContent ?? ""')).includes('Secondary 商品账号'), 'switched product account context');
  await waitFor(async () => cdp.events.slice(secondaryProductsMark).some((event) => {
    if (event.method !== 'Network.requestWillBeSent' || event.params?.request?.method !== 'GET') return false;
    const url = new URL(event.params.request.url);
    return url.pathname === '/api/v1/products' && url.searchParams.get('accountId') === secondaryAccount.id;
  }), 'secondary scoped product request');
  if (String(await evaluate(cdp, 'document.body.innerText')).includes('Chrome 编辑草稿')) throw new Error('switched account should not show primary account product');
  await cdp.send('Emulation.clearDeviceMetricsOverride');
  console.log('local Chrome E2E passed: account context -> sync -> local refresh -> draft create/detail/edit/reload -> UI account switch');
  cdp.socket.close();
}

try { await run(); } finally {
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
