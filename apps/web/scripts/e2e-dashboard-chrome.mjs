import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..', '..', '..');
const children = [];
const chromeProfile = join(tmpdir(), `xianyu-agent-dashboard-chrome-${process.pid}`);
const chromePath = process.env.CHROME_PATH ?? join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe');
const screenshotDir = join(root, 'docs', 'evidence', 'stage5', 'S4-VS-DASHBOARD', 'screenshots');

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
  child.stdout.on('data', (chunk) => process.stdout.write(`[dashboard-e2e:${command}] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[dashboard-e2e:${command}] ${chunk}`));
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

function csrfFrom(cookie) { return decodeURIComponent(cookie.match(/(?:^|; )csrf_token=([^;]+)/)?.[1] ?? ''); }

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
  spawnProcess(process.execPath, ['apps/api/scripts/e2e-harness.mjs'], { env: { ...process.env, PORT: String(apiPort), HOST: '127.0.0.1' } });
  await waitFor(async () => (await fetch(`${apiUrl}/healthz`)).ok, 'API');
  const bootstrap = await fetch(`${apiUrl}/api/v1/auth/bootstrap`, { method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': `dashboard-bootstrap-${process.pid}` }, body: JSON.stringify({ email: 'dashboard-e2e@example.com', password: 'password-123', displayName: 'Dashboard E2E' }) });
  if (!bootstrap.ok) throw new Error(`bootstrap failed: ${bootstrap.status}`);
  const cookie = cookiesFrom(bootstrap);
  const csrf = csrfFrom(cookie);
  const accountResponse = await fetch(`${apiUrl}/api/v1/accounts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie, 'x-csrf-token': csrf, 'Idempotency-Key': `dashboard-account-${process.pid}` },
    body: JSON.stringify({ platform: 'xianyu', sellerRef: `dashboard-e2e-${process.pid}`, displayName: '仪表盘账号 A' }),
  });
  if (!accountResponse.ok) throw new Error(`account seed failed: ${accountResponse.status} ${await accountResponse.text()}`);
  const accountPayload = await accountResponse.json();
  const accountId = accountPayload?.data?.id;
  if (!accountId) throw new Error('dashboard account seed did not return an id');
  spawnProcess(npm, npmArgs(['--workspace', 'apps/web', 'run', 'dev', '--', '--host', '127.0.0.1', '--port', String(webPort)]), { env: { ...process.env, VITE_API_MODE: 'live', VITE_DASHBOARD_MODE: 'mock', VITE_API_BASE_URL: '', VITE_API_PROXY_TARGET: apiUrl } });
  await waitFor(async () => (await fetch(`${webUrl}/dashboard`)).ok, 'Vite frontend');
  const chrome = spawnProcess(chromePath, ['--headless=new', '--disable-gpu', '--disable-extensions', '--no-first-run', '--no-default-browser-check', '--remote-allow-origins=*', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${chromeProfile}`, '--window-size=1440,900', 'about:blank']);
  await waitFor(async () => chrome.exitCode === null && (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).ok, 'local Chrome');
  const cdp = await createCdpClient(debugPort);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable');
  for (const pair of cookie.split('; ')) { const [name, ...valueParts] = pair.split('='); await cdp.send('Network.setCookie', { name, value: valueParts.join('='), url: `${webUrl}/` }); }
  await cdp.send('Page.navigate', { url: `${webUrl}/` });
  await waitFor(async () => String(await evaluate(cdp, 'document.readyState')) === 'complete', 'frontend shell before account context seed');
  await evaluate(cdp, `localStorage.setItem('xianyu.activeAccountId', ${JSON.stringify(accountId)})`);
  await cdp.send('Page.navigate', { url: `${webUrl}/dashboard` });
  await waitFor(async () => String(await evaluate(cdp, 'document.readyState')) === 'complete', 'dashboard page');
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('订单与 AI 闭环趋势'), 'dashboard content');
  const dashboardBody = String(await evaluate(cdp, 'document.body.innerText'));
  const dashboardRequests = cdp.events.filter((event) => event.method === 'Network.requestWillBeSent' && event.params?.request?.url?.includes('/api/v1/dashboard/snapshot'));
  if (dashboardRequests.length > 0) throw new Error('dashboard unexpectedly requested live snapshot API under explicit mock override');
  await assertText(cdp, '总销售额');
  await assertText(cdp, '今天');
  await assertText(cdp, '三天');
  await assertText(cdp, '一个月内');
  await assertText(cdp, '月份选择');
  await assertText(cdp, '自定义时间区间');
  const defaultRangeSelected = await evaluate(cdp, '(() => { const button = Array.from(document.querySelectorAll("button")).find((candidate) => candidate.textContent?.trim() === "一个月内"); return Boolean(button?.classList.contains("ui-button-primary")); })()');
  if (!defaultRangeSelected) throw new Error('dashboard default trend range is not one month');
  const dashboardBodyAfterLayout = String(await evaluate(cdp, 'document.body.innerText'));
  if (dashboardBodyAfterLayout.includes('当前账号健康度')) throw new Error('dashboard still renders the removed account health card');
  if (dashboardBodyAfterLayout.includes('可售卡密库存')) throw new Error('dashboard still renders the removed coupon stock KPI');
  const rangeChanged = await evaluate(cdp, '(() => { const button = Array.from(document.querySelectorAll("button")).find((candidate) => candidate.textContent?.trim() === "三天"); if (!button) return false; button.click(); return true; })()');
  if (!rangeChanged) throw new Error('dashboard trend quick range control missing');
  await waitFor(async () => Boolean(await evaluate(cdp, 'Array.from(document.querySelectorAll("button")).some((candidate) => candidate.textContent?.trim() === "三天" && candidate.classList.contains("ui-button-primary"))')), 'dashboard selected trend range');
  const tooltipShown = await evaluate(cdp, '(() => { const chart = document.querySelector(".dashboard-chart-wrap svg"); if (!chart) return false; chart.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 320, clientY: 120 })); return true; })()');
  if (!tooltipShown) throw new Error('dashboard trend chart missing');
  await waitFor(async () => Boolean(await evaluate(cdp, 'Boolean(document.querySelector(".dashboard-chart-tooltip"))')), 'dashboard trend tooltip');
  await assertText(cdp, '商品排行');
  await assertText(cdp, '最近处理记录');
  const pendingManualBell = await evaluate(cdp, 'Boolean(document.querySelector(".dashboard-desktop-content .dashboard-pending-manual-card .dashboard-icon-button"))');
  if (!pendingManualBell) throw new Error('pending manual KPI bell is missing from the desktop card');
  await evaluate(cdp, 'document.querySelector(".dashboard-desktop-content .dashboard-pending-manual-card .dashboard-icon-button").click()');
  await waitFor(async () => Boolean(await evaluate(cdp, 'Boolean(document.querySelector(".dashboard-desktop-content .dashboard-risk-popover"))')), 'pending manual risk popover');
  await assertText(cdp, '待处理风险');
  await assertText(cdp, '考研英语资料缺少发货凭证');
  const desktopBadgeStyle = await evaluate(cdp, '(() => { const badge = document.querySelector(".dashboard-desktop-content .dashboard-pending-manual-card .dashboard-icon-button b"); if (!badge) return null; const style = getComputedStyle(badge); const rect = badge.getBoundingClientRect(); return { color: style.color, backgroundColor: style.backgroundColor, fontSize: style.fontSize, fontWeight: style.fontWeight, width: rect.width, height: rect.height, borderTopWidth: style.borderTopWidth }; })()');
  if (!desktopBadgeStyle || desktopBadgeStyle.color !== 'rgb(255, 255, 255)' || desktopBadgeStyle.backgroundColor !== 'rgb(192, 0, 0)' || desktopBadgeStyle.fontSize !== '12px' || Number(desktopBadgeStyle.width) < 16 || Number(desktopBadgeStyle.height) < 16 || desktopBadgeStyle.borderTopWidth !== '2px') throw new Error(`desktop unread badge contrast is insufficient: ${JSON.stringify(desktopBadgeStyle)}`);
  const desktopPopoverGeometry = await evaluate(cdp, '(() => { const bell = document.querySelector(".dashboard-desktop-content .dashboard-pending-manual-card .dashboard-icon-button"); const popover = document.querySelector(".dashboard-desktop-content .dashboard-risk-popover"); if (!bell || !popover) return null; const bellRect = bell.getBoundingClientRect(); const popoverRect = popover.getBoundingClientRect(); return { gap: popoverRect.top - bellRect.bottom, rightDelta: Math.abs(popoverRect.right - bellRect.right) }; })()');
  if (!desktopPopoverGeometry || desktopPopoverGeometry.gap > 10 || desktopPopoverGeometry.rightDelta > 12) throw new Error(`desktop risk popover is not anchored to bell: ${JSON.stringify(desktopPopoverGeometry)}`);
  const sharedSidebarCount = await evaluate(cdp, 'document.querySelectorAll(".sidebar").length');
  if (sharedSidebarCount !== 1) throw new Error(`expected one shared sidebar, found ${sharedSidebarCount}`);
  const legacyDashboardSidebarCount = await evaluate(cdp, 'document.querySelectorAll(".dashboard-sidebar").length');
  if (legacyDashboardSidebarCount !== 0) throw new Error('legacy dashboard sidebar is still mounted');
  await assertText(cdp, 'FishAgent');
  await assertText(cdp, '运营台');
  const desktopState = await evaluate(cdp, 'getComputedStyle(document.querySelector(".dashboard-desktop-content")).display');
  if (desktopState === 'none') throw new Error('desktop dashboard shell is hidden at 1440px');
  await captureViewport(cdp, 1440, 900, 'dashboard-desktop-1440x900.png');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  await waitFor(async () => String(await evaluate(cdp, 'getComputedStyle(document.querySelector(".dashboard-mobile-content")).display')) !== 'none', 'mobile dashboard content');
  await assertText(cdp, 'Agent 在线 · 仪表盘账号 A');
  await assertText(cdp, '今天优先处理');
  await assertText(cdp, '经营快照');
  await captureViewport(cdp, 390, 844, 'dashboard-mobile-390x844.png');
  const mobilePendingManualBell = await evaluate(cdp, 'Boolean(document.querySelector(".dashboard-mobile-content .dashboard-pending-manual-card .dashboard-icon-button"))');
  if (!mobilePendingManualBell) throw new Error('pending manual KPI bell is missing from the mobile card');
  await evaluate(cdp, 'document.querySelector(".dashboard-mobile-content .dashboard-pending-manual-card .dashboard-icon-button").click()');
  await waitFor(async () => Boolean(await evaluate(cdp, 'Boolean(document.querySelector(".dashboard-mobile-content .dashboard-risk-popover"))')), 'mobile pending manual risk popover');
  await assertText(cdp, '待处理风险');
  const mobileBadgeStyle = await evaluate(cdp, '(() => { const badge = document.querySelector(".dashboard-mobile-content .dashboard-pending-manual-card .dashboard-icon-button b"); if (!badge) return null; const style = getComputedStyle(badge); const rect = badge.getBoundingClientRect(); return { color: style.color, backgroundColor: style.backgroundColor, fontSize: style.fontSize, fontWeight: style.fontWeight, width: rect.width, height: rect.height, borderTopWidth: style.borderTopWidth }; })()');
  if (!mobileBadgeStyle || mobileBadgeStyle.color !== 'rgb(255, 255, 255)' || mobileBadgeStyle.backgroundColor !== 'rgb(192, 0, 0)' || mobileBadgeStyle.fontSize !== '12px' || Number(mobileBadgeStyle.width) < 16 || Number(mobileBadgeStyle.height) < 16 || mobileBadgeStyle.borderTopWidth !== '2px') throw new Error(`mobile unread badge contrast is insufficient: ${JSON.stringify(mobileBadgeStyle)}`);
  const mobilePopoverGeometry = await evaluate(cdp, '(() => { const bell = document.querySelector(".dashboard-mobile-content .dashboard-pending-manual-card .dashboard-icon-button"); const popover = document.querySelector(".dashboard-mobile-content .dashboard-risk-popover"); if (!bell || !popover) return null; const bellRect = bell.getBoundingClientRect(); const popoverRect = popover.getBoundingClientRect(); return { gap: popoverRect.top - bellRect.bottom, rightDelta: Math.abs(popoverRect.right - bellRect.right), viewportRight: popoverRect.right }; })()');
  if (!mobilePopoverGeometry || mobilePopoverGeometry.gap > 10 || mobilePopoverGeometry.rightDelta > 12 || mobilePopoverGeometry.viewportRight > 390) throw new Error(`mobile risk popover is not anchored to bell: ${JSON.stringify(mobilePopoverGeometry)}`);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await waitFor(async () => Boolean(await evaluate(cdp, '!document.querySelector(".dashboard-mobile-content .dashboard-risk-popover")')), 'mobile pending manual risk popover close');
  const drawerTrigger = await evaluate(cdp, '(() => { const button = Array.from(document.querySelectorAll("button")).find((candidate) => candidate.textContent?.includes("考研英语资料缺少发货凭证")); if (!button) return false; button.click(); return true; })()');
  if (!drawerTrigger) throw new Error('risk todo trigger missing');
  await waitFor(async () => Boolean(await evaluate(cdp, 'Boolean(document.querySelector(".dashboard-risk-drawer"))')), 'risk todo drawer');
  await assertText(cdp, '付款后未发货');
  console.log('local Chrome E2E passed: dashboard route -> KPI/trend range/tooltip -> mobile shell -> risk drawer');
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
  try { rmSync(chromeProfile, { recursive: true, force: true }); } catch (error) { console.warn(`Chrome temporary profile cleanup failed: ${error.message}`); }
}
