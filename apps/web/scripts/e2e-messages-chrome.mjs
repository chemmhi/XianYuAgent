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
const fixtureImagePath = join(tmpdir(), `xianyu-agent-messages-${process.pid}.png`);
const fixtureImagePath2 = join(tmpdir(), `xianyu-agent-messages-${process.pid}-2.png`);
const screenshotDir = join(root, 'docs', 'evidence', 'stage5', 's4-vs5a-chat-read', 'screenshots');
const children = [];
let apiRuntime;
let testAdminId;
let testAccountId;
const useInMemory = process.env.MESSAGES_E2E_STORAGE === 'memory';
const databaseUrl = process.env.DATABASE_URL ?? 'postgres://xianyu:xianyu_dev_only@127.0.0.1:5432/xianyu_agent';
const redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';

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

async function setFileInputFiles(cdp, filePaths) {
  const document = await cdp.send('DOM.getDocument', { depth: -1 });
  const node = await cdp.send('DOM.querySelector', { nodeId: document.root.nodeId, selector: '.messages-file-input' });
  assert.ok(node.nodeId, 'messages file input must be present before selecting a file');
  await cdp.send('DOM.setFileInputFiles', { nodeId: node.nodeId, files: Array.isArray(filePaths) ? filePaths : [filePaths] });
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
  writeFileSync(fixtureImagePath, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));
  writeFileSync(fixtureImagePath2, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAADUlEQVR42mNk+M/wHwAF/gL+VQfP7wAAAABJRU5ErkJggg==', 'base64'));
  const apiBuild = spawnProcess(npm, npmArgs(['--workspace', 'apps/api', 'run', 'build']));
  const buildExit = await new Promise((resolve) => apiBuild.once('exit', resolve));
  if (buildExit !== 0) throw new Error(`API build failed with ${buildExit}`);

  const { createApp } = await import(pathToFileURL(join(root, 'apps', 'api', 'dist', 'app.js')).href);
  const { loadConfig } = await import(pathToFileURL(join(root, 'apps', 'api', 'dist', 'config.js')).href);
  const { hashPassword } = await import(pathToFileURL(join(root, 'apps', 'api', 'dist', 'security.js')).href);
  apiRuntime = createApp(loadConfig({
    ...process.env,
    HOST: '127.0.0.1',
    PORT: String(apiPort),
    ALLOW_IN_MEMORY: useInMemory ? 'true' : 'false',
    DATABASE_URL: useInMemory ? '' : databaseUrl,
    REDIS_URL: useInMemory ? '' : redisUrl,
    COOKIE_SECURE: 'false',
    XIANYU_QR_MODE: 'stub',
    WS_ALLOWED_ORIGINS: webUrl,
  }));
  await apiRuntime.listen();
  await waitFor(async () => (await fetch(`${apiUrl}/healthz`)).ok, 'API');
  if (!useInMemory) {
    await waitFor(async () => (await apiRuntime.store.health()).reachable && Boolean((await apiRuntime.redisRealtime?.health())?.reachable), 'PostgreSQL and Redis', 30_000);
  }
  const admin = await apiRuntime.store.createAdmin({ email: `messages-chrome-${process.pid}@example.com`, passwordHash: await hashPassword('password-123'), displayName: 'Messages Chrome E2E' });
  const login = await apiRuntime.auth.login({ email: admin.email, password: 'password-123' });
  const adminId = admin.id;
  testAdminId = admin.id;
  const cookie = `session_id=${login.session.id}; csrf_token=${encodeURIComponent(login.csrfToken)}`;
  const account = await apiRuntime.store.createAccount({ adminId, platform: 'xianyu', sellerRef: `messages-chrome-${process.pid}`, displayName: '在线聊天 E2E 账号' });
  const secondConversation = await apiRuntime.store.createConversation({ adminId, accountId: account.id, buyerRef: 'buyer-search-e2e', buyerDisplayName: '搜索用户 E2E', buyerAvatarUrl: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2240%22 height=%2240%22%3E%3Crect width=%2240%22 height=%2240%22 rx=%2220%22 fill=%22%23f97316%22/%3E%3Ctext x=%2220%22 y=%2226%22 text-anchor=%22middle%22 font-size=%2220%22 fill=%22white%22%3ES%3C/text%3E%3C/svg%3E', itemTitle: '搜索商品缩略图', itemImageUrl: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2244%22 height=%2236%22%3E%3Crect width=%2244%22 height=%2236%22 rx=%226%22 fill=%22%23fed7aa%22/%3E%3C/svg%3E', externalConversationRef: `messages-search-${process.pid}` });
  await apiRuntime.store.createMessage({ adminId, conversationId: secondConversation.id, direction: 'inbound', senderRole: 'buyer', bodyType: 'text', bodyText: '搜索商品还有库存吗？', source: 'system', traceId: 'messages-chrome-search-seed', createdAt: '2026-09-20T22:00:01.000Z' });
  await apiRuntime.store.createMessage({ adminId, conversationId: secondConversation.id, direction: 'inbound', senderRole: 'buyer', bodyType: 'image', bodyRef: 'https://cdn.example.com/chat/messages-e2e-image.png', source: 'system', traceId: 'messages-chrome-image-seed', createdAt: '2026-09-20T22:00:02.000Z' });

  // Create the primary conversation last so the browser deterministically
  // opens it first while the secondary conversation remains unread for the
  // unread-filter assertions below.
  const conversation = await apiRuntime.store.createConversation({ adminId, accountId: account.id, buyerRef: 'buyer-messages-e2e', buyerDisplayName: '买家 E2E', buyerAvatarUrl: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2240%22 height=%2240%22%3E%3Crect width=%2240%22 height=%2240%22 rx=%2220%22 fill=%22%232563eb%22/%3E%3Ctext x=%2220%22 y=%2226%22 text-anchor=%22middle%22 font-size=%2220%22 fill=%22white%22%3EE%3C/text%3E%3C/svg%3E', itemTitle: '实时消息验证商品', itemImageUrl: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2244%22 height=%2236%22%3E%3Crect width=%2244%22 height=%2236%22 rx=%226%22 fill=%22%23bfdbfe%22/%3E%3C/svg%3E', externalConversationRef: `messages-chrome-${process.pid}` });
  const seedMessage = await apiRuntime.store.createMessage({ adminId, conversationId: conversation.id, direction: 'inbound', senderRole: 'buyer', bodyType: 'text', bodyText: '历史消息 001：请问什么时候发货？', source: 'system', traceId: 'messages-chrome-seed', createdAt: '2026-09-20T23:00:01.000Z' });
  assert.equal(seedMessage.event.cursor, 1);
  await apiRuntime.store.createMessage({ adminId, conversationId: conversation.id, direction: 'outbound', senderRole: 'agent', bodyType: 'text', bodyText: '已收到，我来帮你处理发货问题。', externalMessageRef: 'seller-read-e2e.PNM', source: 'human', traceId: 'messages-chrome-outbound-seed', createdAt: '2026-09-20T23:00:02.000Z' });
  for (let index = 3; index <= 205; index += 1) {
    await apiRuntime.store.createMessage({
      adminId,
      conversationId: conversation.id,
      direction: 'inbound',
      senderRole: 'buyer',
      bodyType: 'text',
      bodyText: `历史消息 ${String(index).padStart(3, '0')}`,
      source: 'system',
      traceId: `messages-chrome-history-${index}`,
      createdAt: new Date(Date.UTC(2026, 8, 20, 23, 0, index)).toISOString(),
    });
  }

  testAccountId = account.id;
  spawnProcess(npm, npmArgs(['--workspace', 'apps/web', 'run', 'dev', '--', '--host', '127.0.0.1', '--port', String(webPort)]), {
    env: { ...process.env, VITE_API_MODE: 'live', VITE_API_BASE_URL: '', VITE_API_PROXY_TARGET: apiUrl },
  });
  await waitFor(async () => (await fetch(`${webUrl}/messages`)).ok, 'Vite frontend');

  const chrome = spawnProcess(chromePath, [
    '--headless=new', '--disable-gpu', '--disable-extensions', '--no-first-run', '--no-default-browser-check', '--remote-allow-origins=*',
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=${chromeProfile}`, '--window-size=1896,900', 'about:blank',
  ]);
  await waitFor(async () => chrome.exitCode === null && (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).ok, 'local Chrome');
  const cdp = await createCdpClient(debugPort);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable');
  await cdp.send('DOM.enable');
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
      const NativeFetch = window.fetch.bind(window);
      window.__xianyuBlockMessagesListFetch = true;
      window.__xianyuReleaseMessagesListFetch = null;
      window.__xianyuBlockTimelineFetchOnce = true;
      window.__xianyuReleaseTimelineFetch = null;
      window.fetch = async (...args) => {
        const url = String(args[0]?.url ?? args[0] ?? '');
        if (url.includes('/api/v1/conversations?') && window.__xianyuBlockMessagesListFetch) {
          await new Promise((resolve) => { window.__xianyuReleaseMessagesListFetch = resolve; });
        }
        if (url.includes('/api/v1/conversations/') && url.includes('/messages?') && window.__xianyuBlockTimelineFetchOnce) {
          window.__xianyuBlockTimelineFetchOnce = false;
          await new Promise((resolve) => { window.__xianyuReleaseTimelineFetch = resolve; });
        }
        return NativeFetch(...args);
      };
    })();`,
  });
  for (const pair of cookie.split('; ')) {
    const [name, ...valueParts] = pair.split('=');
    await cdp.send('Network.setCookie', { name, value: valueParts.join('='), url: `${webUrl}/` });
  }

  await cdp.send('Page.navigate', { url: `${webUrl}/messages` });
  await waitFor(async () => String(await evaluate(cdp, 'document.readyState')) === 'complete', 'messages page');
  await waitFor(async () => await evaluate(cdp, 'Boolean(document.querySelector("[data-messages-domain]"))'), 'messages domain');
  await waitFor(async () => await evaluate(cdp, 'Boolean(document.querySelector(".messages-sidebar-skeleton"))'), 'conversation list skeleton');
  assert.equal(await evaluate(cdp, 'Boolean(document.querySelector(".messages-state"))'), false, 'initial conversation loading must use a skeleton, not a text state');
  await evaluate(cdp, 'window.__xianyuBlockMessagesListFetch = false; window.__xianyuReleaseMessagesListFetch?.();');
  await waitFor(async () => await evaluate(cdp, 'Boolean(document.querySelector(".messages-timeline-skeleton"))'), 'message timeline skeleton');
  assert.equal(await evaluate(cdp, 'Boolean(document.querySelector(".messages-timeline-state"))'), false, 'initial message loading must use a skeleton, not a text state');
  await waitFor(async () => await evaluate(cdp, 'Boolean(document.querySelector(".messages-connection-status.connecting"))'), 'compact realtime connecting indicator');
  assert.equal(await evaluate(cdp, 'Boolean(document.querySelector(".messages-connection-banner"))'), false, 'initial realtime loading must not render the legacy full-width banner');
  await evaluate(cdp, 'window.__xianyuReleaseTimelineFetch?.();');
  // Conversation ordering is driven by latest activity, so the fixture's
  // secondary conversation may be selected first. Explicitly select the
  // primary conversation before asserting its seeded history.
  await waitFor(async () => await evaluate(cdp, `Boolean(document.querySelector('[data-conversation-id="${conversation.id}"]'))`), 'primary conversation row');
  await evaluate(cdp, `document.querySelector('[data-conversation-id="${conversation.id}"]')?.click()`);
  await waitFor(async () => (await messageBodies(cdp)).includes('历史消息 205'), 'latest history page');
  await waitFor(async () => await evaluate(cdp, 'Boolean(document.querySelector(".messages-connection-dot.connected"))'), 'realtime connected');
  assert.equal(await evaluate(cdp, 'Boolean(document.querySelector(".messages-account-tabs"))'), false, 'messages page must not render an account selector');
  assert.equal(await evaluate(cdp, 'Boolean(document.querySelector(`[role="tablist"]`))'), false, 'messages page must not render a tablist account selector');
  assert.equal(await evaluate(cdp, 'localStorage.getItem("xianyu.activeAccountId")'), account.id, 'messages page must reuse the account context selected in Accounts');
  await assertText(cdp, '在线聊天');
  await assertText(cdp, '买家 E2E');
  await assertText(cdp, '真实连接');
  assert.equal(await evaluate(cdp, 'document.querySelectorAll(".messages-conversation-list button").length'), 2);
  assert.equal(await evaluate(cdp, 'document.querySelectorAll(".messages-conversation-avatar img").length'), 2);
  assert.equal(await evaluate(cdp, 'document.querySelectorAll(".messages-conversation-item").length'), 2);
  assert.equal(await evaluate(cdp, 'getComputedStyle(document.querySelector(".messages-conversation-scroll")).overflowY'), 'auto');
  assert.equal(await evaluate(cdp, 'getComputedStyle(document.querySelector(".messages-timeline")).overflowY'), 'auto');
  await evaluate(cdp, `(() => { const input = document.querySelector('input[aria-label="搜索会话"]'); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set; setter?.call(input, '搜索商品'); input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await waitFor(async () => await evaluate(cdp, 'document.querySelectorAll(".messages-conversation-list button").length === 1'), 'search filtering');
  await evaluate(cdp, `(() => { const input = document.querySelector('input[aria-label="搜索会话"]'); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set; setter?.call(input, ''); input.dispatchEvent(new Event('input', { bubbles: true })); document.querySelectorAll('.messages-filter-tabs button')[1]?.click(); })()`);
  await waitFor(async () => await evaluate(cdp, 'document.querySelectorAll(".messages-conversation-list button").length >= 1'), 'unread filtering');
  await evaluate(cdp, `(() => { const input = document.querySelector('input[aria-label="搜索会话"]'); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set; setter?.call(input, '搜索用户'); input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await waitFor(async () => await evaluate(cdp, 'document.querySelectorAll(".messages-conversation-list button").length === 1'), 'buyer search filtering');
  await evaluate(cdp, 'document.querySelector(".messages-conversation-list button")?.click()');
  await waitFor(async () => String(await evaluate(cdp, 'document.querySelector(".messages-main-header strong")?.textContent')).includes('搜索用户'), 'conversation selection');
  await waitFor(async () => await evaluate(cdp, 'Boolean(document.querySelector(".messages-image-button"))'), 'sent image message');
  const pageTargetsBeforeImagePreview = await cdp.send('Target.getTargets');
  await evaluate(cdp, 'document.querySelector(".messages-image-button")?.click()');
  await waitFor(async () => await evaluate(cdp, 'Boolean(document.querySelector(".messages-image-lightbox[role=\\"dialog\\"]"))'), 'sent image lightbox preview');
  const pageTargetsAfterImagePreview = await cdp.send('Target.getTargets');
  assert.equal(pageTargetsAfterImagePreview.targetInfos.filter((target) => target.type === 'page').length, pageTargetsBeforeImagePreview.targetInfos.filter((target) => target.type === 'page').length, 'sent image preview must stay in current page');
  await evaluate(cdp, 'document.querySelector("button[aria-label=\\"关闭图片预览\\"]")?.click()');
  await waitFor(async () => await evaluate(cdp, 'Boolean(document.querySelector(".messages-image-lightbox")) === false'), 'close sent image lightbox');
  await waitFor(async () => await evaluate(cdp, 'Boolean(document.querySelector(".messages-connection-dot.connected"))'), 'secondary conversation realtime connected');
  await evaluate(cdp, '(() => { window.__messagesConversationFetches = 0; window.__messagesNativeFetch = window.fetch.bind(window); window.fetch = (...args) => { const url = String(args[0]?.url ?? args[0] ?? ""); if (url.includes("/api/v1/conversations?")) window.__messagesConversationFetches += 1; return window.__messagesNativeFetch(...args); }; })()');
  const fetchesBeforeLiveMessage = await evaluate(cdp, 'window.__messagesConversationFetches');
  await apiRuntime.store.createMessage({ adminId, conversationId: secondConversation.id, direction: 'inbound', senderRole: 'buyer', bodyType: 'text', bodyText: 'live-message-without-refresh', source: 'system', traceId: 'messages-chrome-live-no-refresh' });
  await waitFor(async () => (await messageBodies(cdp)).includes('live-message-without-refresh'), 'live message without refresh');
  const fetchesAfterLiveMessage = await evaluate(cdp, 'window.__messagesConversationFetches');
  assert.equal(fetchesAfterLiveMessage, fetchesBeforeLiveMessage, 'live message must arrive without a conversation refresh request');
  assert.equal(await evaluate(cdp, '(() => { const timeline = document.querySelector(".messages-timeline"); return Boolean(timeline && timeline.scrollTop + timeline.clientHeight >= timeline.scrollHeight - 2); })()'), true, 'timeline must stay pinned to the newest message');
  await evaluate(cdp, `(() => { const input = document.querySelector('input[aria-label="搜索会话"]'); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set; setter?.call(input, ''); input.dispatchEvent(new Event('input', { bubbles: true })); document.querySelectorAll('.messages-filter-tabs button')[0]?.click(); })()`);
  await evaluate(cdp, `document.querySelector('[data-conversation-id="${conversation.id}"]')?.click()`);
  await waitFor(async () => (await messageBodies(cdp)).length === 100, 'primary conversation latest history page');
  await waitFor(async () => String(await evaluate(cdp, 'document.querySelector(".messages-main-header strong")?.textContent')).includes('买家 E2E'), 'primary conversation selection');
  const latestBodies = await messageBodies(cdp);
  assert.equal(latestBodies[0], '历史消息 106');
  assert.equal(latestBodies.at(-1), '历史消息 205');
  await evaluate(cdp, 'document.querySelector(".messages-history-load-more")?.click()');
  await waitFor(async () => (await messageBodies(cdp)).length === 200, 'first older history page');
  await evaluate(cdp, 'document.querySelector(".messages-history-load-more")?.click()');
  await waitFor(async () => (await messageBodies(cdp)).length === 205, 'complete history pages');
  const completeBodies = await messageBodies(cdp);
  assert.equal(completeBodies[0], '历史消息 001：请问什么时候发货？');
  assert.equal(completeBodies.at(-1), '历史消息 205');
  assert.equal(await evaluate(cdp, 'Boolean(document.querySelector(".messages-read-state.unread"))'), true, 'seller message must remain unread before the platform receipt');
  await apiRuntime.messages.markExternalMessageRead({
    adminId,
    accountId: account.id,
    conversationId: conversation.id,
    externalMessageRef: 'seller-read-e2e.PNM',
    readAt: '2026-09-20T23:04:00.000Z',
    requestId: 'messages-chrome-read-receipt',
    traceId: 'messages-chrome-read-receipt',
  });
  await waitFor(async () => await evaluate(cdp, 'Boolean(document.querySelector(".messages-read-state.read"))'), 'platform 40103 read receipt');
  const outboundAlignment = await evaluate(cdp, '(() => { const row = document.querySelector(".messages-bubble-row.outbound"); const stack = row?.querySelector(".messages-message-stack"); if (!row || !stack) return null; const rowStyle = getComputedStyle(row); const stackStyle = getComputedStyle(stack); return { flexDirection: rowStyle.flexDirection, justifyContent: rowStyle.justifyContent, textAlign: stackStyle.textAlign }; })()');
  assert.deepEqual(outboundAlignment, { flexDirection: 'row-reverse', justifyContent: 'flex-start', textAlign: 'left' }, 'seller messages stay right-positioned while bubble text aligns left');

  assert.equal(await evaluate(cdp, 'document.querySelector("textarea[aria-label=\\"消息内容\\"]")?.getAttribute("placeholder")'), '输入回复，Enter 发送，Shift + Enter 换行，Ctrl + V 粘贴图片。');
  assert.equal(await evaluate(cdp, 'Boolean(document.querySelector(".messages-send-button")?.disabled)'), true, 'send button disabled for empty draft');
  await evaluate(cdp, 'document.querySelector(".messages-emoji-button")?.click()');
  await waitFor(async () => await evaluate(cdp, 'Boolean(document.querySelector(".messages-emoji-picker[role=\\"dialog\\"]"))'), 'emoji picker');
  const emojiLayout = await evaluate(cdp, '(() => { const picker = document.querySelector(".messages-emoji-picker"); if (!picker) return null; const style = getComputedStyle(picker); return { overflowX: style.overflowX, scrollWidth: picker.scrollWidth, clientWidth: picker.clientWidth }; })()');
  assert.equal(emojiLayout.overflowX, 'hidden', 'emoji picker must hide horizontal overflow');
  assert.ok(emojiLayout.scrollWidth <= emojiLayout.clientWidth, 'emoji picker must not overflow horizontally');
  await evaluate(cdp, 'document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))');
  await waitFor(async () => await evaluate(cdp, 'Boolean(document.querySelector(".messages-emoji-picker")) === false'), 'emoji picker closes on outside click');
  await evaluate(cdp, 'document.querySelector(".messages-emoji-button")?.click()');
  await waitFor(async () => await evaluate(cdp, 'Boolean(document.querySelector(".messages-emoji-picker[role=\\"dialog\\"]"))'), 'emoji picker reopen');
  await evaluate(cdp, 'document.querySelector(".messages-emoji-picker button")?.click()');
  await waitFor(async () => String(await evaluate(cdp, 'document.querySelector("textarea[aria-label=\\"消息内容\\"]")?.value ?? ""')).startsWith('['), 'emoji insertion');
  await waitFor(async () => await evaluate(cdp, 'Boolean(document.querySelector(".messages-composer-visual .messages-emoji-inline"))'), 'emoji visual rendering');
  await waitFor(async () => await evaluate(cdp, 'Boolean(document.querySelector(".messages-composer-caret[data-composer-caret]"))'), 'emoji visual caret');
  assert.equal(await evaluate(cdp, 'document.querySelector(".messages-composer-visual")?.textContent ?? ""'), '', 'composer visual must not expose emoji marker names');
  const emojiCaretBeforeClick = await evaluate(cdp, '(() => { const image = document.querySelector(".messages-composer-visual .messages-emoji-inline"); const caret = document.querySelector(".messages-composer-caret[data-composer-caret]"); const textarea = document.querySelector("textarea[aria-label=\\"消息内容\\"]"); if (!image || !caret || !textarea) return null; const imageRect = image.getBoundingClientRect(); const caretRect = caret.getBoundingClientRect(); return { imageRight: imageRect.right, caretLeft: caretRect.left, selectionStart: textarea.selectionStart, selectionEnd: textarea.selectionEnd, valueLength: textarea.value.length, clickX: imageRect.left + imageRect.width / 2, clickY: imageRect.top + imageRect.height / 2 }; })()');
  assert.ok(emojiCaretBeforeClick, 'emoji caret geometry must be available');
  assert.equal(emojiCaretBeforeClick.selectionStart, emojiCaretBeforeClick.valueLength, 'emoji insertion selection must be after the marker token');
  assert.equal(emojiCaretBeforeClick.selectionEnd, emojiCaretBeforeClick.valueLength, 'emoji insertion selection must stay collapsed after the marker token');
  assert.ok(Math.abs(emojiCaretBeforeClick.caretLeft - emojiCaretBeforeClick.imageRight) <= 4, 'visual caret must sit immediately after the emoji image');
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: emojiCaretBeforeClick.clickX, y: emojiCaretBeforeClick.clickY, button: 'left', clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: emojiCaretBeforeClick.clickX, y: emojiCaretBeforeClick.clickY, button: 'left', clickCount: 1 });
  await waitFor(async () => await evaluate(cdp, '(() => { const textarea = document.querySelector("textarea[aria-label=\\"消息内容\\"]"); return Boolean(textarea && textarea.selectionStart === textarea.value.length && textarea.selectionEnd === textarea.value.length); })()'), 'emoji click caret normalization');
  const emojiCaretAfterClick = await evaluate(cdp, '(() => { const image = document.querySelector(".messages-composer-visual .messages-emoji-inline"); const caret = document.querySelector(".messages-composer-caret[data-composer-caret]"); if (!image || !caret) return null; return { imageRight: image.getBoundingClientRect().right, caretLeft: caret.getBoundingClientRect().left }; })()');
  assert.ok(emojiCaretAfterClick, 'emoji caret geometry must remain available after click');
  assert.ok(Math.abs(emojiCaretAfterClick.caretLeft - emojiCaretAfterClick.imageRight) <= 4, 'clicking the emoji must keep the visual caret after the image');
  await evaluate(cdp, '(() => { const textarea = document.querySelector("textarea[aria-label=\\"消息内容\\"]"); if (!textarea) return false; textarea.focus(); textarea.setSelectionRange(textarea.value.length, textarea.value.length); textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true })); return true; })()');
  await waitFor(async () => String(await evaluate(cdp, 'document.querySelector("textarea[aria-label=\\"消息内容\\"]")?.value ?? ""')) === '', 'emoji marker atomic deletion');
  assert.equal(await evaluate(cdp, 'Boolean(document.querySelector(".messages-composer-visual .messages-emoji-inline"))'), false, 'emoji visual must disappear after one Backspace');
  await evaluate(cdp, '(() => { const textarea = document.querySelector("textarea[aria-label=\\"消息内容\\"]"); const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set; setter?.call(textarea, ""); textarea.dispatchEvent(new Event("input", { bubbles: true })); })()');
  await evaluate(cdp, '(() => { const input = document.querySelector(".messages-file-input"); window.__messagesFilePickerClicks = 0; input?.addEventListener("click", () => { window.__messagesFilePickerClicks += 1; }); document.querySelector(".messages-composer-tools .messages-tool-button:not(.messages-emoji-button)")?.click(); })()');
  await waitFor(async () => await evaluate(cdp, 'window.__messagesFilePickerClicks === 1'), 'direct file picker');
  await setFileInputFiles(cdp, [fixtureImagePath, fixtureImagePath2]);
  await waitFor(async () => await evaluate(cdp, 'document.querySelectorAll(".messages-inline-attachment").length === 2'), 'multiple image attachment previews');
  assert.equal(await evaluate(cdp, 'Boolean(document.querySelector(".messages-attachment-copy"))'), false, 'attachment preview must not show filename or size');
  assert.equal(await evaluate(cdp, '(() => { const boxes = Array.from(document.querySelectorAll(".messages-inline-attachment")); return boxes.every((box) => { const image = box.querySelector("img"); return image && box.getBoundingClientRect().width <= image.getBoundingClientRect().width + 20; }); })()'), true, 'attachment previews must hug their thumbnails');
  assert.equal(await evaluate(cdp, 'Array.from(document.querySelectorAll(".messages-inline-attachment")).every((box) => box.getBoundingClientRect().width <= 250)'), true, 'attachment previews must stay compact');
  assert.equal(await evaluate(cdp, 'Boolean(document.querySelector(".messages-send-button")?.disabled)'), false, 'send button enabled for image attachment');
  assert.equal(await evaluate(cdp, 'Boolean(document.querySelector(".messages-inline-attachment")?.closest(".messages-composer-shell"))'), true, 'image attachment must be inside composer shell');
  await evaluate(cdp, 'document.querySelector(".messages-inline-attachment-trigger")?.click()');
  await waitFor(async () => await evaluate(cdp, 'Boolean(document.querySelector(".messages-image-lightbox[role=\\"dialog\\"]"))'), 'image lightbox preview');
  await evaluate(cdp, 'document.querySelector("button[aria-label=\\"关闭图片预览\\"]")?.click()');
  await waitFor(async () => await evaluate(cdp, 'Boolean(document.querySelector(".messages-image-lightbox")) === false'), 'close image lightbox');
  await evaluate(cdp, 'document.querySelectorAll(".messages-inline-attachment-trigger")[1]?.click()');
  await waitFor(async () => await evaluate(cdp, 'Boolean(document.querySelector(".messages-image-lightbox[role=\\"dialog\\"]"))'), 'second image lightbox preview');
  assert.equal(await evaluate(cdp, 'document.querySelector(".messages-image-lightbox img")?.src === document.querySelectorAll(".messages-inline-attachment img")[1]?.src'), true, 'lightbox must preview the clicked attachment');
  await evaluate(cdp, 'document.querySelector("button.messages-lightbox-close")?.click()');
  await waitFor(async () => await evaluate(cdp, 'Boolean(document.querySelector(".messages-image-lightbox")) === false'), 'close second image lightbox');
  await evaluate(cdp, 'document.querySelector(".messages-attachment-remove")?.click()');
  await waitFor(async () => await evaluate(cdp, 'document.querySelectorAll(".messages-inline-attachment").length === 1'), 'remove one image attachment preview');
  assert.equal(await evaluate(cdp, 'Boolean(document.querySelector(".messages-send-button")?.disabled)'), false, 'send button stays enabled while one attachment remains');
  await evaluate(cdp, 'document.querySelector(".messages-attachment-remove")?.click()');
  await waitFor(async () => await evaluate(cdp, 'Boolean(document.querySelector(".messages-inline-attachment")) === false'), 'remove image attachment preview');
  assert.equal(await evaluate(cdp, 'Boolean(document.querySelector(".messages-send-button")?.disabled)'), true, 'send button disabled after removing attachment');
  await evaluate(cdp, `(() => {
    const textarea = document.querySelector('textarea[aria-label="消息内容"]');
    const itemFile = new File([new Uint8Array([137, 80, 78, 71])], 'paste.png', { type: 'image/png', lastModified: 1 });
    const mirroredFile = new File([new Uint8Array([137, 80, 78, 71])], 'paste.png', { type: 'image/png', lastModified: 2 });
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: { items: [{ kind: 'file', getAsFile: () => itemFile }], files: [mirroredFile] } });
    textarea?.dispatchEvent(event);
    return true;
  })()`);
  await waitFor(async () => await evaluate(cdp, 'document.querySelectorAll(".messages-inline-attachment").length === 1'), 'deduplicated pasted image preview');
  await evaluate(cdp, 'document.querySelector(".messages-attachment-remove")?.click()');
  await waitFor(async () => await evaluate(cdp, 'Boolean(document.querySelector(".messages-inline-attachment")) === false'), 'remove pasted image preview');
  await captureViewport(cdp, 1896, 900, 'messages-desktop-1896x900.png');

  const offlineMethod = await disconnectBrowserRealtime(cdp);
  await waitFor(async () => await evaluate(cdp, 'Boolean(document.querySelector(".messages-connection-status.reconnecting"))'), 'compact reconnecting indicator');
  assert.equal(await evaluate(cdp, 'Boolean(document.querySelector(".messages-connection-banner.reconnecting"))'), false, 'reconnecting must not render the legacy full-width banner');
  await waitFor(async () => await evaluate(cdp, 'Boolean(window.__xianyuTestSockets?.some((candidate) => candidate.__xianyuFake && candidate.readyState === 0 && String(candidate.__xianyuUrl ?? "").includes("/api/v1/conversations/") && String(candidate.__xianyuUrl ?? "").includes("/events")))'), 'blocked reconnect attempt');
  assert.equal(await evaluate(cdp, 'document.body.innerText.includes("连接已断开，正在按游标补回消息")'), false, 'reconnecting must not expose the legacy verbose copy');
  await captureViewport(cdp, 1896, 900, 'messages-reconnecting-1896x900.png');

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
   assert.equal(recovered.event.cursor, 207);
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.equal((await messageBodies(cdp)).length, 205);

  await releaseBrowserRealtime(cdp);
  await waitFor(async () => await evaluate(cdp, 'Boolean(document.querySelector(".messages-connection-dot.connected"))'), 'realtime recovery');
  {
    await waitFor(async () => (await messageBodies(cdp)).includes('断线期间新消息：已按游标补回。'), 'cursor backfill message');
  }
  const recoveredBodies = await messageBodies(cdp);
  assert.equal(recoveredBodies.filter((body) => body === '断线期间新消息：已按游标补回。').length, 1, 'recovered message rendered exactly once');
  assert.equal(recoveredBodies.length, 206, 'timeline contains complete history plus one recovered message');
  await assertText(cdp, '按游标补回');
  await captureViewport(cdp, 390, 844, 'messages-mobile-390x844.png');
  await cdp.send('Emulation.clearDeviceMetricsOverride');
  cdp.socket.close();
  console.log(`local Chrome messages E2E passed: connected -> ${offlineMethod} -> cursor backfill -> automatic reconnect -> deduplicated timeline`);
}

async function cleanupRealData() {
  if (useInMemory || !apiRuntime || !testAdminId || !apiRuntime.store?.pool) return;
  const pool = apiRuntime.store.pool;
  try {
    await pool.query('begin');
    if (testAccountId) {
      await pool.query('delete from messages.events where conversation_id in (select id from messages.conversations where account_id=$1)', [testAccountId]);
      await pool.query('delete from messages.messages where conversation_id in (select id from messages.conversations where account_id=$1)', [testAccountId]);
      await pool.query('delete from messages.conversations where account_id=$1', [testAccountId]);
      await pool.query('delete from auth.account_scopes where account_id=$1', [testAccountId]);
      await pool.query('delete from auth.account_credentials where account_id=$1', [testAccountId]);
      await pool.query('delete from observability.audit_events where account_id=$1', [testAccountId]);
      await pool.query('delete from accounts.accounts where id=$1', [testAccountId]);
    }
    await pool.query('delete from auth.sessions where admin_id=$1', [testAdminId]);
    await pool.query('delete from observability.audit_events where actor_id=$1', [testAdminId]);
    await pool.query('delete from auth.admins where id=$1', [testAdminId]);
    await pool.query('commit');
  } catch {
    try { await pool.query('rollback'); } catch {}
  }
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
    await cleanupRealData();
    await apiRuntime.close();
  }
  try { rmSync(chromeProfile, { recursive: true, force: true }); } catch (error) { console.warn(`Chrome temporary profile cleanup failed: ${error.message}`); }
  try { rmSync(fixtureImagePath, { force: true }); } catch (error) { console.warn(`Chrome fixture cleanup failed: ${error.message}`); }
  try { rmSync(fixtureImagePath2, { force: true }); } catch (error) { console.warn(`Chrome second fixture cleanup failed: ${error.message}`); }
}
