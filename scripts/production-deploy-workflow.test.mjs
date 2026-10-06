import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflow = await readFile(new URL('../.github/workflows/deploy-production.yml', import.meta.url), 'utf8');

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
});
