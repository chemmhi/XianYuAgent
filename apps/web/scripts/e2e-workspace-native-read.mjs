import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';

const root = join(import.meta.dirname, '..', '..', '..');
const artifactDir = join(root, 'artifacts', 'real-verify', 'S4-VS-WS-VS-01');
const screenshotDir = join(artifactDir, 'screenshots');
const chromeProfile = join(tmpdir(), `xianyu-agent-workspace-native-read-${process.pid}`);
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
  const child = spawn(command, args, { cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, shell: command.endsWith('.cmd'), ...options });
  child.stdout.on('data', (chunk) => process.stdout.write(`[workspace-native-read:${command}] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[workspace-native-read:${command}] ${chunk}`));
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

async function seedNativeReadData(pool, { adminId, accountId, suffix }) {
  const productId = randomUUID();
  const couponBatchId = randomUUID();
  const orderId = randomUUID();
  const conversationId = randomUUID();
  const createdAt = new Date(Date.now() - 45 * 60 * 1000).toISOString();
  const updatedAt = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  await pool.query(`insert into products.products (id,account_id,external_product_ref,title,description,price_minor,status,created_at,updated_at)
    values ($1,$2,$3,$4,$5,$6,'published',$7,$8)`, [productId, accountId, `NATIVE-PRODUCT-${suffix}`, 'E2E 原生商品', 'Workspace 原生只读验收商品', 12900, createdAt, updatedAt]);
  await pool.query(`insert into coupons.coupon_batches (id,sequence_id,account_id,label,purpose,total_count,status,version,metadata_json,created_at,updated_at)
    values ($1,1,$2,$3,'data',2,'active',1,'{}'::jsonb,$4,$5)`, [couponBatchId, accountId, 'E2E 原生卡券', createdAt, updatedAt]);
  await pool.query(`insert into coupons.coupon_items (id,batch_id,content_ciphertext,status,created_at)
    values ($1,$2,$3,'available',$4),($5,$2,$6,'available',$4)`, [randomUUID(), couponBatchId, Buffer.from('native-secret-a'), createdAt, randomUUID(), Buffer.from('native-secret-b')]);
  await pool.query(`insert into coupons.coupon_bindings (id,coupon_batch_id,product_id,priority,status,created_at,updated_at)
    values ($1,$2,$3,0,'active',$4,$4)`, [randomUUID(), couponBatchId, productId, createdAt]);
  await pool.query(`insert into orders.orders (id,order_no,account_id,account_name,buyer_id,buyer_name,buyer_nickname,item_id,item_title,amount_minor,payment_status,order_status,delivery_status,after_sales_status,delivery_type,created_at,updated_at,product_id,config_version,source)
    values ($1,$2,$3,'Workspace 原生账号','native-buyer-1','Native Buyer','Native Buyer Nick','NATIVE-ITEM-1','E2E 原生商品',12900,'paid','open','pending','none','coupon_only',$4,$5,$6,1,'local')`, [orderId, `NATIVE-ORDER-${suffix}`, accountId, createdAt, updatedAt, productId]);
  await pool.query(`insert into messages.conversations (id,account_id,external_conversation_ref,buyer_ref,buyer_display_name,item_ref,item_title,last_message_preview,last_message_at,created_at,updated_at)
    values ($1,$2,$3,'native-buyer-1','Native Buyer Nick','NATIVE-ITEM-1','E2E 原生商品','你好，什么时候发货？',$4,$4,$4)`, [conversationId, accountId, `native-read-conversation-${suffix}`, createdAt]);
  const runSeeds = [
    { status: 'persisted', decision: 'replied', durationMs: 320, intent: 'product_lookup' },
    { status: 'handoff', decision: 'handoff', durationMs: 780, intent: 'order_question' },
    { status: 'failed', decision: 'failed', durationMs: 1450, intent: 'delivery_question', failureCode: 'NATIVE_READ_FIXTURE' },
  ];
  for (const [index, seed] of runSeeds.entries()) {
    const messageId = randomUUID();
    const runId = randomUUID();
    const runCreatedAt = new Date(Date.now() - (index + 1) * 10 * 60 * 1000).toISOString();
    const runUpdatedAt = new Date(Date.parse(runCreatedAt) + seed.durationMs).toISOString();
    await pool.query(`insert into messages.messages (id,conversation_id,account_id,direction,sender_role,body_type,body_text,source,created_at)
      values ($1,$2,$3,'inbound','buyer','text',$4,'human',$5)`, [messageId, conversationId, accountId, `native activity fixture ${index + 1}`, runCreatedAt]);
    await pool.query(`insert into messages.auto_reply_runs (id,admin_id,account_id,conversation_id,inbound_message_id,intent,decision,status,risk_flags,order_refs,input_digest,created_at,updated_at,failure_code)
      values ($1,$2,$3,$4,$5,$6,$7,$8,'[]'::jsonb,'[]'::jsonb,$9,$10,$11,$12)`, [runId, adminId, accountId, conversationId, messageId, seed.intent, seed.decision, seed.status, `digest-${index + 1}`, runCreatedAt, runUpdatedAt, seed.failureCode ?? null]);
  }
  await pool.query(`insert into observability.health_snapshots (component,status,observed_at,details_json)
    values ('workspace-native-read','healthy',now(),'{}'::jsonb)`);
  return { productId, couponBatchId, orderId, conversationId };
}

async function run() {
  mkdirSync(chromeProfile, { recursive: true });
  const apiPort = await freePort();
  const webPort = await freePort();
  const debugPort = await freePort();
  const apiUrl = `http://127.0.0.1:${apiPort}`;
  const webUrl = `http://127.0.0.1:${webPort}`;
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  testDatabaseName = `xianyu_workspace_native_read_${process.pid}_${Date.now()}`.replace(/[^a-z0-9_]/gi, '_');
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
  const api = spawnProcess(process.execPath, ['apps/api/dist/index.js'], { env: { ...process.env, HOST: '127.0.0.1', PORT: String(apiPort), DATABASE_URL: databaseUrl, REDIS_URL: 'redis://127.0.0.1:6379', ALLOW_IN_MEMORY: 'false', COOKIE_SECURE: 'false', XIANYU_QR_MODE: 'stub', AGENT_RUNTIME: workspaceE2eRuntime } });
  await waitFor(async () => (await fetch(`${apiUrl}/healthz`)).ok, 'Postgres-backed API');
  const suffix = `${Date.now()}-${process.pid}`;
  const bootstrap = await fetch(`${apiUrl}/api/v1/auth/bootstrap`, { method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': `native-read-bootstrap-${suffix}` }, body: JSON.stringify({ email: `native-read-${suffix}@example.com`, password: 'password-123', displayName: 'Workspace Native Read E2E' }) });
  if (!bootstrap.ok) throw new Error(`bootstrap failed: ${bootstrap.status} ${await bootstrap.text()}`);
  const cookie = cookiesFrom(bootstrap);
  const csrf = csrfFrom(cookie);
  if (!cookie || !csrf) throw new Error('bootstrap did not return session/csrf cookies');
  const accountResponse = await fetch(`${apiUrl}/api/v1/accounts`, { method: 'POST', headers: { 'content-type': 'application/json', cookie, 'x-csrf-token': csrf, 'Idempotency-Key': `native-read-account-${suffix}` }, body: JSON.stringify({ platform: 'xianyu', sellerRef: `native-read-${suffix}`, displayName: 'Workspace 原生账号' }) });
  if (!accountResponse.ok) throw new Error(`account seed failed: ${accountResponse.status} ${await accountResponse.text()}`);
  const accountPayload = await accountResponse.json();
  const accountId = accountPayload.data?.id;
  const adminId = accountPayload.data?.adminId ?? null;
  if (!accountId) throw new Error('account seed did not return account id');
  const sessionResponse = await fetch(`${apiUrl}/api/v1/auth/session`, { headers: { cookie } });
  const sessionPayload = sessionResponse.ok ? await sessionResponse.json() : null;
  const resolvedAdminId = sessionPayload?.data?.admin?.id ?? sessionPayload?.data?.adminId ?? adminId;
  if (!resolvedAdminId) throw new Error('could not resolve admin id for fixture seed');
  const seedPool = new pg.Pool({ connectionString: databaseUrl });
  await seedNativeReadData(seedPool, { adminId: resolvedAdminId, accountId, suffix });
  await seedPool.end();

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
  await waitFor(async () => Boolean(await evaluate(cdp, 'Boolean(document.querySelector("[data-workspace-domain]"))')), 'authenticated Workspace surface');
  await waitFor(async () => await evaluate(cdp, `(() => {
    const shell = document.querySelector('[data-workspace-domain]');
    const missing = Array.from(document.querySelectorAll('.workspace-state strong')).some((node) => node.textContent?.includes('请先选择账号'));
    const error = document.querySelector('.workspace-inline-error');
    return Boolean(shell && !missing && !error);
  })()`), 'account context');
  await evaluate(cdp, 'document.querySelector(".workspace-sessions-panel .workspace-panel-head button")?.click()');
  await waitFor(async () => String(await evaluate(cdp, 'document.querySelector(".workspace-thread h2")?.textContent ?? ""')).includes('新会话'), 'new conversation draft');

  async function runQuery(instruction, expected, forbidden = []) {
    const currentTitle = String(await evaluate(cdp, 'document.querySelector(".workspace-thread h2")?.textContent ?? ""'));
    if (!currentTitle.includes('新会话')) {
      await evaluate(cdp, 'document.querySelector(".workspace-sessions-panel .workspace-panel-head button")?.click()');
      await waitFor(async () => String(await evaluate(cdp, 'document.querySelector(".workspace-thread h2")?.textContent ?? ""')).includes('新会话'), 'new conversation draft');
    }
    const before = Number(await evaluate(cdp, 'document.querySelectorAll(".workspace-message-final").length'));
    await evaluate(cdp, `(() => { const area = document.querySelector('.workspace-composer textarea'); const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set; setter?.call(area, ${JSON.stringify(instruction)}); area.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await evaluate(cdp, 'new Promise((resolve) => setTimeout(resolve, 50))');
    await evaluate(cdp, 'document.querySelector(".workspace-composer")?.requestSubmit()');
    try {
      await waitFor(async () => Number(await evaluate(cdp, 'document.querySelectorAll(".workspace-message-final").length')) > before, `native read result: ${instruction}`, 15_000);
    } catch (error) {
      const debugState = await evaluate(cdp, '({ body: document.body.innerText, href: location.href, finals: Array.from(document.querySelectorAll(".workspace-message-final")).map((node) => node.innerText), errors: Array.from(document.querySelectorAll(".workspace-inline-error")).map((node) => node.innerText), sessionRows: document.querySelectorAll(".workspace-session-row").length, h2: document.querySelector(".workspace-thread h2")?.textContent ?? "", status: document.querySelector(".workspace-status")?.textContent ?? "" })');
      const networkDebug = cdp.events.filter((event) => String(event.params?.request?.url ?? event.params?.url ?? '').includes('/api/v1/workspace/')).slice(-40).map((event) => ({ method: event.method, url: event.params?.request?.url ?? event.params?.url, request: event.params?.request?.postData, error: event.params?.errorText }));
      console.error(JSON.stringify({ debugState, networkDebug }, null, 2));
      throw error;
    }
    const result = await evaluate(cdp, 'Array.from(document.querySelectorAll(".workspace-message-final")).at(-1)?.innerText ?? ""');
    if (!String(result).includes(expected)) throw new Error(`query result missing ${expected}: ${result}`);
    for (const token of forbidden) if (String(result).includes(token)) throw new Error(`query result leaked ${token}: ${result}`);
    return result;
  }

  const productResult = await runQuery('查看当前账号的商品', 'E2E 原生商品', ['native-secret-a', 'Credential']);
  const couponResult = await runQuery('查看当前账号有哪些可用卡券', 'E2E 原生卡券', ['native-secret-a', 'native-secret-b', 'Credential']);
  const orderResult = await runQuery('查看最近的订单和未发货订单', `NATIVE-ORDER-${suffix}`, ['Credential']);
  const activityResult = await runQuery('查看今天 Agent 运营数据', '收到 3 条消息', ['Credential', 'cookie']);
  const runIds = [...new Set(cdp.events.flatMap((event) => {
    const url = event.params?.request?.url ?? event.params?.url ?? '';
    const match = String(url).match(/\/api\/v1\/workspace\/runs\/([^/?#]+)/);
    return match ? [match[1]] : [];
  }))];
  if (runIds.length < 4) throw new Error(`expected four native-read runs, got ${runIds.length}`);
  const persisted = [];
  for (const runId of runIds.slice(-4)) {
    const runResponse = await fetch(`${apiUrl}/api/v1/workspace/runs/${encodeURIComponent(runId)}`, { headers: { cookie } });
    if (!runResponse.ok) throw new Error(`run readback failed: ${runResponse.status}`);
    const runPayload = await runResponse.json();
    if (runPayload.data?.status !== 'succeeded') throw new Error(`run did not succeed: ${JSON.stringify(runPayload.data)}`);
    const eventResponse = await fetch(`${apiUrl}/api/v1/workspace/runs/${encodeURIComponent(runId)}/events?after=0`, { headers: { cookie } });
    if (!eventResponse.ok) throw new Error(`run event readback failed: ${eventResponse.status}`);
    const eventPayload = await eventResponse.json();
    if (!(eventPayload.data?.items ?? []).some((event) => event.eventType === 'run.succeeded')) throw new Error(`run.succeeded missing: ${runId}`);
    persisted.push(runId);
  }
  const sessionReadback = await fetch(`${apiUrl}/api/v1/workspace/agent-sessions?accountId=${encodeURIComponent(accountId)}`, { headers: { cookie } });
  if (!sessionReadback.ok) throw new Error(`session readback failed: ${sessionReadback.status}`);
  const sessionPayloadReadback = await sessionReadback.json();
  if ((sessionPayloadReadback.data?.items ?? []).length !== 4) throw new Error(`expected four persisted Workspace sessions, got ${(sessionPayloadReadback.data?.items ?? []).length}`);
  const desktopPath = await captureViewport(cdp, 1440, 900, 'workspace-native-read-desktop-1440x900.png');
  const mobilePath = await captureViewport(cdp, 390, 844, 'workspace-native-read-mobile-390x844.png');
  const browserState = await evaluate(cdp, '({ href: location.href, sessionCount: document.querySelectorAll(".workspace-session-row").length, finalCount: document.querySelectorAll(".workspace-message-final").length, result: document.querySelector(".workspace-message-final:last-of-type")?.innerText ?? "" })');
  console.log(JSON.stringify({ status: 'PASS', slice: 'WS-VS-01', storage: 'postgres', runtime: workspaceE2eRuntime, accountId, runCount: persisted.length, browserState, results: { product: productResult, coupon: couponResult, order: orderResult, activity: activityResult }, screenshots: { desktopPath, mobilePath } }, null, 2));
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
