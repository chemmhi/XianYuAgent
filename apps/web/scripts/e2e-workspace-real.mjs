import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';

const root = join(import.meta.dirname, '..', '..', '..');
const artifactDir = join(root, 'artifacts', 'real-verify', 'S4-VS6A');
const screenshotDir = join(artifactDir, 'screenshots');
const chromeProfile = join(tmpdir(), `xianyu-agent-workspace-real-${process.pid}`);
const chromePath = process.env.CHROME_PATH ?? join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe');
const children = [];
let testDatabaseName;

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
  const child = spawn(command, args, {
    cwd: root,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    shell: command.endsWith('.cmd'),
    ...options,
  });
  child.stdout.on('data', (chunk) => process.stdout.write(`[workspace-real:${command}] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[workspace-real:${command}] ${chunk}`));
  children.push(child);
  return child;
}

async function waitFor(check, label, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const result = await check();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${label} did not become ready${lastError ? `: ${lastError.message}` : ''}`);
}

function cookiesFrom(response) {
  return (response.headers.getSetCookie?.() ?? []).map((value) => value.split(';', 1)[0]).join('; ');
}

function csrfFrom(cookie) {
  return decodeURIComponent(cookie.match(/(?:^|; )csrf_token=([^;]+)/)?.[1] ?? '');
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
    if (message.error) entry.reject(new Error(`${entry.method}: ${message.error.message}`));
    else entry.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject, method });
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
  const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  mkdirSync(screenshotDir, { recursive: true });
  const destination = join(screenshotDir, filename);
  writeFileSync(destination, Buffer.from(screenshot.data, 'base64'));
  return destination;
}

async function run() {
  mkdirSync(chromeProfile, { recursive: true });
  const apiPort = await freePort();
  const webPort = await freePort();
  const debugPort = await freePort();
  const apiUrl = `http://127.0.0.1:${apiPort}`;
  const webUrl = `http://127.0.0.1:${webPort}`;
  const npm = process.env.npm_execpath ? process.execPath : (process.platform === 'win32' ? 'npm.cmd' : 'npm');
  const npmArgs = (args) => process.env.npm_execpath ? [process.env.npm_execpath, ...args] : args;

  testDatabaseName = `xianyu_workspace_real_${process.pid}_${Date.now()}`.replace(/[^a-z0-9_]/gi, '_');
  const adminPool = new pg.Pool({ connectionString: 'postgres://xianyu:xianyu_dev_only@127.0.0.1:5432/postgres' });
  await adminPool.query(`CREATE DATABASE "${testDatabaseName}"`);
  await adminPool.end();
  const databaseUrl = `postgres://xianyu:xianyu_dev_only@127.0.0.1:5432/${testDatabaseName}`;
  const migrate = spawnProcess(npm, npmArgs(['--workspace', 'apps/api', 'run', 'migrate']), { env: { ...process.env, DATABASE_URL: databaseUrl } });
  const migrateExit = await new Promise((resolve) => migrate.once('exit', resolve));
  if (migrateExit !== 0) throw new Error(`migration failed with ${migrateExit}`);

  const apiBuild = spawnProcess(npm, npmArgs(['--workspace', 'apps/api', 'run', 'build']));
  const buildExit = await new Promise((resolve) => apiBuild.once('exit', resolve));
  if (buildExit !== 0) throw new Error(`API build failed with ${buildExit}`);

  const api = spawnProcess(process.execPath, ['apps/api/dist/index.js'], {
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(apiPort),
      DATABASE_URL: databaseUrl,
      REDIS_URL: 'redis://127.0.0.1:6379',
      ALLOW_IN_MEMORY: 'false',
      COOKIE_SECURE: 'false',
      XIANYU_QR_MODE: 'stub',
    },
  });
  await waitFor(async () => (await fetch(`${apiUrl}/healthz`)).ok, 'Postgres-backed API');
  const suffix = `${Date.now()}-${process.pid}`;
  const bootstrap = await fetch(`${apiUrl}/api/v1/auth/bootstrap`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'Idempotency-Key': `workspace-real-bootstrap-${suffix}` },
    body: JSON.stringify({ email: `workspace-real-${suffix}@example.com`, password: 'password-123', displayName: 'Workspace Real E2E' }),
  });
  if (!bootstrap.ok) throw new Error(`bootstrap failed: ${bootstrap.status} ${await bootstrap.text()}`);
  const cookie = cookiesFrom(bootstrap);
  const csrf = csrfFrom(cookie);
  if (!cookie || !csrf) throw new Error('bootstrap did not return session/csrf cookies');

  const accountResponse = await fetch(`${apiUrl}/api/v1/accounts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie, 'x-csrf-token': csrf, 'Idempotency-Key': `workspace-real-account-${suffix}` },
    body: JSON.stringify({ platform: 'xianyu', sellerRef: `workspace-real-${suffix}`, displayName: 'Workspace Real Account' }),
  });
  if (!accountResponse.ok) throw new Error(`account seed failed: ${accountResponse.status} ${await accountResponse.text()}`);
  const accountPayload = await accountResponse.json();
  const accountId = accountPayload.data?.id;
  if (!accountId) throw new Error('account seed did not return account id');

  const web = spawnProcess(npm, npmArgs(['--workspace', 'apps/web', 'run', 'dev', '--', '--host', '127.0.0.1', '--port', String(webPort)]), {
    env: { ...process.env, VITE_API_MODE: 'live', VITE_API_BASE_URL: '', VITE_API_PROXY_TARGET: apiUrl },
  });
  await waitFor(async () => (await fetch(`${webUrl}/workspace`)).ok, 'Vite frontend');
  const chrome = spawnProcess(chromePath, [
    '--headless=new', '--disable-gpu', '--disable-extensions', '--no-first-run', '--no-default-browser-check',
    '--remote-allow-origins=*', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${chromeProfile}`,
    '--window-size=1440,900', 'about:blank',
  ]);
  await waitFor(async () => chrome.exitCode === null && (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).ok, 'local Chrome');
  const cdp = await createCdpClient(debugPort);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable');
  for (const pair of cookie.split('; ')) {
    const [name, ...valueParts] = pair.split('=');
    await cdp.send('Network.setCookie', { name, value: valueParts.join('='), url: `${webUrl}/` });
  }
  await cdp.send('Page.navigate', { url: `${webUrl}/workspace` });
  await waitFor(async () => String(await evaluate(cdp, 'document.readyState')) === 'complete', 'workspace route');
  await waitFor(async () => Boolean(await evaluate(cdp, 'Boolean(document.querySelector("[data-workspace-domain]"))')), 'authenticated Workspace surface');
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('Workspace Real Account'), 'account context');

  const beforeSession = await evaluate(cdp, 'document.querySelectorAll(".workspace-session-row").length');
  if (beforeSession !== 0) throw new Error(`expected empty workspace session list, got ${beforeSession}`);
  await evaluate(cdp, 'document.querySelector(".workspace-sessions-panel .workspace-panel-head button")?.click()');
  await waitFor(async () => Boolean(await evaluate(cdp, 'Boolean(document.querySelector("#workspace-session-title"))')), 'session create form');
  await evaluate(cdp, `(() => { const input = document.querySelector('#workspace-session-title'); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set; setter?.call(input, '真实验证会话'); input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await evaluate(cdp, 'document.querySelector(".workspace-create-form button[type=submit]")?.click()');
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('真实验证会话'), 'created Workspace session');
  const sessionCount = await evaluate(cdp, 'document.querySelectorAll(".workspace-session-row").length');
  if (sessionCount !== 1) throw new Error(`expected one session after create, got ${sessionCount}`);

  await cdp.send('Network.setBlockedURLs', { urls: ['*api/v1/workspace/runs/*/events*'] });
  await evaluate(cdp, `window.__workspaceRunSockets = []; (() => { const Original = window.WebSocket; window.WebSocket = class extends Original { constructor(...args) { super(...args); window.__workspaceRunSockets.push(this); } }; })()`);
  await evaluate(cdp, `(() => { const area = document.querySelector('.workspace-composer textarea'); const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set; setter?.call(area, '检查当前 Workspace 状态并返回摘要'); area.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await evaluate(cdp, 'document.querySelector(".workspace-composer button[type=submit]")?.click()');
  await waitFor(async () => Boolean(await evaluate(cdp, 'Boolean(document.querySelector(".workspace-run-panel .workspace-realtime-banner .btn.ghost"))')), 'reconnect state after blocked event stream', 10_000);
  const blockedBanner = await evaluate(cdp, 'document.querySelector(".workspace-realtime-banner")?.innerText ?? ""');
  await cdp.send('Network.setBlockedURLs', { urls: [] });
  await evaluate(cdp, 'document.querySelector(".workspace-run-panel .workspace-realtime-banner .btn.ghost")?.click()');
  await waitFor(async () => Boolean(await evaluate(cdp, 'Boolean(document.querySelector(".workspace-result-ok"))')), 'successful Run result after reconnect', 15_000);
  const errorNodes = await evaluate(cdp, 'Array.from(document.querySelectorAll(".workspace-inline-error")).map((node) => ({ text: node.textContent, html: node.outerHTML }))');
  const socketStates = await evaluate(cdp, 'Array.from(window.__workspaceRunSockets ?? []).map((socket) => socket.readyState)');

  await evaluate(cdp, 'document.querySelector(".workspace-events summary")?.click()');
  await waitFor(async () => Number(await evaluate(cdp, 'document.querySelectorAll(".workspace-event-row").length')) >= 2, 'event replay in timeline');
  const eventRows = await evaluate(cdp, 'Array.from(document.querySelectorAll(".workspace-event-row strong")).map((node) => node.textContent?.trim()).filter(Boolean)');
  const eventSummary = await evaluate(cdp, 'document.querySelector(".workspace-events summary")?.textContent ?? ""');
  const wsHandshakes = cdp.events.filter((event) => event.method === 'Network.webSocketHandshakeResponseReceived').length;
  const workspaceNetwork = cdp.events.filter((event) => {
    const request = event.params?.request;
    const url = request?.url ?? event.params?.url ?? '';
    return String(url).includes('/api/v1/workspace/');
  }).map((event) => ({ method: event.method, request: event.params?.request?.method, url: event.params?.request?.url ?? event.params?.url, error: event.params?.errorText, blocked: event.params?.blockedReason }));
  if (!eventRows.some((value) => String(value).includes('run.succeeded'))) throw new Error(`run.succeeded missing from UI events: ${JSON.stringify(eventRows)}`);
  if (wsHandshakes < 1) throw new Error('no WebSocket handshake observed in Chrome CDP');

  const desktopPath = await captureViewport(cdp, 1440, 900, 'workspace-desktop-1440x900.png');
  const mobilePath = await captureViewport(cdp, 390, 844, 'workspace-mobile-390x844.png');
  await cdp.send('Emulation.clearDeviceMetricsOverride');

  const sessionReadback = await fetch(`${apiUrl}/api/v1/workspace/agent-sessions?accountId=${encodeURIComponent(accountId)}`, { headers: { cookie } });
  if (!sessionReadback.ok) throw new Error(`session persistence readback failed: ${sessionReadback.status}`);
  const sessionPayload = await sessionReadback.json();
  const session = sessionPayload.data?.items?.find((item) => item.title === '真实验证会话');
  if (!session?.id) throw new Error('session persistence readback missing created session');

  const browserState = await evaluate(cdp, '({ href: location.href, sessionCount: document.querySelectorAll(".workspace-session-row").length, runStatus: document.querySelector(".workspace-run-panel .workspace-status")?.textContent ?? "", result: document.querySelector(".workspace-result-ok")?.innerText ?? "", eventSummary: document.querySelector(".workspace-events summary")?.textContent ?? "" })');
  console.log(JSON.stringify({
    apiStorage: 'postgres', accountId, sessionId: session.id, sessionPersisted: true,
    browserState, blockedBanner, errorNodes, socketStates, eventRows, eventSummary, wsHandshakes, workspaceNetwork,
    screenshots: { desktopPath, mobilePath },
  }, null, 2));
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
  try { rmSync(chromeProfile, { recursive: true, force: true }); } catch (error) { console.warn(`Chrome temporary profile cleanup failed: ${error.message}`); }
  if (testDatabaseName) {
    try {
      const cleanupPool = new pg.Pool({ connectionString: 'postgres://xianyu:xianyu_dev_only@127.0.0.1:5432/postgres' });
      await cleanupPool.query(`DROP DATABASE IF EXISTS "${testDatabaseName}" WITH (FORCE)`);
      await cleanupPool.end();
    } catch (error) {
      console.warn(`temporary database cleanup failed: ${error.message}`);
    }
  }
}
