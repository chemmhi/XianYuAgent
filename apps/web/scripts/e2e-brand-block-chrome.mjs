import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..', '..', '..');
const children = [];
const chromeProfile = join(tmpdir(), `xianyu-agent-brand-block-${process.pid}`);
const chromePath = process.env.CHROME_PATH ?? join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe');

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
  child.stdout.on('data', (chunk) => process.stdout.write(`[brand-block-e2e:${command}] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[brand-block-e2e:${command}] ${chunk}`));
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
    if (message.error) entry.reject(new Error(message.error.message)); else entry.resolve(message.result);
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

async function run() {
  const apiPort = await freePort();
  const webPort = await freePort();
  const debugPort = await freePort();
  const apiUrl = `http://127.0.0.1:${apiPort}`;
  const webUrl = `http://127.0.0.1:${webPort}`;
  mkdirSync(chromeProfile, { recursive: true });
  const npm = process.env.npm_execpath ? process.execPath : (process.platform === 'win32' ? 'npm.cmd' : 'npm');
  const npmArgs = (args) => process.env.npm_execpath ? [process.env.npm_execpath, ...args] : args;
  const apiBuild = spawnProcess(npm, npmArgs(['--workspace', 'apps/api', 'run', 'build']));
  const buildExit = await new Promise((resolve) => apiBuild.once('exit', resolve));
  if (buildExit !== 0) throw new Error(`API build failed with ${buildExit}`);
  spawnProcess(process.execPath, ['apps/api/scripts/e2e-harness.mjs'], { env: { ...process.env, PORT: String(apiPort), HOST: '127.0.0.1' } });
  await waitFor(async () => (await fetch(`${apiUrl}/healthz`)).ok, 'API');
  const bootstrap = await fetch(`${apiUrl}/api/v1/auth/bootstrap`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'Idempotency-Key': `brand-block-bootstrap-${process.pid}` },
    body: JSON.stringify({ email: 'brand-block-e2e@example.com', password: 'password-123', displayName: 'Brand Block E2E' }),
  });
  if (!bootstrap.ok) throw new Error(`bootstrap failed: ${bootstrap.status}`);
  const cookie = cookiesFrom(bootstrap);
  spawnProcess(npm, npmArgs(['--workspace', 'apps/web', 'run', 'dev', '--', '--host', '127.0.0.1', '--port', String(webPort)]), { env: { ...process.env, VITE_API_MODE: 'live', VITE_DASHBOARD_MODE: 'mock', VITE_API_BASE_URL: '', VITE_API_PROXY_TARGET: apiUrl } });
  await waitFor(async () => (await fetch(`${webUrl}/accounts`)).ok, 'Vite frontend');
  const chrome = spawnProcess(chromePath, ['--headless=new', '--disable-gpu', '--disable-extensions', '--no-first-run', '--no-default-browser-check', '--remote-allow-origins=*', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${chromeProfile}`, '--window-size=1440,900', 'about:blank']);
  await waitFor(async () => chrome.exitCode === null && (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).ok, 'local Chrome');
  const cdp = await createCdpClient(debugPort);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  for (const pair of cookie.split('; ')) {
    const [name, ...valueParts] = pair.split('=');
    await cdp.send('Network.setCookie', { name, value: valueParts.join('='), url: `${webUrl}/` });
  }
  await cdp.send('Page.navigate', { url: `${webUrl}/accounts` });
  await waitFor(async () => String(await evaluate(cdp, 'document.readyState')) === 'complete', 'accounts page');
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('添加闲鱼账号'), 'authenticated accounts page');
  const brandBlock = await evaluate(cdp, "document.querySelector('[data-testid=\"brand-block\"]')?.getAttribute('aria-label')");
  if (brandBlock !== '返回仪表盘') throw new Error(`brand block accessibility label mismatch: ${brandBlock}`);
  const clicked = await evaluate(cdp, "(() => { const brand = document.querySelector('[data-testid=\"brand-block\"]'); if (!brand) return false; brand.click(); return true; })()");
  if (!clicked) throw new Error('brand block is missing');
  await waitFor(async () => String(await evaluate(cdp, 'window.location.pathname')) === '/dashboard', 'dashboard route after brand block click');
  await waitFor(async () => await evaluate(cdp, "Boolean(document.querySelector('[data-dashboard-surface=\"desktop\"]'))"), 'dashboard surface after brand block click');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  await waitFor(async () => String(await evaluate(cdp, 'getComputedStyle(document.querySelector(".dashboard-mobile-content")).display')) !== 'none', 'mobile dashboard content');
  const mobileAccountClicked = await evaluate(cdp, '(() => { const button = document.querySelector(".mobile-account-trigger"); if (!button) return false; button.click(); return true; })()');
  if (!mobileAccountClicked) throw new Error('mobile account trigger is missing');
  await waitFor(async () => await evaluate(cdp, "Boolean(document.querySelector('.mobile-account-anchor [data-testid=\"account-logout\"]'))"), 'mobile account menu');
  if (String(await evaluate(cdp, 'window.location.pathname')) !== '/dashboard') throw new Error('mobile account click unexpectedly navigated away from dashboard');
  console.log('brand-block Chrome E2E passed: accounts -> click brand block -> dashboard; mobile account menu remains local');
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
