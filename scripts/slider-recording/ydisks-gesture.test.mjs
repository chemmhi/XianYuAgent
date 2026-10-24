import test from 'node:test';
import assert from 'node:assert/strict';
import { replayYdisksPlan } from './ydisks-gesture.mjs';

test('upstream cumulative timing compensates CDP latency without dropping moves', async () => {
  let now = 0;
  const moves = [];
  const events = [0, 10, 20, 30].map((t, index) => ({ type: 'move', x: index, y: 0, replayAtMs: t, gapMs: 10 }));
  events.push({ type: 'replayEnd', replayAtMs: 40, gapMs: 10 });
  await replayYdisksPlan({ events }, { page: { mouse: { async move(x) { moves.push(x); now += 8; } } },
    clock: () => now, sleep: async ms => { now += ms; } });
  assert.deepEqual(moves, [0, 1, 2, 3]);
  assert.equal(now, 40);
});

test('failed mouse move releases the pressed button and propagates failure', async () => {
  const calls = [];
  await assert.rejects(replayYdisksPlan({ events: [{ type: 'down' }, { type: 'move', x: 1, y: 0 }] }, {
    page: { mouse: { async down() { calls.push('down'); }, async move() { throw Error('transport failed'); }, async up() { calls.push('up'); } } },
  }), /transport failed/);
  assert.deepEqual(calls, ['down', 'up']);
});

test('platform verdict stops remaining actions and releases the held button', async () => {
  const calls = [];
  let accepted = false;
  await replayYdisksPlan({ events: [{ type: 'down' }, { type: 'move', x: 1, y: 1 }, { type: 'domClick' }] }, {
    stopWhen: () => accepted, page: { mouse: { async down() { calls.push('down'); }, async move() { calls.push('move'); accepted = true; }, async up() { calls.push('up'); } } },
  });
  assert.deepEqual(calls, ['down', 'move', 'up']);
});

test('a detached control observation cannot block replay forever', async () => {
  const events = [];
  await replayYdisksPlan({ events: [{ type: 'getAttribute', name: 'style', timeout: 5 }] }, {
    button: { getAttribute() { return new Promise(() => {}); } }, record: type => events.push(type),
  });
  assert.ok(events.includes('gesture.style.unavailable'));
});

test('hover, release, and upstream confirmation click preserve their order and arguments', async () => {
  const calls = [];
  await replayYdisksPlan({ events: [{ type: 'hover', timeout: 2000 }, { type: 'down' }, { type: 'up' },
    { type: 'domClick', javascript: '(e,p)=>e.click()', point: { x: 12, y: 34 } }] }, {
    page: { mouse: { async down() { calls.push('down'); }, async up() { calls.push('up'); } } },
    button: { async hover(options) { calls.push(options); }, async evaluate(source, point) { calls.push({ source, point }); } },
  });
  assert.deepEqual(calls, [{ timeout: 2000 }, 'down', 'up', { source: '(e,p)=>e.click()', point: { x: 12, y: 34 } }]);
});
