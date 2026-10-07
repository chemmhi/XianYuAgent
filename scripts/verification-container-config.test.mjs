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
    assert.match(compose, /XIANYU_VERIFICATION_BROWSER_EXECUTABLE: \/usr\/bin\/google-chrome/);
    assert.doesNotMatch(compose, /XIANYU_VERIFICATION_BROWSER_HEADLESS: \$\{XIANYU_VERIFICATION_BROWSER_HEADLESS:-true\}/);
  });
}

test('API image installs Xvfb and Xauthority support', () => {
  assert.match(dockerfile, /xvfb\s+xauth/);
});

test('API image exports the runtime Chrome version before Node starts', async () => {
  assert.match(dockerfile, /COPY docker-entrypoint\.sh \.\/docker-entrypoint\.sh/);
  assert.match(dockerfile, /ENTRYPOINT \["\.\/docker-entrypoint\.sh"\]/);
  assert.match(await readFile(path.join(root, 'apps/api/docker-entrypoint.sh'), 'utf8'), /google-chrome --version/);
});

test('production verification uses Google Chrome and Shanghai timezone', () => {
  assert.match(dockerfile, /google-chrome-stable_current_amd64\.deb/);
  assert.match(dockerfile, /google-chrome --version/);
  assert.match(productionCompose, /XIANYU_VERIFICATION_BROWSER_EXECUTABLE: \/usr\/bin\/google-chrome/);
  assert.match(productionCompose, /XIANYU_BROWSER_CHROME_VERSION: \$\{XIANYU_BROWSER_CHROME_VERSION:-\}/);
});
