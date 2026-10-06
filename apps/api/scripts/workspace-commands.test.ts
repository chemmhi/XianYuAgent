import assert from 'node:assert/strict';
import test from 'node:test';
import { WorkspaceCommandOrchestrator, detectCommand } from '../src/workspace-commands.js';
import { MemoryStore } from '../src/store-memory.js';
import { InProcessAgentRuntime, WorkspaceService } from '../src/workspace.js';

function orchestrator(overrides: Record<string, unknown> = {}) {
  const base = {
    store: { hasAccountScope: async () => true, getCouponBatch: async () => undefined },
    accounts: { list: async () => ({ items: [], page: 1, pageSize: 100, total: 0, totalPages: 0 }) },
    products: { get: async (_adminId: string, productId: string) => ({ id: productId, accountId: 'account-1', title: '测试商品', configVersion: 2, knowledgeBase: '已有知识库' }) },
    productSync: { sync: async () => ({ syncRunId: 'sync-1', accountId: 'account-1', fetchedCount: 2, createdCount: 1, updatedCount: 1, skippedLocalDraftCount: 0, pagesFetched: 1, pageNumber: 1, pageSize: 20, hasMore: false, items: [] }) },
    productKnowledgeBase: {},
    productAutomation: { get: async () => ({ configVersion: 1, product: { title: '测试商品' }, config: { paidAutoDelivery: { enabled: true }, unpaidAutoReprice: { enabled: false }, reviewGift: { enabled: false }, reviewReminder: { enabled: true } } }), update: async () => ({ configVersion: 2, config: {} }) },
    coupons: { update: async (_input: unknown) => ({ status: 'active', batchId: 'batch-1' }), bind: async () => ({}), unbind: async () => ({}), void: async () => ({}), create: async () => ({ batchId: 'batch-copy' }), importItems: async () => ({}) },
    orders: { refresh: async () => ({ syncRunId: 'order-sync-1', accountId: 'account-1', fetchedCount: 3, createdCount: 2, updatedCount: 1, deletedCount: 0, pagesFetched: 1, hasMore: false, items: [] }), get: async () => ({ orderNo: 'order-1', itemTitle: '测试商品', paymentStatus: 'paid', deliveryStatus: 'pending', afterSalesStatus: 'none' }) },
    dashboard: { getSnapshot: async () => ({ totalSales: 100, todayOrderAmount: 30, selectedRangeSales: 100, autoProcessRate: 50, pendingManualCount: 1, trend: [], health: [{ label: '监听心跳', value: '需授权', tone: 'warn' }], productRank: [], recentActivity: [], riskTodos: [{ id: 'risk-1', title: '订单待处理', severity: 'high', href: '/orders' }] }) },
    autoReplyActivity: { summary: async () => ({ inboundCount: 2, processingCount: 0, persistedCount: 2, handoffCount: 1, failedCount: 0, skippedCount: 0, completionRate: 1, throughputPerSecond: 0.1, p95DurationMs: 120, from: '', to: '', health: [] }), list: async () => ({ items: [{ id: 'run-1', status: 'generated', stage: 'reply_generation', decision: 'replied' }], page: 1, pageSize: 20, total: 1, totalPages: 1 }), detail: async () => ({ run: { id: 'run-1', status: 'generated', stage: 'reply_generation', decision: 'replied' }, events: [] }) },
    autoReplyAgentSettings: { get: async () => ({ accountId: 'account-1', configVersion: 1, enabled: true, sendMode: 'simulate', maxLoops: 4, maxToolCalls: 8, totalTimeoutMs: 60_000, maxHistory: 20, maxReplyLength: 1000, systemPrompt: 'secret', userPromptTemplate: 'secret' }) },
    openaiSettings: { list: async () => [] },
  };
  return new WorkspaceCommandOrchestrator({ ...base, ...overrides } as never);
}

const input = { adminId: 'admin-1', accountId: 'account-1', requestId: 'req-1', traceId: 'trace-1' };

test('includes the latest workspace run state on session listings', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'workspace-session-status@example.com', passwordHash: 'hash', displayName: 'Workspace Session Status' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'session-status', displayName: 'Session Status' });
  const session = await store.createAgentSession({ adminId: admin.id, accountId: account.id, title: 'Session Status' });
  const created = await store.createRun({ adminId: admin.id, accountId: account.id, sessionId: session.id, instruction: '查看订单' });
  await store.updateRun(created.run.id, { status: 'executing' });

  const listed = await store.listAgentSessions(admin.id, { accountId: account.id });
  assert.equal(listed[0]?.runId, created.run.id);
  assert.equal(listed[0]?.runStatus, 'executing');
});

test('detects workspace takeover command families', () => {
  assert.equal(detectCommand('分析近 7 天经营情况'), 'dashboard');
  assert.equal(detectCommand('刷新商品列表'), 'products');
  assert.equal(detectCommand('查看当前账号的商品'), 'products');
  assert.equal(detectCommand('同步闲鱼订单'), 'orders');
  assert.equal(detectCommand('检查 Agent 工作流程'), 'agent_activity');
  assert.equal(detectCommand('配置 OpenAI-compatible 模型'), 'model_settings');
});

test('executes real service-backed sync commands and returns auditable summaries', async () => {
  const result = await orchestrator().execute({ ...input, instruction: '刷新商品列表' });
  assert.equal(result?.mutation, true);
  assert.equal(result?.operation, 'product_sync');
  assert.match(result?.content ?? '', /同步完成/);
  const dashboard = await orchestrator().execute({ ...input, instruction: '分析近 7 天经营情况' });
  assert.match(dashboard?.content ?? '', /销售额/);
  assert.deepEqual((dashboard?.data as { recommendations?: string[] }).recommendations?.length, 3);
});

test('prepares redacted confirmation plans for coupon and product rules', async () => {
  const commands = orchestrator();
  const coupon = await commands.prepareWrite({ ...input, instruction: '启用卡券 batch-1' });
  assert.equal(coupon?.action, 'coupon_enable');
  assert.equal(coupon?.manifest.redacted, true);
  const automation = await commands.prepareWrite({ ...input, instruction: '更新商品自动化规则 商品:product-1; 配置:{"paidAutoDelivery":{"enabled":false}}' });
  assert.equal(automation?.action, 'product_automation_update');
  assert.equal(automation?.manifest.productId, 'product-1');
});

test('routes natural-language coupon creation without asking for a batch id', async () => {
  const commands = orchestrator();
  const plan = await commands.prepareWrite({ ...input, instruction: '帮我新建一个测试卡券' });
  assert.equal(plan?.action, 'coupon_create');
  assert.equal(plan?.manifest.label, '测试卡券');
  assert.equal(plan?.manifest.redacted, true);
});

test('resolves numeric external product refs and builds a disable-all automation patch', async () => {
  const product = { id: 'product-108244', accountId: 'account-1', externalProductRef: '1082449333831', title: '视频下载及文案提取源码，包教包会', configVersion: 4 };
  let updatedConfig: unknown;
  const commands = orchestrator({
    products: {
      get: async () => product,
      list: async () => ({ items: [product], page: 1, pageSize: 20, total: 1, totalPages: 1 }),
    },
    productAutomation: {
      get: async () => ({ configVersion: 4, product, config: {} }),
      update: async (input: { config: unknown }) => {
        const config = input.config as { paidAutoDelivery?: { couponBatchIds?: string[] }; reviewGift?: { couponBatchIds?: string[] } };
        if ((config.paidAutoDelivery?.couponBatchIds?.length ?? 0) > 0 || (config.reviewGift?.couponBatchIds?.length ?? 0) > 0) throw new Error('coupon batch is voided');
        updatedConfig = input.config;
        return { configVersion: 5, config: input.config };
      },
    },
  });
  const plan = await commands.prepareWrite({ ...input, instruction: '帮我取消 1082449333831 这个商品的自动化规则' });
  assert.equal(plan?.action, 'product_automation_update');
  assert.equal(plan?.manifest.productId, product.id);
  assert.deepEqual(plan?.manifest.config, {
    paidAutoDelivery: { enabled: false, couponBatchIds: [] },
    unpaidAutoReprice: { enabled: false },
    reviewGift: { enabled: false, couponBatchIds: [] },
    reviewReminder: { enabled: false },
  });

  await commands.confirm({ plan: plan!, run: { id: 'run-1', requestedBy: input.adminId, accountId: input.accountId, instruction: '帮我取消 1082449333831 这个商品的自动化规则' } as never, step: {} as never, adminId: input.adminId, requestId: input.requestId, traceId: input.traceId });
  assert.deepEqual(updatedConfig, plan?.manifest.config);
});

test('resolves the exact product title in a natural-language cancellation and filters by name', async () => {
  const product = { id: 'product-title-1', accountId: 'account-1', externalProductRef: '1082449333831', title: '视频下载及文案提取源码，包教包会', configVersion: 7 };
  const queries: Array<Record<string, unknown>> = [];
  const commands = orchestrator({
    products: {
      get: async () => product,
      list: async (_adminId: string, query: Record<string, unknown>) => { queries.push(query); return { items: [product], page: 1, pageSize: 20, total: 1, totalPages: 1 }; },
    },
    productAutomation: { get: async () => ({ configVersion: 7, product, config: {} }), update: async () => ({ configVersion: 8, config: {} }) },
  });

  const plan = await commands.prepareWrite({ ...input, instruction: '帮我取消 视频下载及文案提取源码，包教包会 这个商品的自动化规则' });

  assert.equal(plan?.action, 'product_automation_update');
  assert.equal(plan?.manifest.productId, product.id);
  assert.equal(queries.length, 1);
  assert.equal(queries[0]?.keyword, product.title);
});

test('runs a named product automation cancellation through Workspace confirmation with the automation version', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'workspace-automation-confirm@example.com', passwordHash: 'hash', displayName: 'Workspace Automation Confirm' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'automation-confirm', displayName: 'Automation Confirm' });
  const session = await store.createAgentSession({ adminId: admin.id, accountId: account.id, title: 'Automation Confirm' });
  const product = { id: 'product-title-1', accountId: account.id, externalProductRef: '1082449333831', title: '视频下载及文案提取源码，包教包会', configVersion: 9 };
  let receivedExpectedVersion: number | undefined;
  const commands = orchestrator({
    store,
    products: {
      get: async () => product,
      list: async () => ({ items: [product], page: 1, pageSize: 20, total: 1, totalPages: 1 }),
    },
    productAutomation: {
      get: async () => ({ configVersion: 2, product, config: {} }),
      update: async (input: { expectedConfigVersion: number; config: unknown }) => {
        receivedExpectedVersion = input.expectedConfigVersion;
        if (input.expectedConfigVersion !== 2) throw new Error('AUTOMATION_VERSION_CONFLICT');
        return { configVersion: 3, config: input.config };
      },
    },
  });
  const created = await store.createRun({ adminId: admin.id, accountId: account.id, sessionId: session.id, instruction: '帮我取消 视频下载及文案提取源码，包教包会 这个商品的自动化规则' });
  const runtime = new InProcessAgentRuntime(store, commands);
  const service = new WorkspaceService(store, runtime, async () => 'audit-automation-confirm', undefined, undefined, commands);
  runtime.enqueue({ adminId: admin.id, sessionId: session.id, run: created.run, steps: created.steps });
  const deadline = Date.now() + 2_000;
  let confirmation;
  while (Date.now() < deadline) {
    confirmation = await store.getWorkspaceConfirmation(admin.id, created.run.id);
    if (confirmation?.status === 'active') break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(confirmation?.action, 'product_automation_update');
  assert.equal(confirmation?.manifest.expectedConfigVersion, 2);

  const result = await service.confirmRun({ adminId: admin.id, runId: created.run.id, expectedVersion: confirmation!.version, requestId: 'req-automation-confirm', traceId: 'trace-automation-confirm' });
  assert.equal(receivedExpectedVersion, 2);
  assert.equal(result.run.status, 'succeeded');
  assert.match(result.run.resultSummary ?? '', /自动化规则已更新/);
});

test('rejects read-tool routing for product mutation instructions', async () => {
  const commands = orchestrator();
  await assert.rejects(
    () => commands.executeModelTool('workspace_read', { instruction: '帮我取消 视频下载及文案提取源码，包教包会 这个商品的自动化规则' }, input),
    (error: unknown) => (error as { code?: string }).code === 'WORKSPACE_WRITE_REQUIRED',
  );
});

test('keeps read-only order analysis out of the mutation guard', async () => {
  const commands = orchestrator({
    store: {
      hasAccountScope: async () => true,
      getCouponBatch: async () => undefined,
      getAutoReplyActivitySummary: async () => ({ inboundCount: 2, processingCount: 0, persistedCount: 2, handoffCount: 0, failedCount: 0, skippedCount: 0, completionRate: 1, throughputPerSecond: 0.1, p95DurationMs: 120, from: '2026-10-06T00:00:00.000Z', to: '2026-10-06T01:00:00.000Z', health: [] }),
    },
  });
  const result = await commands.executeModelTool('workspace_read', { instruction: '分析当前的订单数据，并给出运营建议' }, input);
  assert.equal(result.kind, 'read');
  assert.match(result.title, /运营/);
});

test('rejects broad-read routing for named product lookup instructions', async () => {
  const commands = orchestrator();
  await assert.rejects(
    () => commands.executeModelTool('workspace_read', { instruction: '搜索商品：视频下载及文案提取源码，包教包会' }, input),
    (error: unknown) => (error as { code?: string }).code === 'WORKSPACE_PRODUCT_SEARCH_REQUIRED',
  );
});

test('searches a product by name through the dedicated workspace tool', async () => {
  const product = { id: 'product-search-1', accountId: 'account-1', externalProductRef: '1082449333831', title: '视频下载及文案提取源码，包教包会', configVersion: 1 };
  let query = '';
  const commands = orchestrator({ products: { get: async () => product, list: async (_adminId: string, input: { keyword?: string }) => { query = input.keyword ?? ''; return { items: [product], page: 1, pageSize: 20, total: 1, totalPages: 1 }; } } });
  const result = await commands.executeModelTool('workspace_product_search', { query: product.title }, input);
  assert.equal(query, product.title);
  assert.equal(result.title, '商品搜索');
  assert.match(result.content, /视频下载及文案提取源码/);
});

test('blocks an unready manual delivery before confirmation creation', async () => {
  const commands = orchestrator({
    orderDelivery: {
      preview: async () => ({
        orderNo: 'ORDER-1',
        accountId: 'account-1',
        deliveryType: 'manual',
        state: 'blocked',
        checks: [{ code: 'TRACKING_REF_REQUIRED', status: 'blocked', message: 'tracking reference required' }],
        couponBatchIds: [],
      }),
    },
  });
  await assert.rejects(
    () => commands.prepareWrite({ ...input, instruction: '人工发货 订单号:ORDER-1' }),
    /order delivery preview is blocked/,
  );
});

test('returns agent workflow details without prompt or credential content', async () => {
  const result = await orchestrator().execute({ ...input, instruction: '检查 Agent 工作流程 运行ID:run-1' });
  assert.match(result?.content ?? '', /Run run-1/);
  assert.doesNotMatch(result?.content ?? '', /secret|api[_-]?key|token/i);
});

test('runs a redacted coupon confirmation through Workspace state and outbox', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'workspace-command-confirm@example.com', passwordHash: 'hash', displayName: 'Workspace Confirm' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'seller-confirm', displayName: 'Confirm Account' });
  const batch = await store.createCouponBatch({ adminId: admin.id, accountId: account.id, label: 'Batch', purpose: 'text', metadata: {} });
  const session = await store.createAgentSession({ adminId: admin.id, accountId: account.id, title: 'Confirm' });
  const created = await store.createRun({ adminId: admin.id, accountId: account.id, sessionId: session.id, instruction: `启用卡券 ${batch.id}` });
  let updateCalls = 0;
  const commands = orchestrator({ store, coupons: { update: async () => { updateCalls += 1; return { status: 'active', batchId: batch.id }; }, bind: async () => ({}), unbind: async () => ({}), void: async () => ({}), create: async () => ({ batchId: 'copy' }), importItems: async () => ({}) } });
  const runtime = new InProcessAgentRuntime(store, commands);
  const service = new WorkspaceService(store, runtime, async () => 'audit', undefined, undefined, commands);
  runtime.enqueue({ adminId: admin.id, sessionId: session.id, run: created.run, steps: created.steps });
  const deadline = Date.now() + 2_000;
  let confirmation;
  while (Date.now() < deadline) {
    confirmation = await store.getWorkspaceConfirmation(admin.id, created.run.id);
    if (confirmation?.status === 'active') break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(confirmation?.action, 'coupon_enable');
  const result = await service.confirmRun({ adminId: admin.id, runId: created.run.id, expectedVersion: confirmation!.version, requestId: 'req-confirm', traceId: 'trace-confirm' });
  assert.equal(result.run.status, 'succeeded');
  assert.equal(result.outbox.status, 'succeeded');
  assert.equal(updateCalls, 1);
});

test('routes publish confirmation through ProductPublishService when stored assets exist', async () => {
  let publishCalls = 0;
  const product = { id: 'product-publish-1', accountId: 'account-1', title: '待发布商品', description: '商品描述', categoryCode: 'digital', priceMinor: 12900, status: 'draft', configVersion: 1, attributes: { publish: { postageMode: 'none' } }, assets: [{ id: 'asset-1', productId: 'product-publish-1', storageKey: 'products/product-publish-1/asset-1.png', mimeType: 'image/png', status: 'active' }] };
  const commands = orchestrator({
    store: { hasAccountScope: async () => true, getCouponBatch: async () => undefined, getProduct: async () => product, listProducts: async () => ({ items: [product], page: 1, pageSize: 20, total: 1, totalPages: 1 }) },
    products: { get: async () => product },
    objectStorage: { getObject: async () => ({ key: 'products/product-publish-1/asset-1.png', body: Buffer.from('png'), contentType: 'image/png' }) },
    productPublisher: { publish: async (input: { images: Array<{ data: Buffer }> }) => { publishCalls += 1; assert.equal(input.images.length, 1); return { product, itemId: 'ITEM-PUBLISH-1', itemUrl: 'https://www.goofish.com/item?id=ITEM-PUBLISH-1', imageUrls: ['https://img.example/publish.png'] }; } },
  });
  const plan = await commands.prepareWrite({ ...input, instruction: '发布商品 productId:product-publish-1' });
  assert.equal(plan?.action, 'product_publish');
  assert.equal(await commands.canExecuteProductPublish({ adminId: input.adminId, manifest: plan!.manifest }), true);
  const result = await commands.confirm({ plan: plan!, run: { id: 'run-publish-1', requestedBy: input.adminId, accountId: input.accountId, instruction: '发布商品 productId:product-publish-1' } as never, step: {} as never, adminId: input.adminId, requestId: input.requestId, traceId: input.traceId });
  assert.equal(publishCalls, 1);
  assert.match(result.outputSummary, /ITEM-PUBLISH-1/);
});

test('routes account health and recovery commands through injected account services', async () => {
  let verifyCalls = 0;
  let recoveryCalls = 0;
  const commands = orchestrator({
    verifyAccount: async () => { verifyCalls += 1; return { success: false, accountInvalid: true, errorCode: 'ACCOUNT_EXPIRED' }; },
    startLoginRecovery: async () => { recoveryCalls += 1; return { loginSessionId: 'login-1', accountId: 'account-1', status: 'waiting', expiresAt: '2026-10-05T12:00:00.000Z' }; },
  });
  const health = await commands.execute({ ...input, instruction: '检查账号连接状态' });
  assert.equal(verifyCalls, 1);
  assert.match(health?.content ?? '', /重新授权/);
  const recovery = await commands.execute({ ...input, instruction: '账号失效，创建二维码登录恢复' });
  assert.equal(recoveryCalls, 1);
  assert.match(recovery?.summary ?? '', /login-1/);
});

test('supports filtered product/order reads and redacted delivery preview', async () => {
  const product = { id: 'product-1', accountId: 'account-1', title: '资料包', description: 'desc', categoryCode: 'digital', priceMinor: 1999, status: 'published', configVersion: 2, updatedAt: '2026-10-05T00:00:00.000Z' };
  const order = { orderNo: 'ORDER-1', accountId: 'account-1', itemTitle: '资料包', itemId: 'item-1', amountMinor: 1999, paymentStatus: 'paid', orderStatus: 'open', deliveryStatus: 'pending', afterSalesStatus: 'none', deliveryType: 'coupon_only', productId: 'product-1' };
  const commands = orchestrator({
    products: { get: async () => product, list: async () => ({ items: [product], total: 1 }) },
    productAutomation: { get: async () => ({ configVersion: 3, product: { title: '资料包' }, config: { paidAutoDelivery: { enabled: true, couponBatchIds: ['batch-1'] }, unpaidAutoReprice: { enabled: false }, reviewGift: { enabled: false }, reviewReminder: { enabled: false } } }) },
    orders: { get: async () => order, list: async () => ({ items: [order], total: 1 }) },
    store: { hasAccountScope: async () => true, getCouponBatch: async () => ({ accountId: 'account-1', status: 'active' }) },
  });
  const productResult = await commands.execute({ ...input, instruction: '查询商品 状态:published' });
  assert.equal((productResult?.data as { total?: number }).total, 1);
  const orderResult = await commands.execute({ ...input, instruction: '查询订单 待发货' });
  assert.equal((orderResult?.data as { total?: number }).total, 1);
  const preview = await commands.execute({ ...input, instruction: '预览发货 订单号:ORDER-1' });
  assert.equal((preview?.data as { preview?: { state?: string } }).preview?.state, 'ready');
  assert.doesNotMatch(preview?.content ?? '', /coupon|正文|secret/i);
});

test('model connectivity testing stays read-only', async () => {
  const commands = orchestrator({ openaiSettings: { list: async () => [{ id: 'cfg-1', role: 'primary', provider: 'openai', model: 'gpt', baseUrl: 'https://example.test', apiKeyHint: '***' }], listModels: async () => [{ id: 'gpt' }] } });
  assert.equal(await commands.prepareWrite({ ...input, instruction: '测试 OpenAI-compatible 模型' }), undefined);
  const result = await commands.execute({ ...input, instruction: '测试 OpenAI-compatible 模型' });
  assert.equal((result?.data as { modelCount?: number }).modelCount, 1);
});
