import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer as createNetServer } from 'node:net';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import WebSocket from 'ws';
import { XianyuVerificationBrowser } from '../src/xianyu-verification-browser.js';

test('verification browser reads completion from a real local Chrome/CDP session', async () => {
  const executablePath = process.env.XIANYU_VERIFICATION_BROWSER_EXECUTABLE || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const profile = await mkdtemp(join(tmpdir(), 'xianyu-verification-cdp-test-'));
  const debugPort = await findFreePort();
  const fixture = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><title>verification fixture</title><p>Complete in test harness</p>');
  });
  await new Promise<void>((resolve) => fixture.listen(0, '127.0.0.1', () => resolve()));
  const address = fixture.address();
  assert.ok(address && typeof address === 'object');
  const verificationUrl = `http://127.0.0.1:${address.port}/fixture`;
  let chrome: ChildProcess | undefined;
  try {
    chrome = spawn(executablePath, [
      '--headless=new', '--disable-gpu', '--disable-extensions', '--no-first-run', '--no-default-browser-check',
      '--remote-allow-origins=*', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, '--window-size=1440,900', 'about:blank',
    ], { stdio: 'ignore', windowsHide: true });
    await waitFor(async () => (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).ok, 8_000);

    const browser = new XianyuVerificationBrowser({ mode: 'connect', debugPort, maxWaitMs: 8_000, pollIntervalMs: 100 });
    const completion = browser.waitForCompletion({ verificationUrl });
    const target = await waitFor(async () => {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      if (!response.ok) return undefined;
      const pages = await response.json() as Array<{ type?: string; webSocketDebuggerUrl?: string }>;
      return pages.find((page) => page.type === 'page' && page.webSocketDebuggerUrl);
    }, 8_000);
    assert.ok(target?.webSocketDebuggerUrl);
    await setCookie(target.webSocketDebuggerUrl, {
      name: 'x5sec', value: 'fixture', domain: '.goofish.com', path: '/', secure: true,
      url: 'https://www.goofish.com/im',
    });

    const result = await completion;
    assert.equal(result.finalUrl, verificationUrl);
    assert.equal(result.cookieSnapshot.find((cookie) => cookie.name === 'x5sec')?.value, 'fixture');
  } finally {
    if (chrome && chrome.exitCode === null) {
      chrome.kill();
      await waitForChildExit(chrome, 2_000);
    }
    await new Promise<void>((resolve) => fixture.close(() => resolve()));
    await rm(profile, { recursive: true, force: true });
  }
});

test('verification browser accepts canvas-only challenge pages instead of treating them as blank', async () => {
  const executablePath = process.env.XIANYU_VERIFICATION_BROWSER_EXECUTABLE || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const profile = await mkdtemp(join(tmpdir(), 'xianyu-verification-canvas-cdp-test-'));
  const debugPort = await findFreePort();
  const fixture = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><canvas id="captcha" width="360" height="160"></canvas><script>document.getElementById("captcha").getContext("2d").fillRect(0,0,1,1)</script>');
  });
  await new Promise<void>((resolve) => fixture.listen(0, '127.0.0.1', () => resolve()));
  const address = fixture.address();
  assert.ok(address && typeof address === 'object');
  const verificationUrl = `http://127.0.0.1:${address.port}/canvas`;
  let chrome: ChildProcess | undefined;
  try {
    chrome = spawn(executablePath, [
      '--headless=new', '--disable-gpu', '--disable-extensions', '--no-first-run', '--no-default-browser-check',
      '--remote-allow-origins=*', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, '--window-size=1440,900', 'about:blank',
    ], { stdio: 'ignore', windowsHide: true });
    await waitFor(async () => (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).ok, 8_000);

    const browser = new XianyuVerificationBrowser({ mode: 'connect', debugPort, maxWaitMs: 8_000, pollIntervalMs: 100 });
    const completion = browser.waitForCompletion({ verificationUrl });
    const target = await waitFor(async () => {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      if (!response.ok) return undefined;
      const pages = await response.json() as Array<{ type?: string; webSocketDebuggerUrl?: string }>;
      return pages.find((page) => page.type === 'page' && page.webSocketDebuggerUrl);
    }, 8_000);
    assert.ok(target?.webSocketDebuggerUrl);
    await setCookie(target.webSocketDebuggerUrl, {
      name: 'x5sec', value: 'fixture-canvas', domain: '.goofish.com', path: '/', secure: true,
      url: 'https://www.goofish.com/im',
    });

    const result = await completion;
    assert.equal(result.cookieSnapshot.find((cookie) => cookie.name === 'x5sec')?.value, 'fixture-canvas');
  } finally {
    if (chrome && chrome.exitCode === null) {
      chrome.kill();
      await waitForChildExit(chrome, 2_000);
    }
    await new Promise<void>((resolve) => fixture.close(() => resolve()));
    await rm(profile, { recursive: true, force: true });
  }
});

async function setCookie(webSocketUrl: string, cookie: Record<string, unknown>): Promise<void> {
  const socket = new WebSocket(webSocketUrl);
  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', reject);
  });
  let nextId = 0;
  const response = new Promise<void>((resolve, reject) => {
    socket.on('message', (raw) => {
      const message = JSON.parse(String(raw)) as { id?: number; error?: { message?: string } };
      if (message.id !== 1) return;
      if (message.error) reject(new Error(message.error.message ?? 'CDP set cookie failed'));
      else resolve();
      socket.close();
    });
  });
  nextId += 1;
  socket.send(JSON.stringify({ id: nextId, method: 'Network.setCookie', params: cookie }));
  await response;
}

async function findFreePort(): Promise<number> {
  const server = createNetServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  assert.ok(port > 0);
  return port;
}

async function waitFor(read: () => Promise<boolean | { webSocketDebuggerUrl?: string } | undefined>, timeoutMs: number): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read().catch(() => undefined);
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('CDP fixture timeout');
}

async function waitForChildExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
