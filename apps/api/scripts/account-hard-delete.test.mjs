import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const { fixture } = await import(process.env.ACCOUNT_DELETE_BASELINE
  ? pathToFileURL('F:/ChenHai/Project/XianYuAgent/apps/api/scripts/invite-registration/test-support.mjs').href
  : './invite-registration/test-support.mjs');

import { seed } from './account-hard-delete-support.mjs';
import { purgeMemoryAccount } from '../src/account-purge-memory.ts';
import { AutoReplyRepairRepository } from '../src/auto-reply-repair-repository.ts';
import { ConversationStateReducer } from '../src/auto-reply-state.ts';
import { ModelProviderRuntimePool } from '../src/model-provider-runtime.ts';
import { Redis } from 'ioredis';
import { mkdtemp, mkdir, writeFile, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

for (const kind of ['memory', 'postgres']) test(`${kind}: delete erases owned data and permits invited-user rebinding`, async t => {
  const f = await fixture(kind); t.after(() => f.close());
  const s = await seed(f);
  await f.runtime.store.grantScope({ adminId: s.invited.id, accountId: s.account.id, scope: 'read' });
  const repairs = new AutoReplyRepairRepository(f.runtime.store);
  const repairState = new ConversationStateReducer(randomUUID).createInitial({ accountId: s.account.id, conversationId: s.conversation.id, now: new Date().toISOString() });
  assert.equal(await repairs.saveConversationState(repairState, 0), true);
  const remove = actor => f.request(`/api/v1/accounts/${s.account.id}`, { ...actor, method: 'DELETE', key: 'delete-test', body: {} });
  assert.equal((await remove(s.invited)).status, 404);
  assert.ok(await f.runtime.store.getAccount(s.admin.id, s.account.id));
  const result = await remove(s.admin);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.data.deleted, true);
  assert.equal(await f.runtime.store.findAccountForLogin({ adminId: s.admin.id, platform: 'xianyu', sellerRef: s.account.sellerRef }), undefined, 'must physically remove the old identity');
  assert.equal(await f.runtime.store.getProduct(s.admin.id, s.product.id), undefined);
  assert.equal(await f.runtime.store.getConversation(s.admin.id, s.conversation.id), undefined);
  assert.equal(await f.runtime.store.getLoginSessionById(s.admin.id, s.session.id), undefined);
  assert.equal(await repairs.getConversationState(s.account.id, s.conversation.id), undefined);
  if (f.db) await assert.rejects(() => repairs.saveConversationState(repairState, 0), { code: '23503' });
  else assert.equal(await repairs.saveConversationState(repairState, 0), false);
  await assert.rejects(() => f.runtime.store.enqueueAutoReplyOutbox({ scope: 'late-job', aggregateType: 'order', aggregateId: randomUUID(), operation: 'order_delivery', idempotencyKey: 'late-job', payload: { accountId: s.account.id } }));
  for (const key of s.paths) assert.equal(await f.runtime.objectStorage.getObject(key), undefined);
  assert.ok(await f.runtime.store.getAccount(s.admin.id, s.other.id));
  assert.ok(await f.runtime.store.getProduct(s.admin.id, s.otherProduct.id));
  assert.ok(await f.runtime.objectStorage.getObject(`products/${s.otherProduct.id}/keep.png`));
  assert.ok(await f.runtime.store.findAdminById(s.admin.id));
  if (f.db) {
    const tables = await f.db.pool.query("select table_schema,table_name from information_schema.columns where column_name='account_id' and table_schema not like 'pg_%'");
    for (const row of tables.rows) {
      const count = await f.db.pool.query(`select count(*)::int n from "${row.table_schema}"."${row.table_name}" where account_id::text=$1`, [s.account.id]);
      assert.equal(count.rows[0].n, 0, `${row.table_schema}.${row.table_name}`);
    }
    for (const table of ['execution.idempotency_records', 'execution.outbox_jobs', 'automation.execution_ledger', 'observability.audit_events']) {
      const leftovers = await f.db.pool.query(`select count(*)::int n from ${table} r where strpos(to_jsonb(r)::text,$1)>0 or strpos(to_jsonb(r)::text,$2)>0`, [s.account.id, s.product.id]);
      assert.equal(leftovers.rows[0].n, 0, table);
    }
  }
  const rebound = await f.runtime.accounts.resolveForLogin({ adminId: s.invited.id, platform: 'xianyu', sellerRef: s.account.sellerRef, requestId: 'rebind', traceId: 'rebind' });
  assert.notEqual(rebound.id, s.account.id);
  assert.equal((await f.runtime.store.listProducts(s.invited.id, { accountId: rebound.id })).total, 0);
  assert.equal((await f.runtime.store.listConversations(s.invited.id, { accountId: rebound.id })).items.length, 0);
});

test('delayed model construction cannot recreate a deleted runtime', async () => {
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  const pool = new ModelProviderRuntimePool({ createClient: async () => { entered(); await gate; return { complete: async () => ({ content: 'ok' }) }; } });
  const resolving = pool.resolve({ adminId: 'admin', accountId: 'account', configs: [{ role: 'primary', version: 1, timeoutMs: 1000 }], mode: 'auto', routingVersion: 0 });
  await started; await pool.deleteAccount('account'); release();
  await assert.rejects(resolving, /MODEL_ACCOUNT_DELETED/);
  assert.equal(pool.getSnapshot('admin', 'account'), undefined);
  await pool.close();
});

test('postgres/Redis: another runtime cannot restore deleted snapshots or routing', async t => {
  const redisUrl = process.env.ACCOUNT_DELETE_REDIS_URL ?? 'redis://127.0.0.1:56379';
  const f = await fixture('postgres', { REDIS_URL: redisUrl }); t.after(() => f.close());
  const s = await seed(f);
  const redis = new Redis(redisUrl); t.after(() => redis.quit());
  const workerPool = new ModelProviderRuntimePool({ redisUrl,
    createClient: async () => ({ complete: async () => ({ content: 'test', model: 'test' }) }),
    withAccountGuard: (id, work) => f.runtime.store.withAccountWriteGuard(id, work),
    accountAvailable: (adminId, id) => f.runtime.store.hasAccountScope(adminId, id),
  }); t.after(() => workerPool.close());
  const input = { adminId: s.admin.id, accountId: s.account.id, configs: [{ role: 'primary', version: 1, timeoutMs: 1000 }], mode: 'auto', routingVersion: 0 };
  await workerPool.resolve(input);
  await workerPool.persistEntrySnapshot(s.admin.id, s.account.id);
  assert.equal(await redis.exists(`model:provider:state:v2:${s.account.id}:1`), 1);
  await f.runtime.accounts.delete({ adminId: s.admin.id, accountId: s.account.id, requestId: 'redis-delete', traceId: 'redis-delete' });
  await workerPool.persistEntrySnapshot(s.admin.id, s.account.id);
  await assert.rejects(() => workerPool.syncRouting({ accountId: s.account.id, routing: {} }), /ACCOUNT_DELETION/);
  await workerPool.probeDue();
  assert.equal(workerPool.getSnapshot(s.admin.id, s.account.id), undefined);
  assert.equal(await redis.exists(`model:provider:state:v2:${s.account.id}:1`), 0);
  assert.equal(await redis.exists(`model:routing:v2:${s.account.id}`), 0);
});

test('memory purge removes custom reservation and execution indexes', () => {
  const state = {
    couponReservations: new Map([['reservation', { reservationId: 'reservation', accountId: 'target', executionKey: 'custom' }]]),
    couponReservationByExecutionKey: new Map([['custom', 'reservation']]),
    automationExecutions: new Map([['custom', { result: { reservationId: 'reservation' } }]]),
    accounts: new Map([['other', { id: 'other' }]]),
  };
  purgeMemoryAccount(state, 'target');
  assert.equal(state.couponReservationByExecutionKey.size, 0);
  assert.equal(state.automationExecutions.size, 0);
  assert.equal(state.accounts.size, 1);
});

for (const kind of ['memory', 'postgres']) test(`${kind}: deletion drains uploads and rejects late writers and login restoration`, async t => {
  const f = await fixture(kind); t.after(() => f.close());
  const s = await seed(f);
  let entered, release;
  const started = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  let finished = false, cleaned = false;
  const writing = f.runtime.store.withAccountArtifactWrite(`products/${s.product.id}/late.png`, async () => { entered(); await gate; finished = true; });
  await started;
  const deleting = f.runtime.store.deleteAccount(s.admin.id, s.account.id, async () => { assert.equal(finished, true); cleaned = true; });
  const deadline = Date.now() + 5000;
  while (await f.runtime.store.getAccountForLogin(s.admin.id, s.account.id)) {
    assert.ok(Date.now() < deadline); await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(cleaned, false, 'must wait for writers before deleting object prefixes');
  await assert.rejects(() => f.runtime.objectStorage.putObject({ key: `products/${s.product.id}/after.png`, body: Buffer.from('late'), contentType: 'image/png' }), /ACCOUNT_DELETION/);
  assert.equal(await f.runtime.store.restoreAccountForLogin(s.admin.id, s.account.id), undefined);
  release(); await writing; await deleting;
  assert.equal(cleaned, true);
  await assert.rejects(() => f.runtime.objectStorage.putObject({ key: `products/${s.product.id}/after.png`, body: Buffer.from('late'), contentType: 'image/png' }), /ACCOUNT_/);
});

test('postgres: purge failure rolls back all business deletes, then retry succeeds', async t => {
  const f = await fixture('postgres'); t.after(() => f.close());
  const s = await seed(f);
  await f.db.pool.query("create function products.reject_test_delete() returns trigger language plpgsql as $$ begin raise exception 'PURGE_TEST_FAILURE'; end $$");
  await f.db.pool.query('create trigger reject_test_delete before delete on products.products for each row execute function products.reject_test_delete()');
  const response = await f.request(`/api/v1/accounts/${s.account.id}`, { ...s.admin, method: 'DELETE', key: 'db-failure', body: {} });
  assert.equal(response.status, 500);
  for (const table of ['products.products', 'orders.orders', 'messages.messages', 'auth.account_scopes']) assert.ok((await f.db.pool.query(`select count(*)::int n from ${table} where account_id=$1`, [s.account.id])).rows[0].n > 0, table);
  assert.equal(await f.runtime.store.getAccountForLogin(s.admin.id, s.account.id), undefined);
  await f.db.pool.query('drop trigger reject_test_delete on products.products');
  const retry = await f.request(`/api/v1/accounts/${s.account.id}`, { ...s.admin, method: 'DELETE', key: 'db-retry', body: {} });
  assert.equal(retry.status, 200, JSON.stringify(retry.body));
});

test('postgres: historical soft-deleted identity is purged through the same path', async t => {
  const f = await fixture('postgres'); t.after(() => f.close());
  const s = await seed(f);
  await f.db.pool.query("update accounts.accounts set status='disabled' where id=$1", [s.account.id]);
  await f.db.pool.query("update auth.account_scopes set status='revoked' where account_id=$1", [s.account.id]);
  await f.runtime.accounts.delete({ adminId: s.admin.id, accountId: s.account.id, requestId: 'legacy', traceId: 'legacy' });
  assert.equal((await f.db.pool.query('select count(*)::int n from accounts.accounts where id=$1', [s.account.id])).rows[0].n, 0);
  const rebound = await f.runtime.accounts.resolveForLogin({ adminId: s.invited.id, platform: 'xianyu', sellerRef: s.account.sellerRef, requestId: 'legacy-rebind', traceId: 'legacy-rebind' });
  assert.notEqual(rebound.id, s.account.id);
});

test('browser profiles and QR session profiles are removed without touching another account', async t => {
  const root = await mkdtemp(join(tmpdir(), 'account-profile-delete-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const f = await fixture('memory', { XIANYU_VERIFICATION_BROWSER_USER_DATA_DIR: root }); t.after(() => f.close());
  const s = await seed(f);
  for (const id of [s.account.id, s.session.id, s.other.id]) {
    await mkdir(join(root, id), { recursive: true }); await writeFile(join(root, id, 'Cookies'), 'synthetic cookie fixture');
  }
  await f.runtime.accounts.delete({ adminId: s.admin.id, accountId: s.account.id, requestId: 'profile-delete', traceId: 'profile-delete' });
  await assert.rejects(() => access(join(root, s.account.id)), { code: 'ENOENT' });
  await assert.rejects(() => access(join(root, s.session.id)), { code: 'ENOENT' });
  await access(join(root, s.other.id, 'Cookies'));
});

test('legacy repair CLI defaults to dry-run and applies only to the exact disabled account', async t => {
  const f = await fixture('postgres'); t.after(() => f.close());
  const s = await seed(f);
  await f.db.pool.query("update accounts.accounts set status='disabled' where id=$1", [s.account.id]);
  await f.db.pool.query("update auth.account_scopes set status='revoked' where account_id=$1", [s.account.id]);
  const args = [new URL('./purge-deleted-account.mjs', import.meta.url).pathname.replace(/^\/([A-Z]:)/i, '$1'), `--account-id=${s.account.id}`];
  const env = { ...process.env, DATABASE_URL: f.db.url, ALLOW_IN_MEMORY: 'false', REDIS_URL: '', CREDENTIAL_ENCRYPTION_KEY: 'invite-test-encryption-key-32-chars', XIANYU_VERIFICATION_BROWSER_MODE: 'disabled' };
  const execute = promisify(execFile);
  const dry = await execute(process.execPath, args, { env, timeout: 15_000 }); assert.match(dry.stdout, /dry-run/);
  assert.equal((await f.db.pool.query('select count(*)::int n from accounts.accounts where id=$1', [s.account.id])).rows[0].n, 1);
  const applied = await execute(process.execPath, [...args, '--apply', `--im-owner-url=${f.origin}`], { env, timeout: 15_000 });
  assert.match(applied.stdout, /"identityReleased":true/);
  assert.equal((await f.db.pool.query('select count(*)::int n from accounts.accounts where id=$1', [s.account.id])).rows[0].n, 0);
  assert.ok(await f.runtime.store.getAccount(s.admin.id, s.other.id));
});

test('postgres: manual delivery paused before enqueue cannot recreate an orphan job', async t => {
  const f = await fixture('postgres'); t.after(() => f.close());
  const s = await seed(f);
  let entered, release;
  const started = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const enqueue = f.runtime.store.enqueueAutoReplyOutbox.bind(f.runtime.store);
  f.runtime.store.enqueueAutoReplyOutbox = async input => {
    assert.equal(input.payload.accountId, s.account.id);
    entered(); await gate; return enqueue(input);
  };
  const delivering = f.runtime.orderDelivery.deliver({ adminId: s.admin.id, accountId: s.account.id, orderNo: 'delete-order', deliveryType: 'manual', trackingRef: 'test-reference', idempotencyKey: 'paused-delivery', requestId: 'paused-delivery', traceId: 'paused-delivery' });
  const rejection = assert.rejects(delivering, { code: '23503' });
  await started;
  await f.runtime.accounts.delete({ adminId: s.admin.id, accountId: s.account.id, requestId: 'delete-during-delivery', traceId: 'delete-during-delivery' });
  release(); await rejection;
  assert.equal((await f.db.pool.query('select count(*)::int n from execution.outbox_jobs where payload_json->>\'accountId\'=$1', [s.account.id])).rows[0].n, 0);
});

for (const kind of ['memory', 'postgres']) test(`${kind}: cleanup failure fences login and is retryable`, async t => {
  const f = await fixture(kind); t.after(() => f.close());
  const s = await seed(f);
  await assert.rejects(() => f.runtime.store.deleteAccount(s.admin.id, s.account.id, async () => { throw new Error('STORAGE_UNAVAILABLE'); }), /STORAGE_UNAVAILABLE/);
  assert.equal(await f.runtime.store.getAccountForLogin(s.admin.id, s.account.id), undefined);
  assert.ok((await f.runtime.store.listAccounts(s.admin.id)).items.some(row => row.id === s.account.id), 'failed deletion remains visible for retry');
  assert.equal(await f.runtime.store.restoreAccountForLogin(s.admin.id, s.account.id), undefined);
  if (f.db) assert.equal((await f.db.pool.query('select count(*)::int n from products.products where id=$1', [s.product.id])).rows[0].n, 1);
  const response = await f.request(`/api/v1/accounts/${s.account.id}`, { ...s.admin, method: 'DELETE', key: 'retry-delete', body: {} });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.ok(await f.runtime.store.getAccount(s.admin.id, s.other.id));
});
