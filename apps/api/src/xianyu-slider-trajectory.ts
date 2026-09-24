export type SliderTrajectoryPoint = readonly [x: number, y: number, delaySeconds: number];

export interface SliderTrajectoryOptions {
  totalStepsRange?: readonly [number, number];
  baseDelayRange?: readonly [number, number];
  jitterXRange?: readonly [number, number];
  jitterYRange?: readonly [number, number];
  rng?: () => number;
}

export interface GeneratedSliderTrajectory {
  points: SliderTrajectoryPoint[];
  metadata: {
    baseDelay: number;
    jitterXRange: readonly [number, number];
    jitterYRange: readonly [number, number];
    overshoot: number;
    correctionSteps: number;
    distance: number;
    totalSteps: number;
    plannedElapsed: number;
  };
}

export const DEFAULT_SLIDER_TRAJECTORY_OPTIONS: Required<Omit<SliderTrajectoryOptions, 'rng'>> = {
  totalStepsRange: [70, 95],
  baseDelayRange: [0.007, 0.012],
  jitterXRange: [-1, 1],
  jitterYRange: [-1.25, 1.25],
};

function finiteRange(value: readonly [number, number] | undefined, fallback: readonly [number, number], name: string): readonly [number, number] {
  const range = value ?? fallback;
  if (range.length !== 2 || !Number.isFinite(range[0]) || !Number.isFinite(range[1]) || range[0] > range[1]) {
    throw new Error(`${name} must be a finite ascending range`);
  }
  return [Number(range[0]), Number(range[1])];
}

function uniform(rng: () => number, range: readonly [number, number]): number {
  return range[0] + (range[1] - range[0]) * rng();
}

function integer(rng: () => number, range: readonly [number, number]): number {
  const low = Math.max(1, Math.ceil(range[0]));
  const high = Math.max(low, Math.floor(range[1]));
  return low + Math.floor(rng() * (high - low + 1));
}

function assertPositiveDistance(distance: number): number {
  const numeric = Number(distance);
  if (!Number.isFinite(numeric) || numeric <= 0) throw new Error('distance must be a positive finite number');
  return numeric;
}

export function generatePhysicsTrajectory(distance: number, options: SliderTrajectoryOptions = {}): GeneratedSliderTrajectory {
  const target = assertPositiveDistance(distance);
  const rng = options.rng ?? Math.random;
  const stepsRange = finiteRange(options.totalStepsRange, DEFAULT_SLIDER_TRAJECTORY_OPTIONS.totalStepsRange, 'totalStepsRange');
  const delayRange = finiteRange(options.baseDelayRange, DEFAULT_SLIDER_TRAJECTORY_OPTIONS.baseDelayRange, 'baseDelayRange');
  const jitterXRange = finiteRange(options.jitterXRange, DEFAULT_SLIDER_TRAJECTORY_OPTIONS.jitterXRange, 'jitterXRange');
  const jitterYRange = finiteRange(options.jitterYRange, DEFAULT_SLIDER_TRAJECTORY_OPTIONS.jitterYRange, 'jitterYRange');

  const steps = integer(rng, stepsRange);
  const baseDelay = uniform(rng, delayRange);
  // A human may overshoot the target by a few pixels, but a 40%–85%
  // overshoot sends the pointer far outside the NC track and is rejected as
  // an invalid drag. Keep the correction phase small and finish at the
  // logical track distance.
  const overshoot = Math.max(2, uniform(rng, [Math.min(target * 0.015, 8), Math.min(target * 0.04, 16)]));
  const peakDistance = target + overshoot;
  const driftDirection = rng() < 0.5 ? -1 : 1;
  // Keep the pointer inside the 34px track while the 30px handle is held.
  // Larger vertical arcs leave the slider lane and are rejected by NC.
  const arcAmplitude = uniform(rng, [0.5, 1.5]);
  const tilt = driftDirection * uniform(rng, [0.2, 0.8]);
  const points: SliderTrajectoryPoint[] = [];

  for (let index = 0; index < steps; index += 1) {
    const progress = (index + 1) / steps;
    const eased = 10 * progress ** 3 - 15 * progress ** 4 + 6 * progress ** 5;
    const x = peakDistance * eased + uniform(rng, jitterXRange);
    const y = driftDirection * arcAmplitude * Math.sin(progress * Math.PI) + tilt * progress + uniform(rng, jitterYRange) * 0.25;
    let delay = baseDelay * uniform(rng, [0.85, 1.15]);
    if (rng() < 0.04) delay += uniform(rng, [0.02, 0.05]);
    points.push([x, y, delay]);
  }

  const rebound = Math.max(1, overshoot * uniform(rng, [0.85, 1.15]));
  const reboundSteps = integer(rng, [3, 5]);
  const lastY = points.at(-1)?.[1] ?? 0;
  for (let index = 0; index < reboundSteps; index += 1) {
    const progress = (index + 1) / reboundSteps;
    points.push([
      peakDistance - rebound * progress + uniform(rng, [-0.8, 0.8]),
      lastY + uniform(rng, [-1.5, 1.5]),
      uniform(rng, [0.015, 0.035]),
    ]);
  }

  const settleX = target;
  const settleSteps = integer(rng, [2, 3]);
  for (let index = 0; index < settleSteps; index += 1) {
    points.push([
      settleX + uniform(rng, [-1.2, 1.2]),
      lastY + uniform(rng, [-1.2, 1.2]),
      uniform(rng, [0.02, 0.045]),
    ]);
  }

  const plannedElapsed = points.reduce((sum, point) => sum + point[2], 0);
  return {
    points,
    metadata: {
      baseDelay,
      jitterXRange,
      jitterYRange,
      overshoot,
      correctionSteps: reboundSteps,
      distance: target,
      totalSteps: points.length,
      plannedElapsed,
    },
  };
}

export interface SliderTrajectoryReplayStats {
  totalPoints: number;
  plannedElapsed: number;
  peakLag: number;
}

export async function replayTrajectory(
  trajectory: readonly SliderTrajectoryPoint[],
  startX: number,
  startY: number,
  move: (x: number, y: number) => void | Promise<void>,
  sleep: (delayMs: number) => void | Promise<void> = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
  clock: () => number = () => performance.now(),
): Promise<{ x: number; y: number; stats: SliderTrajectoryReplayStats }> {
  const startedAt = clock();
  let plannedElapsed = 0;
  let peakLag = 0;
  let currentX = Number(startX);
  let currentY = Number(startY);
  for (const [offsetX, offsetY, delaySeconds] of trajectory) {
    if (!Number.isFinite(delaySeconds) || delaySeconds < 0) throw new Error('trajectory delay must be a finite non-negative number');
    currentX = Number(startX) + Number(offsetX);
    currentY = Number(startY) + Number(offsetY);
    await move(currentX, currentY);
    plannedElapsed += delaySeconds;
    const elapsed = (clock() - startedAt) / 1000;
    if (plannedElapsed > elapsed) await sleep((plannedElapsed - elapsed) * 1000);
    else peakLag = Math.max(peakLag, elapsed - plannedElapsed);
  }
  return { x: currentX, y: currentY, stats: { totalPoints: trajectory.length, plannedElapsed, peakLag } };
}
