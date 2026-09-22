import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..', '..', '..');
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
const apiPort = await freePort();
const webPort = await freePort();
const debugPort = await freePort();
const apiUrl = `http://127.0.0.1:${apiPort}`;
const webUrl = `http://127.0.0.1:${webPort}`;
const chromePath = process.env.CHROME_PATH ?? join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe');
const chromeProfile = join(tmpdir(), `xianyu-agent-chrome-${process.pid}`);
const screenshotDir = join(root, 'docs', 'evidence', 'stage5', 'S4-VS1', 'screenshots');
const children = [];

function spawnProcess(command, args, options = {}) {
  const child = spawn(command, args, { cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, shell: command.endsWith('.cmd'), ...options });
  child.stdout.on('data', (chunk) => process.stdout.write(`[e2e:${command}] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[e2e:${command}] ${chunk}`));
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

function cookiesFrom(response) {
  return (response.headers.getSetCookie?.() ?? []).map((value) => value.split(';', 1)[0]).join('; ');
}

async function bootstrapAdmin() {
  const response = await fetch(`${apiUrl}/api/v1/auth/bootstrap`, { method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': `chrome-bootstrap-${process.pid}` }, body: JSON.stringify({ email: 'chrome-e2e@example.com', password: 'password-123', displayName: 'Chrome E2E' }) });
  if (!response.ok) throw new Error(`bootstrap failed: ${response.status} ${await response.text()}`);
  const cookie = cookiesFrom(response);
  const csrf = decodeURIComponent(cookie.match(/csrf_token=([^;]+)/)?.[1] ?? '');
  if (!csrf) throw new Error('bootstrap did not return csrf cookie');
  return { cookie, csrf };
}

async function createCdpClient() {
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

async function evaluate(cdp, expression, awaitPromise = true) {
  const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? 'browser script failed');
  return result.result?.value;
}

async function assertText(cdp, text) {
  const body = await evaluate(cdp, 'document.body.innerText');
  if (!String(body).includes(text)) throw new Error(`page missing text: ${text}`);
}

async function captureViewport(cdp, width, height, filename) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  writeFileSync(join(screenshotDir, filename), Buffer.from(screenshot.data, 'base64'));
}

async function run() {
  mkdirSync(chromeProfile, { recursive: true });
  const npm = process.env.npm_execpath ? process.execPath : (process.platform === 'win32' ? 'npm.cmd' : 'npm');
  const npmArgs = (args) => process.env.npm_execpath ? [process.env.npm_execpath, ...args] : args;
  const apiBuild = spawnProcess(npm, npmArgs(['--workspace', 'apps/api', 'run', 'build']));
  const buildExit = await new Promise((resolve) => apiBuild.once('exit', resolve));
  if (buildExit !== 0) throw new Error(`API build failed with ${buildExit}`);
  spawnProcess(process.execPath, ['apps/api/scripts/e2e-harness.mjs'], { env: { ...process.env, PORT: String(apiPort), HOST: '127.0.0.1' } });
  await waitFor(async () => (await fetch(`${apiUrl}/healthz`)).ok, 'API');
  const auth = await bootstrapAdmin();
  spawnProcess(npm, npmArgs(['--workspace', 'apps/web', 'run', 'dev', '--', '--host', '127.0.0.1', '--port', String(webPort)]), { env: { ...process.env, VITE_API_MODE: 'live', VITE_API_BASE_URL: '', VITE_API_PROXY_TARGET: apiUrl } });
  await waitFor(async () => (await fetch(`${webUrl}/accounts`)).ok, 'Vite frontend');
  const chrome = spawnProcess(chromePath, ['--headless=new', '--disable-gpu', '--disable-extensions', '--no-first-run', '--no-default-browser-check', '--remote-allow-origins=*', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${chromeProfile}`, '--window-size=1440,900', 'about:blank']);
  await waitFor(async () => chrome.exitCode === null && (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).ok, 'local Chrome');
  const cdp = await createCdpClient();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable');
  let qrCreateCount = 0;
  cdp.socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    const request = message.method === 'Network.requestWillBeSent' ? message.params?.request : undefined;
    if (request?.method === 'POST' && String(request.url).includes('/api/v1/auth/qr-sessions')) qrCreateCount += 1;
  });
  await cdp.send('Page.navigate', { url: `${webUrl}/accounts` });
  await waitFor(async () => String(await evaluate(cdp, 'document.readyState')) === 'complete', 'unauthenticated accounts page');
  await waitFor(async () => await evaluate(cdp, 'Boolean(document.querySelector(".auth-gate"))'), 'unauthenticated AuthGate');
  const unauthenticatedBusinessPage = await evaluate(cdp, 'Boolean(document.querySelector("[data-accounts-domain]"))');
  if (unauthenticatedBusinessPage) throw new Error('unauthenticated page rendered the accounts business surface');
  for (const pair of auth.cookie.split('; ')) { const [name, ...valueParts] = pair.split('='); await cdp.send('Network.setCookie', { name, value: valueParts.join('='), url: `${webUrl}/` }); }
  await cdp.send('Page.navigate', { url: `${webUrl}/accounts` });
  await waitFor(async () => String(await evaluate(cdp, 'document.readyState')) === 'complete', 'accounts page');
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('添加闲鱼账号'), 'accounts business page');
  qrCreateCount = 0;
  await evaluate(cdp, 'Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.trim() === "添加闲鱼账号")?.click()');
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('扫码登录'), 'login method selector');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await waitFor(async () => await evaluate(cdp, 'Boolean(document.querySelector(".qr-login-code-loading"))'), 'QR creating state');
  const creatingQrLayout = await evaluate(cdp, `(() => {
    const modal = document.querySelector('.account-login-modal')?.getBoundingClientRect();
    const view = document.querySelector('.qr-login-view')?.getBoundingClientRect();
    const status = document.querySelector('.qr-login-status-row')?.getBoundingClientRect();
    const code = document.querySelector('.qr-login-code')?.getBoundingClientRect();
    if (!modal || !view || !status || !code) return null;
    return { modal: { width: modal.width, height: modal.height }, view: { top: view.top, height: view.height }, status: { top: status.top, height: status.height, bottom: status.bottom }, code: { top: code.top, height: code.height, bottom: code.bottom } };
  })()`);
  await captureViewport(cdp, 1440, 900, 'accounts-login-modal-creating-desktop-1440x900.png');
  await captureViewport(cdp, 390, 844, 'accounts-login-modal-creating-mobile-390x844.png');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await waitFor(async () => qrCreateCount >= 1, 'initial QR create request');
  await waitFor(async () => await evaluate(cdp, 'Boolean(document.querySelector(".qr-login-code"))'), 'initial QR session rendered');
  const renderedQrLayout = await evaluate(cdp, `(() => {
    const modal = document.querySelector('.account-login-modal')?.getBoundingClientRect();
    const view = document.querySelector('.qr-login-view')?.getBoundingClientRect();
    const status = document.querySelector('.qr-login-status-row')?.getBoundingClientRect();
    const code = document.querySelector('.qr-login-code')?.getBoundingClientRect();
    if (!modal || !view || !status || !code) return null;
    return { modal: { width: modal.width, height: modal.height }, view: { top: view.top, height: view.height }, status: { top: status.top, height: status.height, bottom: status.bottom }, code: { top: code.top, height: code.height, bottom: code.bottom } };
  })()`);
  if (!creatingQrLayout || !renderedQrLayout) throw new Error('QR layout metrics missing');
  const layoutDelta = Math.max(
    Math.abs(creatingQrLayout.modal.width - renderedQrLayout.modal.width),
    Math.abs(creatingQrLayout.modal.height - renderedQrLayout.modal.height),
    Math.abs(creatingQrLayout.code.top - renderedQrLayout.code.top),
    Math.abs(creatingQrLayout.code.height - renderedQrLayout.code.height),
    Math.abs(creatingQrLayout.code.bottom - renderedQrLayout.code.bottom),
  );
  if (layoutDelta > 1.5) throw new Error(`QR layout shifted between creating and rendered states: ${JSON.stringify({ creatingQrLayout, renderedQrLayout, layoutDelta })}`);
  await new Promise((resolve) => setTimeout(resolve, 500));
  if (qrCreateCount !== 1) throw new Error(`initial QR open issued ${qrCreateCount} create requests`);
  await captureViewport(cdp, 1440, 900, 'accounts-login-modal-desktop-1440x900.png');
  await captureViewport(cdp, 390, 844, 'accounts-login-modal-mobile-390x844.png');
  await cdp.send('Emulation.clearDeviceMetricsOverride');
  const hasLegacyForm = await evaluate(cdp, 'Boolean(document.querySelector(".create-account-form"))');
  if (hasLegacyForm) throw new Error('legacy create-account modal is still mounted');
  const hasFakeQr = await evaluate(cdp, 'document.body.innerText.includes("模拟二维码") || Array.from(document.images).some((image) => image.src.startsWith("data:image/svg+xml"))');
  if (hasFakeQr) throw new Error('fake QR code rendered in browser');
  const cookieMethodClicked = await evaluate(cdp, '(() => { const button = document.querySelector("button[data-login-method=\\"cookie\\"]"); if (!button) return false; button.click(); return true; })()');
  if (!cookieMethodClicked) throw new Error('cookie login method button not found');
  await waitFor(async () => await evaluate(cdp, 'Boolean(document.querySelector(".account-login-form textarea"))'), 'cookie login form');
  await evaluate(cdp, 'const area=document.querySelector(".account-login-form textarea"); if(!area) throw new Error("cookie textarea missing"); const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")?.set; if(!setter) throw new Error("textarea setter missing"); setter.call(area,"unb=real-seller; _m_h5_tk=token_1"); area.dispatchEvent(new Event("input",{bubbles:true})); area.dispatchEvent(new Event("change",{bubbles:true}));');
  await evaluate(cdp, 'Array.from(document.querySelectorAll(".account-login-form button")).find((button) => button.textContent?.includes("验证 Cookie"))?.click()');
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('真实闲鱼昵称'), 'cookie login persisted account');
  await assertText(cdp, '真实店铺备注');
  // Seed one additional account through the isolated E2E API harness so the
  // browser can exercise live search/filter behavior on the paged list.
  const accountListResponse = await fetch(`${apiUrl}/api/v1/accounts`, { headers: { cookie: auth.cookie } });
  if (!accountListResponse.ok) throw new Error(`account list seed failed: ${accountListResponse.status}`);
  const accountListPayload = await accountListResponse.json();
  const primaryAccount = accountListPayload.data?.items?.[0];
  if (!primaryAccount?.id) throw new Error('primary account missing after cookie login');
  const secondaryResponse = await fetch(`${apiUrl}/api/v1/accounts`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: auth.cookie,
      'x-csrf-token': auth.csrf,
      'Idempotency-Key': `chrome-delete-account-${process.pid}`,
    },
    body: JSON.stringify({ platform: 'xianyu', sellerRef: `chrome-delete-${process.pid}`, displayName: 'Chrome Delete Secondary' }),
  });
  if (!secondaryResponse.ok) throw new Error(`secondary account seed failed: ${secondaryResponse.status} ${await secondaryResponse.text()}`);
  const secondaryPayload = await secondaryResponse.json();
  const secondaryAccount = secondaryPayload.data;
  if (!secondaryAccount?.id) throw new Error('secondary account missing after seed');

  await cdp.send('Page.reload', { ignoreCache: true });
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('Chrome Delete Secondary'), 'secondary account row');
  const hasOperationHeader = await evaluate(cdp, 'Array.from(document.querySelectorAll("[role=\\\"columnheader\\\"]")).some((node) => node.textContent?.trim() === "操作")');
  if (!hasOperationHeader) throw new Error('account operation column is missing');
  const hasOperationButtons = await evaluate(cdp, `(() => {
    const row = Array.from(document.querySelectorAll('[role="row"]')).find((candidate) => candidate.textContent?.includes(${JSON.stringify(secondaryAccount.displayName)}));
    if (!row) return false;
    const switchButton = row.querySelector('[data-testid="account-switch"]');
    const deleteButton = row.querySelector('[data-testid="account-delete"]');
    const reauthorizeButton = Array.from(row.querySelectorAll('button')).find((button) => ['扫码授权', '重新授权'].includes(button.textContent?.trim() ?? ''));
    return Boolean(switchButton && deleteButton && reauthorizeButton);
  })()`);
  if (!hasOperationButtons) throw new Error('account operation buttons are missing');
  await evaluate(cdp, '(() => { const input = document.querySelector(".accounts-domain-search input"); if (!input) throw new Error("account search input missing"); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set; if (!setter) throw new Error("input setter missing"); setter.call(input, ' + JSON.stringify(secondaryAccount.displayName) + '); input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true })); })()');
  await waitFor(async () => await evaluate(cdp, '(() => { const rows = Array.from(document.querySelectorAll("[role=\\\"row\\\"]")); return rows.some((row) => row.textContent?.includes(' + JSON.stringify(secondaryAccount.displayName) + ')) && !rows.some((row) => row.textContent?.includes(' + JSON.stringify(primaryAccount.displayName ?? '') + ')); })()'), 'account search result');

  const switched = await evaluate(cdp, `(() => {
    const row = Array.from(document.querySelectorAll('[role="row"]')).find((candidate) => candidate.textContent?.includes(${JSON.stringify(secondaryAccount.displayName)}));
    const button = row?.querySelector('[data-testid="account-switch"]');
    if (!button || button.disabled) return false;
    button.click();
    return true;
  })()`);
  if (!switched) throw new Error('account switch action did not trigger');
  await waitFor(async () => await evaluate(cdp, `(() => {
    const row = Array.from(document.querySelectorAll('[role="row"]')).find((candidate) => candidate.textContent?.includes(${JSON.stringify(secondaryAccount.displayName)}));
    return row?.querySelector('[data-testid="account-switch"]')?.textContent?.trim() === '当前账号';
  })()`), 'account switch result');

  mkdirSync(screenshotDir, { recursive: true });
  await captureViewport(cdp, 1440, 900, 'accounts-desktop-1440x900.png');
  await captureViewport(cdp, 390, 844, 'accounts-mobile-390x844.png');
  await cdp.send('Emulation.clearDeviceMetricsOverride');

  const deletedViaUi = await evaluate(cdp, `(() => {
    const row = Array.from(document.querySelectorAll('[role="row"]')).find((candidate) => candidate.textContent?.includes(${JSON.stringify(secondaryAccount.displayName)}));
    const button = row?.querySelector('[data-testid="account-delete"]');
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!deletedViaUi) throw new Error('account delete action did not trigger');
  await waitFor(async () => await evaluate(cdp, 'Boolean(document.querySelector("[role=\\"dialog\\"] [data-testid=\\"account-delete-confirm\\"]"))'), 'account delete confirmation modal');
  await captureViewport(cdp, 1440, 900, 'accounts-delete-modal-desktop-1440x900.png');
  await captureViewport(cdp, 390, 844, 'accounts-delete-modal-mobile-390x844.png');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  const confirmedDelete = await evaluate(cdp, '(() => { const button = document.querySelector("[data-testid=\\"account-delete-confirm\\"]"); if (!button) return false; button.click(); return true; })()');
  if (!confirmedDelete) throw new Error('account delete confirmation did not trigger');
  await waitFor(async () => !(await evaluate(cdp, `document.body.innerText.includes(${JSON.stringify(secondaryAccount.displayName)})`)), 'account delete result');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  const accountMenuOpened = await evaluate(cdp, `(() => {
    const visible = (node) => { const rect = node.getBoundingClientRect(); return rect.width > 0 && rect.height > 0; };
    const trigger = Array.from(document.querySelectorAll('[data-testid="account-menu-trigger"]')).find(visible);
    if (!trigger) return false;
    trigger.click();
    return true;
  })()`);
  if (!accountMenuOpened) throw new Error('account menu trigger is not visible');
  await waitFor(async () => await evaluate(cdp, `(() => {
    const visible = (node) => { const rect = node.getBoundingClientRect(); return rect.width > 0 && rect.height > 0; };
    return Array.from(document.querySelectorAll('[data-testid="account-logout"]')).some(visible);
  })()`), 'account menu');
  const logoutClicked = await evaluate(cdp, `(() => {
    const visible = (node) => { const rect = node.getBoundingClientRect(); return rect.width > 0 && rect.height > 0; };
    const button = Array.from(document.querySelectorAll('[data-testid="account-logout"]')).find(visible);
    if (!button || button.disabled) return false;
    button.click();
    return true;
  })()`);
  if (!logoutClicked) throw new Error('account menu logout action did not trigger');
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('登录管理控制台'), 'login gate after logout');
  const sessionAfterLogout = await evaluate(cdp, 'fetch("/api/v1/auth/session", { credentials: "include" }).then((response) => response.json())');
  const sessionView = sessionAfterLogout?.data ?? sessionAfterLogout;
  if (sessionView?.authenticated !== false) throw new Error(`logout did not clear the authenticated session: ${JSON.stringify(sessionAfterLogout)}`);
  console.log('local Chrome E2E passed: login -> persisted profile -> account search -> switch -> delete -> logout');
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
