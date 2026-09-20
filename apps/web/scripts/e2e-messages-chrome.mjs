import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = join(import.meta.dirname, '..', '..', '..');
const chromePath = process.env.CHROME_PATH ?? join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe');
const chromeProfile = join(tmpdir(), `xianyu-agent-messages-chrome-${process.pid}`);
const screenshotDir = join(root, 'docs', 'evidence', 'stage5', 's4-vs5a-chat-read', 'screenshots');
const children = [];
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
  child.stdout.on('data', (chunk) => process.stdout.write(`[messages-e2e:${command}] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[messages-e2e:${command}] ${chunk}`));
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
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`${label} did not become ready${lastError ? `: ${lastError.message}` : ''}`);
}

function cookiesFrom(response) {
  return (response.headers.getSetCookie?.() ?? []).map((value) => value.split(';', 1)[0]).join('; ');
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
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const entry = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(message.error.message));
    else entry.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  return { socket, send };
}

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? 'browser script failed');
  return result.result?.value;
}

async function assertText(cdp, text) {
  const body = await evaluate(cdp, 'document.body.innerText');
  assert.ok(String(body).includes(text), `page missing text: ${text}`);
}

async function messageBodies(cdp) {
  return await evaluate(cdp, 'Array.from(document.querySelectorAll(".messages-bubble span")).map((node) => node.textContent ?? "")');
}

async function captureViewport(cdp, width, height, filename) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await evaluate(cdp, 'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await new Promise((resolve) => setTimeout(resolve, 250));
  mkdirSync(screenshotDir, { recursive: true });
  const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
  writeFileSync(join(screenshotDir, filename), Buffer.from(screenshot.data, 'base64'));
}

async function disconnectBrowserRealtime(cdp) {
  const result = await evaluate(cdp, '(() => { window.__xianyuBlockReconnect = true; const socket = window.__xianyuTestSockets?.find((candidate) => candidate.readyState === WebSocket.OPEN && String(candidate.__xianyuUrl ?? "").includes("/api/v1/conversations/") && String(candidate.__xianyuUrl ?? "").includes("/events")); if (!socket) return false; socket.close(); return true; })()');
  assert.equal(result, true, 'an open browser realtime socket must exist before disconnect injection');
  return 'CDP WebSocket close injection';
}

async function releaseBrowserRealtime(cdp) {
  const result = await evaluate(cdp, '(() => { window.__xianyuBlockReconnect = false; const sockets = window.__xianyuTestSockets ?? []; const blocked = sockets.filter((candidate) => candidate.__xianyuFake && candidate.readyState === 0 && String(candidate.__xianyuUrl ?? "").includes("/api/v1/conversations/") && String(candidate.__xianyuUrl ?? "").includes("/events")); blocked.forEach((candidate) => candidate.close()); return blocked.length; })()');
  assert.ok(Number(result) > 0, 'a blocked reconnect socket must exist before release');
}

async function run() {
  const apiPort = await freePort();
  const webPort = await freePort();
  const debugPort = await freePort();
  const apiUrl = `http://127.0.0.1:${apiPort}`;
  const webUrl = `http://127.0.0.1:${webPort}`;
  const npm = process.env.npm_execpath ? process.execPath : (process.platform === 'win32' ? 'npm.cmd' : 'npm');
  const npmArgs = (args) => process.env.npm_execpath ? [process.env.npm_execpath, ...args] : args;

  mkdirSync(chromeProfile, { recursive: true });
  const apiBuild = spawnProcess(npm, npmArgs(['--workspace', 'apps/api', 'run', 'build']));
  const buildExit = await new Promise((resolve) => apiBuild.once('exit', resolve));
  if (buildExit !== 0) throw new Error(`API build failed with ${buildExit}`);

  const { createApp } = await import(pathToFileURL(join(root, 'apps', 'api', 'dist', 'app.js')).href);
  const { loadConfig } = await import(pathToFileURL(join(root, 'apps', 'api', 'dist', 'config.js')).href);
  apiRuntime = createApp(loadConfig({
    ...process.env,
    HOST: '127.0.0.1',
    PORT: String(apiPort),
    ALLOW_IN_MEMORY: 'true',
    DATABASE_URL: '',
    COOKIE_SECURE: 'false',
    XIANYU_QR_MODE: 'stub',
    WS_ALLOWED_ORIGINS: webUrl,
  }));
  await apiRuntime.listen();
  await waitFor(async () => (await fetch(`${apiUrl}/healthz`)).ok, 'API');

  const bootstrap = await fetch(`${apiUrl}/api/v1/auth/bootstrap`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'Idempotency-Key': `messages-chrome-bootstrap-${process.pid}` },
    body: JSON.stringify({ email: `messages-chrome-${process.pid}@example.com`, password: 'password-123', displayName: 'Messages Chrome E2E' }),
  });
  if (!bootstrap.ok) throw new Error(`bootstrap failed: ${bootstrap.status} ${await bootstrap.text()}`);
  const bootstrapPayload = await bootstrap.json();
  const adminId = bootstrapPayload.data.profile.id;
  const cookie = cookiesFrom(bootstrap);
  const account = await apiRuntime.store.createAccount({ adminId, platform: 'xianyu', sellerRef: `messages-chrome-${process.pid}`, displayName: '在线聊天 E2E 账号' });
  const conversation = await apiRuntime.store.createConversation({ adminId, accountId: account.id, buyerRef: 'buyer-messages-e2e', buyerDisplayName: '买家 E2E', itemTitle: '实时消息验证商品', externalConversationRef: `messages-chrome-${process.pid}` });
  const seedMessage = await apiRuntime.store.createMessage({ adminId, conversationId: conversation.id, direction: 'inbound', senderRole: 'buyer', bodyType: 'text', bodyText: '历史消息：请问什么时候发货？', source: 'system', traceId: 'messages-chrome-seed' });
  assert.equal(seedMessage.event.cursor, 1);

  spawnProcess(npm, npmArgs(['--workspace', 'apps/web', 'run', 'dev', '--', '--host', '127.0.0.1', '--port', String(webPort)]), {
    env: { ...process.env, VITE_API_MODE: 'live', VITE_API_BASE_URL: '', VITE_API_PROXY_TARGET: apiUrl },
  });
  await waitFor(async () => (await fetch(`${webUrl}/messages`)).ok, 'Vite frontend');

  const chrome = spawnProcess(chromePath, [
    '--headless=new', '--disable-gpu', '--disable-extensions', '--no-first-run', '--no-default-browser-check', '--remote-allow-origins=*',
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=${chromeProfile}`, '--window-size=1440,900', 'about:blank',
  ]);
  await waitFor(async () => chrome.exitCode === null && (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).ok, 'local Chrome');
  const cdp = await createCdpClient(debugPort);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable');
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => {
      const NativeWebSocket = window.WebSocket;
      window.__xianyuTestSockets = [];
      window.__xianyuBlockReconnect = false;
      window.WebSocket = new Proxy(NativeWebSocket, {
        construct(target, args, newTarget) {
          if (window.__xianyuBlockReconnect) {
            const listeners = new Map();
            const fake = {
              __xianyuFake: true,
              __xianyuUrl: String(args[0] ?? ''),
              readyState: 0,
              addEventListener(type, listener) {
                const handlers = listeners.get(type) ?? [];
                handlers.push(listener);
                listeners.set(type, handlers);
              },
              close() {
                if (fake.readyState === 3) return;
                fake.readyState = 3;
                for (const listener of listeners.get('close') ?? []) listener(new Event('close'));
              },
            };
            window.__xianyuTestSockets.push(fake);
            return fake;
          }
          const socket = Reflect.construct(target, args, newTarget);
          socket.__xianyuUrl = String(args[0] ?? '');
          window.__xianyuTestSockets.push(socket);
          return socket;
        },
      });
    })();`,
  });
  for (const pair of cookie.split('; ')) {
    const [name, ...valueParts] = pair.split('=');
    await cdp.send('Network.setCookie', { name, value: valueParts.join('='), url: `${webUrl}/` });
  }

  await cdp.send('Page.navigate', { url: `${webUrl}/messages` });
  await waitFor(async () => String(await evaluate(cdp, 'document.readyState')) === 'complete', 'messages page');
  await waitFor(async () => await evaluate(cdp, 'Boolean(document.querySelector("[data-messages-domain]"))'), 'messages domain');
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('历史消息：请问什么时候发货？'), 'seed message');
  await waitFor(async () => await evaluate(cdp, 'Boolean(document.querySelector(".messages-connection-dot.connected"))'), 'realtime connected');
  await assertText(cdp, '在线聊天');
  await assertText(cdp, '买家 E2E');
  await assertText(cdp, '只读首片');
  assert.deepEqual(await messageBodies(cdp), ['历史消息：请问什么时候发货？']);
  await captureViewport(cdp, 1440, 900, 'messages-desktop-1440x900.png');

  const offlineMethod = await disconnectBrowserRealtime(cdp);
  await waitFor(async () => await evaluate(cdp, 'Boolean(document.querySelector(".messages-connection-banner.reconnecting"))'), 'reconnecting banner');
  await waitFor(async () => await evaluate(cdp, 'Boolean(window.__xianyuTestSockets?.some((candidate) => candidate.__xianyuFake && candidate.readyState === 0 && String(candidate.__xianyuUrl ?? "").includes("/api/v1/conversations/") && String(candidate.__xianyuUrl ?? "").includes("/events")))'), 'blocked reconnect attempt');
  await assertText(cdp, '连接已断开，正在按游标补回消息');
  await captureViewport(cdp, 1440, 900, 'messages-reconnecting-1440x900.png');

  const recovered = await apiRuntime.messages.createMessage({
    adminId,
    conversationId: conversation.id,
    direction: 'inbound',
    senderRole: 'buyer',
    bodyType: 'text',
    bodyText: '断线期间新消息：已按游标补回。',
    source: 'system',
    requestId: 'messages-chrome-recovery',
    traceId: 'messages-chrome-recovery',
  });
  assert.equal(recovered.event.cursor, 2);
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.deepEqual(await messageBodies(cdp), ['历史消息：请问什么时候发货？']);

  await releaseBrowserRealtime(cdp);
  await waitFor(async () => await evaluate(cdp, 'Boolean(document.querySelector(".messages-connection-dot.connected"))'), 'realtime recovery');
  {
    await waitFor(async () => (await messageBodies(cdp)).includes('断线期间新消息：已按游标补回。'), 'cursor backfill message');
  }
  const recoveredBodies = await messageBodies(cdp);
  assert.equal(recoveredBodies.filter((body) => body === '断线期间新消息：已按游标补回。').length, 1, 'recovered message rendered exactly once');
  assert.equal(recoveredBodies.length, 2, 'timeline has one historical and one recovered message');
  await assertText(cdp, '按游标补回');
  await captureViewport(cdp, 390, 844, 'messages-mobile-390x844.png');
  await cdp.send('Emulation.clearDeviceMetricsOverride');
  cdp.socket.close();
  console.log(`local Chrome messages E2E passed: connected -> ${offlineMethod} -> cursor backfill -> automatic reconnect -> deduplicated timeline`);
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
  if (apiRuntime) {
    apiRuntime.server.closeAllConnections?.();
    apiRuntime.server.closeIdleConnections?.();
    await apiRuntime.close();
  }
  try { rmSync(chromeProfile, { recursive: true, force: true }); } catch (error) { console.warn(`Chrome temporary profile cleanup failed: ${error.message}`); }
}
