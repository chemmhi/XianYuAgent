import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const root = join(import.meta.dirname, '..', '..', '..');
const chromePath = process.env.CHROME_PATH ?? join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe');
const chromeProfile = join(tmpdir(), `xianyu-agent-workspace-coupon-auto-${process.pid}`);
const artifactDir = join(root, 'artifacts', 'real-verify', 'workspace-coupon-auto-delivery');
const children = [];
let testDatabaseName;
let fixtureRoot;
let apiRuntime;
let originalFetch;
let cdp;

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
  child.stdout.on('data', (chunk) => process.stdout.write(`[workspace-coupon-auto:${command}] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[workspace-coupon-auto:${command}] ${chunk}`));
  children.push(child);
  return child;
}

async function waitFor(check, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
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

async function createFixtureArchive() {
  fixtureRoot = await mkdtemp(join(tmpdir(), 'xianyu-workspace-coupon-auto-fixture-'));
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

async function runInAppBrowserFlow({ webUrl, artifactDir, confirmations }) {
  const moduleUrl = process.env.CODEX_CUA_MODULE_URL;
  if (!moduleUrl) throw new Error('IAB mode requires CODEX_CUA_MODULE_URL pointing to the Codex CUA runtime');
  const { cua } = await import(moduleUrl);
  await cua.initialize();
  const summaries = await cua.browsers.list();
  const iabSummary = summaries.find((item) => item.type === 'iab');
  if (!iabSummary) throw new Error('Codex In-app Browser was not found');
  const browser = await cua.browsers.get(iabSummary.id);
  const tabInfo = await waitFor(async () => {
    const tabs = await browser.tabs.list();
    return tabs.find((item) => item.url === `${webUrl}/workspace`);
  }, `Codex In-app Browser tab for ${webUrl}/workspace`, 120_000);
  if (!tabInfo) throw new Error(`No exact IAB Workspace tab open for ${webUrl}/workspace`);
  const tab = await browser.tabs.get(tabInfo.id);
  const initial = { url: await tab.url(), title: await tab.title(), dom: await tab.playwright.domSnapshot() };
  await writeFile(join(artifactDir, 'iab-before.json'), JSON.stringify(initial, null, 2));
  const hasComposer = await tab.playwright.locator('.workspace-composer textarea').isVisible();
  if (!hasComposer) throw new Error('IAB Workspace composer is not visible; authenticate and select an account first');
  await tab.playwright.evaluate(`(() => { const instruction = ${JSON.stringify('用 03 PPT Master 的网盘公开分享链接创建一个卡券，关联“AI 技术咨询，需求定制开发服务”这个商品，然后启用自动发货')}; const area = document.querySelector('.workspace-composer textarea'); const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set; setter?.call(area, instruction); area?.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('.workspace-composer')?.requestSubmit(); })()`);
  const readStableState = async () => {
    const first = {
      streamCount: await tab.playwright.locator('[data-testid="workspace-message-stream"]').count(),
      planCount: await tab.playwright.locator('[data-testid="workspace-plan-card"], .workspace-plan-float').count(),
      confirmationCount: await tab.playwright.locator('[data-testid="workspace-confirmation-card"]').count(),
      activityCount: await tab.playwright.locator('[data-testid="workspace-activity-action"]').count(),
      streamText: await tab.playwright.locator('[data-testid="workspace-message-stream"]').innerText(),
    };
    await new Promise((resolve) => setTimeout(resolve, 250));
    const second = {
      streamCount: await tab.playwright.locator('[data-testid="workspace-message-stream"]').count(),
      planCount: await tab.playwright.locator('[data-testid="workspace-plan-card"], .workspace-plan-float').count(),
      confirmationCount: await tab.playwright.locator('[data-testid="workspace-confirmation-card"]').count(),
      activityCount: await tab.playwright.locator('[data-testid="workspace-activity-action"]').count(),
      streamText: await tab.playwright.locator('[data-testid="workspace-message-stream"]').innerText(),
    };
    assert.deepEqual(second, first, 'IAB DOM state must be stable across two reads');
    assert.ok(first.streamText.indexOf('用户') <= first.streamText.indexOf('已完成') || first.streamText.includes('执行'), 'IAB visible text order is unexpected');
    return first;
  };
  for (let index = 1; index <= 3; index += 1) {
    await waitFor(async () => await tab.playwright.locator('[data-testid="workspace-confirmation-card"]').isVisible(), `IAB confirmation ${index}`, 30_000);
    const cardText = await tab.playwright.locator('[data-testid="workspace-confirmation-card"]').innerText();
    const before = await tab.playwright.domSnapshot();
    const continueButton = tab.playwright.locator('[data-testid="workspace-confirm-continue"]');
    await continueButton.click();
    try {
      await waitFor(async () => !(await tab.playwright.locator('[data-testid="workspace-confirmation-card"]').isVisible()), `IAB confirmation ${index} click resolved`, 1_000);
    } catch {
      await tab.playwright.locator('[data-testid="workspace-confirm-continue"]').press('Enter');
    }
    await waitFor(async () => !(await tab.playwright.locator('[data-testid="workspace-confirmation-card"]').isVisible()), `IAB confirmation ${index} resolved`, 30_000);
    const after = await tab.playwright.domSnapshot();
    const stable = await readStableState();
    confirmations.push({ index, cardText, beforeSnapshot: before, afterSnapshot: after, stable });
  }
  await waitFor(async () => (await tab.playwright.locator('.workspace-message-final').count()) === 1, 'IAB final reply', 30_000);
  const finalState = { url: await tab.url(), title: await tab.title(), dom: await tab.playwright.domSnapshot(), finalReply: await tab.playwright.locator('.workspace-message-final').innerText(), finalCount: await tab.playwright.locator('.workspace-message-final').count(), activityCount: await tab.playwright.locator('[data-testid="workspace-activity-action"]').count() };
  await writeFile(join(artifactDir, 'iab-after.json'), JSON.stringify(finalState, null, 2));
  const stable = await readStableState();
  return { href: finalState.url, finalCount: finalState.finalCount, finalReply: finalState.finalReply, planCount: stable.planCount, confirmationCount: stable.confirmationCount, activityCount: stable.activityCount, bodyText: finalState.dom };
}

async function waitForExternalIabEvidence({ artifactDir, confirmations }) {
  const evidencePath = join(artifactDir, 'iab-browser-state.json');
  const evidence = await waitFor(async () => {
    try {
      const parsed = JSON.parse(await readFile(evidencePath, 'utf8'));
      return parsed?.browserState?.finalCount === 1 && Array.isArray(parsed?.confirmations) ? parsed : false;
    } catch {
      return false;
    }
  }, `external IAB evidence at ${evidencePath}`, 300_000);
  confirmations.push(...evidence.confirmations);
  return evidence.browserState;
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

const planStep = (tool, variant, goal) => ({ tool, variant, contractVersion: 1, goal });

async function run() {
  const { archive, installedRoot } = await createFixtureArchive();
  const browserMode = process.env.WORKSPACE_COUPON_AUTO_BROWSER ?? 'cdp';
  const apiPort = await freePort();
  const webPort = await freePort();
  const debugPort = await freePort();
  const apiUrl = `http://127.0.0.1:${apiPort}`;
  const webUrl = `http://127.0.0.1:${webPort}`;
  const suffix = `${Date.now()}-${process.pid}`;
  let modelCalls = 0;
  let round = 0;
  const modelTrace = [];
  const confirmations = [];
  let modelAssertionError;

  originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    if (!String(input).includes('model.example')) return originalFetch(input, init);
    modelCalls += 1;
    const body = JSON.parse(String(init?.body ?? '{}'));
    if (body.tool_choice === 'none') {
      if (round >= 8) return new Response(JSON.stringify({ model: body.model, choices: [{ message: { role: 'assistant', content: '已完成卡券创建、商品关联与付费自动发货启用。' } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
      const steps = [
        planStep('pi_skill_catalog', 'default', '获取 Skill 能力总览和文档索引'),
        planStep('pi_skill_read', 'default', '读取文件分享命令文档'),
        planStep('pi_skill_exec', 'search', '按精确名称检索 03 PPT Master'),
        planStep('pi_skill_exec', 'share', '为检索到的文件创建公开分享链接'),
        planStep('workspace_product_search', 'default', '定位目标商品并取得 productId'),
        planStep('workspace_prepare_write', 'coupon_create', '创建 API 型卡券并写入公开分享 URL'),
        planStep('workspace_prepare_write', 'coupon_bind', '将卡券批次关联目标商品'),
        planStep('workspace_prepare_write', 'product_automation_update', '启用商品付费自动发货并绑定卡券'),
      ];
      return new Response(JSON.stringify({ model: body.model, choices: [{ message: { role: 'assistant', content: JSON.stringify({ steps }) } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    const lastTool = [...(body.messages ?? [])].reverse().find((message) => message.role === 'tool');
    const lastText = String(lastTool?.content ?? '');
    const modelContext = (body.messages ?? []).map((message) => String(message.content ?? '')).join('\n');
    round += 1;
    modelTrace.push({ round, toolNames: (body.tools ?? []).map((tool) => tool.function?.name), lastTool: lastText.slice(0, 500) });
    if (round === 1) return new Response(JSON.stringify({ model: body.model, choices: [{ message: { role: 'assistant', content: '', tool_calls: [{ id: `call-${round}`, type: 'function', function: { name: 'pi_skill_catalog', arguments: JSON.stringify({ skillId: 'quarkclouddrive' }) } }] } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    if (round === 2) return new Response(JSON.stringify({ model: body.model, choices: [{ message: { role: 'assistant', content: '', tool_calls: [{ id: `call-${round}`, type: 'function', function: { name: 'pi_skill_read', arguments: JSON.stringify({ skillId: 'quarkclouddrive', filePath: 'references/file-share.md' }) } }] } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    if (round === 3) return new Response(JSON.stringify({ model: body.model, choices: [{ message: { role: 'assistant', content: '', tool_calls: [{ id: `call-${round}`, type: 'function', function: { name: 'pi_skill_exec', arguments: JSON.stringify({ skillId: 'quarkclouddrive', command: 'search', args: ['03 PPT Master'] }) } }] } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    if (round === 4) return new Response(JSON.stringify({ model: body.model, choices: [{ message: { role: 'assistant', content: '', tool_calls: [{ id: `call-${round}`, type: 'function', function: { name: 'pi_skill_exec', arguments: JSON.stringify({ skillId: 'quarkclouddrive', command: 'share', args: ['fid-03-ppt-master', '--title', '03 PPT Master'] }) } }] } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    if (round === 5) return new Response(JSON.stringify({ model: body.model, choices: [{ message: { role: 'assistant', content: '', tool_calls: [{ id: `call-${round}`, type: 'function', function: { name: 'workspace_product_search', arguments: JSON.stringify({ query: 'AI 技术咨询，需求定制开发服务' }) } }] } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    if (round === 6) return new Response(JSON.stringify({ model: body.model, choices: [{ message: { role: 'assistant', content: '', tool_calls: [{ id: `call-${round}`, type: 'function', function: { name: 'workspace_prepare_write', arguments: JSON.stringify({ operation: 'coupon_create', parameters: { label: '03 PPT Master', purpose: 'api', apiConfig: { url: 'https://share.example.test/03-ppt-master-public', method: 'GET' } } }) } }] } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    const observedBatchId = modelContext.match(/[\"']couponBatchId[\"']\s*:\s*[\"']([A-Za-z0-9_-]+)[\"']/i)?.[1]
      ?? modelContext.match(/[\"']batchId[\"']\s*:\s*[\"']([A-Za-z0-9_-]+)[\"']/i)?.[1]
      ?? modelContext.match(/batchId[\"'=:\\s]+([A-Za-z0-9_-]+)/i)?.[1]
      ?? 'BATCH_PLACEHOLDER';
    if (round === 7) return new Response(JSON.stringify({ model: body.model, choices: [{ message: { role: 'assistant', content: '', tool_calls: [{ id: `call-${round}`, type: 'function', function: { name: 'workspace_prepare_write', arguments: JSON.stringify({ operation: 'coupon_bind', parameters: { productId, batchId: observedBatchId } }) } }] } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    if (round === 8) return new Response(JSON.stringify({ model: body.model, choices: [{ message: { role: 'assistant', content: '', tool_calls: [{ id: `call-${round}`, type: 'function', function: { name: 'workspace_prepare_write', arguments: JSON.stringify({ operation: 'product_automation_update', parameters: { productId, config: { paidAutoDelivery: { enabled: true, couponBatchIds: [observedBatchId] } } } }) } }] } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    const shareSeen = modelContext.includes('share.example.test/03-ppt-master-public');
    if (!shareSeen && round >= 6) modelAssertionError = `share URL missing in model context at round ${round}: ${lastText}`;
    return new Response(JSON.stringify({ model: body.model, choices: [{ message: { role: 'assistant', content: '已完成卡券创建、商品关联与付费自动发货启用。' } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  testDatabaseName = `xianyu_workspace_coupon_auto_${process.pid}_${Date.now()}`.replace(/[^a-z0-9_]/gi, '_');
  const adminPool = new pg.Pool({ connectionString: 'postgres://xianyu:xianyu_dev_only@127.0.0.1:5432/postgres' });
  await adminPool.query(`CREATE DATABASE "${testDatabaseName}"`);
  await adminPool.end();
  const databaseUrl = `postgres://xianyu:xianyu_dev_only@127.0.0.1:5432/${testDatabaseName}`;
  const node = process.execPath;
  const migrate = spawnProcess(node, [join(root, 'apps', 'api', 'scripts', 'migrate.mjs')], { env: { ...process.env, DATABASE_URL: databaseUrl } });
  assert.equal(await new Promise((resolve) => migrate.once('exit', resolve)), 0);
  const apiBuild = spawnProcess(node, [join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', join(root, 'apps', 'api', 'tsconfig.json')]);
  assert.equal(await new Promise((resolve) => apiBuild.once('exit', resolve)), 0);
  const { createApp } = await import(pathToFileURL(join(root, 'apps', 'api', 'dist', 'app.js')).href);
  apiRuntime = createApp({ host: '127.0.0.1', port: apiPort, databaseUrl, allowInMemory: false, cookieSecure: false, sessionIdleMs: 1_800_000, sessionAbsoluteMs: 28_800_000, webSocketAllowedOrigins: [webUrl], agentRuntime: 'pi', modelApiKey: 'workspace-coupon-auto-key', modelBaseUrl: 'https://model.example/v1', modelName: 'workspace-coupon-auto', modelWireApi: 'chat', modelTimeoutMs: 5_000, autoReplyModelEnabled: false, piSkillRoot: installedRoot, credentialEncryptionKey: 'workspace-coupon-auto-credential-key', objectStorageEndpoint: 'http://127.0.0.1:19000', objectStorageAccessKey: 'xianyu', objectStorageSecretKey: 'xianyu_dev_only', objectStorageBucket: 'xianyu-assets', objectStorageRegion: 'us-east-1' });
  await apiRuntime.listen();
  const apiHealth = await waitFor(async () => (await fetch(`${apiUrl}/healthz`)).ok, 'Postgres-backed API');
  assert.ok(apiHealth);
  const adminEmail = process.env.WORKSPACE_COUPON_AUTO_EMAIL ?? `workspace-coupon-auto-${suffix}@example.com`;
  const adminPassword = process.env.WORKSPACE_COUPON_AUTO_PASSWORD ?? 'password-123';
  const bootstrap = await fetch(`${apiUrl}/api/v1/auth/bootstrap`, { method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': `workspace-coupon-auto-bootstrap-${suffix}` }, body: JSON.stringify({ email: adminEmail, password: adminPassword, displayName: 'Workspace Coupon Auto E2E' }) });
  const bootstrapBody = await bootstrap.json();
  assert.equal(bootstrap.status, 200, JSON.stringify(bootstrapBody));
  const cookie = cookiesFrom(bootstrap);
  const csrf = csrfFrom(cookie);
  const adminId = bootstrapBody.data.profile.id;
  const accountResponse = await fetch(`${apiUrl}/api/v1/accounts`, { method: 'POST', headers: { 'content-type': 'application/json', cookie, 'x-csrf-token': csrf, 'Idempotency-Key': `workspace-coupon-auto-account-${suffix}` }, body: JSON.stringify({ platform: 'xianyu', sellerRef: `workspace-coupon-auto-${suffix}`, displayName: 'Workspace Coupon Auto Account' }) });
  const accountBody = await accountResponse.json();
  assert.equal(accountResponse.status, 201, JSON.stringify(accountBody));
  const accountId = accountBody.data.id;
  const productId = randomUUID();
  const seedPool = new pg.Pool({ connectionString: databaseUrl });
  await seedPool.query(`insert into products.products (id,account_id,external_product_ref,title,description,price_minor,status,created_at,updated_at) values ($1,$2,$3,$4,$5,$6,'draft',now(),now())`, [productId, accountId, `AUTO-${suffix}`, 'AI 技术咨询，需求定制开发服务', 'Workspace coupon auto delivery E2E', 19900]);
  await seedPool.end();
  const installed = await apiRuntime.piSkills.install({ adminId, source: archive });
  assert.equal(installed.id, 'quarkclouddrive');
  assert.equal(installed.enabled, true);

  const web = spawnProcess(node, [join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--host', '127.0.0.1', '--port', String(webPort)], { cwd: join(root, 'apps', 'web'), env: { ...process.env, VITE_API_MODE: 'live', VITE_API_BASE_URL: '', VITE_API_PROXY_TARGET: apiUrl } });
  await waitFor(async () => (await fetch(`${webUrl}/workspace`)).ok, 'Vite frontend');
  await mkdir(artifactDir, { recursive: true });
  await rm(join(artifactDir, 'iab-browser-state.json'), { force: true });
  await writeFile(join(artifactDir, 'iab-session.json'), JSON.stringify({ apiUrl, webUrl, adminEmail, adminPassword, adminId, accountId, productId, testDatabaseName, marker: join(artifactDir, 'iab-browser-state.json') }, null, 2));
  let browserState;
  if (browserMode === 'iab') {
    browserState = await runInAppBrowserFlow({ webUrl, artifactDir, confirmations });
  } else if (browserMode === 'iab-external') {
    browserState = await waitForExternalIabEvidence({ artifactDir, confirmations });
  } else {
    const chrome = spawnProcess(chromePath, ['--headless=new', '--disable-gpu', '--disable-extensions', '--no-first-run', '--no-default-browser-check', '--remote-allow-origins=*', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${chromeProfile}`, '--window-size=1440,900', 'about:blank']);
    await waitFor(async () => chrome.exitCode === null && (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).ok, 'local Chrome');
    cdp = await createCdpClient(debugPort);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');
    for (const pair of cookie.split('; ')) { const [name, ...valueParts] = pair.split('='); await cdp.send('Network.setCookie', { name, value: valueParts.join('='), url: `${webUrl}/` }); }
    await cdp.send('Page.navigate', { url: `${webUrl}/workspace` });
    await waitFor(async () => String(await evaluate(cdp, 'document.readyState')) === 'complete', 'workspace route');
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    await waitFor(async () => await evaluate(cdp, 'Boolean(document.querySelector(".workspace-thread") && document.querySelector(".workspace-composer"))'), 'authenticated workspace', 10_000);
    await waitFor(async () => Boolean(await evaluate(cdp, '(() => !document.querySelector(".workspace-inline-error") && !document.body.innerText.includes("请先选择账号"))()')), 'account context');
    await evaluate(cdp, 'document.querySelector(".workspace-sessions-panel .workspace-panel-head button")?.click()');
    await waitFor(async () => String(await evaluate(cdp, 'document.querySelector(".workspace-thread h2")?.textContent ?? ""')).includes('新会话'), 'new conversation');

    const instruction = '用 03 PPT Master 的网盘公开分享链接创建一个卡券，关联“AI 技术咨询，需求定制开发服务”这个商品，然后启用自动发货';
    await evaluate(cdp, `(() => { const area = document.querySelector('.workspace-composer textarea'); const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set; setter?.call(area, ${JSON.stringify(instruction)}); area.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await evaluate(cdp, 'new Promise((resolve) => setTimeout(resolve, 50))');
    await evaluate(cdp, 'document.querySelector(".workspace-composer")?.requestSubmit()');

    async function confirmNext(index) {
      await waitFor(async () => Boolean(await evaluate(cdp, 'document.querySelector("[data-testid=workspace-confirmation-card]")')), `confirmation ${index}`, 30_000);
      const cardText = String(await evaluate(cdp, 'document.querySelector("[data-testid=workspace-confirmation-card]")?.innerText ?? ""'));
      confirmations.push({ index, cardText });
      assert.ok(cardText.length > 0, `confirmation ${index} card should not be empty`);
      await evaluate(cdp, 'document.querySelector("[data-testid=workspace-confirm-continue]")?.click()');
      await waitFor(async () => !Boolean(await evaluate(cdp, 'document.querySelector("[data-testid=workspace-confirmation-card]")')), `confirmation ${index} resolved`, 30_000);
    }
    await confirmNext(1);
    await confirmNext(2);
    await confirmNext(3);

    await waitFor(async () => await evaluate(cdp, 'document.querySelectorAll(".workspace-message-final").length === 1'), 'single final reply', 30_000);
      browserState = await evaluate(cdp, `({ href: location.href, finalCount: document.querySelectorAll('.workspace-message-final').length, finalReply: document.querySelector('.workspace-message-final')?.innerText ?? '', planCount: document.querySelectorAll('[data-testid=workspace-plan-card], .workspace-plan-float').length, confirmationCount: document.querySelectorAll('[data-testid=workspace-confirmation-card]').length, activityCount: document.querySelectorAll('[data-testid=workspace-activity-action]').length, bodyText: document.body.innerText })`);
  }
  assert.equal(browserState.finalCount, 1, JSON.stringify(browserState));
  assert.match(browserState.finalReply, /自动发货|卡券|关联/u);
  assert.ok(browserState.activityCount >= 8, JSON.stringify(browserState));

  const pool = apiRuntime.store.pool;
  const runRow = (await pool.query('select id,status,error_code from workspace.runs where account_id=$1 order by created_at desc limit 1', [accountId])).rows[0];
  assert.equal(runRow.status, 'succeeded', JSON.stringify(runRow));
  const eventRows = await pool.query('select sequence,event_type,payload_json from workspace.run_events where run_id=$1 order by sequence asc', [runRow.id]);
  const events = eventRows.rows;
  const confirmationEvents = events.filter((row) => row.event_type === 'workspace.confirmation.confirmed' || row.event_type === 'workspace.command.completed' || row.event_type === 'workspace.coupon.created');
  const confirmedEvents = events.filter((row) => row.event_type === 'workspace.confirmation.confirmed');
  assert.equal(confirmedEvents.length, confirmations.length, JSON.stringify({ confirmations, confirmedEvents }));
  const completionEvents = events.filter((row) => row.event_type === 'workspace.command.completed' || row.event_type === 'workspace.coupon.created');
  const usedCompletionSequences = new Set();
  confirmations.forEach((confirmation, index) => {
    const confirmed = confirmedEvents[index];
    const action = confirmed?.payload_json?.action;
    const completion = completionEvents.find((row) => {
      if (usedCompletionSequences.has(String(row.sequence))) return false;
      if (row.event_type === 'workspace.coupon.created') return action === 'coupon_create';
      return row.payload_json?.action === action;
    });
    assert.ok(completion, `confirmation ${index + 1} must have a matching completion event: ${JSON.stringify({ action, confirmed, completionEvents })}`);
    usedCompletionSequences.add(String(completion.sequence));
    confirmation.eventTypes = [confirmed.event_type, completion.event_type];
  });
  const toolNames = events.filter((row) => row.event_type === 'tool.result').map((row) => row.payload_json?.toolName);
  assert.deepEqual(toolNames, ['pi_skill_catalog', 'pi_skill_read', 'pi_skill_exec', 'pi_skill_exec', 'workspace_product_search', 'workspace_prepare_write', 'workspace_prepare_write', 'workspace_prepare_write']);
  assert.equal(events.filter((row) => row.event_type === 'workspace.confirmation.created').length, 3);
  assert.equal(events.filter((row) => row.event_type === 'workspace.confirmation.confirmed').length, 3);
  assert.ok(events.some((row) => row.event_type === 'workspace.coupon.created'));
  assert.equal(modelAssertionError, undefined, modelAssertionError ?? '');
  const batch = (await pool.query('select id,sequence_id,label,purpose,metadata_json,status from coupons.coupon_batches where account_id=$1 and metadata_json->\'apiConfig\'->>\'url\'=$2 order by created_at desc limit 1', [accountId, 'https://share.example.test/03-ppt-master-public'])).rows[0];
  assert.equal(batch.label, '03 PPT Master');
  assert.equal(batch.purpose, 'api');
  assert.equal(batch.metadata_json?.apiConfig?.url, 'https://share.example.test/03-ppt-master-public');
  const binding = (await pool.query('select cb.batch_id,cb.product_id,cb.status,cb.created_at,b.sequence_id as batch_sequence_id from coupons.coupon_bindings cb join coupons.coupon_batches b on b.id=cb.batch_id where cb.batch_id=$1 and cb.product_id=$2 and b.account_id=$3 and b.sequence_id=$4 order by cb.created_at desc limit 1', [batch.id, productId, accountId, batch.sequence_id])).rows[0];
  assert.equal(binding.status, 'active', JSON.stringify(binding));
  assert.equal(binding.batch_id, batch.id, JSON.stringify(binding));
  assert.equal(binding.batch_sequence_id, batch.sequence_id, JSON.stringify(binding));
  const automation = (await pool.query('select product_id,config_version,config_json from products.automation_configs where product_id=$1', [productId])).rows[0];
  assert.equal(automation.config_json?.paidAutoDelivery?.enabled, true, JSON.stringify(automation));
  assert.deepEqual(automation.config_json?.paidAutoDelivery?.couponBatchIds, [batch.id]);
  await mkdir(artifactDir, { recursive: true });
  await writeFile(join(artifactDir, 'workspace-coupon-auto-delivery-evidence.json'), JSON.stringify({ browserState, confirmations, toolNames, run: runRow, events, batch, binding, automation, modelTrace }, null, 2));
  console.log(JSON.stringify({ status: 'PASS', storage: 'postgres', accountId, productId, runId: runRow.id, batchId: batch.id, sequenceId: batch.sequence_id, toolNames, confirmations: confirmations.length, browserState }, null, 2));
}

try {
  await run();
} finally {
  if (originalFetch) globalThis.fetch = originalFetch;
  if (cdp?.socket) cdp.socket.close();
  for (const child of children.reverse()) await stopChildAndWait(child);
  try { await apiRuntime?.close(); } catch { /* cleanup */ }
  try { await rm(chromeProfile, { recursive: true, force: true }); } catch { /* cleanup */ }
  if (testDatabaseName) {
    try { const cleanupPool = new pg.Pool({ connectionString: 'postgres://xianyu:xianyu_dev_only@127.0.0.1:5432/postgres' }); await cleanupPool.query(`DROP DATABASE IF EXISTS "${testDatabaseName}" WITH (FORCE)`); await cleanupPool.end(); } catch { /* cleanup */ }
  }
  if (fixtureRoot) { try { await rm(fixtureRoot, { recursive: true, force: true }); } catch { /* cleanup */ } }
}
