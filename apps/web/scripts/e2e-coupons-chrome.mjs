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
  const layoutCouponLabel = `Chrome UI 布局卡券 ${process.pid}`;
  await apiRuntime.store.createCouponBatch({ adminId, accountId: account.id, label: layoutCouponLabel, purpose: 'text', deliveryScope: 'operator_only', metadata: { description: `布局备注 ${process.pid}`, multiSpec: true, specName: '版本', specValue: '标准版' } });
  for (let index = 1; index < 12; index += 1) {
    await apiRuntime.store.createCouponBatch({ adminId, accountId: account.id, label: `Chrome UI 布局卡券 ${process.pid} ${index}`, purpose: 'text', deliveryScope: 'operator_only', metadata: { description: `布局备注 ${process.pid} ${index}` } });
  }
  const createdLabel = `Chrome UI 创建卡券 ${process.pid}`;
  const editedLabel = `Chrome UI 编辑卡券 ${process.pid}`;
  const copiedLabel = `Chrome UI 复制卡券 ${process.pid}`;

  const cookie = cookiesFrom(bootstrap);
  spawnProcess(npm, npmArgs(['--workspace', 'apps/web', 'run', 'dev', '--', '--host', '127.0.0.1', '--port', String(webPort)]), { env: { ...process.env, VITE_API_MODE: 'live', VITE_API_BASE_URL: '', VITE_API_PROXY_TARGET: apiUrl } });
  await waitFor(async () => (await fetch(`${webUrl}/coupons`)).ok, 'Vite frontend');
  const chrome = spawnProcess(chromePath, ['--headless=new', '--disable-gpu', '--disable-extensions', '--no-first-run', '--no-default-browser-check', '--remote-allow-origins=*', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${chromeProfile}`, '--window-size=1440,900', 'about:blank']);
  await waitFor(async () => chrome.exitCode === null && (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).ok, 'local Chrome');
  const cdp = await createCdpClient(debugPort);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable');
  for (const pair of cookie.split('; ')) { const [name, ...valueParts] = pair.split('='); await cdp.send('Network.setCookie', { name, value: valueParts.join('='), url: `${webUrl}/` }); }
  await cdp.send('Page.navigate', { url: `${webUrl}/coupons` });
  await waitFor(async () => String(await evaluate(cdp, 'document.readyState')) === 'complete', 'coupons page');
  await waitFor(async () => await evaluate(cdp, `window.localStorage.getItem('xianyu.activeAccountId') === ${JSON.stringify(account.id)}`), 'coupon account context');
  await waitFor(async () => Boolean(await evaluate(cdp, '(() => { const button = Array.from(document.querySelectorAll("button")).find((candidate) => candidate.textContent?.trim() === "新建卡券"); return Boolean(button && !button.disabled); })()')), 'coupon page');
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
  const emptyStateAudit = await evaluate(cdp, '(() => { const state = document.querySelector(".coupons-panel > .coupons-state"); const panel = document.querySelector(".coupons-panel"); if (!state || !panel) return null; const style = getComputedStyle(state); return { display: style.display, alignItems: style.alignItems, justifyContent: style.justifyContent, flex: style.flex, stateHeight: state.getBoundingClientRect().height, panelHeight: panel.getBoundingClientRect().height }; })()');
  if (!emptyStateAudit || emptyStateAudit.display !== 'flex' || emptyStateAudit.alignItems !== 'center' || emptyStateAudit.justifyContent !== 'center' || emptyStateAudit.stateHeight <= 0 || emptyStateAudit.panelHeight <= emptyStateAudit.stateHeight) throw new Error('coupon empty state is not centered in the panel remainder');
  await setSearchValue(cdp, '');
  await waitFor(async () => { const body = String(await evaluate(cdp, 'document.body.innerText')); return !body.includes('暂无卡券批次') && body.includes(layoutCouponLabel); }, 'coupon list reset');
  await evaluate(cdp, 'Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.trim() === "新建卡券")?.click()');
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('固定文字配置'), 'coupon create modal');
  await assertText(cdp, '填写到无需邮寄凭证');
  const modalLayoutAudit = await evaluate(cdp, '(() => { const modal = document.querySelector(".coupons-editor-modal"); const header = modal?.querySelector(".coupons-modal-header"); const close = header?.querySelector("button[aria-label=\\"关闭\\"]"); const scroll = modal?.querySelector(".coupons-modal-scroll"); const labels = Array.from(modal?.querySelectorAll(".coupons-field-label, .ui-field-label") ?? []); const requiredStars = labels.flatMap((label) => Array.from(label.querySelectorAll(".coupons-required, .ui-field-required"))); const checkbox = modal?.querySelector(".coupons-checkbox-row"); const checkboxInput = checkbox?.querySelector("input[type=checkbox]"); const checkboxCopy = checkbox?.querySelector(".coupons-checkbox-content"); const before = { headerTop: header?.getBoundingClientRect().top ?? null, closeTop: close?.getBoundingClientRect().top ?? null }; if (scroll) scroll.scrollTop = scroll.scrollHeight; const after = { headerTop: header?.getBoundingClientRect().top ?? null, closeTop: close?.getBoundingClientRect().top ?? null }; return { docking: (modal?.innerText ?? "").includes("对接信息") || (modal?.innerText ?? "").includes("对接消息"), headerFixed: before.headerTop !== null && after.headerTop !== null && Math.abs(before.headerTop - after.headerTop) < 1 && before.closeTop !== null && after.closeTop !== null && Math.abs(before.closeTop - after.closeTop) < 1, requiredInline: requiredStars.length > 0 && requiredStars.every((star) => { const label = star.parentElement; return Boolean(label && Math.abs(label.getBoundingClientRect().top - star.getBoundingClientRect().top) < 1); }), selectStyled: Boolean(modal?.querySelector(".ui-select-control select")), checkboxAligned: Boolean(checkbox && checkboxInput && checkboxCopy && getComputedStyle(checkbox).display === "flex" && checkboxInput.getBoundingClientRect().left < checkboxCopy.getBoundingClientRect().left) }; })()');
  if (modalLayoutAudit.docking) throw new Error('coupon create modal still exposes docking information/messages');
  if (!modalLayoutAudit.headerFixed) throw new Error('coupon create modal header or close button scrolls with the body');
  if (!modalLayoutAudit.requiredInline) throw new Error('coupon create modal required markers are not aligned inline');
  if (!modalLayoutAudit.selectStyled) throw new Error('coupon create modal does not use the shared select component');
  if (!modalLayoutAudit.checkboxAligned) throw new Error('coupon create modal checkbox row is not aligned');
  await evaluate(cdp, '(() => { const scroll = document.querySelector(".coupons-modal-scroll"); if (scroll) scroll.scrollTop = 0; })()');
  await captureViewport(cdp, 1440, 900, 'coupons-create-modal-desktop-1440x900.png');
  await captureViewport(cdp, 390, 844, 'coupons-create-modal-mobile-390x844.png');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  const imageTypeReady = await evaluate(cdp, '(() => { const select = document.querySelector(".coupons-editor-modal select"); if (!select || !Array.from(select.options).some((option) => option.value === "image")) return false; const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set; setter?.call(select, "image"); select.dispatchEvent(new Event("change", { bubbles: true })); return true; })()');
  if (!imageTypeReady) throw new Error('coupon type select missing');
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('图片配置（可选，最多3张）'), 'coupon image fields');
  await assertText(cdp, '图片配置（可选，最多3张）');
  const modalFieldAudit = await evaluate(cdp, '(() => { const modal = document.querySelector(".coupons-editor-modal"); const text = modal?.innerText ?? ""; const fileInput = modal?.querySelector("input[type=file]"); return { price: text.includes("对接价格"), dockable: text.includes("是否可对接"), docking: text.includes("对接信息") || text.includes("对接消息"), account: text.includes("账号"), deliveryScope: text.includes("交付范围"), quark: text.includes("夸克链接"), extraction: text.includes("提取码"), shipped: text.includes("已发货次数"), inventory: text.includes("首批库存"), file: Boolean(fileInput && fileInput.getAttribute("accept") === "image/*"), imageBlock: text.includes("支持JPG、PNG、GIF格式，最大5MB，最多上传3张图片（可选）") }; })()');
  if (modalFieldAudit.price || modalFieldAudit.dockable || modalFieldAudit.docking || modalFieldAudit.account || modalFieldAudit.deliveryScope || modalFieldAudit.quark || modalFieldAudit.extraction || modalFieldAudit.shipped || modalFieldAudit.inventory) throw new Error('coupon create modal exposes fields outside the reference schema');
  if (!modalFieldAudit.file || !modalFieldAudit.imageBlock) throw new Error('coupon create modal image uploader does not match the reference interaction');
  const switchedToData = await evaluate(cdp, '(() => { const modal = document.querySelector(".coupons-editor-modal"); const select = Array.from(modal?.querySelectorAll("select") ?? []).find((candidate) => Array.from(candidate.options).some((option) => option.value === "data")); if (!select) return false; const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set; setter?.call(select, "data"); select.dispatchEvent(new Event("input", { bubbles: true })); select.dispatchEvent(new Event("change", { bubbles: true })); return true; })()');
  if (!switchedToData) throw new Error('coupon type select missing');
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('批量数据配置'), 'coupon data type fields');
  await assertText(cdp, '数据内容 (一行一个)');
  await assertText(cdp, '图片配置（可选，最多3张）');
  await evaluate(cdp, '(() => { const modal = document.querySelector(".coupons-editor-modal"); const select = Array.from(modal?.querySelectorAll("select") ?? []).find((candidate) => Array.from(candidate.options).some((option) => option.value === "text")); if (!select) return false; const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set; setter?.call(select, "text"); select.dispatchEvent(new Event("input", { bubbles: true })); select.dispatchEvent(new Event("change", { bubbles: true })); return true; })()');
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('固定文字内容'), 'coupon text fields');
  const createReady = await evaluate(cdp, `(() => { const modal = document.querySelector(".coupons-editor-modal"); if (!modal) return false; const setValue = (selector, value, proto) => { const input = modal.querySelector(selector); if (!input) return false; const setter = Object.getOwnPropertyDescriptor(proto.prototype, "value")?.set; setter?.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true })); return true; }; return setValue('input[placeholder="例如：游戏点卡、会员卡等"]', ${JSON.stringify(createdLabel)}, HTMLInputElement) && setValue('textarea[placeholder="请输入要发送的固定文字内容..."]', ${JSON.stringify(`E2E UI 固定文字内容 ${process.pid}`)}, HTMLTextAreaElement); })()`);
  if (!createReady) throw new Error('coupon create form fields missing');
  await evaluate(cdp, 'document.querySelector(".coupons-editor-modal button[type=submit]")?.click()');
  await waitFor(async () => !(await evaluate(cdp, 'Boolean(document.querySelector(".coupons-editor-modal"))')) && String(await evaluate(cdp, 'document.body.innerText')).includes(createdLabel), 'coupon created from UI');
  const persistedBatch = await waitFor(async () => {
    const page = await apiRuntime.store.listCouponBatches(adminId, { accountId: account.id, page: 1, pageSize: 100 });
    return page.items.find((item) => item.label === createdLabel) ?? false;
  }, 'coupon API persistence');
  if (!persistedBatch) throw new Error('UI-created coupon was not persisted by the API store');
  await assertText(cdp, `E2E UI 固定文字内容 ${process.pid}`);
  const tableLayoutAudit = await evaluate(cdp, `(() => { const scroll = document.querySelector('.coupons-table-scroll'); const table = document.querySelector('[data-coupons-table]'); const firstRow = document.querySelector('[data-coupons-table] .coupons-row:not(.coupons-head)'); const layoutRow = Array.from(document.querySelectorAll('[data-batch-id]')).find((row) => row.querySelector('.coupons-title')?.textContent?.trim() === ${JSON.stringify(layoutCouponLabel)}); const style = scroll ? getComputedStyle(scroll) : null; const title = layoutRow?.querySelector('.coupons-title')?.textContent?.trim() ?? ''; const note = layoutRow?.querySelector('.coupons-note')?.textContent?.trim() ?? ''; const headers = Array.from(table?.querySelectorAll('.coupons-head > span') ?? []).map((item) => (item.textContent?.trim() ?? '').replace(/[↕↑↓]/g, '').trim()); const preview = layoutRow?.querySelector('.coupons-preview-cell'); const actionSelector = '.coupons-row-actions > button, .coupons-row-actions > .coupons-more-actions > button'; const actionButtons = layoutRow?.querySelectorAll(actionSelector)?.length ?? 0; const toolbar = document.querySelector('.coupons-toolbar'); return { hasHeader: (table?.querySelector('.coupons-head')?.textContent ?? '').includes('备注信息'), firstNumber: firstRow?.querySelector('.coupons-row-number')?.textContent?.trim() ?? '', overflowY: style?.overflowY ?? '', clientHeight: scroll?.clientHeight ?? 0, scrollHeight: scroll?.scrollHeight ?? 0, title, note, headers, previewTag: preview?.tagName ?? '', previewClass: preview?.className ?? '', actionButtons, hasStatusFilter: Boolean(toolbar?.querySelector('[data-coupons-status-filter]')), hasStockFilter: Boolean(toolbar?.querySelector('[data-coupons-stock-filter]')), actionLabels: Array.from(layoutRow?.querySelectorAll(actionSelector) ?? []).map((button) => button.getAttribute('aria-label') ?? '') }; })()`);
  const expectedHeaders = ['ID', '名称', '类型', '内容预览', '备注信息', '发货设置', '状态', '时间', '操作'];
  if (!tableLayoutAudit || !tableLayoutAudit.hasHeader || JSON.stringify(tableLayoutAudit.headers) !== JSON.stringify(expectedHeaders) || !/^[1-9]\d*$/.test(String(tableLayoutAudit.firstNumber)) || !['auto', 'scroll'].includes(tableLayoutAudit.overflowY) || tableLayoutAudit.scrollHeight <= tableLayoutAudit.clientHeight || tableLayoutAudit.actionButtons !== 3 || JSON.stringify(tableLayoutAudit.actionLabels) !== JSON.stringify(['编辑', '关联商品', '更多']) || tableLayoutAudit.hasStatusFilter || tableLayoutAudit.hasStockFilter || tableLayoutAudit.previewTag !== 'SPAN' || !String(tableLayoutAudit.previewClass).includes('coupons-preview-cell')) throw new Error('coupon table does not expose the expected columns, typography cells, actions, and internal scroll region');
  if (tableLayoutAudit.title !== layoutCouponLabel || tableLayoutAudit.note !== `布局备注 ${process.pid}`) throw new Error('coupon name and remark columns are not separated');
  const sortButtonState = await evaluate(cdp, '(() => { const button = document.querySelector("[data-testid=coupon-sort-createdAt]"); return button ? { ariaSort: button.getAttribute("aria-sort"), text: button.textContent?.trim() ?? "" } : null; })()');
  if (!sortButtonState || sortButtonState.ariaSort !== 'descending' || !sortButtonState.text.includes('时间')) throw new Error('coupon created-time sort control missing default descending state');
  const createdSortAscMark = cdp.events.length;
  if (!await evaluate(cdp, '(() => { const button = document.querySelector("[data-testid=coupon-sort-createdAt]"); if (!button) return false; button.click(); return true; })()')) throw new Error('coupon created-time sort button missing');
  await waitFor(async () => cdp.events.slice(createdSortAscMark).some((event) => { if (event.method !== 'Network.requestWillBeSent' || event.params?.request?.method !== 'GET') return false; const url = new URL(event.params.request.url); return url.pathname === '/api/v1/coupons/batches' && url.searchParams.get('sortBy') === 'createdAt' && url.searchParams.get('sortOrder') === 'asc' && url.searchParams.get('page') === '1'; }), 'coupon createdAt asc sort request');
  await waitFor(async () => await evaluate(cdp, 'document.querySelector("[data-testid=coupon-sort-createdAt]")?.getAttribute("aria-sort") === "ascending"'), 'coupon createdAt asc aria state');
  const createdSortDescMark = cdp.events.length;
  await evaluate(cdp, 'document.querySelector("[data-testid=coupon-sort-createdAt]")?.click()');
  await waitFor(async () => cdp.events.slice(createdSortDescMark).some((event) => { if (event.method !== 'Network.requestWillBeSent' || event.params?.request?.method !== 'GET') return false; const url = new URL(event.params.request.url); return url.pathname === '/api/v1/coupons/batches' && url.searchParams.get('sortBy') === 'createdAt' && url.searchParams.get('sortOrder') === 'desc' && url.searchParams.get('page') === '1'; }), 'coupon createdAt desc sort request');
  await waitFor(async () => await evaluate(cdp, 'document.querySelector("[data-testid=coupon-sort-createdAt]")?.getAttribute("aria-sort") === "descending"'), 'coupon createdAt desc aria state');
  await captureViewport(cdp, 1440, 900, 'coupons-desktop-1440x900.png');

  const selected = await evaluate(cdp, '(() => { const button = Array.from(document.querySelectorAll("[data-coupons-table] button")).find((candidate) => candidate.getAttribute("aria-label")?.startsWith("选择 ")); if (!button) return false; button.click(); return true; })()');
  if (!selected) throw new Error('coupon selection checkbox missing');
  await assertText(cdp, '删除选中 (1)');
  await assertText(cdp, '关联商品');
  await evaluate(cdp, 'Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.trim() === "关联商品")?.click()');
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('待选商品'), 'coupon relation modal');
  await assertText(cdp, '已选商品');
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('卡券 E2E 商品'), 'coupon relation product list');
  const relationProductSelected = await evaluate(cdp, `(() => { const product = Array.from(document.querySelectorAll('.coupons-relation-pane:not(.selected-pane) button.coupons-relation-item')).find((button) => button.textContent?.includes('卡券 E2E 商品')); if (!product) return false; product.click(); return true; })()`);
  if (!relationProductSelected) throw new Error('coupon relation product option missing');
  await evaluate(cdp, 'Array.from(document.querySelectorAll(".coupons-relation-modal footer button")).find((button) => button.classList.contains("primary"))?.click()');
  await waitFor(async () => await evaluate(cdp, '!document.querySelector(".coupons-relation-modal")'), 'coupon relation save closes modal');
  const relationPersisted = await waitFor(async () => {
    const batch = await apiRuntime.store.getCouponBatch(adminId, persistedBatch.id);
    const productRecord = await apiRuntime.store.getProduct(adminId, product.id);
    const activeBinding = batch?.bindings?.find((binding) => binding.productId === product.id && binding.status === 'active');
    const productBinding = productRecord?.couponBatches?.find((binding) => binding.id === batch?.sequenceId && binding.label === createdLabel);
    return activeBinding && productBinding ? { batchId: batch.id, bindingId: activeBinding.id, productBatchId: productBinding.id } : false;
  }, 'coupon relation persistence and product binding');
  if (!relationPersisted || relationPersisted.productBatchId !== persistedBatch.sequenceId) throw new Error('coupon relation was not persisted on both batch and product records');

  const selectedRow = await evaluate(cdp, `(() => { const row = Array.from(document.querySelectorAll("[data-batch-id]")).find((candidate) => candidate.textContent?.includes(${JSON.stringify(createdLabel)})); const button = row?.querySelector('button[aria-label="编辑"]'); if (!button) return false; button.click(); return true; })()`);
  if (!selectedRow) throw new Error('created coupon edit button missing');
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('编辑卡券'), 'coupon edit modal');
  const edited = await evaluate(cdp, `(() => { const input = Array.from(document.querySelectorAll(".coupons-editor-modal input")).find((item) => item.value === ${JSON.stringify(createdLabel)}); if (!input) return false; const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set; setter?.call(input, ${JSON.stringify(editedLabel)}); input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
  if (!edited) throw new Error('coupon edit name input missing');
  await evaluate(cdp, 'document.querySelector(".coupons-editor-modal button[type=submit]")?.click()');
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes(editedLabel), 'coupon edit persisted');

  const openMore = async () => {
    const opened = await evaluate(cdp, `(() => { const row = Array.from(document.querySelectorAll("[data-batch-id]")).find((candidate) => candidate.textContent?.includes(${JSON.stringify(editedLabel)})); const button = row?.querySelector('button[aria-label="更多"]'); if (!button) return false; button.click(); return true; })()`);
    if (!opened) throw new Error('coupon more button missing');
    await waitFor(async () => await evaluate(cdp, `(() => { const row = Array.from(document.querySelectorAll("[data-batch-id]")).find((candidate) => candidate.textContent?.includes(${JSON.stringify(editedLabel)})); return Boolean(row?.querySelector('[role="menu"]')); })()`), 'coupon more menu');
  };

  await openMore();
  const copyReady = await evaluate(cdp, `(() => { const row = Array.from(document.querySelectorAll("[data-batch-id]")).find((candidate) => candidate.textContent?.includes(${JSON.stringify(editedLabel)})); const button = Array.from(row?.querySelectorAll('[role="menuitem"]') ?? []).find((candidate) => candidate.textContent?.trim() === '复制'); if (!button) return false; button.click(); return true; })()`);
  if (!copyReady) throw new Error('created coupon copy button missing');
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('复制卡券'), 'coupon copy modal');
  const copied = await evaluate(cdp, `(() => { const input = Array.from(document.querySelectorAll(".coupons-editor-modal input")).find((item) => item.value === ${JSON.stringify(editedLabel)}); if (!input) return false; const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set; setter?.call(input, ${JSON.stringify(copiedLabel)}); input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
  if (!copied) throw new Error('coupon copy name input missing');
  await evaluate(cdp, 'document.querySelector(".coupons-editor-modal button[type=submit]")?.click()');
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes(copiedLabel), 'coupon copy persisted');

  await openMore();
  const toggleDisabled = await evaluate(cdp, `(() => { const row = Array.from(document.querySelectorAll("[data-batch-id]")).find((candidate) => candidate.textContent?.includes(${JSON.stringify(editedLabel)})); const button = Array.from(row?.querySelectorAll('[role="menuitem"]') ?? []).find((candidate) => candidate.textContent?.trim() === '禁用'); if (!button) return false; button.click(); return true; })()`);
  if (!toggleDisabled) throw new Error('created coupon disable menu item missing');
  await waitFor(async () => await evaluate(cdp, `(() => { const row = Array.from(document.querySelectorAll("[data-batch-id]")).find((candidate) => candidate.textContent?.includes(${JSON.stringify(editedLabel)})); return row?.textContent?.includes('禁用') ?? false; })()`), 'coupon toggle disabled');
  await openMore();
  const toggleEnabled = await evaluate(cdp, `(() => { const row = Array.from(document.querySelectorAll("[data-batch-id]")).find((candidate) => candidate.textContent?.includes(${JSON.stringify(editedLabel)})); const button = Array.from(row?.querySelectorAll('[role="menuitem"]') ?? []).find((candidate) => candidate.textContent?.trim() === '启用'); if (!button) return false; button.click(); return true; })()`);
  if (!toggleEnabled) throw new Error('created coupon enable menu item missing');
  await waitFor(async () => await evaluate(cdp, `(() => { const row = Array.from(document.querySelectorAll("[data-batch-id]")).find((candidate) => candidate.textContent?.includes(${JSON.stringify(editedLabel)})); return row?.textContent?.includes('启用') ?? false; })()`), 'coupon toggle enabled');
  const drawerCount = await evaluate(cdp, 'document.querySelectorAll(".coupons-drawer, [data-coupon-drawer]").length');
  if (drawerCount !== 0) throw new Error('coupon detail drawer still renders');
  await openMore();
  await evaluate(cdp, 'window.confirm = () => true');
  const deleteReady = await evaluate(cdp, `(() => { const row = Array.from(document.querySelectorAll("[data-batch-id]")).find((candidate) => candidate.textContent?.includes(${JSON.stringify(editedLabel)})); const button = Array.from(row?.querySelectorAll('[role="menuitem"]') ?? []).find((candidate) => candidate.textContent?.trim() === '删除'); if (!button) return false; button.click(); return true; })()`);
  if (!deleteReady) throw new Error('created coupon delete menu item missing');
  await waitFor(async () => !String(await evaluate(cdp, 'document.body.innerText')).includes(editedLabel), 'coupon delete completed');
  await cdp.send('Page.reload', { ignoreCache: true });
  await waitFor(async () => { const body = String(await evaluate(cdp, 'document.body.innerText')); return body.includes(copiedLabel) && !body.includes(editedLabel); }, 'coupon reload persistence and deleted hidden');
  await captureViewport(cdp, 390, 844, 'coupons-mobile-390x844.png');
  await cdp.send('Emulation.clearDeviceMetricsOverride');
  console.log('local Chrome E2E passed: UI create -> list -> edit/copy/toggle/more/delete -> reload');
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
