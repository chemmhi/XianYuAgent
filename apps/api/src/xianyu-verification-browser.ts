import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { dropStaleCaptchaChallengeCookies, type XianyuCookieSnapshot } from './xianyu-cookie-jar.js';
import { XianyuSliderSolver, type XianyuSliderMode } from './xianyu-slider-solver.js';
import { xianyuChromeVersion } from './xianyu-browser-identity.js';

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
  allowManualFallback?: boolean;
  userAgent?: string;
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
  userDataDir?: string;
  ownsUserDataDir: boolean;
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
  private readonly allowManualFallback: boolean;
  private readonly userAgent?: string;
  private readonly activeVerifications = new Map<string, Promise<XianyuVerificationBrowserResult>>();

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
    this.allowManualFallback = options.allowManualFallback ?? true;
    // Preserve the installed Chrome UA by default. An explicit UA override can
    // be supplied for controlled fixtures, but a hard-coded version can make
    // Client Hints and the browser's native UA disagree under anti-bot checks.
    this.userAgent = options.userAgent?.trim() || process.env.XIANYU_BROWSER_USER_AGENT?.trim() || undefined;
  }

  get enabled(): boolean { return this.mode !== 'disabled'; }

  async waitForCompletion(input: { verificationUrl: string; initialCookieSnapshot?: XianyuCookieSnapshot; allowManualFallback?: boolean; maxWaitMs?: number; pollIntervalMs?: number }): Promise<XianyuVerificationBrowserResult> {
    const verificationKey = `${input.verificationUrl}\u0000${JSON.stringify(input.initialCookieSnapshot ?? [])}`;
    const active = this.activeVerifications.get(verificationKey);
    if (active) return active;
    const task = this.runVerification(input);
    this.activeVerifications.set(verificationKey, task);
    try {
      return await task;
    } finally {
      if (this.activeVerifications.get(verificationKey) === task) this.activeVerifications.delete(verificationKey);
    }
  }

  private async runVerification(input: { verificationUrl: string; initialCookieSnapshot?: XianyuCookieSnapshot; allowManualFallback?: boolean; maxWaitMs?: number; pollIntervalMs?: number }): Promise<XianyuVerificationBrowserResult> {
    if (this.mode === 'disabled') throw new Error('XIANYU_VERIFICATION_BROWSER_DISABLED');
    assertVerificationUrl(input.verificationUrl);
    const maxWaitMs = Math.max(250, Math.floor(input.maxWaitMs ?? this.maxWaitMs));
    const pollIntervalMs = Math.max(25, Math.floor(input.pollIntervalMs ?? this.pollIntervalMs));
    const allowManualFallback = input.allowManualFallback ?? this.allowManualFallback;
    // An automatic, non-interactive verification must never flash a visible
    // blank Chrome window. QR/manual login keeps the configured headed mode.
    // Headless Chrome is challenged more aggressively by the platform. Auto
    // solving therefore uses the installed, headed Chrome engine but keeps the
    // owned window off-screen so users never see an empty verification tab.
    // Set XIANYU_VERIFICATION_AUTO_HEADLESS=true only for CI environments with
    // no desktop session.
    const useHeadless = shouldUseHeadlessVerificationBrowser(this.sliderMode, this.headless);
    // Automatic solving is non-interactive by contract. Keep the owned
    // browser fully off-screen even when the caller would otherwise allow a
    // manual fallback; revealing a headed auto-solver only shows a transient
    // blank tab and invites a second, conflicting verification flow.
    const hideWindow = shouldHideVerificationWindow(this.sliderMode, useHeadless);
    const browser = await this.prepareBrowser(useHeadless, hideWindow);
    let cdp: CdpConnection | undefined;
    try {
      cdp = await connectToChrome(browser.debugPort, maxWaitMs, pollIntervalMs, input.verificationUrl);
      await cdp.send('Page.enable');
      await cdp.send('Runtime.enable');
      await cdp.send('Network.enable');
      await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: buildAutomationEvasionScript() });
      await cdp.send('Emulation.setAutomationOverride', { enabled: false }).catch(() => undefined);
      if (browser.ownsProcess && hideWindow && !useHeadless) await moveVerificationWindowOffscreen(cdp);
      if (this.userAgent && this.mode === 'connect') {
        const major = xianyuChromeVersion(this.userAgent).split('.')[0] || '153';
        await cdp.send('Emulation.setUserAgentOverride', {
          userAgent: this.userAgent,
          platform: 'Windows',
          acceptLanguage: 'zh-CN,zh;q=0.9,en;q=0.8',
          userAgentMetadata: {
            brands: [
              { brand: 'Not(A:Brand', version: '99' },
              { brand: 'Chromium', version: major },
              { brand: 'Google Chrome', version: major },
            ],
            fullVersionList: [
              { brand: 'Not(A:Brand', version: '99.0.0.0' },
              { brand: 'Chromium', version: xianyuChromeVersion(this.userAgent) },
              { brand: 'Google Chrome', version: xianyuChromeVersion(this.userAgent) },
            ],
            fullVersion: xianyuChromeVersion(this.userAgent),
            platform: 'Windows',
            platformVersion: '10.0.0',
            architecture: 'x86',
            model: '',
            mobile: false,
          },
        }).catch(() => undefined);
      }
      // The x5secdata/x5sectag challenge markers are part of the active
      // challenge binding. Removing them before navigation makes NC reject an
      // otherwise valid drag because the browser session no longer matches the
      // verification URL. They are removed only after a fresh x5sec is seen.
      const initialCookieSnapshot = input.initialCookieSnapshot ?? [];
      const verificationCookieUrl = resolveVerificationCookieUrl(input.verificationUrl);
      if (initialCookieSnapshot.length > 0) {
        await cdp.send('Network.setCookies', {
          cookies: initialCookieSnapshot.map((cookie) => ({
            name: cookie.name,
            value: cookie.value,
            ...(cookie.domain ? { domain: cookie.domain } : { url: verificationCookieUrl }),
            ...(cookie.path ? { path: cookie.path } : {}),
            ...(cookie.expires !== undefined ? { expires: cookie.expires } : {}),
            ...(cookie.httpOnly !== undefined ? { httpOnly: cookie.httpOnly } : {}),
            ...(cookie.secure !== undefined ? { secure: cookie.secure } : {}),
            ...(cookie.sameSite && ['Strict', 'Lax', 'None'].includes(cookie.sameSite) ? { sameSite: cookie.sameSite } : {}),
          })),
        });
      }
      await cdp.send('Page.navigate', { url: input.verificationUrl });
      await waitForPageContent(cdp, maxWaitMs, pollIntervalMs);
      // Chrome can restore the window bounds after the first real navigation.
      // Re-apply the hidden bounds after the page is mounted so the transient
      // about:blank target can never remain visible to the user.
      if (browser.ownsProcess && hideWindow && !useHeadless) await moveVerificationWindowOffscreen(cdp);
      // NC mounts the visible handle before its challenge callbacks finish
      // wiring. Give the page a short, bounded settle window so the first
      // trusted drag is handled by the live widget instead of a half-mounted
      // DOM node.
      await sleep(750);
      if (browser.ownsProcess && !useHeadless && this.sliderMode !== 'auto' && allowManualFallback) await revealVerificationWindow(cdp);

      if (this.sliderMode === 'auto') {
        try {
          const sliderResult = await new XianyuSliderSolver(cdp, {
            maxRetries: this.sliderMaxRetries,
            logger: console,
          }).solve();
          if (!sliderResult.success) {
            const reason = sliderResult.failureReason ?? 'unknown';
            console.warn(JSON.stringify({ component: 'xianyu-verification', event: 'slider_auto_solve_failed', reason, attempts: sliderResult.attempts, distance: sliderResult.distance, trajectoryPoints: sliderResult.trajectoryPoints }));
            if (process.env.XIANYU_VERIFICATION_DEBUG_SCREENSHOT === 'true') await captureVerificationDebug(cdp, reason);
            if (!allowManualFallback) {
              throw new Error(`XIANYU_VERIFICATION_AUTO_SOLVE_FAILED:${reason}`);
            }
          } else {
            console.info(JSON.stringify({ component: 'xianyu-verification', event: 'slider_auto_solve_succeeded', attempts: sliderResult.attempts, distance: sliderResult.distance, trajectoryPoints: sliderResult.trajectoryPoints }));
          }
        } catch (error) {
          console.warn(JSON.stringify({ component: 'xianyu-verification', event: 'slider_auto_solve_failed', reason: error instanceof Error ? error.message : String(error) }));
          if (!allowManualFallback) throw error;
        }
      }

      const deadline = Date.now() + maxWaitMs;
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
        if (isBlankOrInvalidVerificationPage(lastUrl)) throw new Error('XIANYU_VERIFICATION_PAGE_EMPTY');
        await sleep(pollIntervalMs);
      }
      throw new Error('XIANYU_VERIFICATION_TIMEOUT');
    } finally {
      cdp?.close();
      if (browser.ownsProcess && browser.child) await terminateOwnedBrowser(browser.child);
      if (browser.ownsUserDataDir && browser.userDataDir) await rm(browser.userDataDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async prepareBrowser(useHeadless: boolean, hideWindow = false): Promise<BrowserProcess> {
    if (this.mode === 'connect') {
      if (!this.debugPort) throw new Error('XIANYU_VERIFICATION_DEBUG_PORT_REQUIRED');
      return { ownsProcess: false, debugPort: this.debugPort, ownsUserDataDir: false };
    }
    const debugPort = this.debugPort ?? await findFreePort();
    const executablePath = this.executablePath ?? findChromeExecutable();
    if (!executablePath) throw new Error('XIANYU_VERIFICATION_BROWSER_NOT_FOUND');
    const ownsUserDataDir = !this.userDataDir;
    const userDataDir = this.userDataDir ?? await mkdtemp(join(tmpdir(), 'xianyu-verification-'));
    const args = [
      ...(useHeadless ? ['--headless=new'] : []),
      '--disable-blink-features=AutomationControlled',
      '--disable-features=AutomationControlled',
      '--disable-popup-blocking',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-extensions',
      '--no-first-run',
      '--no-default-browser-check',
      '--remote-allow-origins=*',
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${userDataDir}`,
      '--window-size=1440,900',
      '--lang=zh-CN',
      ...(this.userAgent ? [`--user-agent=${this.userAgent}`] : []),
      ...(!useHeadless && hideWindow ? ['--start-minimized', '--window-position=-32000,-32000'] : []),
      ...(!useHeadless && !hideWindow ? ['--start-minimized'] : []),
      // Start from a deterministic target and navigate only after CDP has
      // attached. Passing the challenge URL on the command line can leave a
      // transient about:blank target selected by CDP and produces a visible
      // empty page while the real target is still loading.
      'about:blank',
    ];
    const child = spawn(executablePath, args, { stdio: 'ignore', windowsHide: true });
    return { child, ownsProcess: true, debugPort, userDataDir, ownsUserDataDir };
  }
}

export function shouldUseHeadlessVerificationBrowser(sliderMode: XianyuSliderMode, configuredHeadless: boolean): boolean {
  if (configuredHeadless) return true;
  return sliderMode === 'auto' && process.env.XIANYU_VERIFICATION_AUTO_HEADLESS === 'true';
}

export function shouldHideVerificationWindow(sliderMode: XianyuSliderMode, useHeadless: boolean): boolean {
  return sliderMode === 'auto' && !useHeadless;
}

export function resolveVerificationCookieUrl(verificationUrl: string): string {
  const url = new URL(verificationUrl);
  url.hash = '';
  url.search = '';
  if (!url.pathname) url.pathname = '/';
  return url.toString();
}

async function terminateOwnedBrowser(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null && child.signalCode !== null) return;
  const pid = child.pid;
  if (process.platform === 'win32' && pid) {
    await new Promise<void>((resolve) => {
      execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => resolve());
    });
  } else {
    try { child.kill('SIGTERM'); } catch { /* already exited */ }
  }
  if (child.exitCode !== null) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 2_000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function buildAutomationEvasionScript(): string {
  // Keep the patch intentionally small. Large fingerprint rewrites tend to
  // create contradictions that are easier to detect than the automation flag.
  return `(() => {
    try {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined, configurable: true });
      delete Object.getPrototypeOf(navigator).webdriver;
    } catch {}
    try {
      delete window.playwright;
      delete window.__playwright;
      delete window.__pw_manual;
      delete window.__PW_inspect;
      delete window.cdc_adoQpoasnfa76pfcZLmcfl_Array;
      delete window.cdc_adoQpoasnfa76pfcZLmcfl_Promise;
      delete window.cdc_adoQpoasnfa76pfcZLmcfl_Symbol;
    } catch {}
  })();`;
}

function assertVerificationUrl(value: string): void {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    const isGoofishHost = hostname === 'goofish.com' || hostname.endsWith('.goofish.com') || hostname === 'localhost' || hostname === '127.0.0.1';
    const path = `${url.pathname}${url.search}${url.hash}`;
    const isLocalFixture = hostname === 'localhost' || hostname === '127.0.0.1';
    if (!isGoofishHost || (!isLocalFixture && !/punish|captcha|verify|security/i.test(path))) throw new Error('invalid target');
  } catch {
    throw new Error('XIANYU_VERIFICATION_URL_INVALID');
  }
}

async function waitForPageContent(cdp: CdpConnection, maxWaitMs: number, pollIntervalMs: number): Promise<void> {
  const deadline = Date.now() + Math.min(maxWaitMs, 12_000);
  let ready = false;
  let blank = true;
  while (Date.now() < deadline) {
    const result = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const body = document.body;
        const html = document.documentElement;
        const text = body?.innerText?.trim() ?? '';
        const renderedNode = body?.querySelector('iframe,canvas,svg,img,video,object,embed,main,section,form,[class],[id],[role]');
        const meaningfulMarkup = (body?.innerHTML?.trim().length ?? 0) > 48 || (html?.outerHTML?.length ?? 0) > 220;
        return {
          ready: document.readyState !== 'loading',
          blank: !body || (!text && !renderedNode && !meaningfulMarkup),
        };
      })()`,
      returnByValue: true,
    });
    const value = (result.result as { value?: unknown } | undefined)?.value;
    if (value && typeof value === 'object') {
      const state = value as { ready?: unknown; blank?: unknown };
      ready = state.ready === true;
      blank = state.blank === true;
      if (ready && !blank) return;
    }
    await sleep(pollIntervalMs);
  }
  if (ready && blank) throw new Error('XIANYU_VERIFICATION_PAGE_EMPTY');
  throw new Error('XIANYU_VERIFICATION_PAGE_LOAD_TIMEOUT');
}

async function revealVerificationWindow(cdp: CdpConnection): Promise<void> {
  try {
    const windowInfo = await cdp.send('Browser.getWindowForTarget');
    const windowId = Number(windowInfo.windowId);
    if (!Number.isFinite(windowId)) return;
    await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
  } catch {
    // Window management is best-effort; it must not fail verification.
  }
}

async function captureVerificationDebug(cdp: CdpConnection, reason: string): Promise<void> {
  try {
    const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const base64 = typeof screenshot.data === 'string' ? screenshot.data : undefined;
    const dom = await cdp.send('Runtime.evaluate', { expression: 'document.documentElement?.outerHTML ?? ""', returnByValue: true });
    const html = (dom.result as { value?: unknown } | undefined)?.value;
    const root = join(process.cwd(), 'artifacts', 'debug');
    await mkdir(root, { recursive: true });
    if (base64) await writeFile(join(root, 'xianyu-slider-failure.png'), Buffer.from(base64, 'base64'));
    await writeFile(join(root, 'xianyu-slider-failure.html'), typeof html === 'string' ? html : `<!-- ${reason} -->`);
  } catch {
    // Diagnostics must never alter the verification result.
  }
}

function isBlankOrInvalidVerificationPage(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'about:' || url.hostname === '';
  } catch {
    return true;
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

async function connectToChrome(debugPort: number, maxWaitMs: number, pollIntervalMs: number, preferredUrl?: string): Promise<CdpConnection> {
  const target = await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
    if (!response.ok) return undefined;
    const items = await response.json() as CdpTarget[];
    const pages = items.filter((item) => item.type === 'page' && item.webSocketDebuggerUrl);
    const preferred = preferredUrl ? (() => {
      try {
        const expected = new URL(preferredUrl);
        const exact = pages.find((item) => String((item as CdpTarget & { url?: string }).url ?? '') === expected.href);
        if (exact) return exact;
        const hostname = expected.hostname;
        const sameHost = pages.find((item) => {
          try { return new URL(String((item as CdpTarget & { url?: string }).url ?? '')).hostname === hostname; } catch { return false; }
        });
        if (sameHost) return sameHost;
        // If Chrome has not navigated yet, prefer the target we can control
        // over an unrelated non-blank tab from a reused browser instance.
        return pages.find((item) => String((item as CdpTarget & { url?: string }).url ?? '').startsWith('about:blank'));
      } catch { return undefined; }
    })() : undefined;
    return preferred ?? pages.find((item) => !String((item as CdpTarget & { url?: string }).url ?? '').startsWith('about:blank')) ?? pages[0];
  }, maxWaitMs, pollIntervalMs);
  const url = target?.webSocketDebuggerUrl;
  if (!url) throw new Error('XIANYU_VERIFICATION_CDP_TARGET_MISSING');
  const WebSocketCtor = (globalThis as unknown as { WebSocket?: new (url: string) => WebSocketLike }).WebSocket;
  if (!WebSocketCtor) throw new Error('XIANYU_VERIFICATION_WEBSOCKET_UNAVAILABLE');
  const socket = new WebSocketCtor(url);
  await waitForSocketOpen(socket, maxWaitMs);
  let nextId = 0;
  const pending = new Map<number, { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  let closed = false;
  const rejectPending = (error: Error): void => {
    if (closed) return;
    closed = true;
    for (const [id, entry] of pending) {
      clearTimeout(entry.timer);
      entry.reject(error);
      pending.delete(id);
    }
  };
  socket.addEventListener('message', (event) => {
    const data = typeof event.data === 'string' ? event.data : String(event.data);
    let message: { id?: number; result?: Record<string, unknown>; error?: { message?: string } };
    try { message = JSON.parse(data) as typeof message; } catch { return; }
    if (!message.id) return;
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.error) entry.reject(new Error(message.error.message ?? 'XIANYU_VERIFICATION_CDP_ERROR'));
    else entry.resolve(message.result ?? {});
  });
  socket.addEventListener('error', () => rejectPending(new Error('XIANYU_VERIFICATION_CDP_CONNECTION_CLOSED')));
  socket.addEventListener('close', () => rejectPending(new Error('XIANYU_VERIFICATION_CDP_CONNECTION_CLOSED')));
  return {
    send: (method, params = {}) => new Promise((resolve, reject) => {
      if (closed) {
        reject(new Error('XIANYU_VERIFICATION_CDP_CONNECTION_CLOSED'));
        return;
      }
      const id = ++nextId;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`XIANYU_VERIFICATION_CDP_TIMEOUT:${method}`));
      }, Math.max(1_000, Math.min(maxWaitMs, 10_000)));
      pending.set(id, { resolve, reject, timer });
      try {
        socket.send(JSON.stringify({ id, method, params }));
      } catch (error) {
        clearTimeout(timer);
        pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    }),
    close: () => {
      rejectPending(new Error('XIANYU_VERIFICATION_CDP_CONNECTION_CLOSED'));
      try { socket.close(); } catch { /* already closed */ }
    },
  };
}

async function moveVerificationWindowOffscreen(cdp: CdpConnection): Promise<void> {
  try {
    const windowInfo = await cdp.send('Browser.getWindowForTarget');
    const windowId = Number(windowInfo.windowId);
    if (!Number.isFinite(windowId)) return;
    await cdp.send('Browser.setWindowBounds', {
      windowId,
      bounds: { windowState: 'normal', left: -32000, top: -32000, width: 1, height: 1 },
    });
    await cdp.send('Browser.setWindowBounds', {
      windowId,
      bounds: { windowState: 'minimized', left: -32000, top: -32000, width: 1, height: 1 },
    });
  } catch {
    // Window management is best-effort; the off-screen launch flags remain
    // the primary guard and must not fail an otherwise valid challenge.
  }
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
