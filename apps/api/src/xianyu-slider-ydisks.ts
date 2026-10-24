// Adapted from 23Star/xianyu-super-butler, commit
// 2490eb849738539e5dc1c07444084f4b54b03287, utils/slider_ydisks.py
// and utils/xianyu_slider_stealth.py (AGPL-3.0; see THIRD_PARTY_NOTICES.md).
import type { XianyuSliderLocator, XianyuSliderPage, XianyuSliderRect } from './xianyu-slider-port.js';
export type SliderTrajectoryPoint = readonly [x: number, y: number, delaySeconds: number];

type Anchor = { x: number; y: number; delay: number };
export interface YdisksTrajectory {
  points: SliderTrajectoryPoint[];
  distance: number;
  overshoot: number;
  targetDuration: number;
  verticalSpan: number;
}
const uniform = (rng: () => number, low: number, high: number) => low + rng() * (high - low);
const integer = (rng: () => number, low: number, high: number) => low + Math.floor(rng() * (high - low + 1));
// Python round uses ties to even; retain the pinned planner's allocation.
const round = (value: number) => value % 1 === 0.5 ? 2 * Math.round(value / 2) : Math.round(value);

export function generateYdisksTrajectory(distance: number, verticalSpan: number, rng: () => number = Math.random): YdisksTrajectory {
  if (!Number.isFinite(distance) || distance <= 0 || !Number.isFinite(verticalSpan) || verticalSpan < 0) {
    throw new Error('invalid Ydisks slider geometry');
  }
  const requested = 8 + integer(rng, 0, 4);
  const delay = uniform(rng, 0.045, 0.085);
  const acceleration = Math.max(2, round(requested * uniform(rng, 0.26, 0.34)));
  const deceleration = Math.max(2, round(requested * uniform(rng, 0.24, 0.32)));
  const constant = Math.max(2, requested - acceleration - deceleration);
  const overshoot = uniform(rng, 4, 20);
  const target = distance + overshoot;
  const accelDistance = target * uniform(rng, 0.24, 0.34);
  const constantDistance = target * uniform(rng, 0.46, 0.56);
  const decelDistance = target - accelDistance - constantDistance;
  const anchors: Anchor[] = [];
  for (let i = 1; i <= acceleration; i++) anchors.push({ x: accelDistance * (i / acceleration) ** 2, y: 0, delay: delay * uniform(rng, 0.7, 1.2) });
  for (let i = 1; i <= constant; i++) anchors.push({ x: accelDistance + constantDistance * i / constant, y: 0, delay: delay * uniform(rng, 0.65, 1.25) });
  for (let i = 1; i <= deceleration; i++) anchors.push({ x: accelDistance + constantDistance + decelDistance * (1 - (1 - i / deceleration) ** 2), y: 0, delay: delay * uniform(rng, 0.9, 1.55) });
  if (verticalSpan > 0) {
    const direction = integer(rng, 0, 1) === 0 ? 1 : -1;
    const values = anchors.map((_, i) => Math.sin(2 * Math.PI * i / (anchors.length - 1)));
    const min = Math.min(...values), max = Math.max(...values);
    for (let i = 0; i < anchors.length; i++) anchors[i].y = direction * (values[i] - (min + max) / 2) * verticalSpan / (max - min);
    anchors[0].y = anchors.at(-1)!.y = 0;
  }
  anchors.at(-1)!.x = target;
  const targetDuration = uniform(rng, 0.55, 1.05);
  const weight = anchors.reduce((sum, point) => sum + point.delay, 0);
  const points: SliderTrajectoryPoint[] = [];
  let previous = { x: 0, y: 0 };
  for (const anchor of anchors) {
    const duration = targetDuration * anchor.delay / weight;
    const count = Math.max(2, Math.ceil(duration / 0.015 * 1.34));
    const phase = uniform(rng, 0, 2 * Math.PI), rate = uniform(rng, 0.8, 1.6);
    const weights = Array.from({ length: count }, (_, i) => 1 + 0.22 * Math.sin(2 * Math.PI * rate * i / Math.max(1, count - 1) + phase));
    const total = weights.reduce((sum, value) => sum + value, 0);
    for (let i = 1; i <= count; i++) points.push([
      previous.x + (anchor.x - previous.x) * i / count,
      previous.y + (anchor.y - previous.y) * i / count,
      duration * weights[i - 1] / total,
    ]);
    previous = anchor;
  }
  return { points, distance, overshoot, targetDuration, verticalSpan };
}

const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
async function bounded<T>(task: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([task, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('YDISKS_CONTROL_TIMEOUT')), ms); })]); }
  finally { if (timer) clearTimeout(timer); }
}
export async function prepareYdisksPage(page: XianyuSliderPage, rng = Math.random): Promise<void> {
  await wait(uniform(rng, 300, 800));
  await page.mouse.move(640, 360);
  await wait(uniform(rng, 20, 50));
  await page.mouse.wheel(0, integer(rng, 200, 500));
  await wait(uniform(rng, 20, 50));
}

export async function replayYdisksTrajectory(points: readonly SliderTrajectoryPoint[], startX: number, startY: number,
  move: (x: number, y: number) => Promise<void>, options: { sleep?: (ms: number) => Promise<void>; clock?: () => number; stopWhen?: () => boolean } = {}): Promise<{ x: number; y: number }> {
  const sleep = options.sleep ?? wait, clock = options.clock ?? (() => performance.now());
  const started = clock();
  let plannedMs = 0, x = startX, y = startY;
  for (const [dx, dy, delay] of points) {
    if (options.stopWhen?.()) break;
    x = startX + dx; y = startY + dy;
    await move(x, y);
    plannedMs += delay * 1000;
    const remaining = started + plannedMs - clock();
    if (remaining > 0) await sleep(remaining);
  }
  return { x, y };
}

export async function executeYdisksGesture(page: XianyuSliderPage, button: XianyuSliderLocator, rect: XianyuSliderRect,
  trajectory: YdisksTrajectory, rng = Math.random, stopWhen: () => boolean = () => false): Promise<void> {
  const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
  await wait(uniform(rng, 100, 300));
  await page.mouse.move(x + uniform(rng, -30, -10), y + uniform(rng, -15, 15), { steps: integer(rng, 5, 10) });
  await wait(uniform(rng, 150, 300));
  await page.mouse.move(x, y, { steps: integer(rng, 3, 6) });
  await wait(uniform(rng, 100, 250));
  await button.hover({ timeout: 2000 });
  await wait(uniform(rng, 100, 300));
  await page.mouse.move(x, y);
  await wait(uniform(rng, 50, 150));
  let pressed = false;
  try {
    await page.mouse.down({ button: 'left' });
    pressed = true;
    await wait(uniform(rng, 50, 150));
    const end = await replayYdisksTrajectory(trajectory.points, x, y, (px, py) => page.mouse.move(px, py), { stopWhen });
    await page.mouse.up({ button: 'left' });
    pressed = false;
    await wait(uniform(rng, 10, 30));
    if (!stopWhen()) {
      // NC requires its confirmation event after release. Use the locator's
      // frame context so iframe controls receive the same event as upstream.
      await bounded(button.evaluate((slider, point) => slider.dispatchEvent(new MouseEvent('click', {
        bubbles: true, cancelable: true, view: window, clientX: point.x, clientY: point.y, button: 0,
      })), end, { timeout: 2000 }), 2000).catch(() => undefined);
    }
  } finally { if (pressed) await page.mouse.up({ button: 'left' }).catch(() => undefined); }
}
