import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = join(import.meta.dirname, '..', '..', '..');
const { createApp } = await import(pathToFileURL(join(root, 'apps', 'api', 'dist', 'app.js')).href);
const { hashPassword } = await import(pathToFileURL(join(root, 'apps', 'api', 'dist', 'security.js')).href);
const chromePath = process.env.CHROME_PATH ?? join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe');
const screenshotDir = join(root, 'docs', 'agent', 'agent-dynamics', 'evidence', 'screenshots');
const chromeProfile = join(tmpdir(), `xianyu-agent-agent-dynamics-${process.pid}`);
const children = [];
const databaseUrl = process.env.DATABASE_URL ?? 'postgres://xianyu:xianyu_dev_only@127.0.0.1:5432/xianyu_agent';
let apiRuntime;
let adminId;
let accountId;
let productId;
let conversationIds = [];
let runIds = [];

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
  child.stdout.on('data', (chunk) => process.stdout.write(`[agent-dynamics-e2e:${command}] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[agent-dynamics-e2e:${command}] ${chunk}`));
  children.push(child);
  return child;
}

async function waitFor(check, label, timeoutMs = 25_000) {
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

async function captureViewport(cdp, width, height, filename) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
  const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
  mkdirSync(screenshotDir, { recursive: true });
  const destination = join(screenshotDir, filename);
  writeFileSync(destination, Buffer.from(screenshot.data, 'base64'));
  return destination;
}

function apiEvent(events, method, pathname, predicate = () => true) {
  return events.some((event) => {
    if (event.method !== 'Network.requestWillBeSent' || event.params?.request?.method !== method) return false;
    const url = new URL(event.params.request.url);
    return url.pathname === pathname && predicate(url);
  });
}

async function run() {
  const apiPort = await freePort();
  const webPort = await freePort();
  const debugPort = await freePort();
  const apiUrl = `http://127.0.0.1:${apiPort}`;
  const webUrl = `http://127.0.0.1:${webPort}`;
  mkdirSync(chromeProfile, { recursive: true });
  const originalFetch = globalThis.fetch;
  let modelCall = 0;
  globalThis.fetch = (async (_input, init) => {
    if (!String(_input).includes('model.example')) return originalFetch(_input, init);
    modelCall += 1;
    const body = JSON.parse(String(init?.body));
    const message = modelCall === 1
      ? { content: '', tool_calls: [{ id: 'agent-dynamics-chrome-product', type: 'function', function: { name: 'get_product_info', arguments: '{}' } }] }
      : { content: JSON.stringify({ decision: 'reply', text: '这是 Chrome/CDP 真实数据库验收回复。' }) };
    return new Response(JSON.stringify({ model: body.model, choices: [{ message }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  try {
    apiRuntime = createApp({ host: '127.0.0.1', port: apiPort, databaseUrl, cookieSecure: false, allowInMemory: false, sessionIdleMs: 1_800_000, sessionAbsoluteMs: 28_800_000, xianyuQrMode: 'stub', modelApiKey: 'agent-dynamics-chrome-key', modelBaseUrl: 'https://model.example/v1', modelName: 'agent-dynamics-chrome', modelWireApi: 'chat', modelTimeoutMs: 5_000, autoReplyModelEnabled: true, autoReplySendMode: 'simulate', autoReplyTestBuyerNames: ['Agent Dynamics Buyer'] });
    await apiRuntime.listen();
    const admin = await apiRuntime.store.createAdmin({ email: `agent-dynamics-e2e-${process.pid}@example.com`, passwordHash: await hashPassword('password-123'), displayName: 'Agent Dynamics E2E' });
    adminId = admin.id;
    const login = await fetch(`${apiUrl}/api/v1/auth/password-login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: admin.email, password: 'password-123' }) });
    if (!login.ok) throw new Error(`password login failed: ${login.status}`);
    const cookie = cookiesFrom(login);
    const account = await apiRuntime.store.createAccount({ adminId, platform: 'xianyu', sellerRef: `agent-dynamics-e2e-${process.pid}`, displayName: 'Agent 动态真实账号' });
    accountId = account.id;
    const product = await apiRuntime.store.createProduct({ adminId, accountId, externalProductRef: `agent-dynamics-product-${process.pid}`, title: 'Agent 动态验收商品', description: '真实 PostgreSQL 商品', priceMinor: 2_590, status: 'published' });
    productId = product.id;
    const persistedConversation = await apiRuntime.store.createConversation({ adminId, accountId, buyerRef: `agent-dynamics-buyer-${process.pid}`, buyerDisplayName: 'Agent Dynamics Buyer', itemRef: product.externalProductRef, itemTitle: product.title, externalConversationRef: `agent-dynamics-persisted-${process.pid}` });
    conversationIds.push(persistedConversation.id);
    const result = await apiRuntime.xianyuIm.handleExternalEvent(adminId, { accountId, externalConversationRef: persistedConversation.externalConversationRef, externalMessageRef: `agent-dynamics-persisted-${process.pid}.PNM`, senderRef: persistedConversation.buyerRef, direction: 'inbound', bodyType: 'text', bodyText: '请介绍这个验收商品。', occurredAt: new Date().toISOString() });
    if (result.autoReply?.run.status !== 'persisted') throw new Error(`persisted run failed: ${result.autoReply?.run.status}`);
    runIds.push(result.autoReply.run.id);

    const fixtureRuns = [
      { buyer: 'Agent Dynamics Handoff', ref: 'handoff', status: 'handoff', decision: 'handoff', intent: '发货咨询', failureCode: undefined },
      { buyer: 'Agent Dynamics Failed', ref: 'failed', status: 'failed', decision: 'failed', intent: '商品咨询', failureCode: 'RESPONSES_API_TIMEOUT' },
      { buyer: 'Agent Dynamics Processing', ref: 'processing', status: 'generated', decision: 'replied', intent: '跨商品咨询', failureCode: undefined },
    ];
    for (const fixture of fixtureRuns) {
      const conversation = await apiRuntime.store.createConversation({ adminId, accountId, buyerRef: `${fixture.ref}-${process.pid}`, buyerDisplayName: fixture.buyer, itemRef: product.externalProductRef, itemTitle: product.title, externalConversationRef: `agent-dynamics-${fixture.ref}-${process.pid}` });
      conversationIds.push(conversation.id);
      const inbound = await apiRuntime.store.createMessage({ adminId, conversationId: conversation.id, direction: 'inbound', senderRole: 'buyer', bodyType: 'text', bodyText: `${fixture.buyer} 的验收消息`, source: 'human' });
      const run = await apiRuntime.store.createAutoReplyRun({ adminId, accountId, conversationId: conversation.id, inboundMessageId: inbound.message.id, intent: fixture.intent, decision: fixture.decision, status: fixture.status, productId, inputDigest: `sha256:${fixture.ref}-${process.pid}`, failureCode: fixture.failureCode });
      runIds.push(run.id);
    }

    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    spawnProcess(npm, ['--workspace', 'apps/web', 'run', 'dev', '--', '--host', '127.0.0.1', '--port', String(webPort)], { env: { ...process.env, VITE_API_MODE: 'live', VITE_API_BASE_URL: '', VITE_API_PROXY_TARGET: apiUrl } });
    await waitFor(async () => (await fetch(`${webUrl}/agent-dynamics`)).ok, 'Vite frontend');
    const chrome = spawnProcess(chromePath, ['--headless=new', '--disable-gpu', '--disable-extensions', '--no-first-run', '--no-default-browser-check', '--remote-allow-origins=*', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${chromeProfile}`, '--window-size=1440,900', 'about:blank']);
    await waitFor(async () => chrome.exitCode === null && (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).ok, 'local Chrome');
    const cdp = await createCdpClient(debugPort);
    await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Network.enable');
    for (const pair of cookie.split('; ')) { const [name, ...valueParts] = pair.split('='); await cdp.send('Network.setCookie', { name, value: valueParts.join('='), url: `${webUrl}/` }); }
    await cdp.send('Page.navigate', { url: `${webUrl}/agent-dynamics` });
    await waitFor(async () => String(await evaluate(cdp, 'document.readyState')) === 'complete', 'Agent 动态 route');
    await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('自动回复 Agent'), 'Agent 动态 heading');
    await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('Agent Dynamics Buyer'), 'persisted buyer row');
    await waitFor(async () => apiEvent(cdp.events, 'GET', '/api/v1/auto-reply/activity/summary'), 'summary API request');
    await waitFor(async () => apiEvent(cdp.events, 'GET', '/api/v1/auto-reply/runs'), 'runs API request');
    const bodyText = String(await evaluate(cdp, 'document.body.innerText'));
    for (const label of ['运行记录', '链路健康', '异常与待处理', 'Agent Dynamics Failed', 'Agent Dynamics Handoff']) if (!bodyText.includes(label)) throw new Error(`Agent dynamics text missing: ${label}`);
    const shellAssertions = await evaluate(cdp, `(() => {
      const nav = Array.from(document.querySelectorAll('.side-nav button')).map((item) => item.textContent?.replace(/\\s+/g, ' ').trim() ?? '');
      const ordersIndex = nav.findIndex((item) => item.includes('订单管理'));
      const agentIndex = nav.findIndex((item) => item.includes('Agent 动态'));
      const settingsIndex = nav.findIndex((item) => item.includes('设置'));
      return {
        prototypeSidebarAbsent: !document.querySelector('.agent-dynamics-sidebar'),
        prototypeTopbarAbsent: !document.querySelector('.agent-dynamics-topbar'),
        existingSidebarPresent: Boolean(document.querySelector('.sidebar')),
        navOrderValid: ordersIndex >= 0 && agentIndex === ordersIndex + 1 && settingsIndex === agentIndex + 1,
      };
    })()`);
    for (const [key, passed] of Object.entries(shellAssertions)) if (!passed) throw new Error(`Agent dynamics shell assertion failed: ${key}`);
    const controlAssertions = await evaluate(cdp, `(() => {
      const head = document.querySelector('.agent-dynamics-head-range select');
      const primary = document.querySelector('.agent-dynamics-head-actions .agent-dynamics-btn.primary');
      const filter = document.querySelector('.agent-dynamics-filter select');
      const search = document.querySelector('.agent-dynamics-search');
      const style = (node) => node ? getComputedStyle(node) : null;
      const headStyle = style(head);
      const primaryStyle = style(primary);
      const filterStyle = style(filter);
      const searchStyle = style(search);
      return {
        sharedSelectCount: document.querySelectorAll('.agent-dynamics-app .ui-select-control select').length,
        headAriaLabel: head?.getAttribute('aria-label') ?? '',
        filterAriaLabel: filter?.getAttribute('aria-label') ?? '',
        headTag: head?.tagName ?? '',
        filterTag: filter?.tagName ?? '',
        headFontSize: headStyle?.fontSize ?? '',
        headFontWeight: headStyle?.fontWeight ?? '',
        primaryFontSize: primaryStyle?.fontSize ?? '',
        primaryFontWeight: primaryStyle?.fontWeight ?? '',
        filterFontSize: filterStyle?.fontSize ?? '',
        searchFontSize: searchStyle?.fontSize ?? '',
        headColor: headStyle?.color ?? '',
        filterColor: filterStyle?.color ?? '',
        searchColor: searchStyle?.color ?? '',
        headBackground: headStyle?.backgroundColor ?? '',
        searchBackground: searchStyle?.backgroundColor ?? '',
        primaryBackground: primaryStyle?.backgroundColor ?? '',
        headRadius: headStyle?.borderRadius ?? '',
        filterRadius: filterStyle?.borderRadius ?? '',
        searchRadius: searchStyle?.borderRadius ?? '',
        headWidth: head?.getBoundingClientRect().width ?? 0,
        primaryWidth: primary?.getBoundingClientRect().width ?? 0,
        filterWidth: filter?.getBoundingClientRect().width ?? 0,
        searchWidth: search?.getBoundingClientRect().width ?? 0,
      };
    })()`);
    if (controlAssertions.sharedSelectCount !== 3 || controlAssertions.headTag !== 'SELECT' || controlAssertions.filterTag !== 'SELECT' || controlAssertions.headAriaLabel !== '时间范围' || controlAssertions.filterAriaLabel !== '运行状态') throw new Error(`Agent dynamics control semantics failed: ${JSON.stringify(controlAssertions)}`);
    if (controlAssertions.headFontSize !== '12px' || controlAssertions.headFontWeight !== '400' || controlAssertions.primaryFontSize !== '11px' || controlAssertions.primaryFontWeight !== '600' || controlAssertions.filterFontSize !== '12px' || controlAssertions.searchFontSize !== '11px') throw new Error(`Agent dynamics control typography failed: ${JSON.stringify(controlAssertions)}`);
    if (controlAssertions.headColor !== 'rgb(17, 24, 39)' || controlAssertions.filterColor !== 'rgb(17, 24, 39)' || controlAssertions.searchColor !== 'rgb(17, 24, 39)' || controlAssertions.headBackground !== 'rgb(246, 247, 249)' || controlAssertions.searchBackground !== 'rgb(246, 247, 249)' || controlAssertions.primaryBackground !== 'rgb(36, 90, 141)' || controlAssertions.headRadius !== '7px' || controlAssertions.filterRadius !== '7px' || controlAssertions.searchRadius !== '7px') throw new Error(`Agent dynamics control color/token failed: ${JSON.stringify(controlAssertions)}`);
    if (controlAssertions.headWidth > 120 || controlAssertions.primaryWidth > 130 || controlAssertions.filterWidth > 120 || Math.abs(controlAssertions.searchWidth - 220) > 2) throw new Error(`Agent dynamics control geometry failed: ${JSON.stringify(controlAssertions)}`);
    console.log(JSON.stringify({ controlAssertions }));
    const desktopPath = await captureViewport(cdp, 1440, 900, 'agent-dynamics-desktop-1440x900.png');
    const opened = await evaluate(cdp, `(() => { const row = Array.from(document.querySelectorAll('.agent-dynamics-run-table tbody tr')).find((item) => item.textContent?.includes('Agent Dynamics Buyer')); if (!row) return false; row.click(); return true; })()`);
    if (!opened) throw new Error('persisted run row not clickable');
    await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('处理时间线'), 'run detail drawer');
    await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('Chrome/CDP 真实数据库验收回复'), 'persisted reply in drawer');
    const timelineAssertions = await evaluate(cdp, `(() => {
      const items = Array.from(document.querySelectorAll('.agent-dynamics-timeline-item'));
      const titles = items.map((item) => item.querySelector('.agent-dynamics-timeline-title')?.textContent?.trim() ?? '');
      const hints = items.map((item) => item.querySelector('.agent-dynamics-timeline-hint')?.textContent?.trim() ?? '');
      return {
        count: items.length,
        titles,
        hints,
        closedByDefault: items.length > 0 && items.every((item) => !item.hasAttribute('open')),
        hasIntentStage: titles.some((title) => title.includes('意图识别')),
        hasContextStage: titles.some((title) => title.includes('上下文读取')),
        hasGenerationStage: titles.some((title) => title.includes('回复生成')),
        hasSendingStage: titles.some((title) => title.includes('发送提交')),
        hasPersistedStage: titles.some((title) => title.includes('消息已完成自动回复')),
        hasInputOutputHint: hints.some((hint) => hint.includes('输入') && hint.includes('输出')),
      };
    })()`);
    if (timelineAssertions.count < 5 || !timelineAssertions.closedByDefault || !timelineAssertions.hasIntentStage || !timelineAssertions.hasContextStage || !timelineAssertions.hasGenerationStage || !timelineAssertions.hasSendingStage || !timelineAssertions.hasPersistedStage || !timelineAssertions.hasInputOutputHint) {
      throw new Error(`timeline semantics failed: ${JSON.stringify(timelineAssertions)}`);
    }
    await evaluate(cdp, `(() => { const first = document.querySelector('.agent-dynamics-timeline-item .agent-dynamics-timeline-summary'); if (!first) return false; first.click(); return true; })()`);
    await waitFor(async () => Boolean(await evaluate(cdp, 'document.querySelector(".agent-dynamics-timeline-item[open] .agent-dynamics-timeline-details")')), 'timeline input/output details');
    const timelineDetailsText = String(await evaluate(cdp, 'document.querySelector(".agent-dynamics-timeline-item[open] .agent-dynamics-timeline-details")?.textContent ?? ""'));
    if (!timelineDetailsText.includes('输入') || !timelineDetailsText.includes('输出')) throw new Error(`timeline input/output groups missing: ${timelineDetailsText}`);
    const drawerText = String(await evaluate(cdp, 'document.body.innerText'));
    const drawerPath = await captureViewport(cdp, 1440, 900, 'agent-dynamics-drawer-desktop-1440x900.png');
    const mobileDrawerPath = await captureViewport(cdp, 390, 844, 'agent-dynamics-mobile-drawer-390x844.png');
    await evaluate(cdp, `(() => { const close = document.querySelector('.agent-dynamics-close'); if (!close) return false; close.click(); return true; })()`);
    await waitFor(async () => !Boolean(await evaluate(cdp, 'document.querySelector(".agent-dynamics-drawer-backdrop.open")')), 'mobile drawer close');
    const mobilePath = await captureViewport(cdp, 390, 844, 'agent-dynamics-mobile-390x844.png');
    if (!drawerText.includes('打开在线聊天') || !/已发送 \/ 已落库|模拟 \/ 已落库/.test(drawerText)) throw new Error('drawer actions or persistence outcome missing');
    console.log(JSON.stringify({ apiUrl, webUrl, accountId, runIds, screenshots: { desktopPath, drawerPath, mobileDrawerPath, mobilePath }, modelCall }));
    cdp.socket.close();
  } finally {
    globalThis.fetch = originalFetch;
    // Stop the browser and Vite child processes before closing the API server.
    // The browser keeps polling the activity endpoints; closing the server
    // first would wait forever on those keep-alive connections.
    for (const child of children) { try { child.kill(); } catch { /* best effort */ } }
    if (apiRuntime?.store?.pool) {
      if (accountId) await apiRuntime.store.pool.query('delete from messages.auto_reply_run_events where account_id=$1', [accountId]);
      if (accountId) await apiRuntime.store.pool.query('delete from messages.auto_reply_runs where account_id=$1', [accountId]);
      if (accountId) await apiRuntime.store.pool.query('delete from messages.auto_reply_inbound_inbox where account_id=$1', [accountId]);
      if (accountId) await apiRuntime.store.pool.query('delete from messages.events where account_id=$1', [accountId]);
      if (accountId) await apiRuntime.store.pool.query('delete from messages.messages where account_id=$1', [accountId]);
      for (const conversationId of conversationIds) await apiRuntime.store.pool.query('delete from messages.conversations where id=$1', [conversationId]);
      if (accountId) await apiRuntime.store.pool.query('delete from products.products where account_id=$1', [accountId]);
      if (accountId) await apiRuntime.store.pool.query('delete from observability.audit_events where account_id=$1', [accountId]);
      if (accountId) await apiRuntime.store.pool.query('delete from auth.account_scopes where account_id=$1', [accountId]);
      if (accountId) await apiRuntime.store.pool.query('delete from accounts.accounts where id=$1', [accountId]);
      if (adminId) await apiRuntime.store.pool.query('delete from auth.sessions where admin_id=$1', [adminId]);
      if (adminId) await apiRuntime.store.pool.query('delete from auth.admins where id=$1', [adminId]);
    }
    try { apiRuntime?.server?.closeAllConnections?.(); } catch { /* best effort */ }
    if (apiRuntime) {
      await Promise.race([
        apiRuntime.close(),
        new Promise((resolve) => setTimeout(resolve, 5_000)),
      ]);
    }
    try { rmSync(chromeProfile, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

run().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
