import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PNG } from 'pngjs';

const root = join(import.meta.dirname, '..', '..', '..');
const designFile = resolve(process.env.PRODUCT_AUTOMATION_DESIGN ?? join(root, 'docs', 'design', 'product-automation-interaction-v1.html'));
const evidenceDir = join(root, 'docs', 'evidence', 'product-automation');
const baselineDir = join(evidenceDir, 'baseline');
const profile = join(tmpdir(), `xianyu-agent-product-automation-design-${process.pid}`);
const chromePath = process.env.CHROME_PATH ?? join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe');
const children = [];

async function freePort() {
  return await new Promise((resolvePort, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const value = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolvePort(value));
    });
  });
}

function spawnProcess(command, args) {
  const child = spawn(command, args, { cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, shell: command.endsWith('.cmd') });
  child.stdout.on('data', (chunk) => process.stdout.write(`[visual-regression:${command}] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[visual-regression:${command}] ${chunk}`));
  children.push(child);
  return child;
}

async function waitFor(check, label, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try { const value = await check(); if (value) return value; } catch (error) { lastError = error; }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 120));
  }
  throw new Error(`${label} did not become ready${lastError ? `: ${lastError.message}` : ''}`);
}

async function cdpClient(debugPort) {
  const target = await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
    if (!response.ok) return false;
    return (await response.json()).find((item) => item.type === 'page' && item.webSocketDebuggerUrl) ?? false;
  }, 'Chrome CDP');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolveOpen, reject) => { socket.addEventListener('open', resolveOpen, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const entry = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(message.error.message)); else entry.resolve(message.result);
  });
  return { socket, send: (method, params = {}) => new Promise((resolveResult, reject) => { const id = ++nextId; pending.set(id, { resolve: resolveResult, reject }); socket.send(JSON.stringify({ id, method, params })); }) };
}

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? 'browser script failed');
  return result.result?.value;
}

async function waitDocument(cdp) {
  await waitFor(async () => String(await evaluate(cdp, 'document.readyState')) === 'complete', 'design document');
  await waitFor(async () => Boolean(await evaluate(cdp, 'document.querySelector(".frame")')), 'design frame');
}

async function normalizeDesignViewport(cdp, width, height) {
  await evaluate(cdp, `(() => { const style = document.querySelector("#codex-visual-baseline-normalize") ?? document.createElement("style"); style.id = "codex-visual-baseline-normalize"; style.textContent = ".note{display:none!important}html,body{overflow:hidden!important}body{margin:0!important}.frame{max-width:none!important;width:${width}px!important;height:${height}px!important;min-height:${height}px!important;margin:0!important;border:0!important;border-radius:0!important;box-shadow:none!important}.app{height:${height}px!important;min-height:${height}px!important}"; document.head.appendChild(style); })()`);
}

async function captureFrame(cdp, outputFile, width, height) {
  const clip = { x: 0, y: 0, width, height, scale: 1 };
  const image = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: true, clip });
  mkdirSync(baselineDir, { recursive: true });
  writeFileSync(outputFile, Buffer.from(image.data, 'base64'));
}

async function resetDesign(cdp, width, height) {
  await cdp.send('Page.reload', { ignoreCache: true });
  await waitDocument(cdp);
  await normalizeDesignViewport(cdp, width, height);
}

async function captureState(cdp, state, width, height) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await resetDesign(cdp, width, height);
  if (state === 'list') await evaluate(cdp, 'document.querySelector("#closeDrawer")?.click()');
  if (state === 'reprice') await evaluate(cdp, 'document.querySelector("[data-tab=reprice]")?.click()');
  if (state === 'gift') await evaluate(cdp, 'document.querySelector("[data-tab=gift]")?.click()');
  if (state === 'review') await evaluate(cdp, 'document.querySelector("[data-tab=review]")?.click()');
  if (state === 'coupon') await evaluate(cdp, 'document.querySelector("[data-coupon=delivery]")?.click()');
  const file = join(baselineDir, `${state}-${width}x${height}.png`);
  await captureFrame(cdp, file, width, height);
  return file;
}

function loadPng(file) { return PNG.sync.read(readFileSync(file)); }

function comparePng(expectedFile, actualFile) {
  const expected = loadPng(expectedFile);
  const actual = loadPng(actualFile);
  if (expected.width !== actual.width || expected.height !== actual.height) return { expected: `${expected.width}x${expected.height}`, actual: `${actual.width}x${actual.height}`, differingPixels: -1, totalPixels: Math.max(expected.width * expected.height, actual.width * actual.height), differingRatio: 1, meanAbsoluteError: null };
  let differingPixels = 0;
  let absoluteError = 0;
  for (let i = 0; i < expected.data.length; i += 4) {
    const delta = Math.abs(expected.data[i] - actual.data[i]) + Math.abs(expected.data[i + 1] - actual.data[i + 1]) + Math.abs(expected.data[i + 2] - actual.data[i + 2]) + Math.abs(expected.data[i + 3] - actual.data[i + 3]);
    absoluteError += delta;
    if (delta > 0) differingPixels += 1;
  }
  const totalPixels = expected.width * expected.height;
  return { expected: `${expected.width}x${expected.height}`, actual: `${actual.width}x${actual.height}`, differingPixels, totalPixels, differingRatio: differingPixels / totalPixels, meanAbsoluteError: absoluteError / (totalPixels * 4) };
}

async function run() {
  const debugPort = await freePort();
  mkdirSync(profile, { recursive: true });
  const chrome = spawnProcess(chromePath, ['--headless=new', '--disable-gpu', '--disable-extensions', '--no-first-run', '--no-default-browser-check', '--allow-file-access-from-files', '--remote-allow-origins=*', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, '--window-size=1440,900', 'about:blank']);
  await waitFor(async () => chrome.exitCode === null && (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).ok, 'Chrome');
  const cdp = await cdpClient(debugPort);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Page.navigate', { url: pathToFileURL(designFile).href });
  await waitDocument(cdp);
  const states = ['list', 'delivery', 'reprice', 'gift', 'review', 'coupon'];
  for (const state of states) {
    await captureState(cdp, state, 1440, 900);
    await captureState(cdp, state, 390, 844);
  }
  const comparisons = [];
  const mapping = { list: '01-products-list', delivery: '02-payment-after-delivery', reprice: '03-unpaid-reprice', gift: '04-review-gift', review: '05-overdue-review', coupon: '06-delivery-coupon-picker' };
  for (const state of states) for (const viewport of ['1440x900', '390x844']) {
    const baseline = join(baselineDir, `${state}-${viewport}.png`);
    const actual = join(evidenceDir, `${mapping[state]}-${viewport === '1440x900' ? 'desktop' : 'mobile'}.png`);
    comparisons.push({ state, viewport, ...comparePng(baseline, actual) });
  }
  writeFileSync(join(evidenceDir, 'pixel-diff-report.json'), JSON.stringify({ designFile, generatedAt: new Date().toISOString(), comparisons }, null, 2));
  console.log(JSON.stringify({ designFile, comparisons }, null, 2));
  cdp.socket.close();
}

try { await run(); }
finally {
  for (const child of children.reverse()) {
    if (!child.killed && child.exitCode === null) {
      if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); else child.kill('SIGTERM');
    }
    child.stdout?.destroy(); child.stderr?.destroy();
  }
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
}
