import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = join(import.meta.dirname, '..', '..', '..');
const { createApp } = await import(pathToFileURL(join(root, 'apps', 'api', 'dist', 'app.js')).href);
const children = [];
const chromeProfile = join(tmpdir(), `xianyu-agent-coupons-chrome-${process.pid}`);
const chromePath = process.env.CHROME_PATH ?? join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe');
const screenshotDir = join(root, 'docs', 'evidence', 'stage5', 'S4-VS3', 'screenshots');
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
  child.stdout.on('data', (chunk) => process.stdout.write(`[coupons-e2e:${command}] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[coupons-e2e:${command}] ${chunk}`));
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
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const entry = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(message.error.message)); else entry.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++nextId; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
  return { socket, send };
}

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? 'browser script failed');
  return result.result?.value;
}

async function assertText(cdp, text) {
  const body = await evaluate(cdp, 'document.body.innerText');
  if (!String(body).includes(text)) throw new Error(`page missing text: ${text}`);
}

async function setSearchValue(cdp, value) {
  const encoded = JSON.stringify(value);
  return evaluate(cdp, `(() => { const input = document.querySelector('input[aria-label="搜索卡券名称或描述"]'); if (!input) return false; const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set; setter?.call(input, ${encoded}); input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
}

async function captureViewport(cdp, width, height, filename) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await evaluate(cdp, 'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await new Promise((resolve) => setTimeout(resolve, 250));
  const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
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
  const bootstrap = await fetch(`${apiUrl}/api/v1/auth/bootstrap`, { method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': `coupons-bootstrap-${process.pid}` }, body: JSON.stringify({ email: 'coupons-e2e@example.com', password: 'password-123', displayName: 'Coupons E2E' }) });
  if (!bootstrap.ok) throw new Error(`bootstrap failed: ${bootstrap.status}`);
  const bootstrapPayload = await bootstrap.json();
  const adminId = bootstrapPayload.data.profile.id;
  const account = await apiRuntime.store.createAccount({ adminId, platform: 'xianyu', sellerRef: `coupons-e2e-${process.pid}` });
  const product = await apiRuntime.store.createProduct({ adminId, accountId: account.id, externalProductRef: `COUPON-ITEM-${process.pid}`, title: '卡券 E2E 商品', description: '受控绑定商品', categoryCode: 'digital', attributes: { source: 'coupons-e2e' }, priceMinor: 1990, status: 'published' });
  const batch = await apiRuntime.store.createCouponBatch({
    adminId,
    accountId: account.id,
    label: 'Chrome E2E 卡券批次',
    purpose: 'text',
    deliveryScope: 'operator_only',
    metadata: {
      description: 'E2E 列表元数据',
      delaySeconds: 15,
      deliveryCount: 3,
      dockable: true,
      price: '9.90',
      minPrice: '5.00',
      feePayer: 'dealer',
      multiSpec: true,
      specName: '套餐',
      specValue: '标准',
    },
  });
  await apiRuntime.store.importCouponItems({ adminId, batchId: batch.id, contents: ['E2E-COUPON-001', 'E2E-COUPON-002'] });
  await apiRuntime.store.bindCouponBatch({ adminId, batchId: batch.id, productId: product.id });

  const cookie = cookiesFrom(bootstrap);
  spawnProcess(npm, npmArgs(['--workspace', 'apps/web', 'run', 'dev', '--', '--host', '127.0.0.1', '--port', String(webPort)]), { env: { ...process.env, VITE_API_MODE: 'live', VITE_API_BASE_URL: '', VITE_API_PROXY_TARGET: apiUrl } });
  await waitFor(async () => (await fetch(`${webUrl}/coupons`)).ok, 'Vite frontend');
  const chrome = spawnProcess(chromePath, ['--headless=new', '--disable-gpu', '--disable-extensions', '--no-first-run', '--no-default-browser-check', '--remote-allow-origins=*', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${chromeProfile}`, '--window-size=1440,900', 'about:blank']);
  await waitFor(async () => chrome.exitCode === null && (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).ok, 'local Chrome');
  const cdp = await createCdpClient(debugPort);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  for (const pair of cookie.split('; ')) { const [name, ...valueParts] = pair.split('='); await cdp.send('Network.setCookie', { name, value: valueParts.join('='), url: `${webUrl}/` }); }
  await cdp.send('Page.navigate', { url: `${webUrl}/coupons` });
  await waitFor(async () => String(await evaluate(cdp, 'document.readyState')) === 'complete', 'coupons page');
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('Chrome E2E 卡券批次'), 'coupon list');
  await assertText(cdp, '卡券列表');
  await assertText(cdp, '新建卡券');
  await assertText(cdp, '刷新');
  const legacyBlocks = await evaluate(cdp, 'document.querySelectorAll(".coupons-kpis, .coupons-page-actions").length');
  if (legacyBlocks !== 0) throw new Error('legacy coupon KPI or page action blocks still render');
  const toolbarButtons = await evaluate(cdp, 'Array.from(document.querySelectorAll(".coupons-toolbar button")).map((button) => button.textContent?.trim()).filter(Boolean)');
  if (toolbarButtons.includes('查询') || toolbarButtons.includes('重置筛选')) throw new Error('coupon toolbar still exposes removed filter actions');
  if (toolbarButtons.indexOf('刷新') >= toolbarButtons.indexOf('新建卡券')) throw new Error('new coupon button is not last in the default toolbar');
  const totalBadgeCount = await evaluate(cdp, 'document.querySelectorAll(".coupons-total").length');
  if (totalBadgeCount !== 0) throw new Error('coupon total badge still renders');
  if (!await setSearchValue(cdp, '__coupon_empty_state__')) throw new Error('coupon search input missing');
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('暂无卡券批次'), 'coupon empty state');
  await assertText(cdp, '当前账号范围内没有匹配的批次，可调整筛选或创建新批次。');
  await setSearchValue(cdp, '');
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('Chrome E2E 卡券批次'), 'coupon list reset');
  await assertText(cdp, 'E2E 列表元数据');
  await assertText(cdp, '对接价：¥9.90');
  await evaluate(cdp, 'Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.trim() === "新建卡券")?.click()');
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('固定文字配置'), 'coupon create modal');
  await assertText(cdp, '填写到无需邮寄凭证');
  await assertText(cdp, '图片配置（可选，最多3张）');
  const modalFieldAudit = await evaluate(cdp, '(() => { const text = document.body.innerText; return { price: text.includes("对接价格"), dockable: text.includes("是否可对接"), account: text.includes("账号"), deliveryScope: text.includes("交付范围"), quark: text.includes("夸克链接"), extraction: text.includes("提取码"), shipped: text.includes("已发货次数"), inventory: text.includes("首批库存"), file: Boolean(document.querySelector("input[type=file][accept=\\\\\"image/*\\\\\"]")), imageBlock: text.includes("支持JPG、PNG、GIF格式，最大5MB，最多上传3张图片（可选）") }; })()');
  if (modalFieldAudit.price || modalFieldAudit.dockable || modalFieldAudit.account || modalFieldAudit.deliveryScope || modalFieldAudit.quark || modalFieldAudit.extraction || modalFieldAudit.shipped || modalFieldAudit.inventory) throw new Error('coupon create modal exposes fields outside the reference schema');
  if (!modalFieldAudit.file || !modalFieldAudit.imageBlock) throw new Error('coupon create modal image uploader does not match the reference interaction');
  const switchedToData = await evaluate(cdp, '(() => { const select = Array.from(document.querySelectorAll("select")).find((candidate) => Array.from(candidate.options).some((option) => option.value === "data")); if (!select) return false; const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set; setter?.call(select, "data"); select.dispatchEvent(new Event("change", { bubbles: true })); return true; })()');
  if (!switchedToData) throw new Error('coupon type select missing');
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('批量数据配置'), 'coupon data type fields');
  await assertText(cdp, '数据内容 (一行一个)');
  await assertText(cdp, '图片配置（可选，最多3张）');
  await evaluate(cdp, '(() => { const select = Array.from(document.querySelectorAll("select")).find((candidate) => Array.from(candidate.options).some((option) => option.value === "text")); if (!select) return false; const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set; setter?.call(select, "text"); select.dispatchEvent(new Event("change", { bubbles: true })); return true; })()');
  await evaluate(cdp, 'Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.trim() === "取消")?.click()');
  await captureViewport(cdp, 1440, 900, 'coupons-desktop-1440x900.png');

  const selected = await evaluate(cdp, '(() => { const button = Array.from(document.querySelectorAll("[data-coupons-table] button")).find((candidate) => candidate.getAttribute("aria-label")?.startsWith("选择 ")); if (!button) return false; button.click(); return true; })()');
  if (!selected) throw new Error('coupon selection checkbox missing');
  await assertText(cdp, '删除选中 (1)');
  await assertText(cdp, '关联商品');
  await evaluate(cdp, 'Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.trim() === "关联商品")?.click()');
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('待选商品'), 'coupon relation modal');
  await assertText(cdp, '已选商品');
  await evaluate(cdp, 'Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.trim() === "取消")?.click()');

  await evaluate(cdp, 'Array.from(document.querySelectorAll("[data-coupons-table] button")).find((button) => button.getAttribute("aria-label") === "编辑")?.click()');
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('编辑卡券'), 'coupon edit modal');
  const edited = await evaluate(cdp, '(() => { const input = Array.from(document.querySelectorAll("input")).find((item) => item.value === "Chrome E2E 卡券批次"); if (!input) return false; const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set; setter?.call(input, "Chrome E2E 卡券编辑"); input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true })); return true; })()');
  if (!edited) throw new Error('coupon edit name input missing');
  await evaluate(cdp, 'Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.trim() === "保存")?.click()');
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('Chrome E2E 卡券编辑'), 'coupon edit persisted');

  await evaluate(cdp, 'Array.from(document.querySelectorAll("[data-coupons-table] button")).find((button) => button.getAttribute("aria-label") === "复制")?.click()');
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('复制卡券'), 'coupon copy modal');
  const copied = await evaluate(cdp, '(() => { const input = Array.from(document.querySelectorAll("input")).find((item) => item.value === "Chrome E2E 卡券编辑"); if (!input) return false; const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set; setter?.call(input, "Chrome E2E 卡券复制"); input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true })); return true; })()');
  if (!copied) throw new Error('coupon copy name input missing');
  await evaluate(cdp, 'Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.trim() === "保存")?.click()');
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('Chrome E2E 卡券复制'), 'coupon copy persisted');

  await evaluate(cdp, 'Array.from(document.querySelectorAll("[data-coupons-table] button")).find((button) => button.getAttribute("aria-label") === "禁用")?.click()');
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('禁用'), 'coupon toggle disabled');
  await evaluate(cdp, 'Array.from(document.querySelectorAll("[data-coupons-table] button")).find((button) => button.getAttribute("aria-label") === "启用")?.click()');
  await waitFor(async () => !String(await evaluate(cdp, 'document.body.innerText')).includes('禁用'), 'coupon toggle enabled');

  const opened = await evaluate(cdp, '(() => { const row = Array.from(document.querySelectorAll("[data-batch-id]")).find((candidate) => candidate.textContent?.includes("Chrome E2E 卡券编辑")); const button = row ? Array.from(row.querySelectorAll("button")).find((candidate) => ["查看", "查看明细"].includes(candidate.getAttribute("aria-label") ?? "")) : undefined; if (!button) return false; button.click(); return true; })()');
  if (!opened) throw new Error('coupon detail button missing');
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('导入库存'), 'coupon drawer');
  const previewButton = await evaluate(cdp, '(() => { const button = Array.from(document.querySelectorAll("button")).find((candidate) => candidate.textContent?.includes("查看首条可用正文")); if (!button) return false; button.click(); return true; })()');
  if (!previewButton) throw new Error('coupon preview button missing');
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('E2E-COUPON-001'), 'controlled coupon preview');
  await assertText(cdp, '复制正文');

  const importReady = await evaluate(cdp, '(() => { const area = Array.from(document.querySelectorAll("textarea")).find((item) => item.getAttribute("placeholder")?.includes("每行一个卡券正文")); if (!area) return false; const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set; setter?.call(area, "E2E-COUPON-003"); area.dispatchEvent(new Event("input", { bubbles: true })); area.dispatchEvent(new Event("change", { bubbles: true })); return true; })()');
  if (!importReady) throw new Error('coupon import textarea missing');
  await evaluate(cdp, 'Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.includes("导入库存"))?.click()');
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('可用库存'), 'coupon import completed');

  const bindReady = await evaluate(cdp, `(() => { const input = document.querySelector('input[placeholder="product UUID"]'); if (!input) return false; const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set; setter?.call(input, "${product.id}"); input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
  if (!bindReady) throw new Error('coupon binding input missing');
  await evaluate(cdp, 'Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.trim() === "绑定")?.click()');
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes(`${product.id}`), 'coupon binding completed');

  await evaluate(cdp, 'window.confirm = () => true; Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.includes("作废批次"))?.click()');
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('voided'), 'coupon void completed');
  await cdp.send('Page.reload', { ignoreCache: true });
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('Chrome E2E 卡券编辑'), 'coupon reload persistence');
  await captureViewport(cdp, 390, 844, 'coupons-mobile-390x844.png');
  await cdp.send('Emulation.clearDeviceMetricsOverride');
  console.log('local Chrome E2E passed: coupons list -> detail -> preview/copy -> import -> bind -> void -> reload');
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
