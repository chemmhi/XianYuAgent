import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer as createNetServer } from 'node:net';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import WebSocket from 'ws';
import { XianyuSliderSolver, type SliderCdpConnection } from '../src/xianyu-slider-solver.js';

const executablePath = process.env.XIANYU_VERIFICATION_BROWSER_EXECUTABLE || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

test('slider solver completes a controlled local Chrome/CDP fixture', async (t) => {
  if (!await fileExists(executablePath)) {
    t.skip(`Chrome executable not found at ${executablePath}`);
    return;
  }
  const profile = await mkdtemp(join(tmpdir(), 'xianyu-slider-cdp-test-'));
  const debugPort = await findFreePort();
  const fixture = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html>
      <style>
        #nocaptcha { width: 240px; height: 40px; margin: 60px; position: relative; background: #eee; }
        #track { width: 220px; height: 40px; position: absolute; left: 0; top: 0; background: #ccc; }
        #slider { width: 40px; height: 40px; position: absolute; left: 0; top: 0; background: #1473e6; }
      </style>
      <div id="nocaptcha"><div id="track" class="slider-track"><button id="slider" class="btn_slide"></button></div></div>
      <script>
        const root = document.querySelector('#nocaptcha');
        const button = document.querySelector('#slider');
        let dragging = false;
        let currentX = 0;
        button.addEventListener('mousedown', () => { dragging = true; });
        document.addEventListener('mousemove', (event) => { if (dragging) currentX = event.clientX; });
        document.addEventListener('mouseup', () => {
          if (!dragging) return;
          dragging = false;
          if (currentX >= 180) root.remove();
          else root.insertAdjacentHTML('beforeend', '<span class="retry">验证失败</span>');
        });
      </script>`);
  });
  await new Promise<void>((resolve) => fixture.listen(0, '127.0.0.1', resolve));
  const address = fixture.address();
  assert.ok(address && typeof address === 'object');
  const url = `http://127.0.0.1:${address.port}/fixture`;
  let chrome: ChildProcess | undefined;
  try {
    chrome = spawn(executablePath, [
      '--headless=new', '--disable-gpu', '--disable-extensions', '--no-first-run', '--no-default-browser-check',
      '--remote-allow-origins=*', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, '--window-size=1440,900', 'about:blank',
    ], { stdio: 'ignore', windowsHide: true });
    const target = await waitFor(async () => {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      if (!response.ok) return undefined;
      const pages = await response.json() as Array<{ type?: string; webSocketDebuggerUrl?: string }>;
      return pages.find((page) => page.type === 'page' && page.webSocketDebuggerUrl);
    }, 8_000);
    assert.ok(target?.webSocketDebuggerUrl);
    const cdp = await connect(target.webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Page.navigate', { url });
    const result = await new XianyuSliderSolver(cdp, { maxRetries: 1, verificationTimeoutMs: 2_000 }).solve();
    assert.equal(result.success, true);
    assert.ok(result.distance && result.distance > 0);
  } finally {
    if (chrome && chrome.exitCode === null) {
      chrome.kill();
      await waitForChildExit(chrome, 2_000);
    }
    await new Promise<void>((resolve) => fixture.close(() => resolve()));
    await waitFor(async () => { try { await rm(profile, { recursive: true, force: true }); return true; } catch { return undefined; } }, 3_000);
  }
});

async function connect(url: string): Promise<SliderCdpConnection> {
  const socket = new WebSocket(url);
  await new Promise<void>((resolve, reject) => { socket.once('open', () => resolve()); socket.once('error', reject); });
  let nextId = 0;
  const pending = new Map<number, { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void }>();
  socket.on('message', (data) => {
    const message = JSON.parse(String(data)) as { id?: number; result?: Record<string, unknown>; error?: { message?: string } };
    if (!message.id) return;
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(message.error.message ?? 'CDP error'));
    else entry.resolve(message.result ?? {});
  });
  return { send(method, params = {}) { return new Promise((resolve, reject) => { const id = ++nextId; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); }); } };
}

async function findFreePort(): Promise<number> {
  const server = createNetServer();
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve()); });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  assert.ok(port);
  return port;
}

async function waitFor<T>(read: () => Promise<T | undefined>, timeoutMs: number): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read().catch(() => undefined);
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('fixture timeout');
}

async function fileExists(path: string): Promise<boolean> {
  try { await import('node:fs/promises').then(({ access }) => access(path)); return true; } catch { return false; }
}

async function waitForChildExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
  });
}
