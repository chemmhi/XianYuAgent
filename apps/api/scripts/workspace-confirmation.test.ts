import assert from 'node:assert/strict';
import test from 'node:test';
import { InProcessAgentRuntime, WorkspaceService } from '../src/workspace.js';
import { MemoryStore } from '../src/store-memory.js';
import { detectNativeWorkspaceWrite, prepareNativeWorkspaceWrite } from '../src/workspace-native-write.js';

async function fixture(instruction = '') {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: `workspace-confirm-${Math.random()}@example.com`, passwordHash: 'hash', displayName: 'Workspace Confirm' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: `confirm-${Math.random()}`, displayName: '确认账号' });
  const product = await store.createProduct({ adminId: admin.id, accountId: account.id, title: '待发布商品', description: 'Workspace 发布确认测试', priceMinor: 12_900, status: 'draft' });
  const session = await store.createAgentSession({ adminId: admin.id, accountId: account.id, title: '确认会话' });
  const created = await store.createRun({ adminId: admin.id, accountId: account.id, sessionId: session.id, instruction: instruction || `发布商品 ${product.id}`, clientRunRef: `confirm-${Math.random()}` });
  return { store, admin, account, product, session, created };
}

async function waitForStatus(store: MemoryStore, adminId: string, runId: string, status: string): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const bundle = await store.getRun(adminId, runId);
    if (bundle?.run.status === status) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`run did not reach ${status}`);
}

test('native workspace write detects and prepares a redacted product publish plan', async () => {
  const { store, admin, account, product } = await fixture();
  assert.equal(detectNativeWorkspaceWrite(`发布商品 ${product.id}`), 'product_publish');
  const plan = await prepareNativeWorkspaceWrite({ store, adminId: admin.id, accountId: account.id, instruction: `发布商品 ${product.id}` });
  assert.equal(plan?.kind, 'product_publish');
  assert.equal(plan?.manifest.productId, product.id);
  assert.equal(plan?.manifest.accountId, account.id);
  assert.equal(plan?.manifest.redacted, true);
  assert.equal(plan?.manifest.requiresExternalExecution, true);
});

test('in-process runtime pauses product publish for confirmation without calling an external publisher', async () => {
  const { store, admin, account, session, created, product } = await fixture();
  new InProcessAgentRuntime(store).enqueue({ adminId: admin.id, sessionId: session.id, run: created.run, steps: created.steps });
  await waitForStatus(store, admin.id, created.run.id, 'waiting_confirmation');
  const bundle = await store.getRun(admin.id, created.run.id);
  const confirmation = await store.getWorkspaceConfirmation(admin.id, created.run.id);
  assert.equal(bundle?.steps[0].status, 'waiting_confirmation');
  assert.equal(confirmation?.status, 'active');
  assert.equal(confirmation?.manifest.productId, product.id);
  assert.equal(confirmation?.manifest.redacted, true);
  assert.ok((await store.listAutoReplyOutboxByAggregate(`workspace:${admin.id}:${account.id}`, created.run.id)).length === 0);
});

test('confirm enqueues an execution outbox and prevents a stale second confirmation', async () => {
  const { store, admin, account, session, created } = await fixture();
  new InProcessAgentRuntime(store).enqueue({ adminId: admin.id, sessionId: session.id, run: created.run, steps: created.steps });
  await waitForStatus(store, admin.id, created.run.id, 'waiting_confirmation');
  const confirmation = await store.getWorkspaceConfirmation(admin.id, created.run.id);
  assert.ok(confirmation);
  const service = new WorkspaceService(store, new InProcessAgentRuntime(store), async () => 'audit-confirm');
  const result = await service.confirmRun({ adminId: admin.id, runId: created.run.id, expectedVersion: confirmation!.version, requestId: 'req-confirm', traceId: 'trace-confirm' });
  assert.equal(result.confirmation.status, 'confirmed');
  assert.equal(result.outbox.status, 'pending');
  assert.equal(result.outbox.operation, 'product_publish');
  assert.equal(result.run.status, 'executing');
  await assert.rejects(() => service.confirmRun({ adminId: admin.id, runId: created.run.id, expectedVersion: confirmation!.version, requestId: 'req-confirm-2', traceId: 'trace-confirm-2' }), /not waiting for confirmation|no longer active/);
  const jobs = await store.listAutoReplyOutboxByAggregate(`workspace:${admin.id}:${account.id}`, created.run.id);
  assert.equal(jobs.length, 1);
});

test('cancel transitions the run and confirmation without creating an outbox job', async () => {
  const { store, admin, account, session, created } = await fixture();
  new InProcessAgentRuntime(store).enqueue({ adminId: admin.id, sessionId: session.id, run: created.run, steps: created.steps });
  await waitForStatus(store, admin.id, created.run.id, 'waiting_confirmation');
  const confirmation = await store.getWorkspaceConfirmation(admin.id, created.run.id);
  const service = new WorkspaceService(store, new InProcessAgentRuntime(store), async () => 'audit-cancel');
  const result = await service.cancelRun({ adminId: admin.id, runId: created.run.id, expectedVersion: confirmation!.version, requestId: 'req-cancel', traceId: 'trace-cancel' });
  assert.equal(result.confirmation.status, 'cancelled');
  assert.equal(result.run.status, 'cancelled');
  assert.equal((await store.listAutoReplyOutboxByAggregate(`workspace:${admin.id}:${account.id}`, created.run.id)).length, 0);
});

test('retry requeues a retryable workspace outbox without duplicating the job', async () => {
  const { store, admin, account, session, created } = await fixture();
  new InProcessAgentRuntime(store).enqueue({ adminId: admin.id, sessionId: session.id, run: created.run, steps: created.steps });
  await waitForStatus(store, admin.id, created.run.id, 'waiting_confirmation');
  const confirmation = await store.getWorkspaceConfirmation(admin.id, created.run.id);
  const service = new WorkspaceService(store, new InProcessAgentRuntime(store), async () => 'audit-retry');
  const confirmed = await service.confirmRun({ adminId: admin.id, runId: created.run.id, expectedVersion: confirmation!.version, requestId: 'req-retry-confirm', traceId: 'trace-retry-confirm' });
  const claimed = await store.claimAutoReplyOutbox({ scope: `workspace:${admin.id}:${account.id}`, workerId: 'workspace-retry-test', limit: 1, leaseMs: 30_000 });
  assert.equal(claimed.length, 1);
  assert.equal(await store.retryAutoReplyOutbox({ id: claimed[0]!.id, workerId: 'workspace-retry-test', errorCode: 'EXTERNAL_TIMEOUT', errorDigest: 'digest', availableAt: new Date().toISOString() }), true);
  const result = await service.retryRun({ adminId: admin.id, runId: created.run.id, requestId: 'req-retry', traceId: 'trace-retry' });
  assert.equal(result.run.status, 'retrying');
  assert.equal(result.outbox.idempotencyKey, confirmed.outbox.idempotencyKey);
  assert.equal(result.outbox.status, 'pending');
  assert.equal((await store.listAutoReplyOutboxByAggregate(`workspace:${admin.id}:${account.id}`, created.run.id)).length, 1);
});
