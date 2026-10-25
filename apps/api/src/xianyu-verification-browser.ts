import { mkdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { dropStaleCaptchaChallengeCookies, normalizeCookieSnapshot, type XianyuCookieSnapshot } from './xianyu-cookie-jar.js';
import { createPatchrightVerificationBrowserFactory } from './patchright-verification-browser.js';
import { XIANYU_USER_AGENT } from './xianyu-browser-identity.js';
import type { XianyuVerificationBrowserFactory, XianyuVerificationContext, XianyuVerificationCookie, XianyuVerificationPage } from './xianyu-browser-port.js';
import { acquireXianyuVerificationProfileLock } from './xianyu-verification-profile-lock.js';
import { XianyuSliderSolver, type XianyuSliderMode } from './xianyu-slider-solver.js';
import { fetchXianyuBrowserImToken, type XianyuBrowserImToken, type XianyuBrowserImTokenRequest } from './xianyu-browser-im-token.js';
import { observeXianyuSliderVerdicts } from './xianyu-slider-verdict.js';
import { verifyXianyuBrowserRead } from './xianyu-browser-mtop.js';
import type { XianyuReadRequest } from './xianyu-verification-request.js';

export type XianyuVerificationBrowserMode = 'disabled' | 'launch';

export interface XianyuVerificationBrowserOptions {
  mode?: XianyuVerificationBrowserMode;
  sliderMode?: XianyuSliderMode;
  sliderMaxRetries?: number;
  headless?: boolean;
  executablePath?: string;
  userDataDir?: string;
  maxWaitMs?: number;
  pollIntervalMs?: number;
  allowManualFallback?: boolean;
  userAgent?: string;
  /** Injectable boundary for unit tests and future browser implementations. */
  browserFactory?: XianyuVerificationBrowserFactory;
}

export interface XianyuVerificationBrowserResult {
  finalUrl: string;
  cookieSnapshot: XianyuCookieSnapshot;
  imToken?: XianyuBrowserImToken;
  verifiedRead?: { api: string; userId: string };
}

const DEFAULT_MAX_WAIT_MS = 3 * 60_000;
const DEFAULT_POLL_INTERVAL_MS = 1_000;

/**
 * A persistent Chrome profile is a singleton resource. Keep this state at
 * module scope so separate service instances in the same API process cannot
 * launch two contexts against one profile and create duplicate tabs.
 */
const activeVerifications = new Map<string, Promise<XianyuVerificationBrowserResult>>();
const profileVerificationTails = new Map<string, Promise<void>>();

/**
 * Keep implicit Chrome profiles outside the repository. Production and
 * container deployments should pass an explicit persistent directory when
 * they need profile reuse; local development must not pollute the workspace.
 */
export function resolveDefaultVerificationUserDataDir(): string {
  return join(tmpdir(), 'xianyu-agent', 'browser_data', 'xianyu-verification');
}

/**
 * Patchright-only verification browser.
 *
 * A persistent system Chrome profile is used per account/session. There is
 * intentionally no CDP fallback: the old CDP path caused blank-window races
 * and made slider input look automated to the platform.
 */
export class XianyuVerificationBrowser {
  private readonly mode: XianyuVerificationBrowserMode;
  private readonly sliderMode: XianyuSliderMode;
  private readonly sliderMaxRetries: number;
  private readonly headless: boolean;
  private readonly executablePath?: string;
  private readonly configuredUserDataDir?: string;
  private readonly maxWaitMs: number;
  private readonly pollIntervalMs: number;
  private readonly allowManualFallback: boolean;
  private readonly userAgent?: string;
  private readonly browserFactory: XianyuVerificationBrowserFactory;

  constructor(options: XianyuVerificationBrowserOptions = {}) {
    this.mode = options.mode ?? 'disabled';
    this.sliderMode = options.sliderMode ?? 'disabled';
    this.sliderMaxRetries = Math.max(1, Math.floor(options.sliderMaxRetries ?? 3));
    this.headless = options.headless ?? false;
    this.executablePath = options.executablePath;
    this.configuredUserDataDir = options.userDataDir;
    this.maxWaitMs = options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.allowManualFallback = options.allowManualFallback ?? false;
    this.userAgent = options.userAgent?.trim() || process.env.XIANYU_BROWSER_USER_AGENT?.trim()
      || (this.sliderMode === 'auto' ? undefined : XIANYU_USER_AGENT);
    this.browserFactory = options.browserFactory ?? createPatchrightVerificationBrowserFactory();
  }

  get enabled(): boolean { return this.mode !== 'disabled'; }

  async deleteProfile(profileKey: string): Promise<void> {
    if (!/^[0-9a-f-]{36}$/i.test(profileKey)) throw new Error('ACCOUNT_PROFILE_KEY_INVALID');
    const directory = join(this.configuredUserDataDir ?? resolveDefaultVerificationUserDataDir(), sanitizeProfileKey(profileKey));
    const key = normalizeProfileLockKey(directory);
    await profileVerificationTails.get(key);
    try { await stat(directory); } catch (error) { if ((error as { code?: string }).code === 'ENOENT') return; throw error; }
    const release = await acquireXianyuVerificationProfileLock(directory, this.maxWaitMs);
    try { await rm(directory, { recursive: true, force: true }); } finally { await release(); }
  }

  async waitForCompletion(input: {
    verificationUrl: string;
    profileKey?: string;
    initialCookieSnapshot?: XianyuCookieSnapshot;
    allowManualFallback?: boolean;
    maxWaitMs?: number;
    pollIntervalMs?: number;
    imTokenRequest?: XianyuBrowserImTokenRequest;
    readRequest?: { request: XianyuReadRequest; expectedUserId: string };
  }): Promise<XianyuVerificationBrowserResult> {
    if (this.mode === 'disabled') throw new Error('XIANYU_VERIFICATION_BROWSER_DISABLED');
    assertVerificationUrl(input.verificationUrl);
    const profileDir = await this.resolveProfileDir(input.profileKey);
    const profileLockKey = normalizeProfileLockKey(profileDir);
    const verificationKey = `${profileLockKey}\u0000${input.verificationUrl}\u0000${JSON.stringify(input.initialCookieSnapshot ?? [])}\u0000${JSON.stringify(input.imTokenRequest ?? null)}\u0000${JSON.stringify(input.readRequest ?? null)}`;
    const active = activeVerifications.get(verificationKey);
    if (active) return active;

    const previous = profileVerificationTails.get(profileLockKey) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.then(() => current);
    profileVerificationTails.set(profileLockKey, tail);

    const task = (async () => {
      await previous;
      try {
        return await this.runVerification(input, profileDir);
      } finally {
        release();
        if (profileVerificationTails.get(profileLockKey) === tail) profileVerificationTails.delete(profileLockKey);
      }
    })();
    activeVerifications.set(verificationKey, task);
    try {
      return await task;
    } finally {
      if (activeVerifications.get(verificationKey) === task) activeVerifications.delete(verificationKey);
    }
  }

  private async runVerification(input: {
    verificationUrl: string;
    profileKey?: string;
    initialCookieSnapshot?: XianyuCookieSnapshot;
    allowManualFallback?: boolean;
    maxWaitMs?: number;
    pollIntervalMs?: number;
    imTokenRequest?: XianyuBrowserImTokenRequest;
    readRequest?: { request: XianyuReadRequest; expectedUserId: string };
  }, profileDir: string): Promise<XianyuVerificationBrowserResult> {
    const maxWaitMs = Math.max(250, Math.floor(input.maxWaitMs ?? this.maxWaitMs));
    const pollIntervalMs = Math.max(25, Math.floor(input.pollIntervalMs ?? this.pollIntervalMs));
    const allowManualFallback = input.allowManualFallback ?? this.allowManualFallback;
    const useHeadless = shouldUseHeadlessVerificationBrowser(this.sliderMode, this.headless);
    const hideWindow = shouldHideVerificationWindow(this.sliderMode, useHeadless, allowManualFallback);
    const releaseProfileLock = await acquireXianyuVerificationProfileLock(profileDir, maxWaitMs);
    try {
      const context = await this.browserFactory.launchPersistentContext({
        profileDir,
        headless: useHeadless,
        hideWindow,
        executablePath: this.executablePath,
        userAgent: this.userAgent,
        ...(this.sliderMode === 'auto' ? { sliderStrategy: 'ydisks' as const } : {}),
      });
      try {
        await context.addInitScript({ content: buildAutomationEvasionScript() });
        const page = await this.reuseVerificationPage(context);
        const initialSnapshot = normalizeCookieSnapshot(input.initialCookieSnapshot) ?? [];
        if (initialSnapshot.length > 0) await context.addCookies(toBrowserCookies(initialSnapshot, input.verificationUrl));
        const verdicts = observeXianyuSliderVerdicts(page);
        const solveChallenge = async (verificationUrl: string): Promise<void> => {
          assertVerificationUrl(verificationUrl);
          const priorSnapshot = mapCookies(await context.cookies());
          await page.goto(verificationUrl, { waitUntil: 'domcontentloaded', timeout: maxWaitMs });
          await waitForPageContent(page, Math.min(maxWaitMs, 12_000), pollIntervalMs);
          await sleep(750);

          if (this.sliderMode === 'auto') {
            const sliderResult = await new XianyuSliderSolver(page, {
              maxRetries: this.sliderMaxRetries,
              logger: console,
              readVerdict: verdicts.read,
            }).solve();
            if (!sliderResult.success) {
              const reason = sliderResult.failureReason ?? 'unknown';
              console.warn(JSON.stringify({ component: 'xianyu-verification', event: 'slider_auto_solve_failed', strategy: 'ydisks', reason, attempts: sliderResult.attempts, distance: sliderResult.distance, trajectoryPoints: sliderResult.trajectoryPoints, protocolCodes: sliderResult.protocolCodes }));
              if (!allowManualFallback) throw new Error(`XIANYU_VERIFICATION_AUTO_SOLVE_FAILED:${reason}`);
              console.warn(JSON.stringify({ component: 'xianyu-verification', event: 'slider_manual_fallback_wait', reason }));
            } else {
              console.info(JSON.stringify({ component: 'xianyu-verification', event: 'slider_auto_solve_succeeded', strategy: 'ydisks', attempts: sliderResult.attempts, distance: sliderResult.distance, trajectoryPoints: sliderResult.trajectoryPoints, protocolCodes: sliderResult.protocolCodes }));
              // The native caller immediately re-requests Token and verifies
              // account identity in this same Chrome session. A challenge may
              // keep its URL or reuse x5sec even after code=0; neither should
              // block that authoritative business check for another 3 minutes.
              if (input.imTokenRequest || input.readRequest) return;
            }
          }

          const deadline = Date.now() + maxWaitMs;
          let lastUrl = page.url();
          let lastCookies = await context.cookies();
          while (Date.now() < deadline) {
            lastUrl = page.url();
            lastCookies = await context.cookies();
            if (isVerificationPageComplete(lastUrl, lastCookies, priorSnapshot)) {
              await sleep(1_000);
              lastCookies = await context.cookies();
              if (isVerificationPageComplete(lastUrl, lastCookies, priorSnapshot)) return;
            }
            if (isBlankOrInvalidVerificationPage(lastUrl)) throw new Error('XIANYU_VERIFICATION_PAGE_EMPTY');
            await sleep(pollIntervalMs);
          }
          console.warn(JSON.stringify({ component: 'xianyu-verification', event: 'verification_completion_timeout',
            nativeTokenRequested: Boolean(input.imTokenRequest), postVerificationUrl: isPostVerificationUrl(lastUrl),
            verificationCookiePresent: lastCookies.some(c => c.name.toLowerCase() === 'x5sec' && Boolean(c.value)),
            platformCode: verdicts.read()?.code }));
          throw new Error('XIANYU_VERIFICATION_TIMEOUT');
        };
        try {
          // The challenge must be issued by this browser's own Token request.
          // A server HTTP challenge belongs to a different network session.
          const imToken = input.imTokenRequest
            ? await fetchXianyuBrowserImToken(context, page, input.imTokenRequest, solveChallenge)
            : undefined;
          const verifiedRead = input.readRequest
            ? await verifyXianyuBrowserRead(context, page, input.readRequest.request, input.readRequest.expectedUserId, solveChallenge)
            : undefined;
          if (!input.imTokenRequest && !input.readRequest) await solveChallenge(input.verificationUrl);
          return { finalUrl: page.url(), cookieSnapshot: dropStaleCaptchaChallengeCookies(mapCookies(await context.cookies())),
            ...(imToken ? { imToken } : {}), ...(verifiedRead ? { verifiedRead } : {}) };
        } finally { await verdicts.close(); }
      } finally {
        await closeVerificationPages(context);
        await context.close().catch(() => undefined);
      }
    } finally {
      await releaseProfileLock();
    }
  }

  private async resolveProfileDir(profileKey = 'default'): Promise<string> {
    const root = resolve(this.configuredUserDataDir ?? resolveDefaultVerificationUserDataDir());
    const safeKey = sanitizeProfileKey(profileKey);
    const profileDir = join(root, safeKey);
    await mkdir(profileDir, { recursive: true });
    return profileDir;
  }

  private async reuseVerificationPage(context: XianyuVerificationContext): Promise<XianyuVerificationPage> {
    const pages = context.pages();
    const page = pages[0] ?? await context.newPage();
    for (const extra of pages.slice(1)) await extra.close().catch(() => undefined);
    return page;
  }
}

async function closeVerificationPages(context: XianyuVerificationContext): Promise<void> {
  let pages: readonly XianyuVerificationPage[] = [];
  try {
    pages = context.pages();
  } catch {
    return;
  }
  for (const page of pages) await page.close().catch(() => undefined);
}

export function shouldUseHeadlessVerificationBrowser(sliderMode: XianyuSliderMode, configuredHeadless: boolean): boolean {
  if (configuredHeadless) return true;
  return sliderMode === 'auto' && process.env.XIANYU_VERIFICATION_AUTO_HEADLESS === 'true';
}

export function shouldHideVerificationWindow(sliderMode: XianyuSliderMode, useHeadless: boolean, allowManualFallback = false): boolean {
  return sliderMode === 'auto' && !useHeadless && !allowManualFallback;
}

export function resolveVerificationCookieUrl(verificationUrl: string): string {
  const url = new URL(verificationUrl);
  url.hash = '';
  url.search = '';
  if (!url.pathname) url.pathname = '/';
  return url.toString();
}

export function isVerificationPageComplete(finalUrl: string, cookies: XianyuCookieSnapshot, initialCookies: XianyuCookieSnapshot = []): boolean {
  if (!isPostVerificationUrl(finalUrl)) return false;
  const current = cookies.find((cookie) => cookie.name.toLowerCase() === 'x5sec' && cookie.value.trim());
  if (!current) return false;
  const initial = initialCookies.find((cookie) => cookie.name.toLowerCase() === 'x5sec');
  return !initial || initial.value !== current.value;
}

function isPostVerificationUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return !/captcha|punish|verify|security/i.test(`${url.pathname}${url.search}${url.hash}`);
  } catch {
    return false;
  }
}

function isBlankOrInvalidVerificationPage(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol !== 'http:' && url.protocol !== 'https:';
  } catch {
    return true;
  }
}

async function waitForPageContent(page: XianyuVerificationPage, maxWaitMs: number, pollIntervalMs: number): Promise<void> {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const state = await page.evaluate(() => {
      const body = document.body;
      const html = document.documentElement;
      const text = body?.innerText?.trim() ?? '';
      const renderedNode = body?.querySelector('iframe,canvas,svg,img,video,object,embed,main,section,form,[class],[id],[role]');
      const meaningfulMarkup = (body?.innerHTML?.trim().length ?? 0) > 48 || (html?.outerHTML?.length ?? 0) > 220;
      return { ready: document.readyState !== 'loading', blank: !body || (!text && !renderedNode && !meaningfulMarkup) };
    }).catch(() => ({ ready: false, blank: true }));
    if (state.ready && !state.blank) return;
    await sleep(pollIntervalMs);
  }
  throw new Error('XIANYU_VERIFICATION_PAGE_EMPTY');
}

function toBrowserCookies(snapshot: XianyuCookieSnapshot, verificationUrl: string): XianyuVerificationCookie[] {
  const cookieUrl = resolveVerificationCookieUrl(verificationUrl);
  return snapshot.map((cookie) => ({
    name: cookie.name,
    value: cookie.value,
    ...(cookie.domain ? { domain: cookie.domain } : { url: cookieUrl }),
    path: cookie.path ?? '/',
    ...(cookie.expires !== undefined ? { expires: cookie.expires } : {}),
    ...(cookie.httpOnly !== undefined ? { httpOnly: cookie.httpOnly } : {}),
    ...(cookie.secure !== undefined ? { secure: cookie.secure } : {}),
    ...(cookie.sameSite ? { sameSite: cookie.sameSite } : {}),
    ...(cookie.partitionKey ? { partitionKey: cookie.partitionKey } : {}),
    ...(cookie._crHasCrossSiteAncestor !== undefined ? { _crHasCrossSiteAncestor: cookie._crHasCrossSiteAncestor } : {}),
  }));
}

function mapCookies(cookies: Array<{ name: string; value: string; domain?: string; path?: string; expires?: number; httpOnly?: boolean; secure?: boolean; sameSite?: string }>): XianyuCookieSnapshot {
  return normalizeCookieSnapshot(cookies.map((cookie) => ({ ...cookie, sameSite: cookie.sameSite }))) ?? [];
}

function sanitizeProfileKey(value: string): string {
  const normalized = value.trim().replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^\.+/, '').slice(0, 96);
  return normalized || 'default';
}

function normalizeProfileLockKey(profileDir: string): string {
  const absolute = resolve(profileDir);
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute;
}

function buildAutomationEvasionScript(): string {
  return `(() => { try { Object.defineProperty(navigator, 'webdriver', { get: () => undefined, configurable: true }); } catch {} })();`;
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

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}
