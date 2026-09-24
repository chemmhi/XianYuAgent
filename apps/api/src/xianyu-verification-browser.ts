import { mkdtemp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { dropStaleCaptchaChallengeCookies, type XianyuCookieSnapshot } from './xianyu-cookie-jar.js';
import { XianyuSliderSolver, type XianyuSliderMode } from './xianyu-slider-solver.js';

export type XianyuVerificationBrowserMode = 'disabled' | 'launch' | 'connect';

export interface XianyuVerificationBrowserOptions {
  mode?: XianyuVerificationBrowserMode;
  sliderMode?: XianyuSliderMode;
  sliderMaxRetries?: number;
  headless?: boolean;
  executablePath?: string;
  debugPort?: number;
  userDataDir?: string;
  maxWaitMs?: number;
  pollIntervalMs?: number;
}

export interface XianyuVerificationBrowserResult {
  finalUrl: string;
  cookieSnapshot: XianyuCookieSnapshot;
}

interface CdpTarget {
  type?: string;
  webSocketDebuggerUrl?: string;
}

interface CdpConnection {
  send(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>;
  close(): void;
}

interface CdpCookie {
  name?: string;
  value?: string;
  domain?: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: string;
  partitionKey?: string;
}

interface BrowserProcess {
  child?: ChildProcess;
  ownsProcess: boolean;
  debugPort: number;
}

const DEFAULT_MAX_WAIT_MS = 3 * 60_000;
const DEFAULT_POLL_INTERVAL_MS = 1_000;

/** Opens a verification page and waits for the user to finish it. */
export class XianyuVerificationBrowser {
  private readonly mode: XianyuVerificationBrowserMode;
  private readonly sliderMode: XianyuSliderMode;
  private readonly sliderMaxRetries: number;
  private readonly headless: boolean;
  private readonly executablePath?: string;
  private readonly debugPort?: number;
  private readonly userDataDir?: string;
  private readonly maxWaitMs: number;
  private readonly pollIntervalMs: number;

  constructor(options: XianyuVerificationBrowserOptions = {}) {
    this.mode = options.mode ?? 'disabled';
    this.sliderMode = options.sliderMode ?? 'disabled';
    this.sliderMaxRetries = Math.max(1, Math.floor(options.sliderMaxRetries ?? 3));
    this.headless = options.headless ?? false;
    this.executablePath = options.executablePath;
    this.debugPort = options.debugPort;
    this.userDataDir = options.userDataDir;
    this.maxWaitMs = options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  }

  get enabled(): boolean { return this.mode !== 'disabled'; }

  async waitForCompletion(input: { verificationUrl: string; initialCookieSnapshot?: XianyuCookieSnapshot }): Promise<XianyuVerificationBrowserResult> {
    if (this.mode === 'disabled') throw new Error('XIANYU_VERIFICATION_BROWSER_DISABLED');
    const browser = await this.prepareBrowser(input.verificationUrl);
    let cdp: CdpConnection | undefined;
    try {
      cdp = await connectToChrome(browser.debugPort, this.maxWaitMs, this.pollIntervalMs);
      await cdp.send('Page.enable');
      await cdp.send('Runtime.enable');
      await cdp.send('Network.enable');
      if (input.initialCookieSnapshot && input.initialCookieSnapshot.length > 0) {
        await cdp.send('Network.setCookies', {
          cookies: input.initialCookieSnapshot.map((cookie) => ({
            name: cookie.name,
            value: cookie.value,
            ...(cookie.domain ? { domain: cookie.domain } : { url: 'https://www.goofish.com/' }),
            ...(cookie.path ? { path: cookie.path } : {}),
            ...(cookie.expires !== undefined ? { expires: cookie.expires } : {}),
            ...(cookie.httpOnly !== undefined ? { httpOnly: cookie.httpOnly } : {}),
            ...(cookie.secure !== undefined ? { secure: cookie.secure } : {}),
            ...(cookie.sameSite && ['Strict', 'Lax', 'None'].includes(cookie.sameSite) ? { sameSite: cookie.sameSite } : {}),
          })),
        });
      }
      await cdp.send('Page.navigate', { url: input.verificationUrl });

      if (this.sliderMode === 'auto') {
        try {
          const sliderResult = await new XianyuSliderSolver(cdp, {
            maxRetries: this.sliderMaxRetries,
            logger: console,
          }).solve();
          if (!sliderResult.success) {
            console.warn(JSON.stringify({ component: 'xianyu-verification', event: 'slider_auto_solve_failed', reason: sliderResult.failureReason ?? 'unknown' }));
          } else {
            console.info(JSON.stringify({ component: 'xianyu-verification', event: 'slider_auto_solve_succeeded', attempts: sliderResult.attempts, distance: sliderResult.distance, trajectoryPoints: sliderResult.trajectoryPoints }));
          }
        } catch (error) {
          console.warn(JSON.stringify({ component: 'xianyu-verification', event: 'slider_auto_solve_failed', reason: error instanceof Error ? error.message : String(error) }));
        }
      }

      const deadline = Date.now() + this.maxWaitMs;
      let lastUrl = input.verificationUrl;
      let lastCookies = input.initialCookieSnapshot ?? [];
      while (Date.now() < deadline) {
        const location = await evaluateString(cdp, 'location.href');
        if (location) lastUrl = location;
        const cookieResult = await cdp.send('Network.getAllCookies');
        lastCookies = mapCookies(cookieResult.cookies);
        if (isVerificationPageComplete(lastUrl, lastCookies, input.initialCookieSnapshot)) {
          return { finalUrl: lastUrl, cookieSnapshot: dropStaleCaptchaChallengeCookies(lastCookies) };
        }
        await sleep(this.pollIntervalMs);
      }
      throw new Error('XIANYU_VERIFICATION_TIMEOUT');
    } finally {
      cdp?.close();
      if (browser.ownsProcess && browser.child && browser.child.exitCode === null) browser.child.kill();
    }
  }

  private async prepareBrowser(verificationUrl: string): Promise<BrowserProcess> {
    if (this.mode === 'connect') {
      if (!this.debugPort) throw new Error('XIANYU_VERIFICATION_DEBUG_PORT_REQUIRED');
      return { ownsProcess: false, debugPort: this.debugPort };
    }
    const debugPort = this.debugPort ?? await findFreePort();
    const executablePath = this.executablePath ?? findChromeExecutable();
    if (!executablePath) throw new Error('XIANYU_VERIFICATION_BROWSER_NOT_FOUND');
    const userDataDir = this.userDataDir ?? await mkdtemp(join(tmpdir(), 'xianyu-verification-'));
    const args = [
      ...(this.headless ? ['--headless=new'] : []),
      '--disable-extensions',
      '--no-first-run',
      '--no-default-browser-check',
      '--remote-allow-origins=*',
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${userDataDir}`,
      '--window-size=1440,900',
      verificationUrl,
    ];
    const child = spawn(executablePath, args, { stdio: 'ignore', windowsHide: true });
    return { child, ownsProcess: true, debugPort };
  }
}

export function isVerificationPageComplete(finalUrl: string, cookies: XianyuCookieSnapshot, previousCookies: XianyuCookieSnapshot = []): boolean {
  const previousX5sec = new Set(previousCookies.filter((cookie) => cookie.name.toLowerCase() === 'x5sec').map((cookie) => `${cookie.domain ?? ''}\u0000${cookie.path ?? '/'}\u0000${cookie.value}`));
  const hasX5sec = cookies.some((cookie) => cookie.name.toLowerCase() === 'x5sec' && cookie.value && isGoofishCookieDomain(cookie.domain)
    && !previousX5sec.has(`${cookie.domain ?? ''}\u0000${cookie.path ?? '/'}\u0000${cookie.value}`));
  if (hasX5sec) return true;
  try {
    const url = new URL(finalUrl);
    const hostname = url.hostname.toLowerCase();
    const isGoofishHost = hostname === 'goofish.com' || hostname.endsWith('.goofish.com');
    const isVerificationPath = /punish|captcha|verify|security/i.test(`${url.pathname}${url.search}${url.hash}`);
    const isPostVerificationTarget = url.pathname === '/im' || url.pathname.startsWith('/im/');
    return isGoofishHost && isPostVerificationTarget && !isVerificationPath;
  } catch {
    return false;
  }
}

function mapCookies(value: unknown): XianyuCookieSnapshot {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): XianyuCookieSnapshot => {
    if (!item || typeof item !== 'object') return [];
    const cookie = item as CdpCookie;
    if (!cookie.name) return [];
    return [{
      name: cookie.name,
      value: String(cookie.value ?? ''),
      domain: cookie.domain,
      path: cookie.path,
      expires: typeof cookie.expires === 'number' ? cookie.expires : undefined,
      httpOnly: Boolean(cookie.httpOnly),
      secure: Boolean(cookie.secure),
      sameSite: cookie.sameSite,
      partitionKey: cookie.partitionKey,
    }];
  });
}

async function connectToChrome(debugPort: number, maxWaitMs: number, pollIntervalMs: number): Promise<CdpConnection> {
  const target = await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
    if (!response.ok) return undefined;
    const items = await response.json() as CdpTarget[];
    return items.find((item) => item.type === 'page' && item.webSocketDebuggerUrl);
  }, maxWaitMs, pollIntervalMs);
  const url = target?.webSocketDebuggerUrl;
  if (!url) throw new Error('XIANYU_VERIFICATION_CDP_TARGET_MISSING');
  const WebSocketCtor = (globalThis as unknown as { WebSocket?: new (url: string) => WebSocketLike }).WebSocket;
  if (!WebSocketCtor) throw new Error('XIANYU_VERIFICATION_WEBSOCKET_UNAVAILABLE');
  const socket = new WebSocketCtor(url);
  await waitForSocketOpen(socket, maxWaitMs);
  let nextId = 0;
  const pending = new Map<number, { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void }>();
  socket.addEventListener('message', (event) => {
    const data = typeof event.data === 'string' ? event.data : String(event.data);
    let message: { id?: number; result?: Record<string, unknown>; error?: { message?: string } };
    try { message = JSON.parse(data) as typeof message; } catch { return; }
    if (!message.id) return;
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(message.error.message ?? 'XIANYU_VERIFICATION_CDP_ERROR'));
    else entry.resolve(message.result ?? {});
  });
  return {
    send: (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    }),
    close: () => socket.close(),
  };
}

interface WebSocketLike {
  addEventListener(type: string, listener: (event: { data?: unknown }) => void): void;
  send(data: string): void;
  close(): void;
}

async function evaluateString(cdp: CdpConnection, expression: string): Promise<string | undefined> {
  const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true });
  const value = (result.result as { value?: unknown } | undefined)?.value;
  return typeof value === 'string' ? value : undefined;
}

async function waitForSocketOpen(socket: WebSocketLike, maxWaitMs: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('XIANYU_VERIFICATION_CDP_CONNECT_TIMEOUT'));
    }, maxWaitMs);
    socket.addEventListener('open', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    });
    socket.addEventListener('error', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error('XIANYU_VERIFICATION_CDP_CONNECT_FAILED'));
    });
  });
}

async function waitFor<T>(read: () => Promise<T | undefined>, maxWaitMs: number, pollIntervalMs: number): Promise<T> {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const value = await read().catch(() => undefined);
    if (value !== undefined) return value;
    await sleep(pollIntervalMs);
  }
  throw new Error('XIANYU_VERIFICATION_CDP_TIMEOUT');
}

async function findFreePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (!port) throw new Error('XIANYU_VERIFICATION_PORT_ALLOC_FAILED');
  return port;
}

function findChromeExecutable(): string | undefined {
  const environment = process.env.XIANYU_VERIFICATION_BROWSER_EXECUTABLE?.trim() || process.env.CHROME_PATH?.trim();
  if (environment) return environment;
  const roots = [process.env.LOCALAPPDATA, process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)']].filter((value): value is string => Boolean(value));
  const candidates = roots.flatMap((root) => [
    join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ]);
  return candidates.find((candidate) => {
    try { return existsSync(candidate); } catch { return false; }
  });
}

function isGoofishCookieDomain(domain: string | undefined): boolean {
  const normalized = String(domain ?? '').toLowerCase();
  return normalized === 'goofish.com' || normalized === '.goofish.com' || normalized.endsWith('.goofish.com');
}

function sleep(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }
