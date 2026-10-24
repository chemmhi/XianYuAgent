import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, symlink, readlink, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTarProfileSnapshot } from './profile-archive.mjs';

test('archive round trip preserves binary profile data and Linux singleton links', async () => {
  const root = await mkdtemp(join(tmpdir(), 'profile archive '));
  try {
    const profile = join(root, 'source profile');
    const restored = join(root, 'restored');
    await mkdir(join(profile, 'Default'), { recursive: true });
    await mkdir(restored);
    const content = Buffer.from([0, 255, 13, 10, 128, 42]);
    await writeFile(join(profile, 'Default', 'Cookies'), content);
    if (process.platform !== 'win32') await symlink('server-host-1234', join(profile, 'SingletonLock'));
    const events = [];
    await createTarProfileSnapshot({ event: (type, data) => events.push({ type, data }) })(profile, join(root, 'snapshot'));
    execFileSync('tar', ['-xzf', join(root, 'snapshot.tar.gz'), '-C', restored], { windowsHide: true });
    assert.deepEqual(await readFile(join(restored, 'Default', 'Cookies')), content);
    if (process.platform !== 'win32') assert.equal(await readlink(join(restored, 'SingletonLock')), 'server-host-1234');
    assert.ok(events.some(event => event.type === 'profile.archive.complete' && event.data.bytes > 0));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('failed archive is recorded as failure and never reported complete', async () => {
  const root = await mkdtemp(join(tmpdir(), 'profile archive failure '));
  try {
    const events = [];
    const capture = createTarProfileSnapshot({ event: (type, data) => events.push({ type, data }) });
    await assert.rejects(capture(join(root, 'missing'), join(root, 'snapshot')));
    assert.ok(events.some(event => event.type === 'profile.archive.error'));
    assert.ok(!events.some(event => event.type === 'profile.archive.complete'));
  } finally { await rm(root, { recursive: true, force: true }); }
});
