import assert from 'node:assert/strict';
import test from 'node:test';
import { XianyuSliderSolver, type XianyuSliderFrame, type XianyuSliderLocator, type XianyuSliderPage } from '../src/xianyu-slider-solver.js';

type State = { dragCount: number; success: boolean; failure: boolean };

class FakeLocator implements XianyuSliderLocator {
  constructor(private readonly kind: 'container' | 'button' | 'track' | 'retry' | 'missing', private readonly state: State) {}
  first(): XianyuSliderLocator { return this; }
  async isVisible(): Promise<boolean> {
    if (this.kind === 'missing') return false;
    if (this.kind === 'container') return !this.state.success;
    if (this.kind === 'retry') return this.state.failure;
    return true;
  }
  async boundingBox() {
    if (this.kind === 'button') return { x: 20, y: 20, width: 40, height: 40 };
    if (this.kind === 'track') return { x: 20, y: 20, width: 220, height: 40 };
    if (this.kind === 'container') return { x: 10, y: 10, width: 240, height: 40 };
    return { x: 100, y: 100, width: 50, height: 20 };
  }
  async textContent(): Promise<string | null> { return this.state.failure ? '验证失败 点击框体重试' : ''; }
  async hover(): Promise<void> {}
  async click(): Promise<void> { this.state.failure = false; }
}

class FakeFrame implements XianyuSliderFrame {
  constructor(private readonly state: State, private readonly missing = false) {}
  locator(selector: string): XianyuSliderLocator {
    if (this.missing) return new FakeLocator('missing', this.state);
    if (selector === '.nc-container') return new FakeLocator('container', this.state);
    if (selector === '#nc_1_n1z') return new FakeLocator('button', this.state);
    if (selector === '#nc_1_n1t') return new FakeLocator('track', this.state);
    if (selector === '.errloading') return new FakeLocator('retry', this.state);
    return new FakeLocator('missing', this.state);
  }
}

class FakePage extends FakeFrame implements XianyuSliderPage {
  readonly calls: string[] = [];
  readonly mouse = {
    move: async (_x: number, _y: number) => { this.calls.push('move'); },
    down: async () => { this.calls.push('down'); },
    up: async () => {
      this.calls.push('up');
      this.state.dragCount += 1;
      if (this.state.dragCount === 1) this.state.failure = true;
      else this.state.success = true;
    },
  };
  constructor(private readonly state: State, missing = false) { super(state, missing); }
  url(): string { return this.state.success ? 'https://www.goofish.com/im' : 'https://punish.goofish.com/verify'; }
  frames(): readonly XianyuSliderFrame[] { return []; }
  async reload(): Promise<void> { this.state.failure = false; }
}

test('Patchright solver replays trusted mouse actions and retries after a failure marker', async () => {
  const state: State = { dragCount: 0, success: false, failure: false };
  const page = new FakePage(state);
  const result = await new XianyuSliderSolver(page, { maxRetries: 2, elementTimeoutMs: 100, verificationTimeoutMs: 200, verificationPollMs: 20, retryDelayMs: 0, rng: () => 0.5 }).solve();
  assert.equal(result.success, true);
  assert.equal(result.attempts, 2);
  assert.equal(result.retryClicked, true);
  assert.equal(result.distance, 180);
  assert.ok(result.trajectoryPoints >= 75);
  assert.ok(page.calls.includes('down'));
  assert.ok(page.calls.includes('up'));
});

test('Patchright solver reports missing slider elements without sending input', async () => {
  const state: State = { dragCount: 0, success: false, failure: false };
  const page = new FakePage(state, true);
  const result = await new XianyuSliderSolver(page, { elementTimeoutMs: 100 }).solve();
  assert.equal(result.success, false);
  assert.equal(result.failureReason, 'slider_elements_not_found');
  assert.equal(result.trajectoryPoints, 0);
  assert.equal(page.calls.length, 0);
});
