import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync, renameSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { XianyuSystemUserPool, normalizeXianyuSystemUserId } from '../src/xianyu-system-users.js';

test('system pool validates exact IDs, reloads atomic replacements and retains last good file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'system-user-pool-'));
  const path = join(dir, 'users.json');
  const logs: string[] = [];
  const pool = new XianyuSystemUserPool(path, undefined, code => logs.push(code));
  const put = (userIds: unknown[]) => writeFileSync(path, JSON.stringify({ version: 1, userIds }));
  try {
    assert.equal(pool.has('1400'), false);
    assert.throws(() => pool.assertReady(), /SYSTEM_USERS_CONFIG_UNAVAILABLE/);
    put(['1400']);
    assert.equal(pool.has('1400@goofish'), true);
    assert.equal(pool.has('11400'), false);
    assert.equal(normalizeXianyuSystemUserId('1400@evil'), undefined);
    const replacement = join(dir, 'replacement.json');
    writeFileSync(replacement, JSON.stringify({ version: 1, userIds: ['2400'] }));
    utimesSync(replacement, new Date(0), new Date(0));
    renameSync(replacement, path);
    assert.equal(pool.has('2400'), true);
    assert.equal(pool.has('1400'), false);
    writeFileSync(path, '{invalid');
    assert.equal(pool.has('2400'), true);
    pool.assertReady();
    assert.ok(pool.snapshot().lastError);
    put(['2400', 'not-an-id']);
    assert.equal(pool.has('2400'), true);
    assert.equal(pool.snapshot().lastError, 'SYSTEM_USERS_CONFIG_INVALID_ID');
    rmSync(path);
    assert.equal(pool.has('2400'), true);
    put([]);
    assert.equal(pool.has('2400'), false);
    assert.equal(pool.snapshot().lastError, undefined);
    assert.ok(logs.length >= 3);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('separate API and Worker providers observe the shared file and retain last good after file loss', () => {
  const dir = mkdtempSync(join(tmpdir(), 'system-user-workers-'));
  const path = join(dir, 'users.json'), fallback = join(dir, 'example.json');
  writeFileSync(fallback, JSON.stringify({ version: 1, userIds: ['1400'] }));
  const api = new XianyuSystemUserPool(path, fallback, () => {});
  const worker = new XianyuSystemUserPool(path, fallback, () => {});
  try {
    assert.equal(api.has('1400'), true);
    writeFileSync(path, JSON.stringify({ version: 1, userIds: ['2400'] }));
    assert.equal(api.has('2400'), true);
    assert.equal(worker.has('2400'), true);
    rmSync(path);
    assert.equal(api.has('2400'), true);
    assert.equal(worker.has('2400'), true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
