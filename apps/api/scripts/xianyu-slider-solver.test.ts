import test from 'node:test';
import assert from 'node:assert/strict';
import { XianyuSliderSolver, type SliderCdpConnection } from '../src/xianyu-slider-solver.js';

class FakeCdp implements SliderCdpConnection {
  readonly calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
  private probeCount = 0;

  async send(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.calls.push({ method, params });
    if (method === 'Runtime.evaluate') {
      const expression = String(params?.expression ?? '');
      if (expression.includes('trackSelectors')) {
        return { result: { value: {
          containerRect: { x: 10, y: 10, width: 240, height: 40 },
          buttonRect: { x: 20, y: 20, width: 40, height: 40 },
          trackRect: { x: 20, y: 20, width: 220, height: 40 },
          distance: 180,
        } } };
      }
      this.probeCount += 1;
      return { result: { value: this.probeCount === 1
        ? { containerVisible: true, failureText: '验证失败', pageUrl: 'https://punish.goofish.com/verify', retryRect: { x: 100, y: 100, width: 50, height: 20 } }
        : { containerVisible: false, pageUrl: 'https://www.goofish.com/im' } } };
    }
    return {};
  }
}

test('solver replays CDP mouse events and retries after a failure marker', async () => {
  const cdp = new FakeCdp();
  const solver = new XianyuSliderSolver(cdp, {
    maxRetries: 2,
    elementTimeoutMs: 100,
    verificationTimeoutMs: 200,
    verificationPollMs: 20,
    rng: () => 0.5,
  });
  const result = await solver.solve();
  assert.equal(result.success, true);
  assert.equal(result.attempts, 2);
  assert.equal(result.retryClicked, true);
  assert.equal(result.distance, 180);
  assert.ok(result.trajectoryPoints >= 75);
  const methods = cdp.calls.map((call) => call.method);
  assert.ok(methods.includes('Input.dispatchMouseEvent'));
  const mouseCalls = cdp.calls.filter((call) => call.method === 'Input.dispatchMouseEvent');
  assert.equal(mouseCalls.find((call) => call.params?.type === 'mousePressed')?.params?.button, 'left');
  const released = [...mouseCalls].reverse().find((call) => call.params?.type === 'mouseReleased');
  assert.equal(released?.params?.button, 'left');
  assert.equal(mouseCalls.find((call) => call.params?.type === 'mousePressed')?.params?.buttons, 1);
  assert.equal(released?.params?.buttons, 0);
});

test('solver reports missing slider elements without dispatching input', async () => {
  const cdp: SliderCdpConnection = {
    async send(method, params) {
      if (method === 'Runtime.evaluate') return { result: { value: null } };
      throw new Error(`unexpected CDP call ${method}:${JSON.stringify(params)}`);
    },
  };
  const result = await new XianyuSliderSolver(cdp, { elementTimeoutMs: 100 }).solve();
  assert.equal(result.success, false);
  assert.equal(result.failureReason, 'slider_elements_not_found');
  assert.equal(result.trajectoryPoints, 0);
});
