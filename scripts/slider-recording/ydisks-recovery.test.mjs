import test from 'node:test';
import assert from 'node:assert/strict';
import { recoverYdisksControl } from './ydisks-recovery.mjs';

function fixture(offset, failClick = false) {
  let now = 0, clicked = false;
  const frame = { locator(selector) {
    return { first() { return this; }, async isVisible() { return selector === '.errloading' || clicked; },
      async click() { if (failClick) throw Error('click failed'); clicked = true; },
      async boundingBox() { return { x: selector === '#nc_1_n1z' ? 100 + offset : 100 }; } };
  } };
  return { page: { frames: () => [frame] }, options: { clock: () => now, sleep: async ms => { now += ms; } } };
}
test('retry returns controls only after confirming they are within 3px of origin', async () => {
  const good = fixture(2);
  assert.ok(await recoverYdisksControl(good.page, good.options));
  const stuck = fixture(8);
  assert.equal(await recoverYdisksControl(stuck.page, stuck.options), undefined);
});
test('a failed platform retry click terminates recovery', async () => {
  const f = fixture(0, true);
  assert.equal(await recoverYdisksControl(f.page, f.options), undefined);
});
