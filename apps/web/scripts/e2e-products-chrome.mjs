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
  const localProduct = await apiRuntime.store.createProduct({ adminId, accountId: account.id, externalProductRef: `ITEM-${process.pid}`, title: 'Chrome E2E 商品', description: '商品详情来自独立 detail API', categoryCode: 'digital', attributes: { source: 'chrome-e2e' }, knowledgeBase: '请用简洁中文回答买家问题。', priceMinor: 3990, status: 'published' });
  const couponBatch = await apiRuntime.store.createCouponBatch({ adminId, accountId: account.id, label: 'Chrome E2E 卡券', purpose: 'text', deliveryScope: 'operator_only' });
  await apiRuntime.store.bindCouponBatch({ adminId, batchId: couponBatch.id, productId: localProduct.id });
  apiRuntime.xianyu.fetchItemsAll = async () => {
    const items = Array.from({ length: 29 }, (_, index) => ({ externalProductRef: `SYNC-${process.pid}-${index + 1}`, title: `Chrome E2E 同步商品 ${index + 1}`, description: '来自闲鱼同步 fixture', categoryCode: 'digital', priceMinor: 1290 + index, detailUrl: `https://www.goofish.com/item?id=SYNC-${process.pid}-${index + 1}`, imageUrls: ['https://img.example/sync.jpg'], attributes: { source: 'chrome-sync-e2e' }, sourcePayloadDigest: `sync-${process.pid}-${index + 1}` }));
    return { pages: [{ success: true, accountInvalid: false, cookieHeader: '', items, pageNumber: 1, pageSize: 20, totalCount: items.length, totalPages: 1, hasMore: false }], items, hasMore: false };
  };
  apiRuntime.xianyu.fetchItemDetail = async (_adminId, _accountId, itemId) => ({
    success: true,
    accountInvalid: false,
    cookieHeader: '',
    summary: {
      itemId: String(itemId),
      categoryId: '50023914',
      title: 'Chrome E2E 闲鱼详情',
      description: '详情接口返回的完整商品描述。',
      richTextDescription: '详情接口返回的富文本商品描述。',
      priceText: '¥8.50',
      priceMinor: 850,
      browseCount: 315,
      wantCount: 33,
      collectCount: 8,
      favoriteCount: 2,
      interactFavoriteCount: 1,
      soldCount: 0,
      quantity: 10000,
      seller: { sellerId: 'seller-e2e', nickname: 'E2E 卖家', city: '深圳', soldCount: 59, itemCount: 37, goodRemarkCount: 22, badRemarkCount: 0 },
      imageUrls: ['https://img.example/xianyu-detail.jpg'],
    },
    response: { data: { itemDO: { itemId: String(itemId), title: 'Chrome E2E 闲鱼详情' } } },
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === 'https://img.example/xianyu-detail.jpg') return new Response(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'), { status: 200, headers: { 'content-type': 'image/png' } });
    return originalFetch(input, init);
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
  await cdp.send('Page.navigate', { url: `${webUrl}/accounts` });
  await waitFor(async () => String(await evaluate(cdp, 'document.readyState')) === 'complete', 'accounts page before products');
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('账号列表'), 'accounts list before products');
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes(account.displayName), 'primary account row');
  const initialSwitched = await evaluate(cdp, `(() => { if (localStorage.getItem('xianyu.activeAccountId') === ${JSON.stringify(account.id)}) return true; const rows = Array.from(document.querySelectorAll('[role="row"]')); const row = rows.find((candidate) => candidate.textContent?.includes(${JSON.stringify(account.displayName)})); const button = row?.querySelector('[data-testid="account-switch"]'); if (!button || button.disabled) return false; button.click(); return true; })()`);
  if (!initialSwitched) throw new Error('primary account switch button missing or disabled');
  await waitFor(async () => String(await evaluate(cdp, 'localStorage.getItem("xianyu.activeAccountId") ?? ""')) === account.id, 'primary account selection');
  await cdp.send('Page.navigate', { url: `${webUrl}/products` });
  await waitFor(async () => String(await evaluate(cdp, 'document.readyState')) === 'complete', 'products page');
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('商品目录'), 'products list');
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('当前账号：Chrome 商品账号'), 'active account context');
  if (await evaluate(cdp, 'document.querySelector("[data-testid=product-account-context]") !== null')) throw new Error('redundant toolbar account name should be removed');
  if (await evaluate(cdp, 'document.querySelectorAll(".products-kpis").length !== 0')) throw new Error('product KPI cards should be removed');
  if (await evaluate(cdp, 'document.querySelector("[data-testid=products-total]") !== null')) throw new Error('redundant toolbar total should be removed');
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('Chrome E2E 商品'), 'product row');
  const tableTypography = await evaluate(cdp, '(() => { const size = (selector) => { const node = document.querySelector(selector); return node ? getComputedStyle(node).fontSize : null; }; return { row: size(".products-row:not(.products-head)"), head: size(".products-head"), title: size(".products-title strong"), titleMeta: size(".products-title small"), coupons: size(".products-coupons"), knowledgeBase: size(".products-knowledge-base"), meta: size(".products-meta"), pagination: size(".products-pagination"), pageButton: size(".products-page-button") }; })()');
  const expectedTypography = { row: '14px', head: '13px', title: '16px', titleMeta: '12px', coupons: '12px', knowledgeBase: '12px', meta: '12px', pagination: '12px', pageButton: '13px' };
  if (JSON.stringify(tableTypography) !== JSON.stringify(expectedTypography)) throw new Error(`product table typography mismatch: ${JSON.stringify(tableTypography)}`);
  const columns = await evaluate(cdp, 'Array.from(document.querySelectorAll(".products-head > span")).map((item) => item.textContent?.trim() ?? "").map((text) => text.replace(/\\s*[↑↓↕]$/, "")).filter(Boolean)');
  const expectedColumns = ['商品标题', '价格', '关联卡券', '自动化', '知识库', '创建时间', '操作'];
  if (JSON.stringify(columns) !== JSON.stringify(expectedColumns)) throw new Error(`product columns mismatch: ${JSON.stringify(columns)}`);
  const productText = String(await evaluate(cdp, 'document.body.innerText'));
  if (!productText.includes('Chrome E2E 卡券') || !productText.includes('请用简洁中文回答买家问题。')) throw new Error('coupon or AI prompt column content missing');
  const detailMark = cdp.events.length;
  if (!await evaluate(cdp, '(() => { const button = document.querySelector("[data-testid^=product-detail-]"); if (!button) return false; button.click(); return true; })()')) throw new Error('product detail action button missing');
  await waitFor(async () => cdp.events.slice(detailMark).some((event) => event.method === 'Network.requestWillBeSent' && event.params?.request?.method === 'GET' && event.params?.request?.url?.match(/\/api\/v1\/products\/[^/]+\/detail(?:\?|$)/)), 'xianyu product detail read request');
  await waitFor(async () => { const text = String(await evaluate(cdp, 'document.body.innerText')); return text.includes('Chrome E2E 闲鱼详情') && text.includes('315') && text.includes('对象存储'); }, 'xianyu detail drawer');
  const detailTypography = await evaluate(cdp, '(() => { const size = (selector) => { const node = document.querySelector(selector); return node ? getComputedStyle(node).fontSize : null; }; return { eyebrow: size(".xianyu-detail-drawer .eyebrow"), subtitle: size(".xianyu-detail-subtitle"), sourceNote: size(".xianyu-detail-source-note"), sectionTitle: size(".xianyu-detail-body h3"), price: size(".xianyu-detail-price"), statLabel: size(".xianyu-detail-stat span"), fieldLabel: size(".xianyu-detail-list dt"), fieldValue: size(".xianyu-detail-list dd"), sellerName: size(".xianyu-seller-card strong"), sellerMeta: size(".xianyu-seller-card > div > span"), sellerMetrics: size(".xianyu-seller-metrics"), description: size(".xianyu-detail-description"), caption: size(".xianyu-detail-image figcaption") }; })()');
  const expectedDetailTypography = { eyebrow: '12px', subtitle: '12px', sourceNote: '12px', sectionTitle: '16px', price: '25px', statLabel: '12px', fieldLabel: '12px', fieldValue: '14px', sellerName: '14px', sellerMeta: '12px', sellerMetrics: '12px', description: '14px', caption: '12px' };
  if (JSON.stringify(detailTypography) !== JSON.stringify(expectedDetailTypography)) throw new Error(`product detail drawer typography mismatch: ${JSON.stringify(detailTypography)}`);
  await waitFor(async () => {
    const state = await evaluate(cdp, '(() => Array.from(document.querySelectorAll(".xianyu-detail-image img")).map((image) => ({ src: image.currentSrc || image.src, complete: image.complete, naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight, opacity: getComputedStyle(image).opacity })))()');
    if (Array.isArray(state) && state.length === 1 && state.every((image) => image.complete && image.naturalWidth > 0)) return true;
    throw new Error(JSON.stringify(state));
  }, 'xianyu detail image preview');
  await captureViewport(cdp, 1440, 900, 'products-detail-drawer-desktop-1440x900.png');
  await captureViewport(cdp, 390, 844, 'products-detail-drawer-mobile-390x844.png');
  await cdp.send('Emulation.clearDeviceMetricsOverride');
  const detailRefreshMark = cdp.events.length;
  if (!await evaluate(cdp, '(() => { const button = document.querySelector(".xianyu-detail-drawer button.btn-small"); if (!button || button.disabled) return false; button.click(); return true; })()')) throw new Error('xianyu detail refresh button missing');
  await waitFor(async () => cdp.events.slice(detailRefreshMark).some((event) => event.method === 'Network.requestWillBeSent' && event.params?.request?.method === 'POST' && event.params?.request?.url?.match(/\/api\/v1\/products\/[^/]+\/detail\/refresh(?:\?|$)/)), 'xianyu product detail refresh request');
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('Chrome E2E 闲鱼详情'), 'xianyu detail after refresh');
  if (!await evaluate(cdp, '(() => { const button = document.querySelector("[aria-label=\\"关闭闲鱼商品详情\\"]"); if (!button) return false; button.click(); return true; })()')) throw new Error('xianyu detail drawer close button missing');
  const cachedDetailMark = cdp.events.length;
  if (!await evaluate(cdp, '(() => { const button = document.querySelector("[data-testid^=product-detail-]"); if (!button) return false; button.click(); return true; })()')) throw new Error('cached product detail action button missing');
  await waitFor(async () => cdp.events.slice(cachedDetailMark).some((event) => event.method === 'Network.requestWillBeSent' && event.params?.request?.method === 'GET' && event.params?.request?.url?.match(/\/api\/v1\/products\/[^/]+\/detail(?:\?|$)/)), 'cached xianyu product detail read request');
  await waitFor(async () => String(await evaluate(cdp, 'document.querySelector(".xianyu-detail-drawer")?.innerText ?? ""')).includes('已读取数据库中的已保存详情'), 'cached xianyu detail drawer');
  await captureViewport(cdp, 1440, 900, 'products-detail-drawer-cached-desktop-1440x900.png');
  await cdp.send('Emulation.clearDeviceMetricsOverride');
  if (cdp.events.slice(cachedDetailMark).some((event) => event.method === 'Network.requestWillBeSent' && event.params?.request?.method === 'POST' && event.params?.request?.url?.match(/\/api\/v1\/products\/[^/]+\/detail\/refresh(?:\?|$)/))) throw new Error('cached detail read unexpectedly refreshed Xianyu');
  if (!await evaluate(cdp, '(() => { const button = document.querySelector("[aria-label=\\"关闭闲鱼商品详情\\"]"); if (!button) return false; button.click(); return true; })()')) throw new Error('cached xianyu detail drawer close button missing');
  const searchEmptyMark = cdp.events.length;
  if (!await evaluate(cdp, '(() => { const input = document.querySelector("[aria-label=\\"搜索商品\\"]"); if (!input) return false; const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set; setter?.call(input, "no-product-match"); input.dispatchEvent(new Event("input", { bubbles: true })); return true; })()')) throw new Error('product search input missing');
  await waitFor(async () => cdp.events.slice(searchEmptyMark).some((event) => { if (event.method !== 'Network.requestWillBeSent' || event.params?.request?.method !== 'GET') return false; const url = new URL(event.params.request.url); return url.pathname === '/api/v1/products' && url.searchParams.get('keyword') === 'no-product-match'; }), 'empty product search request');
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('暂无商品'), 'empty product state');
  const emptyStateLayout = await evaluate(cdp, '(() => { const state = document.querySelector(".products-state"); if (!state) return null; const style = getComputedStyle(state); return { flexGrow: style.flexGrow, minHeight: style.minHeight, alignItems: style.alignItems, justifyItems: style.justifyItems, textAlign: style.textAlign }; })()');
  if (!emptyStateLayout || emptyStateLayout.flexGrow !== '1' || emptyStateLayout.minHeight !== '0px' || !['normal', 'center'].includes(emptyStateLayout.alignItems) || emptyStateLayout.justifyItems !== 'center' || emptyStateLayout.textAlign !== 'center') throw new Error(`empty product state layout mismatch: ${JSON.stringify(emptyStateLayout)}`);
  const searchResetMark = cdp.events.length;
  if (!await evaluate(cdp, '(() => { const input = document.querySelector("[aria-label=\\"搜索商品\\"]"); if (!input) return false; const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set; setter?.call(input, ""); input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true })); return true; })()')) throw new Error('product search reset failed');
  await waitFor(async () => cdp.events.slice(searchResetMark).some((event) => event.method === 'Network.requestWillBeSent' && event.params?.request?.method === 'GET' && event.params?.request?.url?.match(/\/api\/v1\/products(?:\?|$)/)), 'product search reset request');
  await waitFor(async () => { const text = String(await evaluate(cdp, 'document.body.innerText')); return text.includes('Chrome E2E 闲鱼详情') || text.includes('Chrome E2E 商品'); }, 'product row after empty search');
  await cdp.send('Network.setBlockedURLs', { urls: [`${webUrl}/api/v1/products*`] });
  if (!await evaluate(cdp, '(() => { const button = document.querySelector("[data-testid=refresh-products]"); if (!button || button.disabled) return false; button.click(); return true; })()')) throw new Error('product refresh button missing or disabled');
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('商品列表加载失败'), 'product error state');
  const errorStateLayout = await evaluate(cdp, '(() => { const state = document.querySelector(".products-state.products-error"); if (!state) return null; const style = getComputedStyle(state); return { flexGrow: style.flexGrow, minHeight: style.minHeight, alignItems: style.alignItems, justifyItems: style.justifyItems, textAlign: style.textAlign }; })()');
  if (!errorStateLayout || errorStateLayout.flexGrow !== '1' || errorStateLayout.minHeight !== '0px' || !['normal', 'center'].includes(errorStateLayout.alignItems) || errorStateLayout.justifyItems !== 'center' || errorStateLayout.textAlign !== 'center') throw new Error(`error product state layout mismatch: ${JSON.stringify(errorStateLayout)}`);
  await cdp.send('Network.setBlockedURLs', { urls: [] });
  if (!await evaluate(cdp, '(() => { const button = document.querySelector("[data-testid=refresh-products]"); if (!button || button.disabled) return false; button.click(); return true; })()')) throw new Error('product refresh retry missing or disabled');
  await waitFor(async () => { const text = String(await evaluate(cdp, 'document.body.innerText')); return text.includes('Chrome E2E 闲鱼详情') || text.includes('Chrome E2E 商品'); }, 'product row after error retry');
  if (!cdp.events.some((event) => event.method === 'Network.requestWillBeSent' && event.params?.request?.method === 'GET' && (() => { const url = new URL(event.params.request.url); return url.pathname === '/api/v1/products' && url.searchParams.get('sortBy') === 'xianyuOrder' && url.searchParams.get('sortOrder') === 'asc'; })())) throw new Error('default Xianyu page-order sort request missing');
  const createdSortMark = cdp.events.length;
  if (!await evaluate(cdp, '(() => { const button = document.querySelector("[data-testid=product-sort-createdAt]"); if (!button) return false; button.click(); return true; })()')) throw new Error('createdAt sort button missing');
  await waitFor(async () => cdp.events.slice(createdSortMark).some((event) => { if (event.method !== 'Network.requestWillBeSent' || event.params?.request?.method !== 'GET') return false; const url = new URL(event.params.request.url); return url.pathname === '/api/v1/products' && url.searchParams.get('sortBy') === 'createdAt' && url.searchParams.get('sortOrder') === 'desc' && url.searchParams.get('page') === '1'; }), 'createdAt desc sort request');
  await waitFor(async () => Boolean(await evaluate(cdp, '!!document.querySelector("[data-testid=product-sort-createdAt]")')), 'createdAt sort controls after desc');
  const createdSortAscMark = cdp.events.length;
  if (!await evaluate(cdp, '(() => { const button = document.querySelector("[data-testid=product-sort-createdAt]"); if (!button) return false; button.click(); return true; })()')) throw new Error('createdAt asc sort button missing');
  await waitFor(async () => cdp.events.slice(createdSortAscMark).some((event) => { if (event.method !== 'Network.requestWillBeSent' || event.params?.request?.method !== 'GET') return false; const url = new URL(event.params.request.url); return url.pathname === '/api/v1/products' && url.searchParams.get('sortBy') === 'createdAt' && url.searchParams.get('sortOrder') === 'asc'; }), 'createdAt asc sort request');
  await waitFor(async () => Boolean(await evaluate(cdp, '!!document.querySelector("[data-testid=product-sort-createdAt]")')), 'createdAt sort controls after asc');
  const updatedSortAvailable = await evaluate(cdp, 'Boolean(document.querySelector("[data-testid=product-sort-updatedAt]"))');
  if (updatedSortAvailable) {
    const updatedSortMark = cdp.events.length;
    if (!await evaluate(cdp, '(() => { const button = document.querySelector("[data-testid=product-sort-updatedAt]"); if (!button) return false; button.click(); return true; })()')) throw new Error('updatedAt sort button missing');
    await waitFor(async () => cdp.events.slice(updatedSortMark).some((event) => { if (event.method !== 'Network.requestWillBeSent' || event.params?.request?.method !== 'GET') return false; const url = new URL(event.params.request.url); return url.pathname === '/api/v1/products' && url.searchParams.get('sortBy') === 'updatedAt' && url.searchParams.get('sortOrder') === 'desc'; }), 'updatedAt desc sort request');
  }
  await waitFor(async () => Boolean(await evaluate(cdp, '!!document.querySelector(".products-table-scroll")')), 'products table after sorting');
  const scrollState = await evaluate(cdp, '(() => { const table = document.querySelector(".products-table-scroll"); const main = document.querySelector("main.products-main"); return { tableOverflowY: table ? getComputedStyle(table).overflowY : "", mainOverflowY: main ? getComputedStyle(main).overflowY : "", tableClientHeight: table?.clientHeight ?? 0, tableScrollHeight: table?.scrollHeight ?? 0 }; })()');
  if (scrollState.tableOverflowY !== 'auto' || scrollState.mainOverflowY !== 'hidden' || scrollState.tableScrollHeight < scrollState.tableClientHeight) throw new Error(`products scroll container mismatch: ${JSON.stringify(scrollState)}`);
  const syncButton = await evaluate(cdp, '(() => { const button = document.querySelector("[data-testid=sync-products]"); if (!button || button.disabled) return false; button.click(); return true; })()');
  if (!syncButton) throw new Error('sync products button missing or disabled');
  await waitFor(async () => cdp.events.some((event) => event.method === 'Network.requestWillBeSent' && event.params?.request?.method === 'POST' && event.params?.request?.url?.includes('/api/v1/products/sync')), 'xianyu product sync request');
  await waitFor(async () => String(await evaluate(cdp, 'document.querySelector(".products-pagination-total")?.textContent ?? ""')).includes('30'), '29 synced products plus local product');
  if (!await evaluate(cdp, 'String(document.querySelector("[data-testid=products-pagination]")?.textContent ?? "").includes("第 1 / 2 页")')) throw new Error('products pagination missing after sync');
  const pageTwoMark = cdp.events.length;
  if (!await evaluate(cdp, '(() => { const button = document.querySelector("[data-testid=products-page-2]"); if (!button || button.disabled) return false; button.click(); return true; })()')) throw new Error('products page 2 button missing or disabled');
  await waitFor(async () => cdp.events.slice(pageTwoMark).some((event) => {
    if (event.method !== 'Network.requestWillBeSent' || event.params?.request?.method !== 'GET') return false;
    const url = new URL(event.params.request.url);
    return url.pathname === '/api/v1/products' && url.searchParams.get('page') === '2';
  }), 'products page 2 request');
  await waitFor(async () => String(await evaluate(cdp, 'document.querySelector("[data-testid=products-page-2][aria-current=page]") ? document.body.innerText : ""')).includes('第 2 / 2 页'), 'products page 2 state');
  if (!await evaluate(cdp, '(() => { const button = document.querySelector("[data-testid=products-page-1]"); if (!button || button.disabled) return false; button.click(); return true; })()')) throw new Error('products page 1 button missing or disabled');
  await waitFor(async () => String(await evaluate(cdp, 'document.querySelector("[data-testid=products-page-1][aria-current=page]") ? document.body.innerText : ""')).includes('第 1 / 2 页'), 'products page 1 state after pagination');
  const refreshMark = cdp.events.length;
  if (!await evaluate(cdp, '(() => { const button = document.querySelector("[data-testid=refresh-products]"); if (!button || button.disabled) return false; button.click(); return true; })()')) throw new Error('refresh products button missing or disabled');
  await waitFor(async () => cdp.events.slice(refreshMark).some((event) => event.method === 'Network.requestWillBeSent' && event.params?.request?.method === 'GET' && event.params?.request?.url?.match(/\/api\/v1\/products(?:\?|$)/)), 'local product refresh request');
  if (cdp.events.slice(refreshMark).some((event) => event.method === 'Network.requestWillBeSent' && event.params?.request?.url?.includes('/api/v1/products/sync'))) throw new Error('refresh must not call xianyu sync endpoint');
  const publishMark = cdp.events.length;
  if (!await evaluate(cdp, '(() => { const button = document.querySelector("[data-testid=publish-product]"); if (!button || button.disabled) return false; button.click(); return true; })()')) throw new Error('publish product button missing or disabled');
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('新建商品草稿'), 'create draft drawer');
  if (cdp.events.slice(publishMark).some((event) => event.method === 'Network.requestWillBeSent' && /publish|bulk-publish|mtop/i.test(event.params?.request?.url ?? ''))) throw new Error('publish draft entry must not call a real publish endpoint');
  await evaluate(cdp, '(() => { const set = (label, value) => { const field = Array.from(document.querySelectorAll(".product-basic-form label")).find((candidate) => candidate.textContent?.includes(label)); const input = field?.querySelector("input,textarea"); if (!input) throw new Error(`missing ${label}`); const setter = Object.getOwnPropertyDescriptor(input.__proto__, "value")?.set; setter?.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true })); }; set("商品标题", "Chrome 创建草稿"); set("分类编码", "digital"); set("价格（分）", "2990"); set("商品描述", "来自 Chrome E2E 的草稿"); })()');
  const savedCreate = await evaluate(cdp, '(() => { const button = Array.from(document.querySelectorAll("button")).find((item) => item.textContent?.includes("保存草稿")); if (!button || button.disabled) return false; button.click(); return true; })()');
  if (!savedCreate) throw new Error('save draft button disabled');
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('Chrome 创建草稿'), 'created draft row');
  const opened = await evaluate(cdp, '(() => { const button = document.querySelector(".products-title-link"); if (!button) return false; button.click(); return true; })()');
  if (!opened) throw new Error('product detail button missing');
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('Chrome 创建草稿'), 'product detail');
  const openedEdit = await evaluate(cdp, '(() => { const button = Array.from(document.querySelectorAll("button")).find((item) => item.textContent?.includes("编辑草稿")); if (!button) return false; button.click(); return true; })()');
  if (!openedEdit) throw new Error('edit draft button missing');
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('编辑商品草稿'), 'edit draft drawer');
  await evaluate(cdp, '(() => { const field = Array.from(document.querySelectorAll(".product-basic-form label")).find((candidate) => candidate.textContent?.includes("商品标题")); const input = field?.querySelector("input"); if (!input) throw new Error("missing title"); const setter = Object.getOwnPropertyDescriptor(input.__proto__, "value")?.set; setter?.call(input, "Chrome 编辑草稿"); input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true })); })()');
  const savedEdit = await evaluate(cdp, '(() => { const button = Array.from(document.querySelectorAll("button")).find((item) => item.textContent?.includes("保存草稿")); if (!button || button.disabled) return false; button.click(); return true; })()');
  if (!savedEdit) throw new Error('edit save button disabled');
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('Chrome 编辑草稿'), 'updated draft row');
  await cdp.send('Page.reload', { ignoreCache: true });
  await waitFor(async () => String(await evaluate(cdp, 'document.readyState')) === 'complete', 'products reload');
  await waitFor(async () => Boolean(await evaluate(cdp, 'Boolean(document.querySelector(".products-search input"))')), 'products search after reload');
  await evaluate(cdp, '(() => { const input = document.querySelector(".products-search input"); if (!input) return false; const setter = Object.getOwnPropertyDescriptor(input.__proto__, "value")?.set; setter?.call(input, "Chrome 编辑草稿"); input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true })); return true; })()');
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('Chrome 编辑草稿'), 'products persisted after reload');
  await captureViewport(cdp, 1440, 900, 'products-desktop-1440x900.png');
  await captureViewport(cdp, 390, 844, 'products-mobile-390x844.png');
  await cdp.send('Page.navigate', { url: `${webUrl}/accounts` });
  await waitFor(async () => String(await evaluate(cdp, 'document.readyState')) === 'complete', 'accounts page after product flow');
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('账号列表'), 'accounts list for UI switch');
  await waitFor(async () => Boolean(await evaluate(cdp, `document.body.innerText.includes(${JSON.stringify(secondaryAccount.displayName)})`)), 'secondary account row for UI switch');
  const switched = await evaluate(cdp, `(() => { const rows = Array.from(document.querySelectorAll('[role="row"]')); const row = rows.find((candidate) => candidate.textContent?.includes(${JSON.stringify(secondaryAccount.displayName)}) && candidate.querySelector('[data-testid="account-switch"]')?.textContent?.includes('切换账号')); const button = row?.querySelector('[data-testid="account-switch"]'); if (!button) return false; button.click(); return true; })()`);
  if (!switched) throw new Error('secondary account switch button missing or disabled');
  await waitFor(async () => String(await evaluate(cdp, 'localStorage.getItem("xianyu.activeAccountId") ?? ""')) === secondaryAccount.id, 'ui account switch persisted');
  const secondaryProductsMark = cdp.events.length;
  await cdp.send('Page.navigate', { url: `${webUrl}/products` });
  await waitFor(async () => String(await evaluate(cdp, 'document.readyState')) === 'complete', 'products page after account switch');
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('当前账号：Secondary 商品账号'), 'switched product account context');
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
