import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import { pathToFileURL } from 'node:url';

const root = join(import.meta.dirname, '..', '..', '..');
const databaseUrl = process.env.DATABASE_URL ?? 'postgres://xianyu:xianyu_dev_only@127.0.0.1:5432/xianyu_agent';
const objectStorageEndpoint = process.env.OBJECT_STORAGE_ENDPOINT ?? 'http://127.0.0.1:19002';
const children = [];
const chromeProfile = join(tmpdir(), `xianyu-agent-products-live-${process.pid}`);

const { createApp } = await import(pathToFileURL(join(root, 'apps', 'api', 'dist', 'app.js')).href);
const { createToken, sha256 } = await import(pathToFileURL(join(root, 'apps', 'api', 'dist', 'security.js')).href);
const { default: pg } = await import('pg');

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
  child.stdout.on('data', (chunk) => process.stdout.write(`[live-e2e:${command}] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[live-e2e:${command}] ${chunk}`));
  children.push(child);
  return child;
}

async function waitFor(check, label, timeoutMs = 30_000) {
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
  const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++nextId; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
  return { socket, send, events };
}

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? 'browser evaluation failed');
  return result.result?.value;
}

async function run() {
  const apiPort = await freePort();
  const webPort = await freePort();
  const debugPort = await freePort();
  const apiUrl = `http://127.0.0.1:${apiPort}`;
  const webUrl = `http://127.0.0.1:${webPort}`;
  const runtime = createApp({
    host: '127.0.0.1', port: apiPort, databaseUrl, redisUrl: undefined, cookieSecure: false, allowInMemory: false,
    sessionIdleMs: 1_800_000, sessionAbsoluteMs: 28_800_000, xianyuQrMode: 'stub',
    objectStorageEndpoint, objectStoragePublicEndpoint: process.env.OBJECT_STORAGE_PUBLIC_ENDPOINT ?? objectStorageEndpoint,
    objectStorageAccessKey: process.env.OBJECT_STORAGE_ACCESS_KEY ?? 'xianyu',
    objectStorageSecretKey: process.env.OBJECT_STORAGE_SECRET_KEY ?? 'xianyu_dev_only',
    objectStorageBucket: process.env.OBJECT_STORAGE_BUCKET ?? `xianyu-live-${process.pid}`,
    objectStorageRegion: 'us-east-1',
  });
  await runtime.listen();
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const current = await pool.query(`
    select p.id as product_id, p.account_id, scope.admin_id, a.display_name, c.status as credential_status
    from products.products p
    join auth.account_scopes scope on scope.account_id = p.account_id and scope.status = 'active'
    join accounts.accounts a on a.id = p.account_id
    join auth.account_credentials c on c.account_id = p.account_id
    where lower(p.title) like '%ppt master%' and p.external_product_ref = '1078553391460'
      and c.status = 'active'
      and a.display_name is distinct from 'PPT Master 闲鱼账号'
    order by p.updated_at desc
    limit 1
  `);
  if (current.rowCount !== 1) throw new Error('SYSTEM_PPT_MASTER_PRODUCT_NOT_FOUND');
  const currentRow = current.rows[0];
  const adminId = currentRow.admin_id;
  const accountId = currentRow.account_id;
  const productId = currentRow.product_id;
  const storedCredential = await runtime.store.getCredential(adminId, accountId);
  console.log(JSON.stringify({ selectedAccount: currentRow.display_name, accountIdSuffix: String(accountId).slice(-6), credentialStatus: storedCredential?.status, hasMtopToken: Boolean(storedCredential?.cookieHeader?.includes('_m_h5_tk=')), metadataKeys: Object.keys(storedCredential?.metadata ?? {}) }));
  const csrfSeed = createToken();
  const session = await runtime.store.createSession({ adminId, csrfTokenHash: sha256(csrfSeed), expiresAt: new Date(Date.now() + 1_800_000).toISOString() });
  await runtime.auth.contextFromSession(session.id);
  const csrfToken = runtime.auth.getCsrfToken(session.id);
  if (!csrfToken) throw new Error('SYSTEM_SESSION_TOKEN_NOT_CREATED');
  await pool.end();

  const npm = process.env.npm_execpath ? process.execPath : (process.platform === 'win32' ? 'npm.cmd' : 'npm');
  const npmArgs = (args) => process.env.npm_execpath ? [process.env.npm_execpath, ...args] : args;
  spawnProcess(npm, npmArgs(['--workspace', 'apps/web', 'run', 'dev', '--', '--host', '127.0.0.1', '--port', String(webPort)]), { env: { ...process.env, VITE_API_MODE: 'live', VITE_API_BASE_URL: '', VITE_API_PROXY_TARGET: apiUrl } });
  await waitFor(async () => (await fetch(`${webUrl}/products`)).ok, 'Vite frontend');
  mkdirSync(chromeProfile, { recursive: true });
  const chromePath = process.env.CHROME_PATH ?? join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe');
  const chrome = spawnProcess(chromePath, ['--headless=new', '--disable-gpu', '--disable-extensions', '--no-first-run', '--no-default-browser-check', '--remote-allow-origins=*', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${chromeProfile}`, '--window-size=1440,900', 'about:blank']);
  await waitFor(async () => chrome.exitCode === null && (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).ok, 'local Chrome');
  const cdp = await createCdpClient(debugPort);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable');
  for (const pair of `session_id=${session.id}; csrf_token=${encodeURIComponent(csrfToken)}`.split('; ')) { const [name, ...valueParts] = pair.split('='); await cdp.send('Network.setCookie', { name, value: valueParts.join('='), url: `${webUrl}/` }); }
  await cdp.send('Page.navigate', { url: `${webUrl}/accounts` });
  await waitFor(async () => String(await evaluate(cdp, 'document.readyState')) === 'complete', 'accounts page');
  await evaluate(cdp, `localStorage.setItem('xianyu.activeAccountId', ${JSON.stringify(accountId)});`);
  await cdp.send('Page.navigate', { url: `${webUrl}/products` });
  await waitFor(async () => String(await evaluate(cdp, 'document.readyState')) === 'complete', 'products page');
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('PPT Master pptmaster'), 'PPT Master row');

  const detailButton = await evaluate(cdp, `(() => { const row = Array.from(document.querySelectorAll('[role="row"]')).find((candidate) => candidate.textContent?.includes('PPT Master pptmaster')); const button = row?.querySelector('[data-testid="product-detail-${productId}"]'); if (!button) return false; button.click(); return true; })()`);
  assert.equal(detailButton, true, 'PPT Master 详情按钮未找到');
  await waitFor(async () => Boolean(await evaluate(cdp, 'Boolean(document.querySelector(".xianyu-detail-drawer"))')), 'PPT Master detail drawer');
  await waitFor(async () => {
    const body = String(await evaluate(cdp, 'document.querySelector(".xianyu-detail-drawer")?.innerText ?? ""'));
    return !body.includes('正在读取并保存闲鱼商品详情') && (body.includes('闲鱼商品详情加载失败') || body.includes('摘要指纹') || body.includes('商品信息'));
  }, 'PPT Master detail result', 45_000);
  await waitFor(async () => {
    const state = await evaluate(cdp, '(() => Array.from(document.querySelectorAll(".xianyu-detail-image img")).map((image) => ({ src: image.currentSrc || image.src, complete: image.complete, naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight, opacity: getComputedStyle(image).opacity })))()');
    if (Array.isArray(state) && state.length > 0 && state.every((image) => image.complete && image.naturalWidth > 0)) return true;
    throw new Error(JSON.stringify(state));
  }, 'PPT Master object-storage image previews', 45_000);
  const detailBody = String(await evaluate(cdp, 'document.querySelector(".xianyu-detail-drawer")?.innerText ?? ""'));
  const detailOk = !detailBody.includes('闲鱼商品详情加载失败') && (detailBody.includes('PPT Master') || detailBody.includes('1078553391460'));
  const imageStates = await evaluate(cdp, `Array.from(document.querySelectorAll('.xianyu-detail-drawer .xianyu-detail-image img')).map((image) => ({ src: image.src, complete: image.complete, naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight, opacity: getComputedStyle(image).opacity }))`);
  if (!Array.isArray(imageStates) || imageStates.length === 0 || imageStates.some((image) => image.complete !== true || image.naturalWidth <= 0 || image.naturalHeight <= 0)) {
    throw new Error(`LIVE_DETAIL_IMAGES_NOT_RENDERED:${JSON.stringify(imageStates)}`);
  }
  await evaluate(cdp, `document.querySelector('.xianyu-detail-gallery')?.scrollIntoView({ block: 'center' })`);
  const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const screenshotPath = join(root, 'docs', 'evidence', 'stage5', 'S4-VS2', 'screenshots', 'products-detail-drawer-live-object-storage-desktop-1440x900.png');
  writeFileSync(screenshotPath, Buffer.from(screenshot.data, 'base64'));
  console.log(JSON.stringify({ step: 'detail', detailOk, imageStates, screenshotPath, drawerExcerpt: detailBody.slice(0, 800) }));
  await evaluate(cdp, 'document.querySelector(".xianyu-detail-drawer .icon-button")?.click()');

  const syncStart = cdp.events.length;
  const syncButton = await evaluate(cdp, '(() => { const button = document.querySelector("[data-testid=sync-products]"); if (!button || button.disabled) return false; button.click(); return true; })()');
  assert.equal(syncButton, true, '同步闲鱼按钮未找到或被禁用');
  await waitFor(async () => cdp.events.slice(syncStart).some((event) => event.method === 'Network.requestWillBeSent' && event.params?.request?.method === 'POST' && String(event.params.request.url).includes('/api/v1/products/sync')), 'product sync request');
  await waitFor(async () => {
    const buttonReady = await evaluate(cdp, 'Boolean(document.querySelector("[data-testid=sync-products]") && !document.querySelector("[data-testid=sync-products]").disabled)');
    return buttonReady && (cdp.events.slice(syncStart).some((event) => event.method === 'Network.responseReceived' && String(event.params?.response?.url ?? '').includes('/api/v1/products/sync')) || Boolean(await evaluate(cdp, 'Boolean(document.querySelector(".products-inline-error"))')));
  }, 'product sync UI result', 45_000);
  const syncBody = String(await evaluate(cdp, 'document.body.innerText'));
  const syncError = String(await evaluate(cdp, 'document.querySelector(".products-inline-error")?.innerText ?? ""'));
  const syncNetwork = cdp.events.filter((event) => event.method === 'Network.responseReceived' && String(event.params?.response?.url ?? '').includes('/api/v1/products/sync')).map((event) => ({ requestId: event.params.requestId, status: event.params.response.status, url: event.params.response.url }));
  let syncResponseData;
  const syncResponse = syncNetwork.at(-1);
  if (syncResponse?.requestId) {
    try {
      const responseBody = await cdp.send('Network.getResponseBody', { requestId: syncResponse.requestId });
      const parsed = JSON.parse(responseBody.body);
      syncResponseData = { success: parsed.success, error: parsed.error, fetchedCount: parsed.data?.fetchedCount, pagesFetched: parsed.data?.pagesFetched, createdCount: parsed.data?.createdCount, updatedCount: parsed.data?.updatedCount };
    } catch { syncResponseData = { unavailable: true }; }
  }
  console.log(JSON.stringify({ step: 'sync', syncFailed: Boolean(syncError), syncError, syncNetwork: syncNetwork.map(({ requestId, ...rest }) => rest), syncResponseData, hasPptMaster: syncBody.includes('PPT Master pptmaster') }));
  cdp.socket.close();
  await runtime.close();
  return { detailOk, syncError, syncNetwork };
}

try {
  const result = await run();
  if (result.syncError) process.exitCode = 2;
} finally {
  for (const child of children.reverse()) {
    if (!child.killed && child.exitCode === null) {
      if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      else child.kill('SIGTERM');
    }
    child.stdout?.destroy();
    child.stderr?.destroy();
  }
  try { rmSync(chromeProfile, { recursive: true, force: true }); } catch { /* best effort */ }
}
