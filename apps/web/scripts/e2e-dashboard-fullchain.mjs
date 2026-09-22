import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = join(import.meta.dirname, '..', '..', '..');
const { createApp } = await import(pathToFileURL(join(root, 'apps', 'api', 'dist', 'app.js')).href);
const { createToken, sha256 } = await import(pathToFileURL(join(root, 'apps', 'api', 'dist', 'security.js')).href);
const children = [];
const chromeProfile = join(tmpdir(), `xianyu-agent-dashboard-fullchain-${process.pid}`);
const chromePath = process.env.CHROME_PATH ?? join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe');
const evidenceDir = join(root, 'docs', 'evidence', 'stage5', 'S4-VS-DASHBOARD');
let apiRuntime;
let browserSessionId;

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
  child.stdout.on('data', (chunk) => process.stdout.write(`[dashboard-fullchain:${command}] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[dashboard-fullchain:${command}] ${chunk}`));
  children.push(child);
  return child;
}

async function waitFor(check, label, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try { const result = await check(); if (result) return result; } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`${label} did not become ready${lastError ? `: ${lastError.message}` : ''}`);
}

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
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await evaluate(cdp, 'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
  mkdirSync(join(evidenceDir, 'screenshots'), { recursive: true });
  writeFileSync(join(evidenceDir, 'screenshots', filename), Buffer.from(screenshot.data, 'base64'));
}

function cookiesFromContext(context) {
  return `session_id=${context.session.id}; csrf_token=${context.csrfToken}`;
}

async function discoverRealAccount(runtime) {
  const configuredAdminId = process.env.E2E_REAL_ADMIN_ID?.trim();
  const configuredAccountId = process.env.E2E_REAL_ACCOUNT_ID?.trim();
  if (configuredAdminId && configuredAccountId) return { adminId: configuredAdminId, accountId: configuredAccountId };
  const store = runtime.store;
  if (!store.pool) throw new Error('E2E_REAL_ADMIN_ID/E2E_REAL_ACCOUNT_ID required when store is not PostgreSQL');
  const result = await store.pool.query(`
    select s.admin_id, s.account_id
    from auth.account_scopes s
    join auth.account_credentials c on c.account_id = s.account_id and c.status = 'active'
    join accounts.accounts a on a.id = s.account_id and a.status <> 'disabled'
    where s.status = 'active'
    order by c.updated_at desc
    limit 1
  `);
  const row = result.rows[0];
  if (!row) throw new Error('no active scoped Xianyu credential found; set E2E_REAL_ADMIN_ID and E2E_REAL_ACCOUNT_ID explicitly');
  return { adminId: String(row.admin_id), accountId: String(row.account_id) };
}

async function createBrowserSession(runtime, adminId) {
  const csrfSeed = createToken();
  const session = await runtime.store.createSession({ adminId, csrfTokenHash: sha256(csrfSeed), expiresAt: new Date(Date.now() + 3_600_000).toISOString() });
  const context = await runtime.auth.contextFromSession(session.id);
  if (!context) throw new Error('unable to create authenticated browser session');
  return context;
}

async function run() {
  const apiPort = await freePort();
  const webPort = await freePort();
  const debugPort = await freePort();
  const apiUrl = `http://127.0.0.1:${apiPort}`;
  const webUrl = `http://127.0.0.1:${webPort}`;
  mkdirSync(chromeProfile, { recursive: true });

  const build = spawnProcess(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['--workspace', 'apps/api', 'run', 'build']);
  const buildExit = await new Promise((resolve) => build.once('exit', resolve));
  if (buildExit !== 0) throw new Error(`API build failed with ${buildExit}`);

  const databaseUrl = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgres://xianyu:xianyu_dev_only@127.0.0.1:5432/xianyu_agent';
  if (!process.env.E2E_DATABASE_URL && process.env.ALLOW_SHARED_E2E !== '1') {
    throw new Error('fullchain requires E2E_DATABASE_URL or explicit ALLOW_SHARED_E2E=1 because it writes real sync results');
  }
  apiRuntime = createApp({
    host: '127.0.0.1',
    port: apiPort,
    databaseUrl,
    redisUrl: process.env.E2E_REDIS_URL ?? process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
    cookieSecure: false,
    allowInMemory: false,
    sessionIdleMs: 1_800_000,
    sessionAbsoluteMs: 28_800_000,
    xianyuQrMode: 'stub',
    webSocketAllowedOrigins: [webUrl],
    agentRuntime: 'in-process',
    modelTimeoutMs: 60_000,
  });
  await apiRuntime.listen();
  const { adminId, accountId } = await discoverRealAccount(apiRuntime);
  const health = await apiRuntime.store.health();
  if (!health.reachable || health.kind !== 'postgres') throw new Error(`database prerequisite failed: ${JSON.stringify(health)}`);

  const verification = await apiRuntime.xianyu.verifyLogin(adminId, accountId);
  const profile = await apiRuntime.xianyu.fetchProfile(adminId, accountId);
  const items = await apiRuntime.xianyu.fetchItemsPage(adminId, accountId, 1, 5);
  const imToken = await apiRuntime.xianyu.fetchImToken(adminId, accountId, `dashboard-fullchain-${process.pid}`);
  const externalConversations = await apiRuntime.xianyuIm.listConversations(adminId, accountId, undefined, 5);
  const localConversations = await apiRuntime.store.listConversations(adminId, { accountId, limit: 5 });
  const externalOrders = await apiRuntime.xianyu.fetchOrdersAll(adminId, accountId, 5, 1);
  const externalOrderPermissionDenied = externalOrders.pages[0]?.errorCode === 'MTOP_PERMISSION_DENIED';
  if (!verification.success || !profile.success || !items.success || !imToken.success || !externalConversations) {
    throw new Error(`Xianyu read chain failed: ${JSON.stringify({ verification: verification.errorCode, profile: profile.errorCode, items: items.errorCode, imToken: imToken.errorCode })}`);
  }
  if (process.env.REQUIRE_XIANYU_ORDER_SYNC !== '0' && (!externalOrders.pages[0]?.success || externalOrderPermissionDenied || externalOrders.items.length === 0)) {
    throw new Error('Xianyu order read is permission denied for the selected seller account');
  }

  const sessionContext = await createBrowserSession(apiRuntime, adminId);
  browserSessionId = sessionContext.session.id;
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  spawnProcess(npm, ['--workspace', 'apps/web', 'run', 'dev', '--', '--host', '127.0.0.1', '--port', String(webPort)], {
    // Dashboard should inherit live mode from VITE_API_MODE unless an explicit mock override is requested.
    env: { ...process.env, VITE_API_MODE: 'live', VITE_API_BASE_URL: '', VITE_API_PROXY_TARGET: apiUrl },
  });
  await waitFor(async () => (await fetch(`${webUrl}/dashboard`)).ok, 'Vite frontend');

  const chrome = spawnProcess(chromePath, ['--headless=new', '--disable-gpu', '--disable-extensions', '--no-first-run', '--no-default-browser-check', '--remote-allow-origins=*', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${chromeProfile}`, '--window-size=1440,900', 'about:blank']);
  await waitFor(async () => chrome.exitCode === null && (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).ok, 'local Chrome');
  const cdp = await createCdpClient(debugPort);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable');
  for (const pair of cookiesFromContext(sessionContext).split('; ')) {
    const [name, ...valueParts] = pair.split('=');
    await cdp.send('Network.setCookie', { name, value: valueParts.join('='), url: `${webUrl}/` });
  }
  await cdp.send('Page.navigate', { url: `${webUrl}/dashboard` });
  await waitFor(async () => String(await evaluate(cdp, 'document.readyState')) === 'complete', 'dashboard page');
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('订单与 AI 闭环趋势'), 'live dashboard content');
  const dashboardRequests = cdp.events.filter((event) => event.method === 'Network.requestWillBeSent' && event.params?.request?.url?.includes('/api/v1/dashboard/snapshot'));
  if (dashboardRequests.length === 0) throw new Error('browser did not request the live dashboard API');
  const dashboardBody = String(await evaluate(cdp, 'document.body.innerText'));
  if (dashboardBody.includes('Live API') || dashboardBody.includes('Mock API')) throw new Error('dashboard rendered a removed API mode label');
  await captureViewport(cdp, 1440, 900, 'dashboard-fullchain-desktop-1440x900.png');

  await evaluate(cdp, `localStorage.setItem('xianyu.activeAccountId', ${JSON.stringify(accountId)})`);
  await cdp.send('Page.navigate', { url: `${webUrl}/products` });
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('商品目录'), 'products page');
  await waitFor(async () => Boolean(await evaluate(cdp, '(() => { const button = document.querySelector("[data-testid=sync-products]"); return Boolean(button && !button.disabled); })()')), 'product sync control', 90_000);
  const beforeProducts = await apiRuntime.store.listProducts(adminId, { accountId, page: 1, pageSize: 100, sortBy: 'updatedAt', sortOrder: 'desc' });
  const syncMark = cdp.events.length;
  const syncClicked = await evaluate(cdp, '(() => { const button = document.querySelector("[data-testid=sync-products]"); if (!button || button.disabled) return false; button.click(); return true; })()');
  if (!syncClicked) throw new Error('live product sync control is unavailable');
  await waitFor(async () => cdp.events.slice(syncMark).some((event) => event.method === 'Network.requestWillBeSent' && event.params?.request?.method === 'POST' && event.params?.request?.url?.includes('/api/v1/products/sync')), 'live Xianyu product sync request', 90_000);
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('同步闲鱼'), 'product page after sync', 90_000);
  const afterProducts = await apiRuntime.store.listProducts(adminId, { accountId, page: 1, pageSize: 100, sortBy: 'updatedAt', sortOrder: 'desc' });
  const persistedExternalProducts = afterProducts.items.filter((item) => item.source === 'xianyu' && item.lastSyncedAt);
  if (persistedExternalProducts.length === 0) throw new Error('Xianyu product sync did not persist any external product in PostgreSQL');

  await cdp.send('Page.navigate', { url: `${webUrl}/dashboard` });
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('商品排行'), 'dashboard after persisted sync');
  const dashboardAfterSync = String(await evaluate(cdp, 'document.body.innerText'));
  const visibleExternalProduct = persistedExternalProducts.some((item) => dashboardAfterSync.includes(item.title));
  if (!visibleExternalProduct) throw new Error('dashboard did not render persisted Xianyu product data');
  await captureViewport(cdp, 390, 844, 'dashboard-fullchain-mobile-390x844.png');

  await cdp.send('Page.navigate', { url: `${webUrl}/orders` });
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('订单管理'), 'orders page');
  await waitFor(async () => Boolean(await evaluate(cdp, '(() => { const button = document.querySelector("[data-testid=sync-orders]"); return Boolean(button && !button.disabled); })()')), 'order sync control', 90_000);
  const externalOrderTitle = String(externalOrders.items[0]?.itemTitle ?? '').trim();
  if (!externalOrderTitle) throw new Error('Xianyu order response did not include a visible item title');
  const orderSyncMark = cdp.events.length;
  const orderSyncClicked = await evaluate(cdp, '(() => { const button = document.querySelector("[data-testid=sync-orders]"); if (!button || button.disabled) return false; button.click(); return true; })()');
  if (!orderSyncClicked) throw new Error('live order sync control is unavailable');
  await waitFor(async () => cdp.events.slice(orderSyncMark).some((event) => event.method === 'Network.requestWillBeSent' && event.params?.request?.method === 'POST' && event.params?.request?.url?.includes('/api/v1/orders/refresh')), 'live Xianyu order sync request', 90_000);
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes(externalOrderTitle), 'persisted Xianyu order visible in browser', 90_000);
  const persistedOrders = await apiRuntime.store.listOrders(adminId, { accountId, page: 1, pageSize: 100, sortBy: 'createdAt', sortOrder: 'desc' });
  const persistedXianyuOrders = persistedOrders.items.filter((item) => item.source === 'xianyu');
  if (persistedXianyuOrders.length < externalOrders.items.length) throw new Error(`Xianyu order sync did not persist all external orders: expected at least ${externalOrders.items.length}, got ${persistedXianyuOrders.length}`);

  const evidence = {
    status: externalOrderPermissionDenied ? 'PARTIALLY_VERIFIED' : 'PASS',
    storage: health,
    adminId,
    accountId,
    xianyu: {
      verifyLogin: verification.success,
      profile: profile.success,
      productPage: { success: items.success, count: items.items.length, hasMore: items.hasMore },
      imToken: imToken.success,
      conversations: { externalHasMore: externalConversations.hasMore, localPersisted: localConversations.items.length },
      orders: { success: externalOrders.pages[0]?.success ?? false, errorCode: externalOrders.pages[0]?.errorCode ?? null, permissionDenied: externalOrderPermissionDenied, externalCount: externalOrders.items.length, persistedCount: persistedXianyuOrders.length, browserRequestedRefresh: cdp.events.slice(orderSyncMark).some((event) => event.method === 'Network.requestWillBeSent' && event.params?.request?.method === 'POST' && event.params?.request?.url?.includes('/api/v1/orders/refresh')) },
    },
    dashboard: { browserRequestedLiveApi: dashboardRequests.length > 0, uiModeLabelRemoved: !dashboardBody.includes('Live API') && !dashboardBody.includes('Mock API'), persistedProductCount: persistedExternalProducts.length, beforeProductCount: beforeProducts.total, afterProductCount: afterProducts.total },
  };
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(join(evidenceDir, 'fullchain-evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify(evidence, null, 2));
  if (externalOrderPermissionDenied) console.warn('FULLCHAIN WARNING: Xianyu order endpoint returned MTOP_PERMISSION_DENIED; dashboard full chain is partially verified.');
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
  if (apiRuntime && browserSessionId) await apiRuntime.store.revokeSession(browserSessionId, 'dashboard-fullchain cleanup').catch(() => undefined);
  if (apiRuntime) await apiRuntime.close().catch(() => undefined);
  try { rmSync(chromeProfile, { recursive: true, force: true }); } catch (error) { console.warn(`Chrome temporary profile cleanup failed: ${error.message}`); }
}
