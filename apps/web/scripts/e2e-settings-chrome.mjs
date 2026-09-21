import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..', '..', '..');
const chromePath = process.env.CHROME_PATH ?? join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe');
const screenshotDir = join(root, 'docs', 'evidence', 'stage5', 'S4-VS7A', 'screenshots');
const chromeProfile = join(tmpdir(), `xianyu-agent-settings-chrome-${process.pid}`);
const children = [];

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
  child.stdout.on('data', (chunk) => process.stdout.write(`[settings-e2e:${command}] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[settings-e2e:${command}] ${chunk}`));
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
    if (message.error) entry.reject(new Error(message.error.message));
    else entry.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  return { socket, send, events };
}

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? 'browser script failed');
  return result.result?.value;
}

async function setInput(cdp, selector, value) {
  const expression = `(() => { const input = document.querySelector(${JSON.stringify(selector)}); if (!input) throw new Error('missing input: ' + ${JSON.stringify(selector)}); const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set; setter?.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`;
  return evaluate(cdp, expression);
}

async function setLabelInput(cdp, labelText, value) {
  const expression = `(() => { const label = Array.from(document.querySelectorAll('.settings-form-grid label')).find((node) => node.textContent?.trim().startsWith(${JSON.stringify(labelText)})); const input = label?.querySelector('input'); if (!input) throw new Error('missing labeled input: ' + ${JSON.stringify(labelText)}); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set; setter?.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`;
  return evaluate(cdp, expression);
}

async function clickText(cdp, text, selector = 'button') {
  const expression = `(() => { const node = Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find((item) => item.textContent?.trim() === ${JSON.stringify(text)}); if (!node) throw new Error('missing button: ' + ${JSON.stringify(text)}); node.click(); return true; })()`;
  return evaluate(cdp, expression);
}

async function clickContainingText(cdp, text, selector = 'button') {
  const expression = `(() => { const node = Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find((item) => item.textContent?.includes(${JSON.stringify(text)})); if (!node) throw new Error('missing containing button: ' + ${JSON.stringify(text)}); node.click(); return true; })()`;
  return evaluate(cdp, expression);
}

async function captureViewport(cdp, width, height, filename) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  mkdirSync(screenshotDir, { recursive: true });
  const destination = join(screenshotDir, filename);
  writeFileSync(destination, Buffer.from(screenshot.data, 'base64'));
  return destination;
}

async function requestJson(apiUrl, path, options = {}) {
  const response = await fetch(`${apiUrl}${path}`, options);
  const body = await response.json();
  return { response, body };
}

async function run() {
  const apiPort = await freePort();
  const webPort = await freePort();
  const debugPort = await freePort();
  const apiUrl = `http://127.0.0.1:${apiPort}`;
  const webUrl = `http://127.0.0.1:${webPort}`;
  mkdirSync(chromeProfile, { recursive: true });

  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const apiBuild = spawnProcess(npm, ['--workspace', 'apps/api', 'run', 'build']);
  const buildExit = await new Promise((resolve) => apiBuild.once('exit', resolve));
  if (buildExit !== 0) throw new Error(`API build failed with ${buildExit}`);

  spawnProcess(process.execPath, ['apps/api/scripts/e2e-harness.mjs'], { env: { ...process.env, PORT: String(apiPort), HOST: '127.0.0.1', CREDENTIAL_ENCRYPTION_KEY: 'settings-e2e-encryption-key' } });
  await waitFor(async () => (await fetch(`${apiUrl}/healthz`)).ok, 'API');

  const bootstrap = await requestJson(apiUrl, '/api/v1/auth/bootstrap', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'Idempotency-Key': `settings-bootstrap-${process.pid}` },
    body: JSON.stringify({ email: `settings-e2e-${process.pid}@example.com`, password: 'password-123', displayName: 'Settings E2E' }),
  });
  if (!bootstrap.response.ok) throw new Error(`bootstrap failed: ${bootstrap.response.status} ${JSON.stringify(bootstrap.body)}`);
  const cookie = cookiesFrom(bootstrap.response);
  const csrf = csrfFrom(cookie);
  if (!cookie || !csrf) throw new Error('bootstrap did not return session/csrf cookies');

  const account = await requestJson(apiUrl, '/api/v1/accounts', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': `settings-account-${process.pid}` },
    body: JSON.stringify({ platform: 'xianyu', sellerRef: `settings-e2e-${process.pid}`, displayName: 'Settings Demo Account' }),
  });
  if (!account.response.ok) throw new Error(`account seed failed: ${account.response.status} ${JSON.stringify(account.body)}`);
  const accountId = account.body.data?.id;
  if (!accountId) throw new Error('account seed did not return account id');

  const forbidden = await requestJson(apiUrl, `/api/v1/credentials?accountId=${encodeURIComponent('not-scoped-account')}`, { headers: { cookie } });
  if (forbidden.response.status !== 403) throw new Error(`expected 403 for unscoped account, got ${forbidden.response.status}`);

  spawnProcess(npm, ['--workspace', 'apps/web', 'run', 'dev', '--', '--host', '127.0.0.1', '--port', String(webPort)], { env: { ...process.env, VITE_API_MODE: 'live', VITE_API_BASE_URL: '', VITE_API_PROXY_TARGET: apiUrl } });
  await waitFor(async () => (await fetch(`${webUrl}/settings`)).ok, 'Vite frontend');

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
  await cdp.send('Page.navigate', { url: `${webUrl}/settings` });
  await waitFor(async () => String(await evaluate(cdp, 'document.readyState')) === 'complete', 'settings route');
  await waitFor(async () => await evaluate(cdp, 'Boolean(document.querySelector("[data-settings-page]"))'), 'Settings page');
  await waitFor(async () => await evaluate(cdp, 'Boolean(document.querySelector("#settings-account option[value]"))'), 'Settings account options');
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('当前账号'), 'Settings account context');
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('当前账号还没有模型 API Key'), 'empty credential state');

  const agentDefaults = await requestJson(apiUrl, '/api/v1/settings/agent', { headers: { cookie } });
  if (!agentDefaults.response.ok || agentDefaults.body.data?.configVersion !== 0) throw new Error(`agent settings default readback failed: ${agentDefaults.response.status} ${JSON.stringify(agentDefaults.body)}`);
  await clickContainingText(cdp, '自动回复 Agent');
  await waitFor(async () => await evaluate(cdp, 'Boolean(document.querySelector("[data-auto-reply-agent-panel]"))'), 'Auto Reply Agent panel');
  await setLabelInput(cdp, '最大循环次数', '6');
  await setLabelInput(cdp, '防抖窗口（毫秒）', '1500');
  await clickText(cdp, '保存自动回复 Agent 配置');
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('自动回复 Agent 配置已保存'), 'agent settings saved');
  const agentSaved = await requestJson(apiUrl, '/api/v1/settings/agent', { headers: { cookie } });
  if (!agentSaved.response.ok || agentSaved.body.data?.configVersion !== 1 || agentSaved.body.data?.maxLoops !== 6 || agentSaved.body.data?.debounceMs !== 1500) throw new Error(`agent settings persistence failed: ${agentSaved.response.status} ${JSON.stringify(agentSaved.body)}`);
  const agentStale = await requestJson(apiUrl, '/api/v1/settings/agent', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': `agent-settings-stale-${process.pid}` },
    body: JSON.stringify({ expectedVersion: 0, maxLoops: 4 }),
  });
  if (agentStale.response.status !== 409) throw new Error(`expected 409 for stale agent settings, got ${agentStale.response.status}`);

  const agentDesktopPath = await captureViewport(cdp, 1440, 900, 'settings-agent-desktop-1440x900.png');
  const agentMobilePath = await captureViewport(cdp, 390, 844, 'settings-agent-mobile-390x844.png');

  await clickContainingText(cdp, '凭证管理');
  await waitFor(async () => await evaluate(cdp, 'Boolean(document.querySelector("[data-credential-panel]"))'), 'credential panel after Agent settings');
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('当前账号还没有模型 API Key'), 'empty credential state after Agent settings');

  const selectedAccount = await evaluate(cdp, 'document.querySelector("#settings-account")?.value ?? ""');
  if (selectedAccount !== accountId) {
    await evaluate(cdp, `(() => { const select = document.querySelector('#settings-account'); if (!select) throw new Error('settings account select missing'); select.value = ${JSON.stringify(accountId)}; select.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await waitFor(async () => String(await evaluate(cdp, 'document.querySelector("#settings-account")?.value ?? ""')) === accountId, 'account selection');
  }

  await clickText(cdp, '新增 API Key');
  await waitFor(async () => await evaluate(cdp, 'Boolean(document.querySelector(".settings-editor"))'), 'credential editor');
  await setInput(cdp, '.settings-editor input[placeholder="输入新的 API Key"]', 'sk-settings-secret-123456');
  await setLabelInput(cdp, 'Provider', 'openai-compatible');
  await setLabelInput(cdp, 'Alias', 'primary');
  await clickText(cdp, '保存配置');
  await waitFor(async () => await evaluate(cdp, 'Boolean(document.querySelector("[data-credential-row]"))'), 'credential saved');
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('不可查看密钥'), 'redacted credential row');

  const browserSecretLeak = await evaluate(cdp, `(() => ({ href: location.href, body: document.body.innerText.includes('sk-settings-secret-123456'), localStorage: Object.values(localStorage).some((value) => value.includes('sk-settings-secret-123456')), inputs: Array.from(document.querySelectorAll('input,textarea')).some((input) => input.value.includes('sk-settings-secret-123456')) }))()`);
  if (browserSecretLeak.href.includes('sk-settings-secret-123456') || browserSecretLeak.body || browserSecretLeak.localStorage || browserSecretLeak.inputs) throw new Error(`secret leaked into browser surface: ${JSON.stringify(browserSecretLeak)}`);

  const listed = await requestJson(apiUrl, `/api/v1/credentials?accountId=${encodeURIComponent(accountId)}`, { headers: { cookie } });
  if (!listed.response.ok || listed.body.data?.items?.length !== 1) throw new Error(`credential persistence readback failed: ${listed.response.status} ${JSON.stringify(listed.body)}`);
  const credential = listed.body.data.items[0];
  if (credential.canReveal !== false || credential.apiKey !== undefined || JSON.stringify(listed.body).includes('sk-settings-secret-123456')) throw new Error('credential list returned secret material');

  const stale = await requestJson(apiUrl, `/api/v1/credentials/${encodeURIComponent(credential.id)}/disable`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': `settings-stale-${process.pid}` },
    body: JSON.stringify({ expectedVersion: 99 }),
  });
  if (stale.response.status !== 409) throw new Error(`expected 409 version conflict, got ${stale.response.status}`);

  const desktopPath = await captureViewport(cdp, 1440, 900, 'settings-desktop-1440x900.png');
  const mobilePath = await captureViewport(cdp, 390, 844, 'settings-mobile-390x844.png');

  await clickText(cdp, '轮换');
  await waitFor(async () => await evaluate(cdp, 'Boolean(document.querySelector(".settings-editor"))'), 'rotate editor');
  await setInput(cdp, '.settings-editor input[placeholder="输入新的 API Key"]', 'sk-settings-rotated-987654');
  await clickText(cdp, '确认轮换');
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('API Key 已轮换'), 'credential rotated');

  await clickText(cdp, '禁用');
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('已禁用'), 'credential disabled');
  await evaluate(cdp, 'window.confirm = () => true');
  await clickText(cdp, '撤销');
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('已撤销'), 'credential revoked');

  const final = await requestJson(apiUrl, `/api/v1/credentials?accountId=${encodeURIComponent(accountId)}`, { headers: { cookie } });
  if (final.body.data?.items?.[0]?.status !== 'revoked') throw new Error(`final credential state mismatch: ${JSON.stringify(final.body)}`);
  if (JSON.stringify(final.body).includes('sk-settings-rotated-987654')) throw new Error('rotated secret leaked in API readback');

  await cdp.send('Emulation.clearDeviceMetricsOverride');
  console.log(JSON.stringify({ apiStorage: 'memory', accountId, agentSettings: { defaultVersion: agentDefaults.body.data.configVersion, savedVersion: agentSaved.body.data.configVersion, staleStatus: agentStale.response.status }, credentialId: credential.id, forbiddenStatus: forbidden.response.status, staleStatus: stale.response.status, finalStatus: final.body.data.items[0].status, secretRedaction: browserSecretLeak, screenshots: { agentDesktopPath, agentMobilePath, desktopPath, mobilePath } }, null, 2));
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
}
