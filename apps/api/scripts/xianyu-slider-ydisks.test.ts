import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { executeYdisksGesture, generateYdisksTrajectory, replayYdisksTrajectory } from '../src/xianyu-slider-ydisks.js';

test('Ydisks trajectory matches the pinned Python upstream reference', async () => {
  const reference = JSON.parse(await readFile(new URL('./fixtures/xianyu-ydisks-reference.json', import.meta.url), 'utf8'));
  for (const sample of reference.samples) {
    const generated = generateYdisksTrajectory(258, 17, () => sample.random);
    assert.equal(generated.points.length, sample.points.length);
    for (let i = 0; i < sample.points.length; i++) {
      for (let axis = 0; axis < 3; axis++) assert.ok(Math.abs(generated.points[i][axis] - sample.points[i][axis]) < 1e-10, `point ${i}, axis ${axis}`);
    }
    assert.ok(Math.abs(generated.targetDuration - sample.duration) < 1e-12);
    assert.ok(generated.points.every(([x, , delay], i, points) => delay <= 0.015 && delay > 0 && (i === 0 || x >= points[i - 1][0])));
    assert.ok(generated.overshoot >= 4 && generated.overshoot <= 20);
    const ys = generated.points.map(point => point[1]);
    assert.ok(Math.abs(Math.max(...ys) - Math.min(...ys) - 17) < 1e-10);
  }
});

test('Ydisks replay retains all moves and compensates transport latency', async () => {
  let now = 0;
  const moves: number[] = [];
  const end = await replayYdisksTrajectory([[1, 0, 0.01], [2, 0, 0.01], [3, 0, 0.01]], 10, 20,
    async x => { moves.push(x); now += 8; }, { clock: () => now, sleep: async ms => { now += ms; } });
  assert.deepEqual(moves, [11, 12, 13]);
  assert.deepEqual(end, { x: 13, y: 20 });
  assert.equal(now, 30);
});

test('Ydisks replay stops after a successful platform response', async () => {
  let moves = 0;
  await replayYdisksTrajectory([[1, 0, 0], [2, 0, 0]], 0, 0, async () => { moves++; }, { stopWhen: () => moves > 0 });
  assert.equal(moves, 1);
});

test('Ydisks rejects invalid geometry', () => {
  for (const distance of [0, -1, NaN, Infinity]) assert.throws(() => generateYdisksTrajectory(distance, 17));
  assert.throws(() => generateYdisksTrajectory(258, -1));
});

test('Ydisks releases the held mouse when a transport move fails', async () => {
  let pressed = false, releases = 0;
  const page = { mouse: {
    move: async () => { if (pressed) throw new Error('CDP transport failed'); },
    down: async () => { pressed = true; },
    up: async () => { pressed = false; releases++; },
  } };
  await assert.rejects(() => executeYdisksGesture(page as never, { hover: async () => undefined } as never,
    { x: 0, y: 0, width: 42, height: 30 }, generateYdisksTrajectory(258, 17, () => 0.5), () => 0.5), /CDP transport failed/);
  assert.equal(pressed, false);
  assert.equal(releases, 1);
});
