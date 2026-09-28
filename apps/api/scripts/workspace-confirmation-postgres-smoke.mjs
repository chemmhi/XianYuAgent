import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { createApp } from '../dist/app.js';
import { loadConfig } from '../dist/config.js';

const rootDatabaseUrl = process.env.DATABASE_URL ?? 'postgres://xianyu:xianyu_dev_only@127.0.0.1:5432/postgres';
const databaseName = `xianyu_workspace_confirm_${process.pid}_${Date.now()}`.replace(/[^a-z0-9_]/gi, '_');
const databaseUrl = rootDatabaseUrl.replace(/\/[^/]+$/, `/${databaseName}`);
const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url));
let runtime;

async function waitForStatus(store, adminId, runId, expected) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const bundle = await store.getRun(adminId, runId);
    if (bundle?.run.status === expected) return bundle;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`run did not reach ${expected}`);
}

async function createDatabase() {
  const pool = new pg.Pool({ connectionString: rootDatabaseUrl.replace(/\/[^/]+$/, '/postgres') });
  await pool.query(`CREATE DATABASE "${databaseName}"`);
  await pool.end();
}

async function dropDatabase() {
  const pool = new pg.Pool({ connectionString: rootDatabaseUrl.replace(/\/[^/]+$/, '/postgres') });
  await pool.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
  await pool.end();
}

async function migrate() {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(npm, ['--workspace', 'apps/api', 'run', 'migrate'], {
    cwd: repositoryRoot,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) throw new Error(`migration failed with ${result.status}`);
}

function appConfig() {
  return loadConfig({
    HOST: '127.0.0.1',
    PORT: '0',
    DATABASE_URL: databaseUrl,
    REDIS_URL: '',
    ALLOW_IN_MEMORY: 'false',
    COOKIE_SECURE: 'false',
    XIANYU_QR_MODE: 'stub',
    AGENT_RUNTIME: 'in-process',
    AUTO_REPLY_OUTCOME_REVIEW_WORKER_ENABLED: 'false',
    OBJECT_STORAGE_ENDPOINT: 'http://127.0.0.1:19000',
  });
}

async function run() {
  await createDatabase();
  await migrate();
  runtime = createApp(appConfig());
  const { store } = runtime;
  const admin = await store.createAdmin({ email: `workspace-confirm-postgres-${process.pid}@example.com`, passwordHash: 'hash', displayName: 'Workspace Confirmation PostgreSQL' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: `workspace-confirm-postgres-${process.pid}`, displayName: 'PostgreSQL 确认账号' });
  const product = await store.createProduct({ adminId: admin.id, accountId: account.id, title: 'PostgreSQL 待发布商品', description: 'Workspace confirmation PostgreSQL smoke', priceMinor: 25900, status: 'draft' });
  const session = await store.createAgentSession({ adminId: admin.id, accountId: account.id, title: 'PostgreSQL 确认会话' });
  const created = await store.createRun({ adminId: admin.id, accountId: account.id, sessionId: session.id, instruction: `发布商品 ${product.id}`, clientRunRef: `workspace-confirm-postgres-${process.pid}` });

  runtime.workspaceRuntime.enqueue({ adminId: admin.id, sessionId: session.id, run: created.run, steps: created.steps });
  await waitForStatus(store, admin.id, created.run.id, 'waiting_confirmation');
  const pending = await store.getWorkspaceConfirmation(admin.id, created.run.id);
  assert.ok(pending);
  assert.equal(pending.status, 'active');
  assert.equal(pending.manifest.productId, product.id);

  const confirmed = await runtime.workspace.confirmRun({
    adminId: admin.id,
    runId: created.run.id,
    expectedVersion: pending.version,
    requestId: 'workspace-confirm-postgres-confirm',
    traceId: 'workspace-confirm-postgres-trace',
  });
  assert.equal(confirmed.confirmation.status, 'confirmed');
  assert.equal(confirmed.run.status, 'executing');
  assert.equal(confirmed.outbox.status, 'pending');

  const auditPool = new pg.Pool({ connectionString: databaseUrl });
  const persistedRows = await auditPool.query(`
    select c.status as confirmation_status, c.version, r.status as run_status, s.status as step_status,
           o.status as outbox_status, o.operation, o.scope
      from workspace.confirmations c
      join workspace.runs r on r.id = c.run_id
      join workspace.steps s on s.id = c.step_id
      join execution.outbox_jobs o on o.aggregate_id = c.run_id
     where c.id = $1`, [pending.id]);
  assert.equal(persistedRows.rowCount, 1);
  assert.deepEqual(persistedRows.rows[0], {
    confirmation_status: 'confirmed',
    version: 2,
    run_status: 'executing',
    step_status: 'executing',
    outbox_status: 'pending',
    operation: 'product_publish',
    scope: `workspace:${admin.id}:${account.id}`,
  });
  await auditPool.end();

  await runtime.close();
  runtime = createApp(appConfig());
  const readback = await runtime.store.getWorkspaceConfirmation(admin.id, created.run.id);
  const runReadback = await runtime.store.getRun(admin.id, created.run.id);
  const outboxReadback = await runtime.store.listAutoReplyOutboxByAggregate(`workspace:${admin.id}:${account.id}`, created.run.id);
  assert.equal(readback?.status, 'confirmed');
  assert.equal(readback?.version, 2);
  assert.equal(runReadback?.run.status, 'executing');
  assert.equal(runReadback?.steps[0]?.status, 'executing');
  assert.equal(outboxReadback.length, 1);
  assert.equal(outboxReadback[0]?.status, 'pending');
  console.log(JSON.stringify({
    status: 'PASS',
    slice: 'WS-VS-02',
    storage: 'postgres',
    database: databaseName,
    runId: created.run.id,
    confirmationId: readback?.id,
    outboxId: outboxReadback[0]?.id,
    readback: { confirmation: readback?.status, version: readback?.version, run: runReadback?.run.status, step: runReadback?.steps[0]?.status, outbox: outboxReadback[0]?.status },
  }, null, 2));
}

try {
  await run();
} finally {
  if (runtime) {
    try { await runtime.close(); } catch (error) { console.warn(`runtime close failed: ${error.message}`); }
  }
  try { await dropDatabase(); } catch (error) { console.warn(`temporary database cleanup failed: ${error.message}`); }
}
