import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';

const root = join(import.meta.dirname, '..', '..', '..');
const chromePath = process.env.CHROME_PATH ?? join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe');
const chromeProfile = join(tmpdir(), `xianyu-agent-workspace-pi-${process.pid}`);
const children = [];
let apiRuntime;
let cdp;
let testDatabaseName;
let originalFetch;

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
  child.stdout.on('data', (chunk) => process.stdout.write(`[workspace-pi-e2e:${command}] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[workspace-pi-e2e:${command}] ${chunk}`));
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

async function evaluate(client, expression) {
  const result = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? 'browser script failed');
  return result.result?.value;
}

function stopChild(child) {
  if (!child || child.exitCode !== null || child.killed) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else child.kill('SIGTERM');
}

async function stopChildAndWait(child) {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  stopChild(child);
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3_000))]);
}

async function run() {
  const apiPort = await freePort();
  const webPort = await freePort();
  const debugPort = await freePort();
  const apiUrl = `http://127.0.0.1:${apiPort}`;
  const webUrl = `http://127.0.0.1:${webPort}`;
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const suffix = `${Date.now()}-${process.pid}`;
  let modelCalls = 0;
  originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    if (!String(input).includes('model.example')) return originalFetch(input, init);
    modelCalls += 1;
    const body = JSON.parse(String(init?.body ?? '{}'));
    return new Response(JSON.stringify({
      model: body.model,
      choices: [{ message: { role: 'assistant', content: '这是 Workspace ChatGPT E2E 的确定性 AI 回复。' } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  const adminPool = new pg.Pool({ connectionString: 'postgres://xianyu:xianyu_dev_only@127.0.0.1:5432/postgres' });
  testDatabaseName = `xianyu_workspace_pi_${process.pid}_${Date.now()}`.replace(/[^a-z0-9_]/gi, '_');
  await adminPool.query(`CREATE DATABASE "${testDatabaseName}"`);
  await adminPool.end();
  const databaseUrl = `postgres://xianyu:xianyu_dev_only@127.0.0.1:5432/${testDatabaseName}`;

  const migrate = spawnProcess(npm, ['--workspace', 'apps/api', 'run', 'migrate'], { env: { ...process.env, DATABASE_URL: databaseUrl } });
  const migrateExit = await new Promise((resolve) => migrate.once('exit', resolve));
  assert.equal(migrateExit, 0, `migration failed with ${migrateExit}`);

  const apiBuild = spawnProcess(npm, ['--workspace', 'apps/api', 'run', 'build']);
  const buildExit = await new Promise((resolve) => apiBuild.once('exit', resolve));
  assert.equal(buildExit, 0, `API build failed with ${buildExit}`);

  const { createApp } = await import(pathToFileURL(join(root, 'apps', 'api', 'dist', 'app.js')).href);
  apiRuntime = createApp({
    host: '127.0.0.1',
    port: apiPort,
    databaseUrl,
    allowInMemory: false,
    cookieSecure: false,
    sessionIdleMs: 1_800_000,
    sessionAbsoluteMs: 28_800_000,
    xianyuQrMode: 'stub',
    redisUrl: undefined,
    webSocketAllowedOrigins: [webUrl],
    agentRuntime: 'pi',
    modelApiKey: 'workspace-chatgpt-e2e-key',
    modelBaseUrl: 'https://model.example/v1',
    modelName: 'workspace-chatgpt-e2e',
    modelWireApi: 'chat',
    modelTimeoutMs: 5_000,
    autoReplyModelEnabled: false,
    credentialEncryptionKey: 'workspace-chatgpt-e2e-credential-key',
    objectStorageEndpoint: 'http://127.0.0.1:19000',
    objectStorageAccessKey: 'xianyu',
    objectStorageSecretKey: 'xianyu_dev_only',
    objectStorageBucket: 'xianyu-assets',
    objectStorageRegion: 'us-east-1',
  });
  await apiRuntime.listen();
  await waitFor(async () => (await fetch(`${apiUrl}/healthz`)).ok, 'Postgres-backed API');

  const bootstrap = await fetch(`${apiUrl}/api/v1/auth/bootstrap`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'Idempotency-Key': `workspace-pi-bootstrap-${suffix}` },
    body: JSON.stringify({ email: `workspace-pi-${suffix}@example.com`, password: 'password-123', displayName: 'Workspace Pi E2E' }),
  });
  assert.equal(bootstrap.status, 200, await bootstrap.text());
  const cookie = cookiesFrom(bootstrap);
  const csrf = csrfFrom(cookie);
  assert.ok(cookie && csrf, 'bootstrap did not return session/csrf cookies');

  const accountResponse = await fetch(`${apiUrl}/api/v1/accounts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie, 'x-csrf-token': csrf, 'Idempotency-Key': `workspace-pi-account-${suffix}` },
    body: JSON.stringify({ platform: 'xianyu', sellerRef: `workspace-pi-${suffix}`, displayName: 'Workspace Pi E2E Account' }),
  });
  if (accountResponse.status !== 201) throw new Error(`account seed failed: ${accountResponse.status} ${await accountResponse.text()}`);
  const accountId = (await accountResponse.json()).data?.id;
  assert.ok(accountId, 'account seed did not return account id');

  const web = spawnProcess(npm, ['--workspace', 'apps/web', 'run', 'dev', '--', '--host', '127.0.0.1', '--port', String(webPort)], {
    env: { ...process.env, VITE_API_MODE: 'live', VITE_API_BASE_URL: '', VITE_API_PROXY_TARGET: apiUrl },
  });
  await waitFor(async () => (await fetch(`${webUrl}/workspace`)).ok, 'Vite frontend');
  const chrome = spawnProcess(chromePath, [
    '--headless=new', '--disable-gpu', '--disable-extensions', '--no-first-run', '--no-default-browser-check',
    '--remote-allow-origins=*', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${chromeProfile}`,
    '--window-size=1440,900', 'about:blank',
  ]);
  await waitFor(async () => chrome.exitCode === null && (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).ok, 'local Chrome');
  cdp = await createCdpClient(debugPort);
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
    return Boolean(shell && !missing && !document.querySelector('.workspace-inline-error'));
  })()`), 'account context');

  await evaluate(cdp, 'document.querySelector(".workspace-sessions-panel .workspace-panel-head button")?.click()');
  await waitFor(async () => String(await evaluate(cdp, 'document.querySelector(".workspace-thread h2")?.textContent ?? ""')).includes('新会话'), 'new conversation draft');
  const instruction = `请检查当前 Workspace 状态并返回摘要（${suffix}）`;
  await evaluate(cdp, `(() => {
    const area = document.querySelector('.workspace-composer textarea');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(area, ${JSON.stringify(instruction)});
    area.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await evaluate(cdp, 'document.querySelector(".workspace-composer button[type=submit]")?.click()');
  await waitFor(async () => Boolean(await evaluate(cdp, 'Boolean(document.querySelector(".workspace-message-final"))')), 'AI final reply in Workspace', 20_000);
  const browserReply = await evaluate(cdp, 'document.querySelector(".workspace-message-final")?.innerText ?? ""');
  assert.match(String(browserReply), /确定性 AI 回复/);
  assert.ok(modelCalls >= 1, 'deterministic model stub was not called');

  const runRow = await waitFor(async () => {
    const result = await apiRuntime.store.pool.query('select id, status, result_summary from workspace.runs where account_id=$1 order by created_at desc limit 1', [accountId]);
    return result.rows[0]?.status === 'succeeded' ? result.rows[0] : false;
  }, 'succeeded Workspace run persisted', 20_000);
  const messageRows = await apiRuntime.store.pool.query('select message_type, content from workspace.messages where run_id=$1 order by sequence asc', [runRow.id]);
  const eventRows = await apiRuntime.store.pool.query('select event_type, payload_json from workspace.run_events where run_id=$1 order by sequence asc', [runRow.id]);
  const messageTypes = messageRows.rows.map((row) => row.message_type);
  assert.ok(messageTypes.includes('user_message'), `missing persisted user message: ${JSON.stringify(messageRows.rows)}`);
  assert.ok(messageTypes.includes('reasoning_summary'), `missing persisted reasoning summary: ${JSON.stringify(messageRows.rows)}`);
  assert.ok(messageTypes.includes('final_answer'), `missing persisted final answer: ${JSON.stringify(messageRows.rows)}`);
  assert.ok(messageRows.rows.some((row) => row.message_type === 'final_answer' && String(row.content).includes('确定性 AI 回复')));
  const eventTypes = eventRows.rows.map((row) => row.event_type);
  assert.ok(eventTypes.includes('run.succeeded'), `missing run.succeeded event: ${JSON.stringify(eventRows.rows)}`);
  assert.ok(eventTypes.includes('workspace.message'), `missing workspace.message event: ${JSON.stringify(eventRows.rows)}`);
  assert.ok(eventTypes.includes('message.appended'), `missing message.appended event: ${JSON.stringify(eventRows.rows)}`);

  const sessionReadback = await fetch(`${apiUrl}/api/v1/workspace/agent-sessions?accountId=${encodeURIComponent(accountId)}`, { headers: { cookie } });
  assert.equal(sessionReadback.status, 200);
  const sessionPayload = await sessionReadback.json();
  const session = sessionPayload.data?.items?.[0];
  assert.ok(session?.id, 'workspace session did not persist');
  const browserState = await evaluate(cdp, `({
    sessionCount: document.querySelectorAll('.workspace-session-row').length,
    finalReply: document.querySelector('.workspace-message-final')?.innerText ?? '',
    traceCount: document.querySelectorAll('.workspace-agent-trace').length,
    collapsedTraceCount: document.querySelectorAll('.workspace-agent-trace .workspace-trace-toggle[aria-expanded="false"]').length,
    avatarCount: document.querySelectorAll('.workspace-message-avatar, .workspace-message-icon').length,
  })`);
  assert.equal(browserState.traceCount, 1, `expected one merged execution trace: ${JSON.stringify(browserState)}`);
  assert.equal(browserState.collapsedTraceCount, 1, `execution trace should be collapsed by default: ${JSON.stringify(browserState)}`);
  assert.equal(browserState.avatarCount, 0, `avatars should not render in the conversation stream: ${JSON.stringify(browserState)}`);
  console.log(JSON.stringify({
    apiStorage: 'postgres',
    runtime: 'pi',
    modelCalls,
    accountId,
    sessionId: session.id,
    runId: runRow.id,
    runStatus: runRow.status,
    messageTypes,
    eventTypes,
    browserState,
  }, null, 2));
}

try {
  await run();
} finally {
  if (originalFetch) globalThis.fetch = originalFetch;
  if (cdp?.socket) cdp.socket.close();
  for (const child of children.reverse()) {
    await stopChildAndWait(child);
    child.stdout?.destroy();
    child.stderr?.destroy();
  }
  try { await apiRuntime?.close(); } catch (error) { console.warn(`API cleanup failed: ${error.message}`); }
  try { rmSync(chromeProfile, { recursive: true, force: true }); } catch (error) { console.warn(`Chrome profile cleanup failed: ${error.message}`); }
  if (testDatabaseName) {
    try {
      const cleanupPool = new pg.Pool({ connectionString: 'postgres://xianyu:xianyu_dev_only@127.0.0.1:5432/postgres' });
      await cleanupPool.query(`DROP DATABASE IF EXISTS "${testDatabaseName}" WITH (FORCE)`);
      await cleanupPool.end();
    } catch (error) { console.warn(`temporary database cleanup failed: ${error.message}`); }
  }
}
