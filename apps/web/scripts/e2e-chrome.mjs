import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..', '..', '..');
const apiPort = 18000 + (process.pid % 900);
const webPort = 14000 + (process.pid % 900);
const debugPort = 19000 + (process.pid % 900);
const apiUrl = 'http://127.0.0.1:' + apiPort;
const webUrl = 'http://127.0.0.1:' + webPort;
const chromePath = process.env.CHROME_PATH ?? join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe');
const chromeProfile = join(tmpdir(), 'xianyu-agent-chrome-' + process.pid);
const screenshotDir = join(root, 'docs', 'evidence', 'stage5', 'S4-VS1', 'screenshots');
const children = [];

function spawnProcess(command, args, options = {}) {
  const child = spawn(command, args, { cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, shell: command.endsWith('.cmd'), ...options });
  child.stdout.on('data', (chunk) => process.stdout.write('[e2e:' + command + '] ' + chunk));
  child.stderr.on('data', (chunk) => process.stderr.write('[e2e:' + command + '] ' + chunk));
  children.push(child);
  return child;
}

async function waitFor(check, label, timeoutMs = 20000) {
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
  throw new Error(label + ' 未就绪' + (lastError ? ': ' + lastError.message : ''));
}

function cookiesFrom(response) {
  return (response.headers.getSetCookie?.() ?? []).map((value) => value.split(';', 1)[0]).join('; ');
}

async function bootstrapAdmin() {
  const response = await fetch(apiUrl + '/api/v1/auth/bootstrap', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'Idempotency-Key': 'chrome-bootstrap-' + process.pid },
    body: JSON.stringify({ email: 'chrome-e2e@example.com', password: 'password-123', displayName: 'Chrome E2E' }),
  });
  if (!response.ok) throw new Error('bootstrap failed: ' + response.status + ' ' + await response.text());
  const cookie = cookiesFrom(response);
  const csrf = decodeURIComponent(cookie.match(/csrf_token=([^;]+)/)?.[1] ?? '');
  if (!csrf) throw new Error('bootstrap did not return csrf cookie');
  return { cookie, csrf };
}

async function createCdpClient() {
  const target = await waitFor(async () => {
    const response = await fetch('http://127.0.0.1:' + debugPort + '/json/list');
    if (!response.ok) return false;
    const pages = await response.json();
    return pages.find((item) => item.type === 'page' && item.webSocketDebuggerUrl) ?? false;
  }, 'Chrome DevTools Protocol');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const entry = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) entry.reject(new Error(message.error.message)); else entry.resolve(message.result);
    }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  return { socket, send };
}

async function evaluate(cdp, expression, awaitPromise = true) {
  const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? '浏览器脚本执行失败');
  return result.result?.value;
}

async function assertText(cdp, text) {
  const body = await evaluate(cdp, 'document.body.innerText');
  if (!String(body).includes(text)) throw new Error('页面缺少文本：' + text);
}

async function captureViewport(cdp, width, height, filename) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  writeFileSync(join(screenshotDir, filename), Buffer.from(screenshot.data, 'base64'));
}

async function run() {
  mkdirSync(chromeProfile, { recursive: true });
  const npm = process.env.npm_execpath ? process.execPath : (process.platform === 'win32' ? 'npm.cmd' : 'npm');
  const npmArgs = (args) => process.env.npm_execpath ? [process.env.npm_execpath, ...args] : args;
  const apiBuild = spawnProcess(npm, npmArgs(['--workspace', 'apps/api', 'run', 'build']));
  const buildExit = await new Promise((resolve) => apiBuild.once('exit', resolve));
  if (buildExit !== 0) throw new Error('API build failed with ' + buildExit);

  spawnProcess(npm, npmArgs(['--workspace', 'apps/api', 'run', 'start']), { env: { ...process.env, PORT: String(apiPort), HOST: '127.0.0.1', ALLOW_IN_MEMORY: 'true', DATABASE_URL: '', COOKIE_SECURE: 'false', XIANYU_QR_MODE: 'stub' } });
  await waitFor(async () => (await fetch(apiUrl + '/healthz')).ok, 'API');
  const auth = await bootstrapAdmin();

  spawnProcess(npm, npmArgs(['--workspace', 'apps/web', 'run', 'dev', '--', '--host', '127.0.0.1', '--port', String(webPort)]), { env: { ...process.env, VITE_API_MODE: 'live', VITE_API_BASE_URL: '', VITE_API_PROXY_TARGET: apiUrl } });
  await waitFor(async () => (await fetch(webUrl + '/accounts')).ok, 'Vite 前端');

  const chrome = spawnProcess(chromePath, ['--headless=new', '--disable-gpu', '--disable-extensions', '--no-first-run', '--no-default-browser-check', '--remote-allow-origins=*', '--remote-debugging-port=' + debugPort, '--user-data-dir=' + chromeProfile, '--window-size=1440,900', 'about:blank']);
  await waitFor(async () => chrome.exitCode === null && (await fetch('http://127.0.0.1:' + debugPort + '/json/version')).ok, '本地 Chrome');

  const cdp = await createCdpClient();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable');
  for (const pair of auth.cookie.split('; ')) {
    const [name, ...valueParts] = pair.split('=');
    await cdp.send('Network.setCookie', { name, value: valueParts.join('='), url: webUrl + '/' });
  }
  await cdp.send('Page.navigate', { url: webUrl + '/accounts' });
  await waitFor(async () => String(await evaluate(cdp, 'document.readyState')) === 'complete', '账号页面');
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('店铺 / 账号管理'), '账号页面内容');
  await assertText(cdp, '添加闲鱼账号');
  await assertText(cdp, '账号列表');

  await evaluate(cdp, 'Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.trim() === "添加闲鱼账号")?.click()');
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('创建并扫码授权'), '添加账号弹窗');
  await evaluate(cdp, 'const inputs = Array.from(document.querySelectorAll(".create-account-form input")); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; setter.call(inputs[0], "chrome-seller-001"); inputs[0].dispatchEvent(new Event("input", { bubbles: true })); inputs[0].dispatchEvent(new Event("change", { bubbles: true })); setter.call(inputs[1], "Chrome 测试店铺"); inputs[1].dispatchEvent(new Event("input", { bubbles: true })); inputs[1].dispatchEvent(new Event("change", { bubbles: true }));');
  await evaluate(cdp, 'Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.trim() === "创建并扫码授权")?.click()');
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('扫码授权账号'), '二维码授权弹窗');
  await assertText(cdp, 'Chrome 测试店铺');
  await assertText(cdp, '二维码');
  await evaluate(cdp, 'Array.from(document.querySelectorAll(".qr-login-modal button")).find((button) => button.textContent?.trim() === "关闭")?.click()');
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('Chrome 测试店铺'), '账号列表刷新');
  mkdirSync(screenshotDir, { recursive: true });
  await captureViewport(cdp, 1440, 900, 'accounts-desktop-1440x900.png');
  await captureViewport(cdp, 390, 844, 'accounts-mobile-390x844.png');
  await cdp.send('Emulation.clearDeviceMetricsOverride');
  console.log('local Chrome E2E passed: account create -> real API -> visible persisted account -> QR authorization view');
  cdp.socket.close();
}

try {
  await run();
} finally {
  for (const child of children.reverse()) {
    if (!child.killed && child.exitCode === null) {
      if (process.platform === 'win32' && child.spawnargs?.[0]?.toLowerCase().endsWith('chrome.exe')) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      else child.kill('SIGTERM');
    }
    child.stdout?.destroy();
    child.stderr?.destroy();
  }
  try { rmSync(chromeProfile, { recursive: true, force: true }); } catch (error) { console.warn('Chrome 临时目录清理失败，已保留供系统回收：' + error.message); }
}
