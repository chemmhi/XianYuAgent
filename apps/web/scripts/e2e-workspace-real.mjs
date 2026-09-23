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
const workspaceE2eRuntime = (process.env.WORKSPACE_E2E_RUNTIME ?? 'in-process').trim().toLowerCase();
if (!['in-process', 'pi'].includes(workspaceE2eRuntime)) throw new Error('WORKSPACE_E2E_RUNTIME must be in-process or pi');
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
  // Invoke the platform npm shim directly so child workspace scripts receive
  // the local node_modules/.bin PATH (important when this script runs under npm).
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const npmArgs = (args) => args;

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
      AGENT_RUNTIME: workspaceE2eRuntime,
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
  // WorkspacePage intentionally keeps the account context in the shared
  // AccountContext provider instead of duplicating the display name in the
  // conversation surface. Assert the authenticated workspace shell is live
  // and that the "请先选择账号" guard is gone, rather than coupling this
  // E2E to a non-user-visible account label.
  await waitFor(async () => await evaluate(cdp, `(() => {
    const shell = document.querySelector('[data-workspace-domain]');
    const missing = Array.from(document.querySelectorAll('.workspace-state strong')).some((node) => node.textContent?.includes('请先选择账号'));
    const error = document.querySelector('.workspace-inline-error');
    return Boolean(shell && !missing && !error);
  })()`), 'account context');

  const beforeSession = await evaluate(cdp, 'document.querySelectorAll(".workspace-session-row").length');
  if (beforeSession !== 0) throw new Error(`expected empty workspace session list, got ${beforeSession}`);
  await evaluate(cdp, 'document.querySelector(".workspace-sessions-panel .workspace-panel-head button")?.click()');
  await waitFor(async () => String(await evaluate(cdp, 'document.querySelector(".workspace-thread h2")?.textContent ?? ""')).includes('新会话'), 'new conversation draft');
  const titleForm = await evaluate(cdp, 'Boolean(document.querySelector("#workspace-session-title"))');
  if (titleForm) throw new Error('new Workspace flow unexpectedly requires a manual title');

  await cdp.send('Network.setBlockedURLs', { urls: ['*api/v1/workspace/runs/*/events*'] });
  await evaluate(cdp, `window.__workspaceRunSockets = []; (() => { const Original = window.WebSocket; window.WebSocket = class extends Original { constructor(...args) { super(...args); window.__workspaceRunSockets.push(this); } }; })()`);
  await evaluate(cdp, `(() => { const area = document.querySelector('.workspace-composer textarea'); const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set; setter?.call(area, '检查当前 Workspace 状态并返回摘要'); area.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await evaluate(cdp, 'new Promise((resolve) => setTimeout(resolve, 50))');
  await evaluate(cdp, 'document.querySelector(".workspace-composer")?.requestSubmit()');
  await waitFor(async () => Boolean(await evaluate(cdp, 'Boolean(document.querySelector(".workspace-thread .workspace-reconnect-button"))')), 'reconnect state after blocked event stream', 10_000);
  const sessionCount = await evaluate(cdp, 'document.querySelectorAll(".workspace-session-row").length');
  if (sessionCount !== 1) throw new Error(`expected one session after first message, got ${sessionCount}`);
  const derivedTitle = await evaluate(cdp, 'document.querySelector(".workspace-session-title")?.textContent ?? ""');
  if (!String(derivedTitle).includes('检查当前 Workspace 状态并返回摘要')) throw new Error(`session title was not derived from first message: ${derivedTitle}`);
  const blockedBanner = await evaluate(cdp, 'document.querySelector(".workspace-thread-header")?.innerText ?? ""');
  await cdp.send('Network.setBlockedURLs', { urls: [] });
  await evaluate(cdp, 'document.querySelector(".workspace-thread .workspace-reconnect-button")?.click()');
  await waitFor(async () => Boolean(await evaluate(cdp, 'Boolean(document.querySelector(".workspace-message-final"))')), 'successful Run result after reconnect', 15_000);
  const messageTypes = await evaluate(cdp, '({ user: document.querySelectorAll(".workspace-message-user").length, reasoning: document.querySelectorAll(".workspace-agent-trace").length, toolGroup: document.querySelectorAll(".workspace-agent-trace").length, tool: document.querySelectorAll(".workspace-trace-row").length, final: document.querySelectorAll(".workspace-message-final").length })');
  if (messageTypes.user < 1 || messageTypes.reasoning < 1 || messageTypes.toolGroup < 1 || messageTypes.final < 1) throw new Error(`workspace message stream missing canonical types: ${JSON.stringify(messageTypes)}`);
  await evaluate(cdp, 'document.querySelector(".workspace-trace-toggle")?.click()');
  await waitFor(async () => Number(await evaluate(cdp, 'document.querySelectorAll(".workspace-trace-row").length')) >= 2, 'expanded tool event group');
  const errorNodes = await evaluate(cdp, 'Array.from(document.querySelectorAll(".workspace-inline-error")).map((node) => ({ text: node.textContent, html: node.outerHTML }))');
  const socketStates = await evaluate(cdp, 'Array.from(window.__workspaceRunSockets ?? []).map((socket) => socket.readyState)');
  await waitFor(async () => Number(await evaluate(cdp, 'document.querySelectorAll(".workspace-trace-row").length')) >= 2, 'event replay in message stream');
  const eventRows = await evaluate(cdp, 'Array.from(document.querySelectorAll(".workspace-trace-row small")).map((node) => node.textContent?.trim()).filter(Boolean)');
  const eventSummary = await evaluate(cdp, 'Array.from(document.querySelectorAll(".workspace-trace-details")).map((node) => node.innerText).join(" | ")');
  const wsHandshakes = cdp.events.filter((event) => event.method === 'Network.webSocketHandshakeResponseReceived').length;
  const workspaceNetwork = cdp.events.filter((event) => {
    const request = event.params?.request;
    const url = request?.url ?? event.params?.url ?? '';
    return String(url).includes('/api/v1/workspace/');
  }).map((event) => ({ method: event.method, request: event.params?.request?.method, url: event.params?.request?.url ?? event.params?.url, error: event.params?.errorText, blocked: event.params?.blockedReason }));
  if (!eventRows.some((value) => String(value).includes('run.started'))) throw new Error(`run.started missing from expanded UI tool events: ${JSON.stringify(eventRows)}`);
  if (wsHandshakes < 1) throw new Error('no WebSocket handshake observed in Chrome CDP');

  const runId = [...new Set(workspaceNetwork.map((item) => String(item.url ?? '').match(/\/api\/v1\/workspace\/runs\/([^/?#]+)/)?.[1]).filter(Boolean))][0];
  if (!runId) throw new Error(`workspace run id missing from network trace: ${JSON.stringify(workspaceNetwork)}`);
  const runReadback = await fetch(`${apiUrl}/api/v1/workspace/runs/${encodeURIComponent(runId)}`, { headers: { cookie } });
  if (!runReadback.ok) throw new Error(`run persistence readback failed: ${runReadback.status}`);
  const runPayload = await runReadback.json();
  if (runPayload.data?.status !== 'succeeded') throw new Error(`run persistence readback did not succeed: ${JSON.stringify(runPayload.data)}`);
  const runEventsReadback = await fetch(`${apiUrl}/api/v1/workspace/runs/${encodeURIComponent(runId)}/events?after=0`, { headers: { cookie } });
  if (!runEventsReadback.ok) throw new Error(`run event readback failed: ${runEventsReadback.status}`);
  const runEventsPayload = await runEventsReadback.json();
  if (!(runEventsPayload.data?.items ?? []).some((event) => event.eventType === 'run.succeeded')) throw new Error(`run.succeeded missing from persisted events: ${JSON.stringify(runEventsPayload.data?.items ?? [])}`);

  const desktopPath = await captureViewport(cdp, 1440, 900, 'workspace-desktop-1440x900.png');
  const mobilePath = await captureViewport(cdp, 390, 844, 'workspace-mobile-390x844.png');
  await cdp.send('Emulation.clearDeviceMetricsOverride');

  const sessionReadback = await fetch(`${apiUrl}/api/v1/workspace/agent-sessions?accountId=${encodeURIComponent(accountId)}`, { headers: { cookie } });
  if (!sessionReadback.ok) throw new Error(`session persistence readback failed: ${sessionReadback.status}`);
  const sessionPayload = await sessionReadback.json();
  const session = sessionPayload.data?.items?.find((item) => String(item.title).includes('检查当前 Workspace 状态并返回摘要'));
  if (!session?.id) throw new Error('session persistence readback missing created session');

  const browserState = await evaluate(cdp, '({ href: location.href, sessionCount: document.querySelectorAll(".workspace-session-row").length, runStatus: document.querySelector(".workspace-thread .workspace-status")?.textContent ?? "", result: document.querySelector(".workspace-message-final")?.innerText ?? "", messageTypes: { user: document.querySelectorAll(".workspace-message-user").length, trace: document.querySelectorAll(".workspace-agent-trace").length, tool: document.querySelectorAll(".workspace-trace-row").length, final: document.querySelectorAll(".workspace-message-final").length }, eventSummary: Array.from(document.querySelectorAll(".workspace-trace-details")).map((node) => node.innerText).join(" | ") })');
  console.log(JSON.stringify({
    apiStorage: 'postgres', runtime: workspaceE2eRuntime, accountId, sessionId: session.id, runId, sessionPersisted: true, runPersisted: true,
    browserState, blockedBanner, errorNodes, socketStates, messageTypes, eventRows, eventSummary, wsHandshakes, workspaceNetwork,
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
