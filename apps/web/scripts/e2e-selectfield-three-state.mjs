import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const root = join(import.meta.dirname, '..', '..', '..');
const chromePath = process.env.CHROME_PATH ?? join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe');
const targetUrl = process.env.SELECTFIELD_TARGET_URL ?? 'http://127.0.0.1:4173/controls';
const outputDir = process.env.SELECTFIELD_OUTPUT_DIR ?? join(root, 'artifacts', 'real-selectfield-three-state-20260922');
const chromeProfile = join(tmpdir(), `xianyu-agent-selectfield-${process.pid}`);
const children = [];

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function spawnProcess(command, args) {
  const child = spawn(command, args, { cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  child.stdout.on('data', (chunk) => process.stdout.write(`[selectfield-e2e] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[selectfield-e2e] ${chunk}`));
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
    await sleep(100);
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
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? 'browser evaluation failed');
  return result.result?.value;
}

async function capture(cdp, fileName) {
  const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
  mkdirSync(outputDir, { recursive: true });
  const destination = join(outputDir, fileName);
  writeFileSync(destination, Buffer.from(screenshot.data, 'base64'));
  return destination;
}

async function run() {
  mkdirSync(chromeProfile, { recursive: true });
  const debugPort = await freePort();
  const chrome = spawnProcess(chromePath, [
    '--headless=new', '--disable-gpu', '--disable-extensions', '--disable-crash-reporter',
    '--disable-breakpad', '--no-first-run', '--no-default-browser-check', '--remote-allow-origins=*',
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=${chromeProfile}`, '--window-size=1440,900', 'about:blank',
  ]);
  await waitFor(async () => chrome.exitCode === null && (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).ok, 'local Chrome');
  const cdp = await createCdpClient(debugPort);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: targetUrl });
  await waitFor(async () => String(await evaluate(cdp, 'document.readyState')) === 'complete', 'controls page');
  await waitFor(async () => Boolean(await evaluate(cdp, 'Boolean(document.querySelector(".ui-select-control .ui-select-trigger"))')), 'SelectField trigger');
  await sleep(350);

  const selector = '.ui-select-trigger[aria-label="默认下拉"]';
  const defaultState = await evaluate(cdp, `(() => { const trigger = document.querySelector(${JSON.stringify(selector)}); const root = trigger?.closest('.ui-select-control'); return { expanded: trigger?.getAttribute('aria-expanded'), menu: Boolean(root?.querySelector('.ui-select-menu')), rect: trigger?.getBoundingClientRect().toJSON(), style: trigger ? { background: getComputedStyle(trigger).backgroundColor, border: getComputedStyle(trigger).borderColor, radius: getComputedStyle(trigger).borderRadius } : null }; })()`);
  if (defaultState.expanded !== 'false' || defaultState.menu) throw new Error(`default state mismatch: ${JSON.stringify(defaultState)}`);
  const defaultScreenshot = await capture(cdp, 'select-default-1440x900.png');

  const focusState = await evaluate(cdp, `(() => { const trigger = document.querySelector(${JSON.stringify(selector)}); trigger?.focus(); const style = trigger ? getComputedStyle(trigger) : null; return { active: document.activeElement === trigger, expanded: trigger?.getAttribute('aria-expanded'), background: style?.backgroundColor, border: style?.borderColor, outline: style?.outlineWidth }; })()`);
  if (!focusState.active || focusState.expanded !== 'false') throw new Error(`focus state mismatch: ${JSON.stringify(focusState)}`);
  const focusScreenshot = await capture(cdp, 'select-focus-1440x900.png');

  const clickPoint = await evaluate(cdp, `(() => { const trigger = document.querySelector(${JSON.stringify(selector)}); const rect = trigger?.getBoundingClientRect(); return rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null; })()`);
  if (!clickPoint) throw new Error('select trigger has no layout box');
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: clickPoint.x, y: clickPoint.y, button: 'left', clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: clickPoint.x, y: clickPoint.y, button: 'left', clickCount: 1 });
  await sleep(80);
  const openState = await evaluate(cdp, `(() => { const trigger = document.querySelector(${JSON.stringify(selector)}); const root = trigger?.closest('.ui-select-control'); const menu = root?.querySelector('.ui-select-menu'); return { expanded: trigger?.getAttribute('aria-expanded'), menu: Boolean(menu), role: menu?.getAttribute('role'), optionCount: menu?.querySelectorAll('[role="option"]').length ?? 0, selectedCount: menu?.querySelectorAll('[aria-selected="true"]').length ?? 0, menuStyle: menu ? { background: getComputedStyle(menu).backgroundColor, radius: getComputedStyle(menu).borderRadius, shadow: getComputedStyle(menu).boxShadow } : null }; })()`);
  if (openState.expanded !== 'true' || !openState.menu || openState.role !== 'listbox' || openState.optionCount < 2 || openState.selectedCount !== 1) throw new Error(`open state mismatch: ${JSON.stringify(openState)}`);
  const openScreenshot = await capture(cdp, 'select-open-1440x900.png');

  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 20, y: 20, button: 'left', clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 20, y: 20, button: 'left', clickCount: 1 });
  await sleep(80);
  const closeState = await evaluate(cdp, `(() => { const trigger = document.querySelector(${JSON.stringify(selector)}); const root = trigger?.closest('.ui-select-control'); return { expanded: trigger?.getAttribute('aria-expanded'), menu: Boolean(root?.querySelector('.ui-select-menu')) }; })()`);
  if (closeState.expanded !== 'false' || closeState.menu) throw new Error(`outside click did not close: ${JSON.stringify(closeState)}`);

  const result = { generatedAt: new Date().toISOString(), targetUrl, viewport: '1440x900', states: { default: defaultState, focus: focusState, open: openState, closedByOutsideClick: closeState }, screenshots: { default: defaultScreenshot, focus: focusScreenshot, open: openScreenshot } };
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(join(outputDir, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
  cdp.socket.close();
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
}).finally(async () => {
  for (const child of children.reverse()) {
    if (!child.killed && child.exitCode === null) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  }
  try { rmSync(chromeProfile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* best-effort temp profile cleanup */ }
});
