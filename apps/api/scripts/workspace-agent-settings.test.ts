import assert from 'node:assert/strict';
import test from 'node:test';
import { AutoReplyAgentSettingsService, DEFAULT_AUTO_REPLY_AGENT_CONFIG } from '../src/auto-reply-agent-settings.js';
import { CouponAssetService } from '../src/coupon-assets.js';
import { CouponService } from '../src/services.js';
import { MemoryObjectStorage } from '../src/object-storage.js';
import { InProcessAgentRuntime, WorkspaceService } from '../src/workspace.js';
import { MemoryStore } from '../src/store-memory.js';
import { detectNativeWorkspaceWrite, parseNativeWorkspaceAgentSettingsUpdate, prepareNativeWorkspaceWrite } from '../src/workspace-native-write.js';

async function fixture(instruction: string) {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: `workspace-agent-${Math.random()}@example.com`, passwordHash: 'hash', displayName: 'Workspace Agent Settings' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: `agent-${Math.random()}`, displayName: '配置账号' });
  const session = await store.createAgentSession({ adminId: admin.id, accountId: account.id, title: '配置会话' });
  const created = await store.createRun({ adminId: admin.id, accountId: account.id, sessionId: session.id, instruction, clientRunRef: `agent-${Math.random()}` });
  const coupons = new CouponService(store, async () => 'audit-coupon', new CouponAssetService(store, new MemoryObjectStorage()));
  const settings = new AutoReplyAgentSettingsService(store, DEFAULT_AUTO_REPLY_AGENT_CONFIG, async () => 'audit-agent-settings');
  return { store, admin, account, session, created, coupons, settings };
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

test('native Agent settings parser supports safe operational fields and redacts prompt content', async () => {
  const instruction = '修改自动回复配置；启用：否；最大循环次数：6；发送延迟：12秒；发送模式：模拟发送；系统提示词：不要进入 Workspace';
  assert.equal(detectNativeWorkspaceWrite(instruction), 'agent_settings_update');
  const parsed = parseNativeWorkspaceAgentSettingsUpdate(instruction);
  assert.deepEqual(parsed?.patch, { enabled: false, maxLoops: 6, sendDelaySeconds: 12, sendMode: 'simulate' });
  assert.equal(JSON.stringify(parsed).includes('不要进入 Workspace'), false);
  const { store, admin, account } = await fixture(instruction);
  const plan = await prepareNativeWorkspaceWrite({ store, adminId: admin.id, accountId: account.id, instruction });
  assert.equal(plan?.action, 'agent_settings_update');
  assert.equal(plan?.policyRef, 'agent.settings.update.confirm');
  assert.equal(plan?.manifest.expectedVersion, 0);
  assert.equal(JSON.stringify(plan?.manifest).includes('不要进入 Workspace'), false);
  assert.equal(plan?.content.includes('不要进入 Workspace'), false);
  const milliseconds = parseNativeWorkspaceAgentSettingsUpdate('调整自动回复 Agent；发送延迟：12000毫秒');
  assert.equal(milliseconds?.patch.sendDelaySeconds, 12);
});

test('Workspace Agent settings confirmation updates config and completes local outbox', async () => {
  const instruction = '修改自动回复配置；启用：否；最大循环次数：6；发送延迟：12秒';
  const { store, admin, account, session, created, coupons, settings } = await fixture(instruction);
  new InProcessAgentRuntime(store).enqueue({ adminId: admin.id, sessionId: session.id, run: created.run, steps: created.steps });
  await waitForStatus(store, admin.id, created.run.id, 'waiting_confirmation');
  const confirmation = await store.getWorkspaceConfirmation(admin.id, created.run.id);
  assert.ok(confirmation);
  assert.equal(confirmation?.action, 'agent_settings_update');
  assert.equal(confirmation?.manifest.expectedVersion, 0);
  const service = new WorkspaceService(store, new InProcessAgentRuntime(store), async () => 'audit-workspace-agent', coupons, settings);
  const result = await service.confirmRun({ adminId: admin.id, runId: created.run.id, expectedVersion: confirmation!.version, requestId: 'req-agent-confirm', traceId: 'trace-agent-confirm' });
  assert.equal(result.confirmation.status, 'confirmed');
  assert.equal(result.run.status, 'succeeded');
  assert.equal(result.outbox.status, 'succeeded');
  assert.equal(result.outbox.operation, 'agent_settings_update');
  const saved = await settings.get(admin.id, account.id);
  assert.equal(saved.configVersion, 1);
  assert.equal(saved.enabled, false);
  assert.equal(saved.maxLoops, 6);
  assert.equal(saved.sendDelaySeconds, 12);
  const messages = await store.listWorkspaceMessages(admin.id, session.id);
  assert.equal(messages.some((message) => message.content.includes('系统提示词')), false);
  assert.equal((await store.listRunEvents(admin.id, created.run.id)).some((event) => JSON.stringify(event.payload).includes('系统提示词')), false);
  await assert.rejects(() => service.confirmRun({ adminId: admin.id, runId: created.run.id, expectedVersion: confirmation!.version, requestId: 'req-agent-replay', traceId: 'trace-agent-replay' }), /not waiting for confirmation|no longer active/);
});

test('Workspace Agent settings confirmation rejects a stale config version before consuming confirmation', async () => {
  const instruction = '修改自动回复配置；最大循环次数：7';
  const { store, admin, account, session, created, coupons, settings } = await fixture(instruction);
  new InProcessAgentRuntime(store).enqueue({ adminId: admin.id, sessionId: session.id, run: created.run, steps: created.steps });
  await waitForStatus(store, admin.id, created.run.id, 'waiting_confirmation');
  const confirmation = await store.getWorkspaceConfirmation(admin.id, created.run.id);
  await settings.update({ adminId: admin.id, accountId: account.id, expectedVersion: 0, patch: { maxLoops: 5 }, requestId: 'req-external-update', traceId: 'trace-external-update' });
  const service = new WorkspaceService(store, new InProcessAgentRuntime(store), async () => 'audit-workspace-agent', coupons, settings);
  await assert.rejects(() => service.confirmRun({ adminId: admin.id, runId: created.run.id, expectedVersion: confirmation!.version, requestId: 'req-agent-stale', traceId: 'trace-agent-stale' }), /version changed/);
  assert.equal((await store.getWorkspaceConfirmation(admin.id, created.run.id))?.status, 'active');
  assert.equal((await store.getRun(admin.id, created.run.id))?.run.status, 'waiting_confirmation');
});
