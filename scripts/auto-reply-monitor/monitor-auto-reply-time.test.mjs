import assert from 'node:assert/strict';
import test from 'node:test';
import { formatShanghaiTimestamp } from './monitor-auto-reply-time.mjs';

test('formats trace timestamps in Shanghai time with an explicit +08:00 offset', () => {
  assert.equal(
    formatShanghaiTimestamp('2026-09-23T12:34:56.789Z'),
    '2026-09-23T20:34:56.789+08:00',
  );
});

test('keeps Date inputs independent from the host machine timezone', () => {
  assert.equal(
    formatShanghaiTimestamp(new Date('2026-01-01T00:00:00.000Z')),
    '2026-01-01T08:00:00.000+08:00',
  );
});

test('falls back to the current timestamp when an event timestamp is missing or invalid', () => {
  const fallback = new Date('2026-02-03T00:00:00.000Z');
  assert.equal(formatShanghaiTimestamp(null, fallback), '2026-02-03T08:00:00.000+08:00');
  assert.equal(formatShanghaiTimestamp('not-a-timestamp', fallback), '2026-02-03T08:00:00.000+08:00');
});
