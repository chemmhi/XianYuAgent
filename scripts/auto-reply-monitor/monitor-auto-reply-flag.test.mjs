import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { acquireMonitorFlag } from './monitor-auto-reply-flag.mjs';

test('shared monitor flag survives until the last owner releases it', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'xianyu-monitor-flag-'));
  const flagPath = join(directory, 'auto-reply-god-view.enable');
  try {
    const first = await acquireMonitorFlag(flagPath, { ownerToken: 'owner-a' });
    const second = await acquireMonitorFlag(flagPath, { ownerToken: 'owner-b' });

    assert.equal(existsSync(flagPath), true);
    await first.release();
    assert.equal(existsSync(flagPath), true);

    await second.release();
    assert.equal(existsSync(flagPath), false);
    assert.equal(existsSync(`${flagPath}.owners`), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('keepFlag preserves the shared flag after the final owner exits', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'xianyu-monitor-flag-'));
  const flagPath = join(directory, 'auto-reply-god-view.enable');
  try {
    const lease = await acquireMonitorFlag(flagPath, { ownerToken: 'owner-keep', keepFlag: true });
    await lease.release();
    assert.equal(existsSync(flagPath), true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
