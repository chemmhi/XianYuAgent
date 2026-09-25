import assert from 'node:assert/strict';
import test from 'node:test';
import { XianyuVerificationBrowser } from '../src/xianyu-verification-browser.js';
import type { XianyuBrowserCookie } from '../src/xianyu-cookie-jar.js';
import type { XianyuSliderFrame, XianyuSliderLocator } from '../src/xianyu-slider-port.js';
import type {
  XianyuVerificationBrowserFactory,
  XianyuVerificationContext,
  XianyuVerificationLaunchOptions,
  XianyuVerificationPage,
} from '../src/xianyu-browser-port.js';

class FakePage implements XianyuVerificationPage {
  private currentUrl = 'about:blank';

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

  async close(): Promise<void> { return undefined; }
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

test('verification core runs against a browser port without importing Patchright types', async () => {
  const factory = new FakeFactory();
  const browser = new XianyuVerificationBrowser({
    mode: 'launch',
    sliderMode: 'disabled',
    headless: true,
    userDataDir: 'browser_data/port-test',
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
});
