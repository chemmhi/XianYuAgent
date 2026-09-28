import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { createApp } from '../dist/app.js';
import { loadConfig } from '../dist/config.js';

const rootDatabaseUrl = process.env.DATABASE_URL ?? 'postgres://xianyu:xianyu_dev_only@127.0.0.1:5432/postgres';
const databaseName = `xianyu_workspace_agent_${process.pid}_${Date.now()}`.replace(/[^a-z0-9_]/gi, '_');
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
async function createDatabase() { const pool = new pg.Pool({ connectionString: rootDatabaseUrl.replace(/\/[^/]+$/, '/postgres') }); await pool.query(`CREATE DATABASE "${databaseName}"`); await pool.end(); }
async function dropDatabase() { const pool = new pg.Pool({ connectionString: rootDatabaseUrl.replace(/\/[^/]+$/, '/postgres') }); await pool.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`); await pool.end(); }
async function migrate() { const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'; const result = spawnSync(npm, ['--workspace', 'apps/api', 'run', 'migrate'], { cwd: repositoryRoot, env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: 'inherit', shell: process.platform === 'win32' }); if (result.status !== 0) throw new Error(`migration failed with ${result.status}`); }
function appConfig() { return loadConfig({ HOST: '127.0.0.1', PORT: '0', DATABASE_URL: databaseUrl, REDIS_URL: '', ALLOW_IN_MEMORY: 'false', COOKIE_SECURE: 'false', XIANYU_QR_MODE: 'stub', AGENT_RUNTIME: 'in-process', AUTO_REPLY_OUTCOME_REVIEW_WORKER_ENABLED: 'false', OBJECT_STORAGE_ENDPOINT: 'http://127.0.0.1:19000' }); }

async function run() {
  await createDatabase();
  await migrate();
  runtime = createApp(appConfig());
  const { store } = runtime;
  const admin = await store.createAdmin({ email: `workspace-agent-postgres-${process.pid}@example.com`, passwordHash: 'hash', displayName: 'Workspace Agent PostgreSQL' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: `workspace-agent-postgres-${process.pid}`, displayName: 'PostgreSQL 配置账号' });
  const session = await store.createAgentSession({ adminId: admin.id, accountId: account.id, title: 'PostgreSQL 配置会话' });
  const instruction = '修改自动回复配置；启用：否；最大循环次数：6；发送延迟：12秒';
  const created = await store.createRun({ adminId: admin.id, accountId: account.id, sessionId: session.id, instruction, clientRunRef: `workspace-agent-postgres-${process.pid}` });
  runtime.workspaceRuntime.enqueue({ adminId: admin.id, sessionId: session.id, run: created.run, steps: created.steps });
  await waitForStatus(store, admin.id, created.run.id, 'waiting_confirmation');
  const pending = await store.getWorkspaceConfirmation(admin.id, created.run.id);
  assert.ok(pending);
  assert.equal(pending.action, 'agent_settings_update');
  assert.equal(pending.policyRef, 'agent.settings.update.confirm');
  const confirmed = await runtime.workspace.confirmRun({ adminId: admin.id, runId: created.run.id, expectedVersion: pending.version, requestId: 'workspace-agent-postgres-confirm', traceId: 'workspace-agent-postgres-trace' });
  assert.equal(confirmed.run.status, 'succeeded');
  assert.equal(confirmed.outbox.status, 'succeeded');

  const auditPool = new pg.Pool({ connectionString: databaseUrl });
  const persisted = await auditPool.query(`select c.status as confirmation_status, c.version, r.status as run_status, s.status as step_status, o.status as outbox_status, o.operation, cfg.config_version, cfg.config_json->>'enabled' as enabled, cfg.config_json->>'maxLoops' as max_loops, cfg.config_json->>'sendDelaySeconds' as send_delay from workspace.confirmations c join workspace.runs r on r.id=c.run_id join workspace.steps s on s.id=c.step_id join execution.outbox_jobs o on o.aggregate_id=c.run_id join settings.auto_reply_agent_account_configs cfg on cfg.account_id=c.account_id where c.id=$1`, [pending.id]);
  assert.equal(persisted.rowCount, 1);
  assert.deepEqual(persisted.rows[0], { confirmation_status: 'confirmed', version: 2, run_status: 'succeeded', step_status: 'succeeded', outbox_status: 'succeeded', operation: 'agent_settings_update', config_version: 1, enabled: 'false', max_loops: '6', send_delay: '12' });
  await auditPool.end();
  assert.equal((await store.listWorkspaceMessages(admin.id, session.id)).some((message) => message.content.includes(instruction)), false);

  await runtime.close();
  runtime = createApp(appConfig());
  const readback = await runtime.store.getWorkspaceConfirmation(admin.id, created.run.id);
  const runReadback = await runtime.store.getRun(admin.id, created.run.id);
  const outboxReadback = await runtime.store.listAutoReplyOutboxByAggregate(`workspace:${admin.id}:${account.id}`, created.run.id);
  const settingsReadback = await runtime.store.getAutoReplyAgentConfig(admin.id, account.id);
  assert.equal(readback?.status, 'confirmed');
  assert.equal(readback?.version, 2);
  assert.equal(runReadback?.run.status, 'succeeded');
  assert.equal(runReadback?.steps[0]?.status, 'succeeded');
  assert.equal(outboxReadback[0]?.status, 'succeeded');
  assert.equal(settingsReadback?.configVersion, 1);
  assert.equal(settingsReadback?.enabled, false);
  console.log(JSON.stringify({ status: 'PASS', slice: 'WS-VS-04', storage: 'postgres', database: databaseName, runId: created.run.id, confirmation: readback?.status, run: runReadback?.run.status, configVersion: settingsReadback?.configVersion, outbox: outboxReadback[0]?.status, redacted: !JSON.stringify(readback?.manifest).includes(instruction) }, null, 2));
}

try { await run(); } finally { if (runtime) { try { await runtime.close(); } catch (error) { console.warn(`runtime close failed: ${error.message}`); } } try { await dropDatabase(); } catch (error) { console.warn(`temporary database cleanup failed: ${error.message}`); } }
