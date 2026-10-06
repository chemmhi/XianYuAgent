import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [dockerfile, productionCompose, developmentCompose] = await Promise.all([
  readFile(path.join(root, 'apps/api/Dockerfile'), 'utf8'),
  readFile(path.join(root, 'compose.prod.yml'), 'utf8'),
  readFile(path.join(root, 'docker-compose.yml'), 'utf8'),
]);

for (const [name, compose] of [['production', productionCompose], ['development', developmentCompose]]) {
  test(`${name} browser container uses init and Patchright Xvfb mode`, () => {
    assert.match(compose, /init:\s*true/);
    assert.match(compose, /command:\s*\["xvfb-run"/);
    assert.match(compose, /XIANYU_VERIFICATION_BROWSER_MODE: \$\{XIANYU_VERIFICATION_BROWSER_MODE:-launch\}/);
    assert.match(compose, /XIANYU_VERIFICATION_SLIDER_MODE: \$\{XIANYU_VERIFICATION_SLIDER_MODE:-auto\}/);
    assert.match(compose, /XIANYU_VERIFICATION_BROWSER_HEADLESS: \$\{XIANYU_VERIFICATION_BROWSER_HEADLESS:-false\}/);
    assert.doesNotMatch(compose, /XIANYU_VERIFICATION_BROWSER_HEADLESS: \$\{XIANYU_VERIFICATION_BROWSER_HEADLESS:-true\}/);
  });
}

test('API image installs Xvfb and Xauthority support', () => {
  assert.match(dockerfile, /xvfb\s+xauth/);
});
