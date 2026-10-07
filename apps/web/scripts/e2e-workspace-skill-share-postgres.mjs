import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';

const root = join(import.meta.dirname, '..', '..', '..');
const chromePath = process.env.CHROME_PATH ?? join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe');
const chromeProfile = join(tmpdir(), `xianyu-agent-workspace-skill-${process.pid}`);
const children = [];
let apiRuntime;
let cdp;
let testDatabaseName;
let originalFetch;
let fixtureRoot;

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
  child.stdout.on('data', (chunk) => process.stdout.write(`[workspace-skill-e2e:${command}] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[workspace-skill-e2e:${command}] ${chunk}`));
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
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
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
  return { socket, send };
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

async function createFixtureArchive() {
  fixtureRoot = await mkdtemp(join(tmpdir(), 'xianyu-workspace-skill-fixture-'));
  const skillRoot = join(fixtureRoot, 'quarkclouddrive');
  await mkdir(join(skillRoot, 'references'), { recursive: true });
  await mkdir(join(skillRoot, 'scripts'), { recursive: true });
  await writeFile(join(skillRoot, 'SKILL.md'), '---\nname: quarkclouddrive\nversion: 1.0.0\n---\nThe file-share command is documented in references/file-share.md.\n', 'utf8');
  await writeFile(join(skillRoot, 'references', 'file-share.md'), [
    '# 网盘公开分享',
    '1. Search the exact file name with `search --name "03 PPT Master"`.',
    '2. Create the public link with `share --fid FID --title "03 PPT Master"`.',
  ].join('\n'), 'utf8');
  await writeFile(join(skillRoot, 'scripts', 'main.cjs'), [
    "const args = process.argv.slice(2);",
    "const command = args[0];",
    "if (command === 'search' && args[1] === '03 PPT Master') { console.log(JSON.stringify({ code: 0, items: [{ fid: 'fid-03-ppt-master', name: '03 PPT Master' }] })); process.exit(0); }",
    "if (command === 'share' && args[1] === 'fid-03-ppt-master') { console.log(JSON.stringify({ code: 0, url: 'https://share.example.test/03-ppt-master-public' })); process.exit(0); }",
    "console.log(JSON.stringify({ code: 2, error: 'unexpected command', args })); process.exit(2);",
  ].join('\n'), 'utf8');
  const archive = join(fixtureRoot, 'quarkclouddrive.zip');
  const tar = process.platform === 'win32' ? 'tar.exe' : 'tar';
  const result = spawnSync(tar, ['-a', '-c', '-f', archive, '-C', fixtureRoot, 'quarkclouddrive'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || 'skill archive creation failed');
  return { archive, installedRoot: join(fixtureRoot, 'installed') };
}

async function run() {
  const { archive, installedRoot } = await createFixtureArchive();
  const apiPort = await freePort();
  const webPort = await freePort();
  const debugPort = await freePort();
  const apiUrl = `http://127.0.0.1:${apiPort}`;
  const webUrl = `http://127.0.0.1:${webPort}`;
  const node = process.execPath;
  const suffix = `${Date.now()}-${process.pid}`;
  let modelCalls = 0;
  let skillRounds = 0;
  let sawReferenceSearch = false;
  let sawSearchResult = false;
  let sawShareResult = false;
  let modelAssertionError;
  const modelTrace = [];
  originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    if (!String(input).includes('model.example')) return originalFetch(input, init);
    modelCalls += 1;
    const body = JSON.parse(String(init?.body ?? '{}'));
    if (body.tool_choice === 'none') {
      return new Response(JSON.stringify({ model: body.model, choices: [{ message: { role: 'assistant', content: JSON.stringify({ steps: [{ tool: 'pi_skill_read', goal: '读取网盘公开分享说明' }, { tool: 'pi_skill_search', goal: '定位 03 PPT Master' }, { tool: 'pi_skill_exec', goal: '执行 search 后创建公开分享' }] }) } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    const lastTool = [...(body.messages ?? [])].reverse().find((message) => message.role === 'tool');
    skillRounds += 1;
    modelTrace.push({ round: skillRounds, toolNames: (body.tools ?? []).map((tool) => tool.function?.name), lastTool: String(lastTool?.content ?? '').slice(0, 500) });
    if (skillRounds === 3) {
      const content = String(lastTool?.content ?? '');
      if (!/references[\\/]file-share\.md/.test(content) || !/share --fid/.test(content)) modelAssertionError = `reference search evidence missing: ${content}`;
      else sawReferenceSearch = true;
    }
    if (skillRounds === 4) {
      if (!/fid-03-ppt-master/.test(String(lastTool?.content ?? ''))) modelAssertionError = `search result missing: ${String(lastTool?.content ?? '')}`;
      else sawSearchResult = true;
    }
    if (skillRounds === 5) {
      if (!/share\.example\.test\/03-ppt-master-public/.test(String(lastTool?.content ?? ''))) modelAssertionError = `share result missing: ${String(lastTool?.content ?? '')}`;
      else sawShareResult = true;
    }
    const tool = (name, args) => ({ id: `skill-call-${skillRounds}`, type: 'function', function: { name, arguments: JSON.stringify(args) } });
    const message = skillRounds === 1
      ? { role: 'assistant', content: '', tool_calls: [tool('pi_skill_read', { skillId: 'quarkclouddrive' })] }
      : skillRounds === 2
        ? { role: 'assistant', content: '', tool_calls: [tool('pi_skill_search', { skillId: 'quarkclouddrive', query: '03 PPT Master', mode: 'literal' })] }
        : skillRounds === 3
          ? { role: 'assistant', content: '', tool_calls: [tool('pi_skill_exec', { skillId: 'quarkclouddrive', command: 'search', args: ['03 PPT Master'] })] }
          : skillRounds === 4
            ? { role: 'assistant', content: '', tool_calls: [tool('pi_skill_exec', { skillId: 'quarkclouddrive', command: 'share', args: ['fid-03-ppt-master', '--title', '03 PPT Master'] })] }
            : { role: 'assistant', content: '已找到 03 PPT Master，并创建公开分享链接：https://share.example.test/03-ppt-master-public' };
    return new Response(JSON.stringify({ model: body.model, choices: [{ message }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  const adminPool = new pg.Pool({ connectionString: 'postgres://xianyu:xianyu_dev_only@127.0.0.1:5432/postgres' });
  testDatabaseName = `xianyu_workspace_skill_${process.pid}_${Date.now()}`.replace(/[^a-z0-9_]/gi, '_');
  await adminPool.query(`CREATE DATABASE "${testDatabaseName}"`);
  await adminPool.end();
  const databaseUrl = `postgres://xianyu:xianyu_dev_only@127.0.0.1:5432/${testDatabaseName}`;

  const migrate = spawnProcess(node, [join(root, 'apps', 'api', 'scripts', 'migrate.mjs')], { env: { ...process.env, DATABASE_URL: databaseUrl } });
  const migrateExit = await new Promise((resolve) => migrate.once('exit', resolve));
  assert.equal(migrateExit, 0, `migration failed with ${migrateExit}`);
  const apiBuild = spawnProcess(node, [join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', join(root, 'apps', 'api', 'tsconfig.json')]);
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
    webSocketAllowedOrigins: [webUrl],
    agentRuntime: 'pi',
    modelApiKey: 'workspace-skill-e2e-key',
    modelBaseUrl: 'https://model.example/v1',
    modelName: 'workspace-skill-e2e',
    modelWireApi: 'chat',
    modelTimeoutMs: 5_000,
    autoReplyModelEnabled: false,
    piSkillRoot: installedRoot,
    credentialEncryptionKey: 'workspace-skill-e2e-credential-key',
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
    headers: { 'content-type': 'application/json', 'Idempotency-Key': `workspace-skill-bootstrap-${suffix}` },
    body: JSON.stringify({ email: `workspace-skill-${suffix}@example.com`, password: 'password-123', displayName: 'Workspace Skill E2E' }),
  });
  const bootstrapBody = await bootstrap.json();
  assert.equal(bootstrap.status, 200, JSON.stringify(bootstrapBody));
  const adminId = bootstrapBody.data.profile.id;
  const cookie = cookiesFrom(bootstrap);
  const csrf = csrfFrom(cookie);
  assert.ok(cookie && csrf, 'bootstrap did not return session/csrf cookies');

  const accountResponse = await fetch(`${apiUrl}/api/v1/accounts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie, 'x-csrf-token': csrf, 'Idempotency-Key': `workspace-skill-account-${suffix}` },
    body: JSON.stringify({ platform: 'xianyu', sellerRef: `workspace-skill-${suffix}`, displayName: 'Workspace Skill E2E Account' }),
  });
  const accountBody = await accountResponse.json();
  assert.equal(accountResponse.status, 201, JSON.stringify(accountBody));
  const accountId = accountBody.data.id;
  const installed = await apiRuntime.piSkills.install({ adminId, source: archive });
  assert.equal(installed.id, 'quarkclouddrive');
  assert.equal(installed.enabled, true);

  const web = spawnProcess(node, [join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--host', '127.0.0.1', '--port', String(webPort)], {
    cwd: join(root, 'apps', 'web'),
    env: { ...process.env, VITE_API_MODE: 'live', VITE_API_BASE_URL: '', VITE_API_PROXY_TARGET: apiUrl },
  });
  await waitFor(async () => (await fetch(`${webUrl}/workspace`)).ok, 'Vite frontend');
  const chrome = spawnProcess(chromePath, ['--headless=new', '--disable-gpu', '--disable-extensions', '--no-first-run', '--no-default-browser-check', '--remote-allow-origins=*', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${chromeProfile}`, '--window-size=1440,900', 'about:blank']);
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
  const instruction = `用 03 PPT Master 的网盘公开分享链接创建（${suffix}）`;
  await evaluate(cdp, `(() => {
    const area = document.querySelector('.workspace-composer textarea');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(area, ${JSON.stringify(instruction)});
    area.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await evaluate(cdp, 'new Promise((resolve) => setTimeout(resolve, 50))');
  await evaluate(cdp, 'document.querySelector(".workspace-composer")?.requestSubmit()');
  await waitFor(async () => Boolean(await evaluate(cdp, 'Boolean(document.querySelector(".workspace-message-final"))')), 'Skill final reply in Workspace', 30_000);

  const browserState = await evaluate(cdp, `({
    finalCount: document.querySelectorAll('.workspace-message-final').length,
    finalReply: document.querySelector('.workspace-message-final')?.innerText ?? '',
    summaryCount: document.querySelectorAll('.workspace-execution-summary').length,
    toolCount: document.querySelectorAll('.workspace-tool-event').length,
    bodyText: document.body.innerText,
  })`);
  assert.equal(browserState.finalCount, 1, `expected one visible final answer: ${JSON.stringify(browserState)}`);
  assert.match(browserState.finalReply, /share\.example\.test\/03-ppt-master-public/);
  assert.ok(browserState.summaryCount >= 1, `expected execution summaries: ${JSON.stringify(browserState)}`);
  assert.ok(browserState.toolCount >= 4, `expected read/search/search/share tool events: ${JSON.stringify(browserState)}`);

  const runRow = await waitFor(async () => {
    const result = await apiRuntime.store.pool.query('select id, status, error_code, result_summary from workspace.runs where account_id=$1 order by created_at desc limit 1', [accountId]);
    return result.rows[0]?.status === 'succeeded' ? result.rows[0] : false;
  }, 'succeeded Skill run persisted', 20_000);
  const messageRows = await apiRuntime.store.pool.query('select message_type, content from workspace.messages where run_id=$1 order by sequence asc', [runRow.id]);
  const eventRows = await apiRuntime.store.pool.query('select event_type, payload_json from workspace.run_events where run_id=$1 order by sequence asc', [runRow.id]);
  const eventTypes = eventRows.rows.map((row) => row.event_type);
  const toolResults = eventRows.rows.filter((row) => row.event_type === 'tool.result');
  const toolNames = toolResults.map((row) => row.payload_json?.toolName);
  const skillSearchEvent = toolResults.find((row) => row.payload_json?.toolName === 'pi_skill_search');
  const skillExecEvents = toolResults.filter((row) => row.payload_json?.toolName === 'pi_skill_exec');
  assert.equal(runRow.error_code, null);
  assert.ok(!eventTypes.includes('MODEL_TOOL_LOOP_EXCEEDED'));
  assert.deepEqual(toolNames.slice(0, 4), ['pi_skill_read', 'pi_skill_search', 'pi_skill_exec', 'pi_skill_exec']);
  assert.equal(skillExecEvents.length, 2, `expected exactly search + share execution: ${JSON.stringify(skillExecEvents)}`);
  assert.equal(skillExecEvents.filter((row) => row.payload_json?.result?.data?.command === 'share' || String(row.payload_json?.result?.title ?? '').includes('share')).length, 1, `share must execute once: ${JSON.stringify(skillExecEvents)}`);
  assert.equal(skillSearchEvent?.payload_json?.result?.data?.sourceFile, undefined, 'search should report multi-file evidence without forcing a single file');
  const commandEvidence = skillSearchEvent?.payload_json?.result?.data?.commandEvidence;
  assert.ok(Array.isArray(commandEvidence), `reference search must return structured command evidence: ${JSON.stringify(skillSearchEvent)}`);
  assert.ok(commandEvidence.some((item) => item?.sourceFile === 'references/file-share.md' && /^share\s/.test(String(item.command))), `reference search must expose the documented share command: ${JSON.stringify(commandEvidence)}`);
  assert.ok(eventRows.rows.some((row) => row.event_type === 'workspace.skill.progress' && row.payload_json?.phase === 'execution'), 'share must enter execution phase');
  assert.ok(eventRows.rows.some((row) => row.event_type === 'workspace.skill.progress' && row.payload_json?.suggestedTool === 'pi_skill_exec'), 'search evidence must suggest pi_skill_exec');
  assert.ok(eventRows.rows.filter((row) => row.event_type === 'assistant.delta').every((row) => row.payload_json?.messageType !== 'final_answer' && row.payload_json?.phase === 'draft'), 'assistant drafts must not be projected as final answers');
  assert.equal(messageRows.rows.filter((row) => row.message_type === 'final_answer').length, 1, `expected exactly one persisted final answer: ${JSON.stringify(messageRows.rows)}`);
  assert.ok(eventTypes.includes('run.succeeded'));
  assert.equal(modelAssertionError, undefined, `${modelAssertionError ?? ''}\n${JSON.stringify(modelTrace, null, 2)}`);
  assert.ok(sawReferenceSearch && sawSearchResult && sawShareResult, `model assertions incomplete: ${JSON.stringify({ sawReferenceSearch, sawSearchResult, sawShareResult, skillRounds, modelTrace })}`);
  console.log(JSON.stringify({ apiStorage: 'postgres', runtime: 'pi', modelCalls, skillRounds, accountId, runId: runRow.id, runStatus: runRow.status, toolNames, eventTypes, browserState, modelTrace }, null, 2));
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
  try { await rm(chromeProfile, { recursive: true, force: true }); } catch (error) { console.warn(`Chrome profile cleanup failed: ${error.message}`); }
  if (testDatabaseName) {
    try {
      const cleanupPool = new pg.Pool({ connectionString: 'postgres://xianyu:xianyu_dev_only@127.0.0.1:5432/postgres' });
      await cleanupPool.query(`DROP DATABASE IF EXISTS "${testDatabaseName}" WITH (FORCE)`);
      await cleanupPool.end();
    } catch (error) { console.warn(`temporary database cleanup failed: ${error.message}`); }
  }
  if (fixtureRoot) {
    try { await rm(fixtureRoot, { recursive: true, force: true }); } catch (error) { console.warn(`fixture cleanup failed: ${error.message}`); }
  }
}
