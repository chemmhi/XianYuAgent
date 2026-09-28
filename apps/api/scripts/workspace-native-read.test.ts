import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryStore } from '../src/store-memory.js';
import { executeNativeWorkspaceRead, detectNativeWorkspaceRead } from '../src/workspace-native-read.js';
import { PiRuntimeAdapter } from '../src/pi-runtime.js';
import { InProcessAgentRuntime } from '../src/workspace.js';

async function fixture() {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'workspace-native-read@example.com', passwordHash: 'hash', displayName: 'Workspace Native Read' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'native-read-seller', displayName: '原生读取账号' });
  const product = await store.createProduct({ adminId: admin.id, accountId: account.id, title: 'Workspace 原生商品', description: '数字资料', priceMinor: 1_990, status: 'published' });
  const batch = await store.createCouponBatch({ adminId: admin.id, accountId: account.id, label: '原生卡券批次', purpose: 'text', metadata: { note: '仅管理员可见' } });
  await store.importCouponItems({ adminId: admin.id, batchId: batch.id, contents: ['SECRET-CODE-1', 'SECRET-CODE-2'] });
  await store.bindCouponBatch({ adminId: admin.id, batchId: batch.id, productId: product.id });
  await store.createOrder({ adminId: admin.id, order: { orderNo: 'NATIVE-ORDER-1', accountId: account.id, accountName: account.displayName, buyerId: 'buyer-1', buyerName: '买家一', itemId: product.externalProductRef ?? product.id, itemTitle: product.title, amountMinor: 1_990, paymentStatus: 'paid', orderStatus: 'open', deliveryStatus: 'pending', afterSalesStatus: 'none', deliveryType: 'coupon_only', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), productId: product.id } });
  const conversation = await store.createConversation({ adminId: admin.id, accountId: account.id, buyerRef: 'buyer-1', buyerDisplayName: '买家一', itemTitle: product.title });
  const inbound = await store.createMessage({ adminId: admin.id, conversationId: conversation.id, direction: 'inbound', senderRole: 'buyer', bodyType: 'text', bodyText: '有货吗', source: 'human' });
  const autoReplyRun = await store.createAutoReplyRun({ adminId: admin.id, accountId: account.id, conversationId: conversation.id, inboundMessageId: inbound.message.id, intent: 'availability', decision: 'replied', status: 'received', inputDigest: 'sha256:input' });
  await store.updateAutoReplyRun(autoReplyRun.id, { status: 'generated' });
  await store.updateAutoReplyRun(autoReplyRun.id, { status: 'persisted', senderOutcome: 'known_success' });
  return { store, admin, account, product, batch };
}

test('native workspace read routes only supported read intents', () => {
  assert.equal(detectNativeWorkspaceRead('查看当前账号的商品'), 'products');
  assert.equal(detectNativeWorkspaceRead('有哪些可用卡券'), 'coupons');
  assert.equal(detectNativeWorkspaceRead('最近的订单和未发货订单'), 'orders');
  assert.equal(detectNativeWorkspaceRead('查看今天 Agent 运营数据'), 'agent_activity');
  assert.equal(detectNativeWorkspaceRead('发布商品'), undefined);
  assert.equal(detectNativeWorkspaceRead('新增卡券'), undefined);
  assert.equal(detectNativeWorkspaceRead('修改自动回复配置'), undefined);
});

test('native workspace read returns safe product, coupon, order and activity summaries', async () => {
  const { store, admin, account } = await fixture();
  const products = await executeNativeWorkspaceRead({ store, adminId: admin.id, accountId: account.id, instruction: '查看当前账号的商品' });
  assert.equal(products?.kind, 'products');
  assert.match(products?.content ?? '', /Workspace 原生商品/);
  const coupons = await executeNativeWorkspaceRead({ store, adminId: admin.id, accountId: account.id, instruction: '有哪些可用卡券' });
  assert.equal(coupons?.kind, 'coupons');
  assert.match(coupons?.content ?? '', /原生卡券批次/);
  assert.doesNotMatch(coupons?.content ?? '', /SECRET-CODE-1/);
  const orders = await executeNativeWorkspaceRead({ store, adminId: admin.id, accountId: account.id, instruction: '最近的订单和未发货订单' });
  assert.equal(orders?.kind, 'orders');
  assert.match(orders?.content ?? '', /NATIVE-ORDER-1/);
  const activity = await executeNativeWorkspaceRead({ store, adminId: admin.id, accountId: account.id, instruction: '查看今天 Agent 运营数据' });
  assert.equal(activity?.kind, 'agent_activity');
  assert.match(activity?.content ?? '', /收到 1 条消息/);
});

test('native workspace read enforces account scope', async () => {
  const { store, admin, account } = await fixture();
  await assert.rejects(() => executeNativeWorkspaceRead({ store, adminId: admin.id, accountId: '11111111-1111-4111-8111-111111111111', instruction: '查看商品' }), /ACCOUNT_SCOPE_FORBIDDEN/);
  assert.ok(account.id);
});

test('Pi runtime persists native read results without calling the model', async () => {
  const { store, admin, account } = await fixture();
  const session = await store.createAgentSession({ adminId: admin.id, accountId: account.id, title: '原生读取会话' });
  const created = await store.createRun({ adminId: admin.id, accountId: account.id, sessionId: session.id, instruction: '查看当前账号的商品', clientRunRef: 'native-read-run' });
  assert.equal((await executeNativeWorkspaceRead({ store, adminId: admin.id, accountId: account.id, instruction: created.run.instruction }))?.kind, 'products');
  let modelCalled = false;
  const model = { async complete() { modelCalled = true; throw new Error('model must not be called for native read'); } };
  const adapter = new PiRuntimeAdapter(store, model, { model: 'test-model', messageSink: async (message) => { await store.appendWorkspaceMessage({ adminId: message.adminId ?? admin.id, sessionId: message.sessionId, runId: message.runId, type: message.messageType, content: message.content, summary: message.summary }); } });
  adapter.enqueue({ adminId: admin.id, sessionId: session.id, run: created.run, steps: created.steps });
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const run = await store.getRun(admin.id, created.run.id);
    if (run?.run.status === 'succeeded') break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const run = await store.getRun(admin.id, created.run.id);
  assert.equal(modelCalled, false);
  assert.equal(run?.run.status, 'succeeded');
  const messages = await store.listWorkspaceMessages(admin.id, session.id, 20);
  assert.ok(messages.some((message) => message.type === 'final_answer' && /Workspace 原生商品/.test(message.content)));
  const events = await store.listRunEvents(admin.id, created.run.id, 0);
  assert.ok(events.some((event) => event.eventType === 'workspace.native_read'));
});

test('in-process runtime emits native result content for the Workspace surface', async () => {
  const { store, admin, account } = await fixture();
  const session = await store.createAgentSession({ adminId: admin.id, accountId: account.id, title: '原生读取会话' });
  const created = await store.createRun({ adminId: admin.id, accountId: account.id, sessionId: session.id, instruction: '查看当前账号的商品', clientRunRef: 'native-read-in-process-run' });
  new InProcessAgentRuntime(store).enqueue({ adminId: admin.id, sessionId: session.id, run: created.run, steps: created.steps });
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const run = await store.getRun(admin.id, created.run.id);
    if (run?.run.status === 'succeeded') break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const events = await store.listRunEvents(admin.id, created.run.id, 0);
  const nativeEvent = events.find((event) => event.eventType === 'workspace.native_read');
  const succeededEvent = events.find((event) => event.eventType === 'run.succeeded');
  assert.match(String(nativeEvent?.payload.content ?? ''), /Workspace 原生商品/);
  assert.match(String(succeededEvent?.payload.content ?? ''), /Workspace 原生商品/);
});

