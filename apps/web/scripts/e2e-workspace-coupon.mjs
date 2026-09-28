import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { randomUUID } from 'node:crypto';

const root = join(import.meta.dirname, '..', '..', '..');
const artifactDir = join(root, 'artifacts', 'real-verify', 'S4-VS-WS-VS-03');
const screenshotDir = join(artifactDir, 'screenshots');
const chromeProfile = join(tmpdir(), `xianyu-agent-workspace-coupon-${process.pid}`);
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
  const child = spawn(command, args, { cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, shell: command.endsWith('.cmd'), ...options });
  child.stdout.on('data', (chunk) => process.stdout.write(`[workspace-coupon:${command}] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[workspace-coupon:${command}] ${chunk}`));
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
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

  testDatabaseName = `xianyu_workspace_coupon_e2e_${process.pid}_${Date.now()}`.replace(/[^a-z0-9_]/gi, '_');
  const adminPool = new pg.Pool({ connectionString: 'postgres://xianyu:xianyu_dev_only@127.0.0.1:5432/postgres' });
  await adminPool.query(`CREATE DATABASE "${testDatabaseName}"`);
  await adminPool.end();
  const databaseUrl = `postgres://xianyu:xianyu_dev_only@127.0.0.1:5432/${testDatabaseName}`;

  const migrate = spawnProcess(npm, ['--workspace', 'apps/api', 'run', 'migrate'], { env: { ...process.env, DATABASE_URL: databaseUrl } });
  const migrateExit = await new Promise((resolve) => migrate.once('exit', resolve));
  if (migrateExit !== 0) throw new Error(`migration failed with ${migrateExit}`);
  const apiBuild = spawnProcess(npm, ['--workspace', 'apps/api', 'run', 'build']);
  const buildExit = await new Promise((resolve) => apiBuild.once('exit', resolve));
  if (buildExit !== 0) throw new Error(`API build failed with ${buildExit}`);

  const api = spawnProcess(process.execPath, ['apps/api/dist/index.js'], { env: { ...process.env, HOST: '127.0.0.1', PORT: String(apiPort), DATABASE_URL: databaseUrl, REDIS_URL: '', ALLOW_IN_MEMORY: 'false', COOKIE_SECURE: 'false', XIANYU_QR_MODE: 'stub', AGENT_RUNTIME: 'in-process' } });
  await waitFor(async () => (await fetch(`${apiUrl}/healthz`)).ok, 'Postgres-backed API');
  const suffix = `${Date.now()}-${process.pid}`;
  const bootstrap = await fetch(`${apiUrl}/api/v1/auth/bootstrap`, { method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': `workspace-coupon-e2e-bootstrap-${suffix}` }, body: JSON.stringify({ email: `workspace-coupon-e2e-${suffix}@example.com`, password: 'password-123', displayName: 'Workspace Coupon E2E' }) });
  if (!bootstrap.ok) throw new Error(`bootstrap failed: ${bootstrap.status} ${await bootstrap.text()}`);
  const cookie = cookiesFrom(bootstrap);
  const csrf = csrfFrom(cookie);
  const accountResponse = await fetch(`${apiUrl}/api/v1/accounts`, { method: 'POST', headers: { 'content-type': 'application/json', cookie, 'x-csrf-token': csrf, 'Idempotency-Key': `workspace-coupon-e2e-account-${suffix}` }, body: JSON.stringify({ platform: 'xianyu', sellerRef: `workspace-coupon-e2e-${suffix}`, displayName: 'Workspace Coupon 账号' }) });
  if (!accountResponse.ok) throw new Error(`account seed failed: ${accountResponse.status} ${await accountResponse.text()}`);
  const accountPayload = await accountResponse.json();
  const accountId = accountPayload.data?.id;
  if (!accountId) throw new Error('account seed did not return account id');
  const sessionPayload = await (await fetch(`${apiUrl}/api/v1/auth/session`, { headers: { cookie } })).json();
  const adminId = sessionPayload.data?.admin?.id;
  if (!adminId) throw new Error('admin session readback failed');

  const couponSecret = `E2E-COUPON-SECRET-${suffix}`;
  const couponInstruction = `新增卡券；名称：E2E 会员卡券；类型：固定文字；内容：${couponSecret}`;

  const web = spawnProcess(npm, ['--workspace', 'apps/web', 'run', 'dev', '--', '--host', '127.0.0.1', '--port', String(webPort)], { env: { ...process.env, VITE_API_MODE: 'live', VITE_API_BASE_URL: '', VITE_API_PROXY_TARGET: apiUrl } });
  await waitFor(async () => (await fetch(`${webUrl}/workspace`)).ok, 'Vite frontend');
  const chrome = spawnProcess(chromePath, ['--headless=new', '--disable-gpu', '--disable-extensions', '--no-first-run', '--no-default-browser-check', '--remote-allow-origins=*', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${chromeProfile}`, '--window-size=1440,900', 'about:blank']);
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
  await waitFor(async () => await evaluate(cdp, '(() => Boolean(document.querySelector("[data-workspace-domain]")))()'), 'authenticated Workspace surface');
  await waitFor(async () => await evaluate(cdp, `(() => {
    const shell = document.querySelector('[data-workspace-domain]');
    const missing = Array.from(document.querySelectorAll('.workspace-state strong')).some((node) => node.textContent?.includes('请先选择账号'));
    const error = document.querySelector('.workspace-inline-error');
    return Boolean(shell && !missing && !error);
  })()`), 'account context');

  await evaluate(cdp, 'document.querySelector(".workspace-sessions-panel .workspace-panel-head button")?.click()');
  await waitFor(async () => String(await evaluate(cdp, 'document.querySelector(".workspace-thread h2")?.textContent ?? ""')).includes('新会话'), 'new conversation draft');

  async function submitCoupon() {
    await evaluate(cdp, `(() => { const area = document.querySelector('.workspace-composer textarea'); const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set; setter?.call(area, ${JSON.stringify(couponInstruction)}); area.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await evaluate(cdp, 'new Promise((resolve) => setTimeout(resolve, 50))');
    await evaluate(cdp, 'document.querySelector(".workspace-composer")?.requestSubmit()');
    await waitFor(async () => await evaluate(cdp, '(() => Boolean(document.querySelector("[data-testid=workspace-confirmation-card]")))()'), 'confirmation card', 15_000);
    const cardText = String(await evaluate(cdp, 'document.querySelector("[data-testid=workspace-confirmation-card]")?.innerText ?? ""'));
    if (!cardText.includes('E2E 会员卡券')) throw new Error(`confirmation card missing coupon title: ${cardText}`);
    if (!cardText.includes('coupon.create.confirm')) throw new Error(`confirmation card missing policy reference: ${cardText}`);
    if (cardText.includes(couponSecret) || cardText.includes('cookie') || cardText.includes('Credential') || cardText.includes('secret')) throw new Error(`confirmation card leaked sensitive data: ${cardText}`);
    return cardText;
  }

  const firstCard = await submitCoupon();
  const desktopPath = await captureViewport(cdp, 1440, 900, 'workspace-coupon-desktop-1440x900.png');
  await evaluate(cdp, 'document.querySelector("[data-testid=workspace-confirm-continue]")?.click()');
  await waitFor(async () => String(await evaluate(cdp, 'document.querySelector(".workspace-status")?.textContent ?? ""')).includes('已完成'), 'confirmed succeeded state');
  await waitFor(async () => await evaluate(cdp, '(() => Boolean(document.querySelector("[data-testid=workspace-outbox-panel]")))()'), 'outbox panel');
  const firstPanel = String(await evaluate(cdp, 'document.querySelector("[data-testid=workspace-outbox-panel]")?.innerText ?? ""'));
  if (!firstPanel.includes('已完成')) throw new Error(`outbox panel missing succeeded state: ${firstPanel}`);

  const sessionItems = async () => (await (await fetch(`${apiUrl}/api/v1/workspace/agent-sessions?accountId=${encodeURIComponent(accountId)}`, { headers: { cookie } })).json()).data?.items ?? [];
  const activeSession = (await sessionItems())[0];
  if (!activeSession?.id) throw new Error('workspace session persistence missing');
  const messagesAfterConfirm = await (await fetch(`${apiUrl}/api/v1/workspace/agent-sessions/${encodeURIComponent(activeSession.id)}/messages`, { headers: { cookie } })).json();
  const firstRunId = [...(messagesAfterConfirm.data?.items ?? [])].reverse().find((message) => message.type === 'user_message')?.runId;
  if (!firstRunId) throw new Error('confirmed run id missing from persisted messages');
  const firstConfirmation = await (await fetch(`${apiUrl}/api/v1/workspace/runs/${encodeURIComponent(firstRunId)}/confirmation`, { headers: { cookie } })).json();
  if (firstConfirmation.data?.status !== 'confirmed') throw new Error(`confirmation persistence mismatch: ${JSON.stringify(firstConfirmation.data)}`);
  const firstOutbox = await (await fetch(`${apiUrl}/api/v1/execution/outbox?runId=${encodeURIComponent(firstRunId)}`, { headers: { cookie } })).json();
  if (firstOutbox.data?.items?.[0]?.status !== 'succeeded') throw new Error(`outbox persistence mismatch: ${JSON.stringify(firstOutbox.data)}`);
  const firstRun = await (await fetch(`${apiUrl}/api/v1/workspace/runs/${encodeURIComponent(firstRunId)}`, { headers: { cookie } })).json();
  if (firstRun.data?.status !== 'succeeded') throw new Error(`run persistence mismatch: ${JSON.stringify(firstRun.data)}`);

  const secondCardPromise = submitCoupon();
  await secondCardPromise;
  const mobilePath = await captureViewport(cdp, 390, 844, 'workspace-coupon-mobile-390x844.png');
  await evaluate(cdp, 'document.querySelector("[data-testid=workspace-confirm-cancel]")?.click()');
  await waitFor(async () => String(await evaluate(cdp, 'document.querySelector(".workspace-status")?.textContent ?? ""')).includes('已取消'), 'cancelled state');
  const cancelledRows = await (await fetch(`${apiUrl}/api/v1/workspace/agent-sessions/${encodeURIComponent(activeSession.id)}/messages`, { headers: { cookie } })).json();
  const secondRunId = [...(cancelledRows.data?.items ?? [])].reverse().find((message) => message.type === 'user_message' && message.runId !== firstRunId)?.runId;
  if (!secondRunId) throw new Error('cancelled run id missing from persisted messages');
  const secondConfirmation = await (await fetch(`${apiUrl}/api/v1/workspace/runs/${encodeURIComponent(secondRunId)}/confirmation`, { headers: { cookie } })).json();
  if (secondConfirmation.data?.status !== 'cancelled') throw new Error(`cancel persistence mismatch: ${JSON.stringify(secondConfirmation.data)}`);
  const secondOutbox = await (await fetch(`${apiUrl}/api/v1/execution/outbox?runId=${encodeURIComponent(secondRunId)}`, { headers: { cookie } })).json();
  if ((secondOutbox.data?.items ?? []).length !== 0) throw new Error(`cancelled run unexpectedly enqueued outbox: ${JSON.stringify(secondOutbox.data)}`);

  const browserState = await evaluate(cdp, '({ href: location.href, confirmationCards: document.querySelectorAll("[data-testid=workspace-confirmation-card]").length, outboxPanels: document.querySelectorAll("[data-testid=workspace-outbox-panel]").length, status: document.querySelector(".workspace-status")?.textContent ?? "", sessionCount: document.querySelectorAll(".workspace-session-row").length })');
  const couponRows = await (await fetch(`${apiUrl}/api/v1/coupons/batches?accountId=${encodeURIComponent(accountId)}`, { headers: { cookie } })).json();
  if (couponRows.data?.items?.[0]?.label !== 'E2E 会员卡券') throw new Error(`coupon persistence mismatch: ${JSON.stringify(couponRows.data)}`);
  const persistedMessages = await (await fetch(`${apiUrl}/api/v1/workspace/agent-sessions/${encodeURIComponent(activeSession.id)}/messages`, { headers: { cookie } })).json();
  if (JSON.stringify(persistedMessages.data).includes(couponSecret)) throw new Error('coupon secret leaked into persisted Workspace messages');
  console.log(JSON.stringify({ status: 'PASS', slice: 'WS-VS-03', storage: 'postgres', accountId, batchId: couponRows.data?.items?.[0]?.batchId, runs: { confirmed: firstRunId, cancelled: secondRunId }, browserState, firstCard, firstPanel, screenshots: { desktopPath, mobilePath }, redacted: !JSON.stringify(persistedMessages.data).includes(couponSecret) }, null, 2));
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
    } catch (error) { console.warn(`temporary database cleanup failed: ${error.message}`); }
  }
}
