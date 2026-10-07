import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflow = await readFile(new URL('../.github/workflows/deploy-production.yml', import.meta.url), 'utf8');
const deployScript = await readFile(new URL('./deploy-production.sh', import.meta.url), 'utf8');
const apiDockerfile = await readFile(new URL('../apps/api/Dockerfile', import.meta.url), 'utf8');

test('production workflow deploys every main push and supports manual runs', () => {
  assert.match(workflow, /push:\s*[\s\S]*branches:\s*[\s\S]*- main/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /group: production-deploy/);
});

test('production workflow pins SSH host verification and deployment inputs', () => {
  assert.match(workflow, /StrictHostKeyChecking=yes/);
  assert.match(workflow, /DEPLOY_SSH_KEY/);
  assert.match(workflow, /DEPLOY_KNOWN_HOSTS/);
  assert.match(workflow, /DEPLOY_PATH/);
});

test('production workflow verifies the pushed SHA before deployment', () => {
  assert.match(workflow, /git fetch --prune origin main/);
  assert.match(workflow, /git pull --ff-only origin main/);
  assert.match(workflow, /actual_sha=.*git rev-parse HEAD/);
  assert.match(workflow, /actual_sha.*EXPECTED_SHA/);
  assert.match(workflow, /bash scripts\/deploy-production\.sh/);
  assert.doesNotMatch(workflow, /deploy-production-frontend\.sh/);
});

test('production deploy keeps UI and API in one verified entrypoint', () => {
  assert.match(deployScript, /build_frontend\(\)/);
  assert.match(deployScript, /npm ci --no-audit --no-fund/);
  assert.match(deployScript, /apps\/web\/dist/);
  assert.match(deployScript, /npm run build:web/);
  assert.match(deployScript, /frontend_mutation_started=1/);
  assert.match(deployScript, /rollback_frontend\(\)/);
  assert.match(deployScript, /wait_for_text "\$PUBLIC_BASE_URL\//);
  assert.match(deployScript, /infra_up_args=\(-d\)/);
  assert.doesNotMatch(deployScript, /up -d --build --force-recreate[\s\S]*postgres redis object-storage/);
  assert.ok(deployScript.indexOf('build_frontend') < deployScript.indexOf('up -d --force-recreate api worker'));
});

test('production deploy migrates the existing volume before API and Worker startup', () => {
  assert.match(deployScript, /wait_for_postgres/);
  assert.match(deployScript, /docker compose -f "\$COMPOSE_FILE" run --rm --no-deps api node scripts\/migrate\.mjs/);
  const migrationIndex = deployScript.indexOf('node scripts/migrate.mjs');
  const apiStartupIndex = deployScript.indexOf('up -d --force-recreate api worker');
  assert.ok(migrationIndex >= 0 && apiStartupIndex > migrationIndex);
  assert.match(apiDockerfile, /COPY scripts\/migrate\.mjs \.\/scripts\/migrate\.mjs/);
  assert.match(apiDockerfile, /COPY migrations \.\/migrations/);
});
