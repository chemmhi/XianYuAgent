import test from 'node:test';
import assert from 'node:assert/strict';
import { generatePhysicsTrajectory, replayTrajectory } from '../src/xianyu-slider-trajectory.js';

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

test('slider trajectory is deterministic with an injected random source', () => {
  const first = generatePhysicsTrajectory(180, { rng: seeded(7) });
  const second = generatePhysicsTrajectory(180, { rng: seeded(7) });
  assert.deepEqual(first, second);
  assert.ok(first.points.length >= 75);
  assert.ok(first.points.every(([x, y, delay]) => Number.isFinite(x) && Number.isFinite(y) && delay > 0));
  assert.ok(first.metadata.plannedElapsed > 0);
});

test('trajectory replay preserves relative coordinates and planned timing', async () => {
  let now = 0;
  const moves: Array<[number, number]> = [];
  const sleeps: number[] = [];
  const generated = generatePhysicsTrajectory(120, { rng: seeded(12) });
  const replayed = await replayTrajectory(
    generated.points,
    100,
    200,
    (x, y) => { moves.push([x, y]); },
    (delayMs) => { sleeps.push(delayMs); now += delayMs / 1000; },
    () => now * 1000,
  );
  assert.equal(moves.length, generated.points.length);
  assert.deepEqual(moves.at(-1), [100 + generated.points.at(-1)![0], 200 + generated.points.at(-1)![1]]);
  assert.equal(replayed.stats.totalPoints, generated.points.length);
  assert.ok(replayed.stats.plannedElapsed > 0);
  assert.ok(sleeps.length > 0);
});
