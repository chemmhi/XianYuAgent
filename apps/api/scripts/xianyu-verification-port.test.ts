import assert from 'node:assert/strict';
import test from 'node:test';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { XianyuVerificationBrowser } from '../src/xianyu-verification-browser.js';
import type { XianyuBrowserCookie } from '../src/xianyu-cookie-jar.js';
import type { XianyuSliderFrame, XianyuSliderLocator } from '../src/xianyu-slider-port.js';
import type {
  XianyuVerificationBrowserFactory,
  XianyuVerificationContext,
  XianyuVerificationLaunchOptions,
  XianyuVerificationPage,
} from '../src/xianyu-browser-port.js';
import { acquireXianyuVerificationProfileLock } from '../src/xianyu-verification-profile-lock.js';

class FakePage implements XianyuVerificationPage {
  private currentUrl = 'about:blank';
  closed = false;
  closeCount = 0;

  constructor(private readonly onNavigate: (url: string) => void) {}

  locator(_selector: string): XianyuSliderLocator {
    throw new Error('slider is disabled in this port test');
  }

  frames(): readonly XianyuSliderFrame[] { return []; }

  url(): string { return this.currentUrl; }

  readonly mouse = {
    move: async (_x: number, _y: number) => undefined,
    down: async (_options?: { button?: 'left' | 'right' | 'middle' }) => undefined,
    up: async (_options?: { button?: 'left' | 'right' | 'middle' }) => undefined,
  };

  async reload(): Promise<void> { return undefined; }

  async goto(url: string): Promise<void> {
    this.currentUrl = url.replace('/punish', '/im');
    this.onNavigate(this.currentUrl);
  }

  async evaluate<T>(_pageFunction: () => T | Promise<T>): Promise<T> {
    return { ready: true, blank: false } as T;
  }

  async close(): Promise<void> {
    this.closed = true;
    this.closeCount += 1;
  }
}

class FakeContext implements XianyuVerificationContext {
  readonly cookiesState: XianyuBrowserCookie[] = [];
  readonly page: FakePage;
  closed = false;

  constructor() {
    this.page = new FakePage(() => {
      this.cookiesState.push({ name: 'x5sec', value: 'fresh-port-test', domain: '127.0.0.1', path: '/' });
    });
  }

  async addInitScript(): Promise<void> { return undefined; }

  async addCookies(cookies: readonly XianyuBrowserCookie[]): Promise<void> {
    this.cookiesState.push(...cookies);
  }

  async cookies(): Promise<XianyuBrowserCookie[]> { return this.cookiesState.slice(); }

  pages(): readonly XianyuVerificationPage[] { return [this.page]; }

  async newPage(): Promise<XianyuVerificationPage> { return this.page; }

  async close(): Promise<void> { this.closed = true; }
}

class FakeFactory implements XianyuVerificationBrowserFactory {
  readonly launches: XianyuVerificationLaunchOptions[] = [];
  readonly context = new FakeContext();

  async launchPersistentContext(options: XianyuVerificationLaunchOptions): Promise<XianyuVerificationContext> {
    this.launches.push(options);
    return this.context;
  }
}

class TrackingFactory implements XianyuVerificationBrowserFactory {
  readonly launches: XianyuVerificationLaunchOptions[] = [];
  readonly contexts: FakeContext[] = [];
  active = 0;
  maxActive = 0;

  async launchPersistentContext(options: XianyuVerificationLaunchOptions): Promise<XianyuVerificationContext> {
    this.launches.push(options);
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    const context = new FakeContext();
    const close = context.close.bind(context);
    context.close = async () => {
      await close();
      this.active -= 1;
    };
    this.contexts.push(context);
    return context;
  }
}

test('verification core runs against a browser port without importing Patchright types', async () => {
  const factory = new FakeFactory();
  const userDataDir = await mkdtemp(join(tmpdir(), 'xianyu-verification-port-test-'));
  try {
    const browser = new XianyuVerificationBrowser({
      mode: 'launch',
      sliderMode: 'disabled',
      headless: true,
      userDataDir,
      maxWaitMs: 4_000,
      pollIntervalMs: 25,
      browserFactory: factory,
    });

    const result = await browser.waitForCompletion({
      verificationUrl: 'http://127.0.0.1:19191/punish',
      profileKey: 'port-test-account',
    });

    assert.equal(result.finalUrl, 'http://127.0.0.1:19191/im');
    assert.equal(result.cookieSnapshot.find((cookie) => cookie.name === 'x5sec')?.value, 'fresh-port-test');
    assert.equal(factory.launches.length, 1);
    assert.equal(factory.launches[0]?.headless, true);
    assert.match(factory.launches[0]?.profileDir ?? '', /port-test-account$/);
    assert.equal(factory.context.closed, true);
    assert.equal(factory.context.page.closed, true);
  } finally {
    await rm(userDataDir, { recursive: true, force: true });
  }
});

test('verification forwards partitioned token cookies and protected session attributes', async () => {
  const factory = new FakeFactory();
  const userDataDir = await mkdtemp(join(tmpdir(), 'xianyu-verification-cookie-scope-'));
  const initial: XianyuBrowserCookie[] = [
    { name: '_m_h5_tk', value: 'partitioned-token', domain: '.goofish.com', path: '/', secure: true, sameSite: 'None', partitionKey: 'https://goofish.com' },
    { name: 'cookie2', value: 'protected-session', domain: '.goofish.com', path: '/', secure: true, httpOnly: true, sameSite: 'None' },
  ];
  try {
    const browser = new XianyuVerificationBrowser({ mode: 'launch', sliderMode: 'disabled', headless: true,
      userDataDir, maxWaitMs: 4000, pollIntervalMs: 25, browserFactory: factory });
    const result = await browser.waitForCompletion({ verificationUrl: 'http://127.0.0.1:19191/punish',
      profileKey: 'scope-account', initialCookieSnapshot: initial });
    for (const cookie of initial) {
      assert.deepEqual(factory.context.cookiesState.find(actual => actual.name === cookie.name), cookie);
      assert.deepEqual(result.cookieSnapshot.find(actual => actual.name === cookie.name), cookie);
    }
  } finally { await rm(userDataDir, { recursive: true, force: true }); }
});

test('same persistent profile deduplicates identical verification across browser instances', async () => {
  const factory = new TrackingFactory();
  const userDataDir = await mkdtemp(join(tmpdir(), 'xianyu-verification-profile-lock-test-'));
  try {
    const options = {
      mode: 'launch' as const,
      sliderMode: 'disabled' as const,
      headless: true,
      userDataDir,
      maxWaitMs: 4_000,
      pollIntervalMs: 25,
      browserFactory: factory,
    };
    const first = new XianyuVerificationBrowser(options);
    const second = new XianyuVerificationBrowser(options);
    const input = {
      verificationUrl: 'http://127.0.0.1:19191/punish',
      profileKey: 'shared-profile',
    };

    const [firstResult, secondResult] = await Promise.all([
      first.waitForCompletion(input),
      second.waitForCompletion(input),
    ]);

    assert.deepEqual(secondResult, firstResult);
    assert.equal(factory.launches.length, 1);
    assert.equal(factory.maxActive, 1);
    assert.equal(factory.contexts[0]?.closed, true);
  } finally {
    await rm(userDataDir, { recursive: true, force: true });
  }
});

test('different verification requests sharing a profile run serially', async () => {
  const factory = new TrackingFactory();
  const userDataDir = await mkdtemp(join(tmpdir(), 'xianyu-verification-profile-queue-test-'));
  try {
    const options = {
      mode: 'launch' as const,
      sliderMode: 'disabled' as const,
      headless: true,
      userDataDir,
      maxWaitMs: 4_000,
      pollIntervalMs: 25,
      browserFactory: factory,
    };
    const browser = new XianyuVerificationBrowser(options);
    const first = browser.waitForCompletion({
      verificationUrl: 'http://127.0.0.1:19191/punish',
      profileKey: 'queued-profile',
    });
    const second = browser.waitForCompletion({
      verificationUrl: 'http://127.0.0.1:19191/punish',
      profileKey: 'queued-profile',
      initialCookieSnapshot: [{ name: 'other', value: 'different' }],
    });

    await Promise.all([first, second]);
    assert.equal(factory.launches.length, 2);
    assert.equal(factory.maxActive, 1);
  } finally {
    await rm(userDataDir, { recursive: true, force: true });
  }
});

test('profile lock waits on a live owner and recovers a stale owner', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'xianyu-verification-file-lock-test-'));
  const lockPath = join(profile, '.xianyu-verification.lock');
  try {
    await writeFile(lockPath, JSON.stringify({ pid: process.pid, host: hostname() }), 'utf8');
    await assert.rejects(
      () => acquireXianyuVerificationProfileLock(profile, 1_000),
      (error: unknown) => error instanceof Error && error.message === 'XIANYU_VERIFICATION_PROFILE_BUSY',
    );

    await writeFile(lockPath, '', 'utf8');
    await assert.rejects(
      () => acquireXianyuVerificationProfileLock(profile, 1_000),
      (error: unknown) => error instanceof Error && error.message === 'XIANYU_VERIFICATION_PROFILE_BUSY',
    );

    await writeFile(lockPath, JSON.stringify({ pid: 2_147_483_647, host: hostname() }), 'utf8');
    const release = await acquireXianyuVerificationProfileLock(profile, 1_000);
    await release();
    await assert.rejects(() => access(lockPath));
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
});
