import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
test('production enables managed/native verification by default and honors explicit opt-out', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'xianyu-production-config-'));
  const envFile = join(directory, 'compose.env');
  try {
    await writeFile(envFile, 'POSTGRES_PASSWORD=synthetic-test-only\nOBJECT_STORAGE_ACCESS_KEY=synthetic-test-only\nOBJECT_STORAGE_SECRET_KEY=synthetic-test-only\n');
    for (const explicit of [undefined, 'false']) {
      const env = { ...process.env };
      for (const key of ['XIANYU_VERIFICATION_REMOTE_ENABLED', 'XIANYU_VERIFICATION_NATIVE_ENABLED']) {
        delete env[key]; if (explicit !== undefined) env[key] = explicit;
      }
      const result = spawnSync('docker', ['compose', '--env-file', envFile, '-f', 'compose.prod.yml', 'config', '--format', 'json'], { cwd: repoRoot, env, encoding: 'utf8' });
      assert.equal(result.status, 0, 'production Compose must resolve');
      const api = JSON.parse(result.stdout).services.api;
      assert.equal(api.environment.XIANYU_VERIFICATION_REMOTE_ENABLED, explicit ?? 'true');
      assert.equal(api.environment.XIANYU_VERIFICATION_NATIVE_ENABLED, explicit ?? 'true');
    }
  } finally {
    if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith('xianyu-production-config-')) throw Error('Unsafe Compose test cleanup');
    await rm(directory, { recursive: true, force: true });
  }
});
