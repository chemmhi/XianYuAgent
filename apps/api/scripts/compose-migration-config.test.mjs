import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..', '..');

function runComposeConfig() {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('docker', ['compose', '--profile', 'full', 'config', '--format', 'json'], { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => resolvePromise({ code, stdout, stderr }));
  });
}

const compose = await runComposeConfig();
assert.equal(compose.code, 0, compose.stderr || compose.stdout);
const config = JSON.parse(compose.stdout);
const services = config.services ?? {};
assert.ok(services.postgres, 'compose must define PostgreSQL');
assert.ok((services.postgres.volumes ?? []).some((volume) => String(volume.target) === '/docker-entrypoint-initdb.d' && String(volume.source).replaceAll('\\', '/').endsWith('/apps/api/migrations') && volume.read_only === true));
assert.deepEqual(services.api?.profiles, ['full']);
assert.deepEqual(services.worker?.profiles, ['full']);
assert.equal(services.api?.depends_on?.postgres?.condition, 'service_healthy');
assert.equal(services.api?.depends_on?.redis?.condition, 'service_healthy');
assert.equal(services.api?.depends_on?.['object-storage']?.condition, 'service_started');
assert.equal(services.worker?.depends_on?.postgres?.condition, 'service_healthy');
assert.equal(services.worker?.depends_on?.redis?.condition, 'service_healthy');

const dockerfile = await readFile(resolve(repoRoot, 'apps/api/Dockerfile'), 'utf8');
assert.match(dockerfile, /COPY --from=build \/app\/dist \.\/dist/);
assert.match(dockerfile, /CMD \["node", "dist\/index\.js"\]/);

console.log('compose migration config passed');
