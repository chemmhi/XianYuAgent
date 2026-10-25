import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fixture } from './test-support.mjs';
import { WorkspaceCommandOrchestrator } from '../../src/workspace-commands.ts';

for (const kind of ['memory', 'postgres']) test(kind + ': a pre-existing run cannot execute another user tool or confirmation after losing access', async t => {
  const f = await fixture(kind, { AGENT_RUNTIME: 'in-process' }); t.after(() => f.close());
  const owner = await f.actor('run-owner@example.com');
  const user = await f.actor('run-user@example.com', 'user');
  const other = await f.actor('run-other@example.com', 'user');
  const account = await f.runtime.store.createAccount({ adminId: user.id, platform: 'xianyu', sellerRef: 'run-access-account' });
  await f.runtime.store.grantScope({ adminId: other.id, accountId: account.id, scope: 'write' });
  const session = await f.runtime.workspace.createSession({ adminId: user.id, accountId: account.id, title: 'Old Run', requestId: 'create-session', traceId: 'access-run' });
  const input = { adminId: user.id, accountId: account.id, sessionId: session.id, instruction: '新增卡券；名称：授权生命周期卡券；类型：固定文字；内容：隔离卡密', requestId: 'start', traceId: 'access-run' };
  const started = await f.runtime.workspace.startRun(input);
  const deadline = Date.now() + 3000;
  let confirmation;
  while (Date.now() < deadline) { confirmation = await f.runtime.store.getWorkspaceConfirmation(user.id, started.run.runId); if (confirmation) break; await delay(10); }
  assert.ok(confirmation, 'original authorized run reaches write confirmation');
  const plan = await f.runtime.workspaceCommands.prepareWrite({ ...input, operation: 'coupon_create', parameters: { label: '工具卡券', purpose: 'text', textContent: '工具内容' } });
  const bundle = await f.runtime.store.getRun(user.id, started.run.runId);
  await f.runtime.store.setInviteStatus(owner.id, user.inviteId, 'disabled');
  const denied = error => error.code === 'INVITE_ACCESS_DISABLED';
  await assert.rejects(() => f.runtime.workspace.startRun({ ...input, clientRunRef: 'disabled-run' }), denied);
  assert.equal(await f.runtime.store.findRunByClientRef(user.id, account.id, 'disabled-run'), undefined);
  await assert.rejects(() => f.runtime.workspace.confirmRun({ adminId: user.id, runId: started.run.runId, expectedVersion: confirmation.version, requestId: 'confirm-disabled', traceId: 'access-run' }), denied);
  await assert.rejects(() => f.runtime.workspace.reconnectRun({ adminId: user.id, runId: started.run.runId, requestId: 'reconnect-disabled', traceId: 'access-run' }), denied);
  await assert.rejects(() => f.runtime.workspace.retryRun({ adminId: user.id, runId: started.run.runId, requestId: 'retry-disabled', traceId: 'access-run' }), denied);
  await assert.rejects(() => f.runtime.workspaceCommands.executeModelTool('workspace_prepare_write', { operation: 'coupon_create', parameters: { label: '工具卡券', purpose: 'text', textContent: '工具内容' } }, input), denied);
  await assert.rejects(() => f.runtime.workspaceCommands.execute({ ...input, instruction: '查询商品' }), denied);
  await assert.rejects(() => f.runtime.workspaceCommands.confirm({ plan, run: bundle.run, step: bundle.steps[0], adminId: user.id, requestId: 'old-tool', traceId: 'access-run' }), denied);
  assert.equal((await f.runtime.store.listCouponBatches(other.id, { accountId: account.id })).items.length, 0);
  assert.equal((await f.runtime.store.getWorkspaceConfirmation(user.id, started.run.runId)).status, 'active');
  assert.equal((await f.runtime.store.listAutoReplyOutboxByAggregate(`workspace:${user.id}:${account.id}`, started.run.runId)).length, 0);
  await f.runtime.workspaceCommands.prepareWrite({ ...input, adminId: other.id, operation: 'coupon_create', parameters: { label: '其他用户卡券', purpose: 'text', textContent: '其他用户内容' } });
  await f.runtime.store.setInviteStatus(owner.id, user.inviteId, 'active');
  const completed = await f.runtime.workspace.confirmRun({ adminId: user.id, runId: started.run.runId, expectedVersion: confirmation.version, requestId: 'confirm-restored', traceId: 'access-run' });
  assert.equal(completed.confirmation.status, 'confirmed');
  assert.equal((await f.runtime.store.listCouponBatches(user.id, { accountId: account.id })).items.length, 1);
  let published = 0;
  const product = { id: 'deferred-product', accountId: account.id, status: 'draft', title: 'Delayed Publish', priceMinor: 100, assets: [{ id: 'asset', status: 'active', storageKey: 'image.jpg' }] };
  const commands = new WorkspaceCommandOrchestrator({
    ...f.runtime,
    assertActorAccess: id => f.runtime.auth.assertActorAccess(id),
    products: { get: async () => product },
    objectStorage: { getObject: async () => { await f.runtime.store.setInviteStatus(owner.id, user.inviteId, 'disabled'); return { contentType: 'image/jpeg', body: Buffer.from('test-image') }; } },
    productPublisher: { publish: async () => { published += 1; throw new Error('unauthorized external request'); } },
  });
  await assert.rejects(() => commands.confirm({ adminId: user.id, plan: { manifest: { action: 'product_publish', productId: product.id, accountId: account.id } }, run: bundle.run, step: bundle.steps[0], requestId: 'deferred-publish', traceId: 'access-run' }), denied);
  assert.equal(published, 0, 'revocation during image preparation must block the external publish call');
  await f.runtime.store.setInviteStatus(owner.id, user.inviteId, 'active');
  const originalPrepare = f.runtime.workspaceCommands.prepareWrite.bind(f.runtime.workspaceCommands);
  let releasePrepare, enteredPrepare;
  const waiting = new Promise(resolve => { releasePrepare = resolve; });
  const entered = new Promise(resolve => { enteredPrepare = resolve; });
  f.runtime.workspaceCommands.prepareWrite = async params => { enteredPrepare(); await waiting; return originalPrepare(params); };
  const queued = await f.runtime.workspace.startRun({ ...input, instruction: '查询商品', clientRunRef: 'queued-before-disable' });
  await Promise.race([entered, delay(3000).then(() => { throw new Error('queued runtime never reached its first tool'); })]);
  await f.runtime.store.setInviteStatus(owner.id, user.inviteId, 'disabled');
  releasePrepare();
  const failedDeadline = Date.now() + 3000;
  let failed;
  while (Date.now() < failedDeadline) {
    failed = await f.runtime.store.getRun(user.id, queued.run.runId);
    const events = await f.runtime.store.listRunEvents(user.id, queued.run.runId);
    if (failed?.run.status === 'failed' && failed.steps[0]?.status === 'failed' && events.some(event => event.eventType === 'run.failed')) break;
    await delay(10);
  }
  assert.equal(failed?.run.status, 'failed', 'a denied asynchronous tool must persist failure without an unhandled rejection');
  assert.equal(failed.run.errorCode, 'INVITE_ACCESS_DISABLED');
  assert.equal(failed.steps[0].status, 'failed');
  assert.equal((await f.runtime.store.listCouponBatches(other.id, { accountId: account.id })).items.length, 1);
});
