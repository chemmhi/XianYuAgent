import assert from 'node:assert/strict';
import test from 'node:test';
import { CouponAssetService } from '../src/coupon-assets.js';
import { CouponService } from '../src/services.js';
import { MemoryObjectStorage } from '../src/object-storage.js';
import { InProcessAgentRuntime, WorkspaceService, type WorkspaceRuntime } from '../src/workspace.js';
import { MemoryStore } from '../src/store-memory.js';
import { detectNativeWorkspaceWrite, parseNativeWorkspaceCouponCreate, prepareNativeWorkspaceWrite, sanitizeWorkspaceInstruction } from '../src/workspace-native-write.js';

async function fixture(instruction: string) {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: `workspace-coupon-${Math.random()}@example.com`, passwordHash: 'hash', displayName: 'Workspace Coupon' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: `coupon-${Math.random()}`, displayName: '卡券账号' });
  const session = await store.createAgentSession({ adminId: admin.id, accountId: account.id, title: '卡券会话' });
  const created = await store.createRun({ adminId: admin.id, accountId: account.id, sessionId: session.id, instruction, clientRunRef: `coupon-${Math.random()}` });
  const coupons = new CouponService(store, async () => 'audit-coupon', new CouponAssetService(store, new MemoryObjectStorage()));
  return { store, admin, account, session, created, coupons };
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

test('native coupon parser supports text and data modes while redacting content', async () => {
  const instruction = '新增卡券；名称：会员资料包；类型：批量数据；内容：A-001\nB-002；备注：内部交付';
  assert.equal(detectNativeWorkspaceWrite(instruction), 'coupon_create');
  const parsed = parseNativeWorkspaceCouponCreate(instruction);
  assert.deepEqual(parsed?.items, ['A-001', 'B-002']);
  assert.equal(parsed?.metadata.description, '内部交付');
  const { store, admin, account } = await fixture(instruction);
  const plan = await prepareNativeWorkspaceWrite({ store, adminId: admin.id, accountId: account.id, instruction });
  assert.equal(plan?.action, 'coupon_create');
  assert.equal(plan?.manifest.label, '会员资料包');
  assert.equal(plan?.manifest.itemCount, 2);
  assert.equal(plan?.manifest.redacted, true);
  assert.equal(JSON.stringify(plan?.manifest).includes('A-001'), false);
  assert.equal(plan?.content.includes('A-001'), false);
});

test('natural-language coupon creation extracts label and content from one sentence', async () => {
  const instruction = '帮我新建一个测试卡券，卡券内容为”测试内容“';
  assert.equal(detectNativeWorkspaceWrite(instruction), 'coupon_create');
  const parsed = parseNativeWorkspaceCouponCreate(instruction);
  assert.equal(parsed?.label, '测试卡券');
  assert.equal(parsed?.purpose, 'text');
  assert.equal(parsed?.metadata.textContent, '测试内容');
  assert.match(sanitizeWorkspaceInstruction(instruction), /测试卡券/);
  assert.doesNotMatch(sanitizeWorkspaceInstruction(instruction), /测试内容/);

  const { store, admin, account } = await fixture(instruction);
  const plan = await prepareNativeWorkspaceWrite({ store, adminId: admin.id, accountId: account.id, instruction });
  assert.equal(plan?.action, 'coupon_create');
  assert.equal(plan?.manifest.label, '测试卡券');
  assert.equal(plan?.manifest.itemCount, 0);
  assert.equal(plan?.manifest.configured, true);
  assert.deepEqual(plan?.executionPlan, { action: 'coupon_create', accountId: account.id, label: '测试卡券', purpose: 'text', metadata: { textContent: '测试内容' }, items: [] });
});

test('workspace coupon parser accepts the manual form metadata fields', () => {
  const parsed = parseNativeWorkspaceCouponCreate('新建卡券；名称：API 测试；类型：API接口；接口：https://example.test/cards；请求方法：POST；超时时间：45；请求头：{"Authorization":"Bearer token"}；请求参数：{"count":1}；响应取值字段：data.card；延时发货时间：30；费用承担：dealer；最低售价：9.9；投放可见性：dealer_only；多规格：true；规格名称：套餐；规格值：30天');
  assert.equal(parsed?.label, 'API 测试');
  assert.equal(parsed?.purpose, 'api');
  assert.deepEqual(parsed?.metadata.apiConfig, { url: 'https://example.test/cards', method: 'POST', timeout: 45, headers: '{"Authorization":"Bearer token"}', params: '{"count":1}', responseField: 'data.card' });
  assert.equal(parsed?.metadata.delaySeconds, 30);
  assert.equal(parsed?.metadata.feePayer, 'dealer');
  assert.equal(parsed?.metadata.minPrice, '9.9');
  assert.equal(parsed?.metadata.dockVisibility, 'dealer_only');
  assert.equal(parsed?.metadata.multiSpec, true);
  assert.equal(parsed?.metadata.specName, '套餐');
  assert.equal(parsed?.metadata.specValue, '30天');
});

test('workspace coupon confirmation creates a native batch and completed local outbox', async () => {
  const secret = '会员码-ONLY-SERVER';
  const instruction = `新增卡券；名称：会员资料包；类型：固定文字；内容：${secret}`;
  const { store, admin, account, session, created, coupons } = await fixture(instruction);
  new InProcessAgentRuntime(store).enqueue({ adminId: admin.id, sessionId: session.id, run: created.run, steps: created.steps });
  await waitForStatus(store, admin.id, created.run.id, 'waiting_confirmation');
  const confirmation = await store.getWorkspaceConfirmation(admin.id, created.run.id);
  assert.ok(confirmation);
  assert.equal(confirmation?.action, 'coupon_create');
  assert.equal(JSON.stringify(confirmation?.manifest).includes(secret), false);
  const messagesBefore = await store.listWorkspaceMessages(admin.id, session.id);
  assert.equal(messagesBefore.some((message) => message.content.includes(secret)), false);

  const service = new WorkspaceService(store, new InProcessAgentRuntime(store), async () => 'audit-confirm-coupon', coupons);
  const result = await service.confirmRun({ adminId: admin.id, runId: created.run.id, expectedVersion: confirmation!.version, requestId: 'req-coupon-confirm', traceId: 'trace-coupon-confirm' });
  assert.equal(result.confirmation.status, 'confirmed');
  assert.equal(result.run.status, 'succeeded');
  assert.equal(result.outbox.status, 'succeeded');
  assert.equal(result.outbox.operation, 'coupon_create');

  const page = await coupons.list(admin.id, { accountId: account.id, page: 1, pageSize: 10 });
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0]?.label, '会员资料包');
  const detail = await coupons.get(admin.id, String(page.items[0]?.batchId));
  assert.equal((detail.metadata as { textContent?: string } | undefined)?.textContent, secret);
  const messagesAfter = await store.listWorkspaceMessages(admin.id, session.id);
  assert.equal(messagesAfter.some((message) => message.content.includes(secret)), false);
  assert.equal((await store.listRunEvents(admin.id, created.run.id)).some((event) => JSON.stringify(event.payload).includes(secret)), false);
  await assert.rejects(() => service.confirmRun({ adminId: admin.id, runId: created.run.id, expectedVersion: confirmation!.version, requestId: 'req-coupon-replay', traceId: 'trace-coupon-replay' }), /not waiting for confirmation|no longer active/);
});

test('workspace data coupon confirmation imports each line without exposing values', async () => {
  const instruction = '创建卡券；名称：兑换码批次；类型：批量数据；内容：CODE-001\nCODE-002';
  const { store, admin, account, session, created, coupons } = await fixture(instruction);
  new InProcessAgentRuntime(store).enqueue({ adminId: admin.id, sessionId: session.id, run: created.run, steps: created.steps });
  await waitForStatus(store, admin.id, created.run.id, 'waiting_confirmation');
  const confirmation = await store.getWorkspaceConfirmation(admin.id, created.run.id);
  const service = new WorkspaceService(store, new InProcessAgentRuntime(store), async () => 'audit-data-coupon', coupons);
  await service.confirmRun({ adminId: admin.id, runId: created.run.id, expectedVersion: confirmation!.version, requestId: 'req-data-coupon', traceId: 'trace-data-coupon' });
  const page = await coupons.list(admin.id, { accountId: account.id, page: 1, pageSize: 10 });
  const detail = await coupons.get(admin.id, String(page.items[0]?.batchId));
  assert.equal(detail.items?.length, 2);
  assert.equal((await store.listWorkspaceMessages(admin.id, session.id)).some((message) => message.content.includes('CODE-001')), false);
});

test('coupon confirmation hands the result back to Pi before finalizing the run', async () => {
  const instruction = '用“测试商品”这个商品创建一个卡券，关联商品并启动自动发货';
  const { store, admin, account, session, created, coupons } = await fixture(instruction);
  new InProcessAgentRuntime(store).enqueue({ adminId: admin.id, sessionId: session.id, run: created.run, steps: created.steps });
  await waitForStatus(store, admin.id, created.run.id, 'waiting_confirmation');
  const confirmation = await store.getWorkspaceConfirmation(admin.id, created.run.id);
  assert.ok(confirmation);

  const continuationInputs: Array<{ history?: Array<{ role: string; content: string }> }> = [];
  const runtime: WorkspaceRuntime = {
    enqueue: () => undefined,
    async resume() { return undefined; },
    async continueAfterConfirmation(input) {
      continuationInputs.push({ history: input.history });
    },
    cancel: () => undefined,
    stop: () => undefined,
  };
  const service = new WorkspaceService(store, runtime, async () => 'audit-pi-continuation', coupons);
  const result = await service.confirmRun({ adminId: admin.id, runId: created.run.id, expectedVersion: confirmation!.version, requestId: 'req-pi-continuation', traceId: 'trace-pi-continuation' });

  assert.equal(result.run.status, 'executing');
  assert.equal(continuationInputs.length, 1);
  const messages = await store.listWorkspaceMessages(admin.id, session.id);
  assert.equal(messages.some((message) => message.runId === created.run.id && message.type === 'final_answer'), false);
  const toolEvent = messages.find((message) => message.runId === created.run.id && message.type === 'tool_event' && message.content.includes('"batchId"'));
  assert.ok(toolEvent);
  assert.match(toolEvent?.content ?? '', /"action":"coupon_create"/);
  assert.match(String(continuationInputs[0]?.history?.at(-1)?.content), /batchId/);
  assert.equal(account.id, created.run.accountId);
});
