import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));

function storageImage(t, override) {
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), 'xianyu-compose-'));
  t.after(() => rmSync(temporaryRoot, { recursive: true, force: true }));
  const envFile = path.join(temporaryRoot, '.env');
  writeFileSync(envFile, '');
  const env = { ...process.env };
  delete env.OBJECT_STORAGE_IMAGE;
  if (override !== undefined) env.OBJECT_STORAGE_IMAGE = override;
  const config = JSON.parse(execFileSync('docker', [
    'compose', '--env-file', envFile, '-f', path.join(projectRoot, 'docker-compose.yml'),
    'config', '--format', 'json',
  ], { cwd: projectRoot, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  return config.services['object-storage'].image;
}

test('development storage defaults to the production MinIO image', (t) => {
  assert.equal(storageImage(t), 'minio/minio:latest');
});

test('development storage accepts an explicit image mirror or pinned version', (t) => {
  const mirror = 'registry.example.test/minio/minio:RELEASE.test';
  assert.equal(storageImage(t, mirror), mirror);
});

test('an empty storage image override uses the default', (t) => {
  assert.equal(storageImage(t, ''), 'minio/minio:latest');
});
