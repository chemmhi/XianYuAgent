import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile as execFileCallback, spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const root = resolve(import.meta.dirname, '..', '..');
const execFile = promisify(execFileCallback);
const chromePath = process.env.CHROME_PATH ?? join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe');
const children = [];
const servers = [];
const screenshotDir = join(root, 'artifacts', 'pi-skill-e2e', 'screenshots');
const skillRoot = await mkdtemp(join(tmpdir(), 'pi-skill-browser-root-'));
const fixtureRoot = await mkdtemp(join(tmpdir(), 'pi-skill-browser-fixture-'));
const chromeProfile = join(tmpdir(), `pi-skill-browser-${process.pid}`);

async function freePort() {
  return await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolvePort(port));
    });
  });
}

function spawnProcess(command, args, options = {}) {
  const child = spawn(command, args, { cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, shell: command.endsWith('.cmd'), ...options });
  child.stdout.on('data', (chunk) => process.stdout.write(`[pi-skill-e2e:${command}] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[pi-skill-e2e:${command}] ${chunk}`));
  children.push(child);
  return child;
}

async function waitFor(check, label, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) { lastError = error; }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
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
  await new Promise((resolveOpen, reject) => {
    socket.addEventListener('open', resolveOpen, { once: true });
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
  const send = (method, params = {}) => new Promise((resolveResult, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve: resolveResult, reject, method });
    socket.send(JSON.stringify({ id, method, params }));
  });
  return { socket, send };
}

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? 'browser evaluation failed');
  return result.result?.value;
}

async function capture(cdp, width, height, filename) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  await mkdir(screenshotDir, { recursive: true });
  const path = join(screenshotDir, filename);
  await writeFile(path, Buffer.from(shot.data, 'base64'));
  return path;
}

async function makeSkillArchive() {
  const skill = join(fixtureRoot, 'quarkclouddrive');
  await mkdir(join(skill, 'scripts'), { recursive: true });
  await writeFile(join(skill, 'SKILL.md'), '---\nname: quarkclouddrive\nversion: 1.0.22-e2e\ndescription: Quark Drive browser fixture\n---\n');
  await writeFile(join(skill, 'scripts', 'main.cjs'), [
    "const args = process.argv.slice(2);",
    "if (args[0] === 'login' && !args.includes('--token')) { console.log(JSON.stringify({ code: -1408, msg: '请在浏览器中完成登录：https://example.test/quark/login' })); process.exit(1); }",
    "if (args[0] === 'login' && args[2] !== 'fixture-token') { console.log(JSON.stringify({ code: -401, msg: '授权码无效' })); process.exit(0); }",
    "if (args[0] === 'login') { console.log(JSON.stringify({ code: 0, msg: '授权成功' })); process.exit(0); }",
    "if (args[0] === 'get-user-info') { console.log(JSON.stringify({ code: 0, msg: '成功', data: { nickname: 'E2E 用户', member_type: 'SVIP' } })); process.exit(0); }",
    "console.log(JSON.stringify({ code: 0, msg: 'ok' }));",
  ].join('\n'));
  const archive = join(fixtureRoot, 'quarkclouddrive-1.0.22.zip');
  await execFile('tar', ['-a', '-c', '-f', archive, '-C', fixtureRoot, 'quarkclouddrive']);
  return archive;
}

async function main() {
  const apiPort = await freePort();
  const webPort = await freePort();
  const modelPort = await freePort();
  const archive = await makeSkillArchive();
  const archiveBytes = await readFile(archive);
  const archiveServer = createServer((req, res) => {
    if (req.url === '/quarkclouddrive-1.0.22.zip') {
      res.writeHead(200, { 'content-type': 'application/zip', 'content-length': archiveBytes.length });
      res.end(archiveBytes);
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise((resolveListen) => archiveServer.listen(modelPort + 1, '127.0.0.1', resolveListen));
  servers.push(archiveServer);

  const modelServer = createServer(async (req, res) => {
    if (req.method !== 'POST' || !req.url?.endsWith('/chat/completions')) { res.writeHead(404).end(); return; }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const lastTool = [...messages].reverse().find((message) => message?.role === 'tool');
    const lastUser = [...messages].reverse().find((message) => message?.role === 'user');
    const response = lastTool
      ? { id: 'pi-skill-e2e-result', model: body.model, choices: [{ index: 0, message: { role: 'assistant', content: `已通过夸克网盘 Skill 获取账号信息。\n${String(lastTool.content ?? '')}` }, finish_reason: 'stop' }] }
      : String(lastUser?.content ?? '').match(/夸克|quark|get-user-info/i)
        ? { id: 'pi-skill-e2e-tool', model: body.model, choices: [{ index: 0, message: { role: 'assistant', content: null, tool_calls: [{ id: 'skill-call-1', type: 'function', function: { name: 'pi_skill_exec', arguments: JSON.stringify({ skillId: 'quarkclouddrive', command: 'get-user-info', args: [] }) } }] }, finish_reason: 'tool_calls' }] }
        : { id: 'pi-skill-e2e-ready', model: body.model, choices: [{ index: 0, message: { role: 'assistant', content: 'Workspace Pi Skill E2E ready.' }, finish_reason: 'stop' }] };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(response));
  });
  await new Promise((resolveListen) => modelServer.listen(modelPort, '127.0.0.1', resolveListen));
  servers.push(modelServer);

  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const api = spawnProcess(process.execPath, ['apps/api/dist/index.js'], { env: { ...process.env, HOST: '127.0.0.1', PORT: String(apiPort), ALLOW_IN_MEMORY: 'true', DATABASE_URL: '', REDIS_URL: '', COOKIE_SECURE: 'false', AGENT_RUNTIME: 'pi', API_KEY: 'pi-skill-e2e-key', BASE_URL: `http://127.0.0.1:${modelPort}/v1`, MODEL: 'pi-skill-e2e', WIRE_API: 'chat', MODEL_TIMEOUT_MS: '10000', PI_SKILL_ROOT: skillRoot, WS_ALLOWED_ORIGINS: `http://127.0.0.1:${webPort}`, XIANYU_QR_MODE: 'stub' } });
  await waitFor(async () => (await fetch(`http://127.0.0.1:${apiPort}/healthz`)).ok, 'API');
  const suffix = `${Date.now()}-${process.pid}`;
  const bootstrap = await fetch(`http://127.0.0.1:${apiPort}/api/v1/auth/bootstrap`, { method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': `pi-skill-browser-bootstrap-${suffix}` }, body: JSON.stringify({ email: `pi-skill-${suffix}@example.com`, password: 'password-123', displayName: 'Pi Skill Browser E2E' }) });
  assert.equal(bootstrap.status, 200, await bootstrap.text());
  const cookie = cookiesFrom(bootstrap);
  const csrf = csrfFrom(cookie);
  const account = await fetch(`http://127.0.0.1:${apiPort}/api/v1/accounts`, { method: 'POST', headers: { 'content-type': 'application/json', cookie, 'x-csrf-token': csrf, 'Idempotency-Key': `pi-skill-browser-account-${suffix}` }, body: JSON.stringify({ platform: 'xianyu', sellerRef: `pi-skill-browser-${suffix}`, displayName: 'Pi Skill Browser E2E' }) });
  const accountBody = await account.text();
  assert.equal(account.status, 201, accountBody);
  const accountId = JSON.parse(accountBody).data?.id;
  assert.ok(accountId);

  const web = spawnProcess(npm, ['--workspace', 'apps/web', 'run', 'dev', '--', '--host', '127.0.0.1', '--port', String(webPort)], { env: { ...process.env, VITE_API_MODE: 'live', VITE_API_BASE_URL: '', VITE_API_PROXY_TARGET: `http://127.0.0.1:${apiPort}` } });
  await waitFor(async () => (await fetch(`http://127.0.0.1:${webPort}/workspace`)).ok, 'Vite workspace');
  const debugPort = await freePort();
  const chrome = spawnProcess(chromePath, ['--headless=new', '--disable-gpu', '--disable-extensions', '--no-first-run', '--no-default-browser-check', '--remote-allow-origins=*', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${chromeProfile}`, '--window-size=1440,900', 'about:blank']);
  await waitFor(async () => chrome.exitCode === null && (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).ok, 'Chrome');
  const cdp = await createCdpClient(debugPort);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  for (const pair of cookie.split('; ')) { const [name, ...parts] = pair.split('='); await cdp.send('Network.setCookie', { name, value: parts.join('='), url: `http://127.0.0.1:${webPort}/` }); }
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${webPort}/workspace` });
  await waitFor(async () => String(await evaluate(cdp, 'document.readyState')) === 'complete', 'workspace page');
  await waitFor(async () => Boolean(await evaluate(cdp, 'Boolean(document.querySelector("[data-workspace-domain]"))')), 'authenticated workspace');
  await evaluate(cdp, 'document.querySelector(".workspace-sessions-panel .workspace-panel-head button")?.click()');
  await waitFor(async () => Boolean(await evaluate(cdp, 'Boolean(document.querySelector(".workspace-thread h2"))')), 'new conversation');

  const sourceUrl = `http://127.0.0.1:${modelPort + 1}/quarkclouddrive-1.0.22.zip`;
  let expectedFinalCount = 0;
  const persistedFinalCount = async () => {
    const sessions = await (await fetch(`http://127.0.0.1:${apiPort}/api/v1/workspace/agent-sessions?accountId=${encodeURIComponent(accountId)}`, { headers: { cookie } })).json();
    const sessionId = sessions.data?.items?.[0]?.id;
    if (!sessionId) return 0;
    const messages = await (await fetch(`http://127.0.0.1:${apiPort}/api/v1/workspace/agent-sessions/${encodeURIComponent(sessionId)}/messages?limit=200`, { headers: { cookie } })).json();
    return (messages.data?.items ?? []).filter((item) => item.type === 'final_answer').length;
  };
  const send = async (textValue) => {
    const before = await persistedFinalCount();
    expectedFinalCount = Math.max(expectedFinalCount, before + 1);
    await evaluate(cdp, `(() => { const area = document.querySelector('.workspace-composer textarea'); const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set; setter?.call(area, ${JSON.stringify(textValue)}); area.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('.workspace-composer')?.requestSubmit(); })()`);
    await waitFor(async () => (await persistedFinalCount()) >= expectedFinalCount, `persisted final response for ${textValue.slice(0, 16)}`, 20_000);
    await cdp.send('Page.reload', { ignoreCache: true });
    await waitFor(async () => String(await evaluate(cdp, 'document.readyState')) === 'complete', 'workspace reload');
    await waitFor(async () => Boolean(await evaluate(cdp, 'Boolean(document.querySelector("[data-workspace-domain]"))')), 'workspace after reload');
  };
  await send(`请安装夸克网盘 Skill，地址：${sourceUrl}`);
  const installedShot = await capture(cdp, 1440, 900, 'workspace-skill-installed.png');
  await send('请登录 quarkclouddrive');
  const pendingShot = await capture(cdp, 1440, 900, 'workspace-skill-login-pending.png');
  await send('授权码：fixture-token');
  const authorizedShot = await capture(cdp, 1440, 900, 'workspace-skill-login-authorized.png');
  await send('请通过夸克网盘 Skill 查询我的账号信息');
  const consumedShot = await capture(cdp, 1440, 900, 'workspace-skill-consumed.png');
  const finalText = await evaluate(cdp, 'Array.from(document.querySelectorAll(".workspace-message-final")).map((node) => node.innerText).join("\\n---\\n")');
  const skillList = await fetch(`http://127.0.0.1:${apiPort}/api/v1/workspace/skills`, { headers: { cookie } });
  const skillPayload = await skillList.json();
  assert.match(String(finalText), /E2E 用户|夸克网盘 Skill/);
  assert.equal(skillPayload.data?.items?.[0]?.authorized, true);
  console.log(JSON.stringify({ status: 'passed', sourceUrl, screenshots: { installedShot, pendingShot, authorizedShot, consumedShot }, finalText, installedSkill: { id: skillPayload.data?.items?.[0]?.id, authorized: skillPayload.data?.items?.[0]?.authorized } }, null, 2));
  cdp.socket.close();
}

try {
  await main();
} finally {
  for (const child of children.reverse()) {
    if (child.exitCode === null && !child.killed) {
      if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      else child.kill('SIGTERM');
    }
  }
  for (const server of servers) await new Promise((resolveClose) => server.close(() => resolveClose()));
  await rm(chromeProfile, { recursive: true, force: true }).catch(() => undefined);
  await rm(skillRoot, { recursive: true, force: true });
  await rm(fixtureRoot, { recursive: true, force: true });
}
