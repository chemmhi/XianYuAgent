import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8'));

test('development API and worker scripts do not override slider verification mode', () => {
  for (const scriptName of ['dev:api', 'dev:worker']) {
    const script = String(packageJson.scripts?.[scriptName] ?? '');
    assert.doesNotMatch(script, /XIANYU_VERIFICATION_BROWSER_MODE=disabled/);
    assert.doesNotMatch(script, /XIANYU_VERIFICATION_SLIDER_MODE=disabled/);
  }
});

test('explicit verification scripts keep automatic slider mode available', () => {
  for (const scriptName of ['dev:api:verification', 'dev:worker:verification']) {
    const script = String(packageJson.scripts?.[scriptName] ?? '');
    assert.match(script, /XIANYU_VERIFICATION_BROWSER_MODE=launch/);
    assert.match(script, /XIANYU_VERIFICATION_SLIDER_MODE=auto/);
  }
});
