import { describe, expect, it } from 'vitest';
import { createInFlightDedupe } from './controller';

describe('QR login controller concurrency guard', () => {
  it('shares one in-flight start operation and allows a later retry', async () => {
    const dedupe = createInFlightDedupe();
    let calls = 0;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });

    const first = dedupe(async () => {
      calls += 1;
      await pending;
    });
    const second = dedupe(async () => {
      calls += 1;
    });

    expect(second).toBe(first);
    expect(calls).toBe(1);

    release();
    await first;

    await dedupe(async () => {
      calls += 1;
    });
    expect(calls).toBe(2);
  });
});
