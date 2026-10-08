import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryStore } from '../src/store-memory.js';
import { buildWorkspaceModelMessages, detectWorkspaceResponseLanguage, OpenAICompatibleModelClient, PiModelClientError, PiRuntimeAdapter, type ModelClient, type ModelCompletionResult, type ModelStreamHandlers } from '../src/pi-runtime.js';
import type { WorkspaceCommandOrchestrator } from '../src/workspace-commands.js';
import { createWorkspaceExecutionPlan } from '../src/workspace-context.js';
import { allWorkspaceToolPlanMetadata } from '../src/workspace-tool-plans.js';

const tool = (name: string, description: string, parameters: Record<string, unknown> = {}) => ({
  type: 'function' as const,
  function: { name, description, parameters, plan: allWorkspaceToolPlanMetadata(name) },
});
const planStep = (toolName: string, goal: string, variant = 'default') => ({ tool: toolName, goal, variant, contractVersion: 1 });

function sse(...events: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) controller.enqueue(encoder.encode(event));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

test('OpenAI-compatible chat streaming forwards provider reasoning, text and tool deltas', async () => {
  const client = new OpenAICompatibleModelClient({
    apiKey: 'test-key',
    baseUrl: 'https://model.example/v1',
    model: 'stream-model',
    wireApi: 'chat',
    fetchImpl: async () => sse(
      'data: {"model":"stream-model","choices":[{"delta":{"reasoning_content":"分析 "}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"已读取"}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"workspace_read","arguments":"{\\"instruction\\":\\"查看商品\\"}"}}]},"finish_reason":"tool_calls"}]}\n\n',
      'data: [DONE]\n\n',
    ) as typeof fetch,
  });
  const reasoning: string[] = [];
  const text: string[] = [];
  const deltas: string[] = [];
  const result = await client.stream({ messages: [{ role: 'user', content: '查看商品' }] }, {
    onReasoningDelta: (delta) => { reasoning.push(delta); },
    onTextDelta: (delta) => { text.push(delta); },
    onToolCallDelta: (delta) => { if (delta.argumentsDelta) deltas.push(delta.argumentsDelta); },
  });
  assert.deepEqual(reasoning, ['分析 ']);
  assert.deepEqual(text, ['已读取']);
  assert.equal(result.content, '已读取');
  assert.equal(result.toolCalls?.[0]?.function.name, 'workspace_read');
  assert.deepEqual(deltas, ['{"instruction":"查看商品"}']);
});

test('strict Plan Mode truncates extra tool calls after the current generic step', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'strict-plan-extra@example.com', passwordHash: 'hash', displayName: 'Strict Plan Extra' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'strict-plan-extra' });
  const session = await store.createAgentSession({ adminId: admin.id, accountId: account.id, title: 'Strict plan extra' });
  const instruction = '读取当前配置并完成后续计划';
  const created = await store.createRun({ adminId: admin.id, accountId: account.id, sessionId: session.id, instruction });
  const plan = createWorkspaceExecutionPlan({ instruction, steps: [planStep('workspace_read', '读取当前配置')], toolMetadata: { workspace_read: allWorkspaceToolPlanMetadata('workspace_read')! } })!;
  await store.appendRunEvent({ runId: created.run.id, eventType: 'workspace.plan.created', payload: { status: plan.status, plan } });
  let round = 0;
  let executed = 0;
  let secondRoundMessages: Array<{ role: string; toolCalls?: unknown[] }> = [];
  const readback = { id: 'readback-1', type: 'function' as const, function: { name: 'workspace_read', arguments: JSON.stringify({ instruction: '读取当前配置' }) } };
  const extra = { id: 'extra-1', type: 'function' as const, function: { name: 'workspace_product_search', arguments: JSON.stringify({ query: '不应执行' }) } };
  const model: ModelClient = {
    async complete() { return { content: 'unused', model: 'strict-plan-extra' }; },
    async stream(input) {
      round += 1;
      if (round === 2) secondRoundMessages = input.messages as Array<{ role: string; toolCalls?: unknown[] }>;
      return round === 1 ? { content: '', model: 'strict-plan-extra', toolCalls: [readback, extra] } : { content: '已完成', model: 'strict-plan-extra' };
    },
  };
  const commands = {
    getModelTools: () => [
      tool('workspace_product_search', 'search', { type: 'object' }),
      tool('workspace_read', 'read', { type: 'object' }),
    ],
    executeModelTool: async (name: string) => {
      executed += 1;
      assert.equal(name, 'workspace_read');
      return { kind: 'read' as const, title: '自动发货配置', summary: '读取完成', content: 'paid auto delivery enabled', data: { productId: 'product-1', configVersion: 4, config: { paidAutoDelivery: { enabled: true, couponBatchIds: ['batch-1'] } } } };
    },
  } as unknown as WorkspaceCommandOrchestrator;
  const runtime = new PiRuntimeAdapter(store, model, { workspaceCommands: commands, model: 'strict-plan-extra' });
  try {
    runtime.enqueue({ adminId: admin.id, sessionId: session.id, run: created.run, steps: created.steps });
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline && (await store.getRun(admin.id, created.run.id))?.run.status !== 'succeeded') await new Promise((resolve) => setTimeout(resolve, 10));
    const events = await store.listRunEvents(admin.id, created.run.id, 0);
    assert.equal((await store.getRun(admin.id, created.run.id))?.run.status, 'succeeded');
    assert.equal(executed, 1);
    assert.equal(round, 2);
    assert.equal(events.some((event) => event.eventType === 'tool.call.completed' && event.payload.toolCallId === 'extra-1'), false);
    assert.equal(secondRoundMessages.length > 0, true);
  } finally {
    runtime.stop();
  }
});

test('Pi runtime executes model-selected workspace tools and streams results', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'stream-runtime@example.com', passwordHash: 'hash', displayName: 'Stream Runtime' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'stream-runtime' });
  const session = await store.createAgentSession({ adminId: admin.id, accountId: account.id, title: 'Streaming' });
  const created = await store.createRun({ adminId: admin.id, accountId: account.id, sessionId: session.id, instruction: '查看商品', clientRunRef: 'stream-runtime' });
  let round = 0;
  const requests: Array<{ messages: Array<{ role: string; content: unknown }> }> = [];
  const model: ModelClient = {
    async stream(input, handlers: ModelStreamHandlers): Promise<ModelCompletionResult> {
      requests.push({ messages: input.messages });
      round += 1;
      if (round === 1) {
        await handlers.onReasoningDelta?.('需要读取商品数据');
        const call = { id: 'call-1', type: 'function' as const, function: { name: 'workspace_read', arguments: JSON.stringify({ instruction: '查看商品' }) } };
        await handlers.onToolCallDelta?.({ index: 0, id: call.id, name: 'workspace_read', argumentsDelta: '{"instruction":' });
        await handlers.onToolCallDelta?.({ index: 0, id: call.id, argumentsDelta: '"查看商品"}' });
        await handlers.onToolCall?.(call);
        return { content: '', model: 'stream-model', toolCalls: [call] };
      }
      await handlers.onReasoningDelta?.('根据工具结果整理答案');
      await handlers.onTextDelta?.('商品读取完成');
      return { content: '商品读取完成', model: 'stream-model' };
    },
    async complete() { return { content: 'unused', model: 'unused' }; },
  };
  const commandTool = {
    getModelTools: () => [tool('workspace_read', 'read', { type: 'object' })],
    executeModelTool: async () => ({ kind: 'products' as const, title: '商品', summary: '读取完成', content: `工具返回商品${'x'.repeat(2_500)}`, data: { count: 1 } }),
  } as unknown as WorkspaceCommandOrchestrator;
  const runtime = new PiRuntimeAdapter(store, model, { workspaceCommands: commandTool, model: 'stream-model' });
  runtime.enqueue({ adminId: admin.id, sessionId: session.id, run: created.run, steps: created.steps });
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const bundle = await store.getRun(admin.id, created.run.id);
    if (bundle?.run.status === 'succeeded') break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const events = await store.listRunEvents(admin.id, created.run.id, 0);
  assert.ok(events.some((event) => event.eventType === 'workspace.execution.summary' && event.payload.summary === '分析任务'));
  assert.ok(events.some((event) => event.eventType === 'workspace.execution.summary' && event.payload.content === '读取完成'));
  assert.ok(!events.some((event) => event.eventType === 'reasoning.delta'));
  assert.ok(!events.some((event) => event.eventType === 'tool.call.delta'));
  assert.ok(events.some((event) => event.eventType === 'tool.call.started' && event.payload.toolName === 'workspace_read'));
  assert.ok(events.filter((event) => event.eventType === 'tool.call.started').every((event) => typeof event.payload.argumentFingerprint === 'string' && event.payload.arguments === undefined));
  assert.ok(events.some((event) => event.eventType === 'tool.result' && event.payload.status === 'succeeded'));
  assert.ok(events.some((event) => event.eventType === 'tool.result' && String((event.payload.result as { content?: string }).content).length > 2_000));
  assert.ok(requests[1]?.messages.some((message) => message.role === 'tool' && String(message.content).length > 2_000));
  assert.ok(events.some((event) => event.eventType === 'assistant.delta' && String(event.payload.contentDelta).includes('商品读取完成')));
  assert.match(String(requests[0]?.messages.find((message) => message.role === 'system')?.content), /简体中文/);
  assert.match(String(requests[0]?.messages.find((message) => message.role === 'system')?.content), /思考摘要/);
  assert.equal((await store.getRun(admin.id, created.run.id))?.run.status, 'succeeded');
  runtime.stop();
});

test('Pi runtime executes a durable Plan Mode sequence and exposes the current step after compaction', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'plan-mode@example.com', passwordHash: 'hash', displayName: 'Plan Mode' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'plan-mode' });
  const session = await store.createAgentSession({ adminId: admin.id, accountId: account.id, title: 'Plan Mode' });
  const created = await store.createRun({ adminId: admin.id, accountId: account.id, sessionId: session.id, instruction: '定位商品并读取商品状态' });
  let round = 0;
  let planningCalls = 0;
  const requests: string[] = [];
  const model: ModelClient = {
    async complete() {
      planningCalls += 1;
      return { content: '{"steps":[{"tool":"workspace_product_search","variant":"default","contractVersion":1,"goal":"定位目标商品"},{"tool":"workspace_read","variant":"default","contractVersion":1,"goal":"读取商品状态"}]}', model: 'plan-model' };
    },
    async stream(input, handlers) {
      requests.push(JSON.stringify(input.messages));
      round += 1;
      const call = round === 1
        ? { id: 'plan-search', type: 'function' as const, function: { name: 'workspace_product_search', arguments: '{"query":"目标商品"}' } }
        : round === 2
          ? { id: 'plan-read', type: 'function' as const, function: { name: 'workspace_read', arguments: '{"instruction":"读取商品状态"}' } }
          : undefined;
      if (!call) return { content: '计划已完成', model: 'plan-model' };
      await handlers.onToolCall?.(call);
      return { content: '', model: 'plan-model', toolCalls: [call] };
    },
  };
  const commandTool = {
    getModelTools: () => [
      tool('workspace_product_search', 'search', { type: 'object' }),
      tool('workspace_read', 'read', { type: 'object' }),
    ],
    executeModelTool: async (name: string) => name === 'workspace_product_search'
      ? { kind: 'products' as const, title: '商品搜索', summary: '找到目标商品', content: 'productId=product-plan', data: { productId: 'product-plan', items: [{ id: 'product-plan', title: '目标商品' }] } }
      : { kind: 'read' as const, title: '商品状态', summary: '读取完成', content: '商品状态正常' },
  } as unknown as WorkspaceCommandOrchestrator;
  const runtime = new PiRuntimeAdapter(store, model, { workspaceCommands: commandTool, model: 'plan-model' });
  try {
    runtime.enqueue({ adminId: admin.id, sessionId: session.id, run: created.run, steps: created.steps });
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline && (await store.getRun(admin.id, created.run.id))?.run.status !== 'succeeded') await new Promise((resolve) => setTimeout(resolve, 10));
    const bundle = await store.getRun(admin.id, created.run.id);
    const events = await store.listRunEvents(admin.id, created.run.id, 0);
    assert.equal(bundle?.run.status, 'succeeded');
    assert.equal(planningCalls, 1);
    assert.equal(round, 3);
    assert.ok(events.some((event) => event.eventType === 'workspace.plan.created'));
    const planUpdates = events.filter((event) => event.eventType === 'workspace.plan.updated');
    assert.ok(planUpdates.length >= 2);
    assert.equal((planUpdates.at(-1)?.payload.plan as { status?: string } | undefined)?.status, 'completed');
    assert.match(requests[1] ?? '', /workspace_read/);
    assert.match(requests[1] ?? '', /当前/);
  } finally {
    runtime.stop();
  }
});

test('Plan Mode stops the remaining tool calls when a planned step fails', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'plan-batch-failure@example.com', passwordHash: 'hash', displayName: 'Plan Batch Failure' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'plan-batch-failure' });
  const session = await store.createAgentSession({ adminId: admin.id, accountId: account.id, title: 'Plan Batch Failure' });
  const created = await store.createRun({ adminId: admin.id, accountId: account.id, sessionId: session.id, instruction: '定位商品并准备写入' });
  let confirmations = 0;
  const model: ModelClient = {
    async complete() { return { content: '{"steps":[{"tool":"workspace_product_search","variant":"default","contractVersion":1,"goal":"定位目标商品"},{"tool":"workspace_prepare_write","variant":"coupon_bind","contractVersion":1,"goal":"准备受控写入"}]}', model: 'plan-batch-failure' }; },
    async stream(_input, handlers) {
      const search = { id: 'batch-search', type: 'function' as const, function: { name: 'workspace_product_search', arguments: '{"query":"目标商品"}' } };
      const write = { id: 'batch-write', type: 'function' as const, function: { name: 'workspace_prepare_write', arguments: '{}' } };
      await handlers.onToolCall?.(search);
      await handlers.onToolCall?.(write);
      return { content: '', model: 'plan-batch-failure', toolCalls: [search, write] };
    },
  };
  const commandTool = {
    getModelTools: () => [
      tool('workspace_product_search', 'search', { type: 'object' }),
      tool('workspace_prepare_write', 'write', { type: 'object' }),
    ],
    executeModelTool: async (name: string) => {
      if (name === 'workspace_product_search') throw Object.assign(new Error('search backend down'), { code: 'SEARCH_BACKEND_DOWN' });
      confirmations += 1;
      return { kind: 'write_plan' as const, title: '写入确认', summary: '等待确认', content: '等待确认', plan: { kind: 'coupon_bind', action: 'coupon_bind', title: '写入确认', summary: '等待确认', content: '等待确认', policyRef: 'workspace.coupon_bind.confirm', expiresAt: new Date(Date.now() + 60_000).toISOString(), manifest: { productId: 'product-1' } } };
    },
  } as unknown as WorkspaceCommandOrchestrator;
  const runtime = new PiRuntimeAdapter(store, model, { workspaceCommands: commandTool, model: 'plan-batch-failure' });
  try {
    runtime.enqueue({ adminId: admin.id, sessionId: session.id, run: created.run, steps: created.steps });
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline && !['succeeded', 'failed'].includes((await store.getRun(admin.id, created.run.id))?.run.status ?? '')) await new Promise((resolve) => setTimeout(resolve, 10));
    const bundle = await store.getRun(admin.id, created.run.id);
    const events = await store.listRunEvents(admin.id, created.run.id, 0);
    assert.equal(bundle?.run.status, 'failed');
    assert.equal(confirmations, 0);
    assert.equal(events.some((event) => event.eventType === 'workspace.confirmation.created'), false);
    const planUpdates = events.filter((event) => event.eventType === 'workspace.plan.updated');
    assert.equal((planUpdates.at(-1)?.payload.plan as { status?: string } | undefined)?.status, 'blocked');
  } finally {
    runtime.stop();
  }
});

test('Plan Mode adjusts the plan after a failed step and continues with the replacement path', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'plan-replan@example.com', passwordHash: 'hash', displayName: 'Plan Replan' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'plan-replan' });
  const session = await store.createAgentSession({ adminId: admin.id, accountId: account.id, title: 'Plan Replan' });
  const created = await store.createRun({ adminId: admin.id, accountId: account.id, sessionId: session.id, instruction: '定位商品并读取状态' });
  let planningCalls = 0;
  let rounds = 0;
  const executedTools: string[] = [];
  const model: ModelClient = {
    async complete() {
      planningCalls += 1;
      return { content: planningCalls === 1
        ? '{"steps":[{"tool":"workspace_product_search","variant":"default","contractVersion":1,"goal":"定位目标商品"},{"tool":"workspace_read","variant":"default","contractVersion":1,"goal":"读取商品状态"}]}'
        : '{"steps":[{"tool":"workspace_read","variant":"default","contractVersion":1,"goal":"改用现有读取能力获取商品状态"}]}', model: 'plan-replan' };
    },
    async stream(_input, handlers) {
      rounds += 1;
      if (rounds === 1) {
        const search = { id: 'replan-search', type: 'function' as const, function: { name: 'workspace_product_search', arguments: '{"query":"目标商品"}' } };
        await handlers.onToolCall?.(search);
        return { content: '', model: 'plan-replan', toolCalls: [search] };
      }
      if (rounds === 2) {
        const read = { id: 'replan-read', type: 'function' as const, function: { name: 'workspace_read', arguments: '{"instruction":"读取商品状态"}' } };
        await handlers.onToolCall?.(read);
        return { content: '', model: 'plan-replan', toolCalls: [read] };
      }
      return { content: '已读取商品状态。', model: 'plan-replan', toolCalls: [] };
    },
  };
  const commandTool = {
    getModelTools: () => [
      tool('workspace_product_search', 'search', { type: 'object' }),
      tool('workspace_read', 'read', { type: 'object' }),
    ],
    executeModelTool: async (name: string) => {
      executedTools.push(name);
      if (name === 'workspace_product_search') throw Object.assign(new Error('search backend down'), { code: 'SEARCH_BACKEND_DOWN' });
      return { kind: 'read' as const, title: '商品状态', summary: '已读取商品状态', content: '商品状态正常', data: { status: 'active' } };
    },
  } as unknown as WorkspaceCommandOrchestrator;
  const runtime = new PiRuntimeAdapter(store, model, { workspaceCommands: commandTool, model: 'plan-replan' });
  try {
    runtime.enqueue({ adminId: admin.id, sessionId: session.id, run: created.run, steps: created.steps });
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline && !['succeeded', 'failed'].includes((await store.getRun(admin.id, created.run.id))?.run.status ?? '')) await new Promise((resolve) => setTimeout(resolve, 10));
    const bundle = await store.getRun(admin.id, created.run.id);
    const events = await store.listRunEvents(admin.id, created.run.id, 0);
    assert.equal(bundle?.run.status, 'succeeded');
    assert.deepEqual(executedTools, ['workspace_product_search', 'workspace_read']);
    assert.ok(events.some((event) => event.eventType === 'workspace.plan.updated' && event.payload.reason === 'replanned_after_failure'));
    const lastPlan = events.filter((event) => event.eventType === 'workspace.plan.updated').at(-1)?.payload.plan as { status?: string; revision?: number } | undefined;
    assert.equal(lastPlan?.status, 'completed');
    assert.equal(lastPlan?.revision, 3);
  } finally {
    runtime.stop();
  }
});

test('Plan Mode advances a restored step when its successful result is replayed from cache', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'plan-replay-cache@example.com', passwordHash: 'hash', displayName: 'Plan Replay Cache' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'plan-replay-cache' });
  const session = await store.createAgentSession({ adminId: admin.id, accountId: account.id, title: 'Plan Replay Cache' });
  const created = await store.createRun({ adminId: admin.id, accountId: account.id, sessionId: session.id, instruction: '定位商品' });
  const plan = createWorkspaceExecutionPlan({ instruction: created.run.instruction, steps: [planStep('workspace_product_search', '定位目标商品')], toolMetadata: { workspace_product_search: allWorkspaceToolPlanMetadata('workspace_product_search')! } })!;
  await store.appendRunEvent({ runId: created.run.id, eventType: 'workspace.plan.created', payload: { status: plan.status, plan } });
  const args = '{"query":"目标商品"}';
  await store.appendRunEvent({ runId: created.run.id, eventType: 'tool.call.started', payload: { toolCallId: 'prior-search', toolName: 'workspace_product_search', arguments: args, argumentFingerprint: undefined, readOnly: true } });
  await store.appendRunEvent({ runId: created.run.id, eventType: 'tool.result', payload: { toolCallId: 'prior-search', toolName: 'workspace_product_search', status: 'succeeded', result: { kind: 'products', title: '商品搜索', summary: '找到目标商品', content: 'productId=product-replay', data: { productId: 'product-replay', items: [{ id: 'product-replay', title: '目标商品' }] } } } });
  let round = 0;
  const model: ModelClient = {
    async stream(_input, handlers) {
      round += 1;
      if (round === 1) {
        const call = { id: 'replay-search', type: 'function' as const, function: { name: 'workspace_product_search', arguments: args } };
        await handlers.onToolCall?.(call);
        return { content: '', model: 'plan-replay-cache', toolCalls: [call] };
      }
      return { content: '已定位商品', model: 'plan-replay-cache' };
    },
    async complete() { return { content: 'unused', model: 'unused' }; },
  };
  let executes = 0;
  const commandTool = {
    getModelTools: () => [tool('workspace_product_search', 'search', { type: 'object' })],
    executeModelTool: async () => { executes += 1; return { kind: 'products', title: '商品搜索', summary: '找到目标商品', content: 'productId=product-replay' }; },
  } as unknown as WorkspaceCommandOrchestrator;
  const runtime = new PiRuntimeAdapter(store, model, { workspaceCommands: commandTool, model: 'plan-replay-cache' });
  try {
    runtime.enqueue({ adminId: admin.id, sessionId: session.id, run: created.run, steps: created.steps });
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline && (await store.getRun(admin.id, created.run.id))?.run.status !== 'succeeded') await new Promise((resolve) => setTimeout(resolve, 10));
    const bundle = await store.getRun(admin.id, created.run.id);
    const events = await store.listRunEvents(admin.id, created.run.id, 0);
    assert.equal(bundle?.run.status, 'succeeded');
    assert.equal(executes, 0);
    assert.ok(events.some((event) => event.eventType === 'tool.result' && event.payload.reused === true));
    const planUpdates = events.filter((event) => event.eventType === 'workspace.plan.updated');
    assert.equal((planUpdates.at(-1)?.payload.plan as { status?: string } | undefined)?.status, 'completed');
  } finally {
    runtime.stop();
  }
});

test('Plan Mode reconnect reopens a blocked durable step before allowing tools', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'plan-blocked-reconnect@example.com', passwordHash: 'hash', displayName: 'Plan Blocked Reconnect' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'plan-blocked-reconnect' });
  const session = await store.createAgentSession({ adminId: admin.id, accountId: account.id, title: 'Plan Blocked Reconnect' });
  const created = await store.createRun({ adminId: admin.id, accountId: account.id, sessionId: session.id, instruction: '定位商品' });
  const failedRun = await store.updateRun(created.run.id, { status: 'failed', errorCode: 'SEARCH_BACKEND_DOWN' });
  const failedStep = await store.updateRunStep(created.steps[0]!.id, { status: 'failed', errorCode: 'SEARCH_BACKEND_DOWN' });
  assert.ok(failedRun && failedStep);
  const blockedPlan = {
    version: 1,
    revision: 2,
    goal: created.run.instruction,
    status: 'blocked',
    currentStepId: 'step-1',
    steps: [{ ...planStep('workspace_product_search', '定位目标商品'), id: 'step-1', status: 'blocked', attempts: 1, evidence: '后端不可用' }],
  };
  await store.appendRunEvent({ runId: created.run.id, eventType: 'workspace.plan.updated', payload: { status: 'blocked', plan: blockedPlan } });
  let round = 0;
  let executions = 0;
  const model: ModelClient = {
    async stream(_input, handlers) {
      round += 1;
      if (round === 1) {
        const call = { id: 'reconnect-search', type: 'function' as const, function: { name: 'workspace_product_search', arguments: '{"query":"目标商品"}' } };
        await handlers.onToolCall?.(call);
        return { content: '', model: 'plan-blocked-reconnect', toolCalls: [call] };
      }
      return { content: '已重新定位商品', model: 'plan-blocked-reconnect' };
    },
    async complete() { return { content: 'unused', model: 'unused' }; },
  };
  const commandTool = {
    getModelTools: () => [tool('workspace_product_search', 'search', { type: 'object' })],
    executeModelTool: async () => { executions += 1; return { kind: 'products', title: '商品搜索', summary: '找到目标商品', content: 'productId=product-reconnect' }; },
  } as unknown as WorkspaceCommandOrchestrator;
  const runtime = new PiRuntimeAdapter(store, model, { workspaceCommands: commandTool, model: 'plan-blocked-reconnect' });
  try {
    await runtime.resume({ run: failedRun!, steps: [failedStep!], adminId: admin.id, sessionId: session.id, resumeFromFailure: true });
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline && (await store.getRun(admin.id, created.run.id))?.run.status !== 'succeeded') await new Promise((resolve) => setTimeout(resolve, 10));
    const bundle = await store.getRun(admin.id, created.run.id);
    const events = await store.listRunEvents(admin.id, created.run.id, 0);
    assert.equal(bundle?.run.status, 'succeeded');
    assert.equal(executions, 1);
    assert.ok(events.some((event) => event.eventType === 'workspace.plan.updated' && event.payload.reason === 'reconnect_failed_step'));
    assert.equal((events.filter((event) => event.eventType === 'workspace.plan.updated').at(-1)?.payload.plan as { status?: string } | undefined)?.status, 'completed');
  } finally {
    runtime.stop();
  }
});

test('Plan Mode advances past a confirmed write before executing the next step', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'plan-confirmation-continuation@example.com', passwordHash: 'hash', displayName: 'Plan Confirmation Continuation' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'plan-confirmation-continuation' });
  const session = await store.createAgentSession({ adminId: admin.id, accountId: account.id, title: 'Plan Confirmation Continuation' });
  const created = await store.createRun({ adminId: admin.id, accountId: account.id, sessionId: session.id, instruction: '先创建卡券再定位商品' });
  const waitingRun = await store.updateRun(created.run.id, { status: 'waiting_confirmation' });
  const waitingStep = await store.updateRunStep(created.steps[0]!.id, { status: 'waiting_confirmation' });
  assert.ok(waitingRun && waitingStep);
  const waitingPlan = {
    version: 1,
    revision: 2,
    goal: created.run.instruction,
    status: 'waiting_confirmation',
    currentStepId: 'step-1',
    steps: [
      { ...planStep('workspace_prepare_write', '创建卡券'), id: 'step-1', status: 'waiting_confirmation', attempts: 1, evidence: '等待确认' },
      { ...planStep('workspace_product_search', '定位商品'), id: 'step-2', status: 'pending', attempts: 0 },
    ],
  };
  await store.appendRunEvent({ runId: created.run.id, eventType: 'workspace.plan.updated', payload: { status: 'waiting_confirmation', plan: waitingPlan } });
  await store.appendRunEvent({ runId: created.run.id, eventType: 'workspace.coupon.created', payload: { status: 'succeeded', batchId: 'batch-1' } });
  let round = 0;
  const model: ModelClient = {
    async stream(_input, handlers) {
      round += 1;
      if (round === 1) {
        const call = { id: 'after-confirm-search', type: 'function' as const, function: { name: 'workspace_product_search', arguments: '{"query":"目标商品"}' } };
        await handlers.onToolCall?.(call);
        return { content: '', model: 'plan-confirmation-continuation', toolCalls: [call] };
      }
      return { content: '卡券已确认，商品已定位', model: 'plan-confirmation-continuation' };
    },
    async complete() { return { content: 'unused', model: 'unused' }; },
  };
  const commandTool = {
    getModelTools: () => [tool('workspace_product_search', 'search', { type: 'object' })],
    executeModelTool: async () => ({ kind: 'products', title: '商品搜索', summary: '找到目标商品', content: 'productId=product-after-confirm' }),
  } as unknown as WorkspaceCommandOrchestrator;
  const runtime = new PiRuntimeAdapter(store, model, { workspaceCommands: commandTool, model: 'plan-confirmation-continuation' });
  try {
    await runtime.continueAfterConfirmation({
      adminId: admin.id,
      sessionId: session.id,
      run: waitingRun!,
      steps: [waitingStep!],
      history: [{ role: 'assistant', content: '[tool_event] 卡券已确认创建' }],
    });
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline && (await store.getRun(admin.id, created.run.id))?.run.status !== 'succeeded') await new Promise((resolve) => setTimeout(resolve, 10));
    const bundle = await store.getRun(admin.id, created.run.id);
    const events = await store.listRunEvents(admin.id, created.run.id, 0);
    assert.equal(bundle?.run.status, 'succeeded');
    assert.ok(events.some((event) => event.eventType === 'workspace.plan.updated' && event.payload.reason === 'confirmation_succeeded'));
    assert.equal((events.filter((event) => event.eventType === 'workspace.plan.updated').at(-1)?.payload.plan as { status?: string } | undefined)?.status, 'completed');
  } finally {
    runtime.stop();
  }
});

test('Pi runtime rechecks the original task after each tool result before finalizing', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'continuation-runtime@example.com', passwordHash: 'hash', displayName: 'Continuation Runtime' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'continuation-runtime' });
  const session = await store.createAgentSession({ adminId: admin.id, accountId: account.id, title: 'Continuation' });
  const created = await store.createRun({ adminId: admin.id, accountId: account.id, sessionId: session.id, instruction: '创建卡券后关联商品并启动自动发货' });
  const running = await store.updateRun(created.run.id, { status: 'waiting_confirmation' });
  const step = await store.updateRunStep(created.steps[0]!.id, { status: 'waiting_confirmation' });
  assert.ok(running);
  assert.ok(step);

  let round = 0;
  const requests: Array<{ messages: Array<{ role: string; content: unknown }> }> = [];
  const model: ModelClient = {
    async stream(input, handlers) {
      requests.push({ messages: input.messages });
      round += 1;
      if (round === 1) {
        const call = { id: 'continuation-search', type: 'function' as const, function: { name: 'workspace_product_search', arguments: JSON.stringify({ query: '测试商品' }) } };
        await handlers.onToolCall?.(call);
        return { content: '', model: 'continuation-model', toolCalls: [call] };
      }
      if (round === 2) {
        const call = { id: 'continuation-automation', type: 'function' as const, function: { name: 'workspace_prepare_write', arguments: JSON.stringify({ operation: 'product_automation_update', parameters: { productId: 'product-1', config: { paidAutoDelivery: { enabled: true, couponBatchIds: ['batch-1'] } } } }) } };
        await handlers.onToolCall?.(call);
        return { content: '', model: 'continuation-model', toolCalls: [call] };
      }
      await handlers.onTextDelta?.('卡券已创建、商品已关联并已启动自动发货');
      return { content: '卡券已创建、商品已关联并已启动自动发货', model: 'continuation-model' };
    },
    async complete() { return { content: 'unused', model: 'unused' }; },
  };
  const commandTool = {
    getModelTools: () => [
      { type: 'function', function: { name: 'workspace_product_search', description: 'search', parameters: { type: 'object' } } },
      { type: 'function', function: { name: 'workspace_prepare_write', description: 'write', parameters: { type: 'object' } } },
    ],
    executeModelTool: async (name: string) => name === 'workspace_product_search'
      ? { kind: 'products' as const, title: '商品搜索', summary: '已找到测试商品', content: 'product-1', data: { productId: 'product-1', title: '测试商品' } }
      : { kind: 'read' as const, title: '自动发货', summary: '自动发货已启动', content: 'automation-updated', data: { productId: 'product-1', configVersion: 2, enabled: true } },
  } as unknown as WorkspaceCommandOrchestrator;
  const runtime = new PiRuntimeAdapter(store, model, { workspaceCommands: commandTool, model: 'continuation-model' });
  await runtime.continueAfterConfirmation({
    adminId: admin.id,
    sessionId: session.id,
    run: running!,
    steps: [step!],
    history: [{ role: 'assistant', content: '[tool_event] 卡券已创建 {"batchId":"batch-1"}' }],
    resumeFromFailure: true,
  });
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const bundle = await store.getRun(admin.id, created.run.id);
    if (bundle?.run.status === 'succeeded') break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const bundle = await store.getRun(admin.id, created.run.id);
  assert.equal(bundle?.run.status, 'succeeded');
  assert.equal(round, 3);
  assert.match(String(requests[0]?.messages.some((message) => String(message.content).includes('batch-1'))), /true/);
  assert.match(String(requests[0]?.messages.find((message) => message.role === 'system')?.content), /一个写操作成功不代表整个任务完成/);
  assert.ok((await store.listRunEvents(admin.id, created.run.id)).some((event) => event.eventType === 'run.succeeded'));
  runtime.stop();
});

test('Pi runtime queues confirmation continuation while the previous round is still closing', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'confirmation-race@example.com', passwordHash: 'hash', displayName: 'Confirmation Race' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'confirmation-race' });
  const session = await store.createAgentSession({ adminId: admin.id, accountId: account.id, title: 'Confirmation Race' });
  const created = await store.createRun({ adminId: admin.id, accountId: account.id, sessionId: session.id, instruction: '创建卡券后继续关联商品' });
  const originalAppend = store.appendRunEvent.bind(store);
  let releaseClosing!: () => void;
  const closing = new Promise<void>((resolve) => { releaseClosing = resolve; });
  store.appendRunEvent = async (input) => {
    if (input.eventType === 'stream.completed' && input.payload.status === 'waiting_confirmation') await closing;
    return originalAppend(input);
  };
  let rounds = 0;
  const model: ModelClient = {
    async stream() {
      rounds += 1;
      if (rounds === 1) return { content: '', model: 'race-model', toolCalls: [{ id: 'create-coupon', type: 'function' as const, function: { name: 'workspace_prepare_write', arguments: '{}' } }] };
      return { content: '已收到卡券创建结果，继续处理商品关联', model: 'race-model' };
    },
    async complete() { return { content: 'unused', model: 'unused' }; },
  };
  const commandTool = {
    getModelTools: () => [{ type: 'function', function: { name: 'workspace_prepare_write', description: 'write', parameters: { type: 'object' } } }],
    executeModelTool: async () => ({ kind: 'write_plan' as const, title: '创建卡券', summary: '等待确认', content: '等待确认', plan: { kind: 'coupon_create', action: 'coupon_create', title: '创建卡券', summary: '等待确认', content: '等待确认', policyRef: 'workspace.coupon_create.confirm', expiresAt: new Date(Date.now() + 60_000).toISOString(), manifest: { label: '03 PPT Master' } } }),
  } as unknown as WorkspaceCommandOrchestrator;
  const runtime = new PiRuntimeAdapter(store, model, { workspaceCommands: commandTool, model: 'race-model' });
  try {
    runtime.enqueue({ adminId: admin.id, sessionId: session.id, run: created.run, steps: created.steps });
    const deadline = Date.now() + 2_000;
    let waiting = await store.getRun(admin.id, created.run.id);
    while (Date.now() < deadline && waiting?.run.status !== 'waiting_confirmation') {
      await new Promise((resolve) => setTimeout(resolve, 10));
      waiting = await store.getRun(admin.id, created.run.id);
    }
    assert.equal(waiting?.run.status, 'waiting_confirmation');
    await runtime.continueAfterConfirmation({ adminId: admin.id, sessionId: session.id, run: waiting.run, steps: waiting.steps, history: [{ role: 'assistant', content: '卡券已确认 batchId=18' }] });
    releaseClosing();
    while (Date.now() < deadline && (await store.getRun(admin.id, created.run.id))?.run.status !== 'succeeded') await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal((await store.getRun(admin.id, created.run.id))?.run.status, 'succeeded');
    assert.equal(rounds, 2);
  } finally {
    releaseClosing();
    runtime.stop();
  }
});

test('Pi runtime compacts and retries after the model rejects an oversized context', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'context-retry@example.com', passwordHash: 'hash', displayName: 'Context Retry' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'context-retry' });
  const session = await store.createAgentSession({ adminId: admin.id, accountId: account.id, title: 'Context Retry' });
  const created = await store.createRun({ adminId: admin.id, accountId: account.id, sessionId: session.id, instruction: '完成卡券关联，保留 batchId=18' });
  let attempts = 0;
  const requests: string[] = [];
  const model: ModelClient = {
    async stream(input) {
      requests.push(JSON.stringify(input.messages));
      attempts += 1;
      if (attempts === 1) throw new PiModelClientError('MODEL_HTTP_ERROR', 'context length exceeded', 413);
      return { content: '已恢复任务并继续执行', model: 'context-retry-model' };
    },
    async complete() { return { content: '已找到商品 productId=product-1 和分享链接，待完成 batchId=18 的卡券关联。', model: 'context-retry-model' }; },
  };
  const commandTool = {
    getModelTools: () => [],
    executeModelTool: async () => { throw new Error('unexpected tool call'); },
  } as unknown as WorkspaceCommandOrchestrator;
  const runtime = new PiRuntimeAdapter(store, model, { workspaceCommands: commandTool, model: 'context-retry-model' });
  try {
    runtime.enqueue({ adminId: admin.id, sessionId: session.id, run: created.run, steps: created.steps, history: [{ role: 'assistant', content: `已找到商品 productId=product-1，分享链接 https://example.test/share/critical-link。${'x'.repeat(8_000)}` }] });
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline && (await store.getRun(admin.id, created.run.id))?.run.status !== 'succeeded') await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal((await store.getRun(admin.id, created.run.id))?.run.status, 'succeeded');
    assert.equal(attempts, 2);
    assert.ok(requests[1]!.length < requests[0]!.length);
    assert.match(requests[1]!, /batchId=18/);
    assert.match(requests[1]!, /productId=product-1/);
    assert.match(requests[1]!, /critical-link/);
    assert.ok((await store.listRunEvents(admin.id, created.run.id)).some((event) => event.eventType === 'context.compacted'));
  } finally { runtime.stop(); }
});

test('Workspace Pi runtime does not reuse the Auto-Reply eight-call budget', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'loop-budget@example.com', passwordHash: 'hash', displayName: 'Loop Budget' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'loop-budget' });
  const session = await store.createAgentSession({ adminId: admin.id, accountId: account.id, title: 'Loop budget' });
  const created = await store.createRun({ adminId: admin.id, accountId: account.id, sessionId: session.id, instruction: '连续读取工作区数据' });
  let round = 0;
  const model: ModelClient = {
    async stream(_input, handlers) {
      round += 1;
      if (round <= 9) {
        const call = { id: `loop-call-${round}`, type: 'function' as const, function: { name: 'workspace_read', arguments: JSON.stringify({ instruction: `读取第 ${round} 轮` }) } };
        await handlers.onToolCall?.(call);
        return { content: '', model: 'loop-budget-model', toolCalls: [call] };
      }
      await handlers.onTextDelta?.('已完成连续读取');
      return { content: '已完成连续读取', model: 'loop-budget-model' };
    },
    async complete() { return { content: 'unused', model: 'unused' }; },
  };
  const commandTool = {
    getModelTools: () => [{ type: 'function', function: { name: 'workspace_read', description: 'read', parameters: { type: 'object' } } }],
    executeModelTool: async () => ({ kind: 'read' as const, title: '工作区读取', summary: '读取完成', content: '读取完成' }),
  } as unknown as WorkspaceCommandOrchestrator;
  const runtime = new PiRuntimeAdapter(store, model, { workspaceCommands: commandTool, model: 'loop-budget-model' });
  runtime.enqueue({ adminId: admin.id, sessionId: session.id, run: created.run, steps: created.steps });
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const bundle = await store.getRun(admin.id, created.run.id);
    if (bundle?.run.status === 'succeeded' || bundle?.run.status === 'failed') break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal((await store.getRun(admin.id, created.run.id))?.run.status, 'succeeded');
  assert.equal(round, 10);
  runtime.stop();
});

test('Pi runtime surfaces terminal tool failures and consumes fenced tool arguments', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'tool-failure@example.com', passwordHash: 'hash', displayName: 'Tool Failure' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'tool-failure' });
  const session = await store.createAgentSession({ adminId: admin.id, accountId: account.id, title: 'Tool failure' });
  const created = await store.createRun({ adminId: admin.id, accountId: account.id, sessionId: session.id, instruction: '修改商品自动发货规则' });
  let round = 0;
  let receivedArgs: Record<string, unknown> | undefined;
  const call = { id: 'call-failure', type: 'function' as const, function: { name: 'workspace_read', arguments: '```json\n' + JSON.stringify(JSON.stringify({ instruction: '修改商品自动发货规则' })) + '\n```' } };
  const model: ModelClient = {
    async stream(_input, handlers) {
      round += 1;
      if (round === 1) {
        await handlers.onTextDelta?.('我先定位这个商品，再为你生成变更确认单。');
        await handlers.onToolCall?.(call);
        return { content: '我先定位这个商品，再为你生成变更确认单。', model: 'failure-model', toolCalls: [call] };
      }
      await handlers.onTextDelta?.('工具结果已收到。');
      return { content: '工具结果已收到。', model: 'failure-model' };
    },
    async complete() { return { content: 'unused', model: 'unused' }; },
  };
  const commandTool = {
    getModelTools: () => [{ type: 'function', function: { name: 'workspace_read', description: 'read', parameters: { type: 'object' } } }],
    executeModelTool: async (_name: string, args: Record<string, unknown>) => {
      receivedArgs = args;
      const error = new Error('该商品按名称或外部编号查找应使用 workspace_product_search') as Error & { code: string };
      error.code = 'WORKSPACE_PRODUCT_SEARCH_REQUIRED';
      throw error;
    },
  } as unknown as WorkspaceCommandOrchestrator;
  const runtime = new PiRuntimeAdapter(store, model, { workspaceCommands: commandTool, model: 'failure-model' });
  runtime.enqueue({ adminId: admin.id, sessionId: session.id, run: created.run, steps: created.steps });
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const bundle = await store.getRun(admin.id, created.run.id);
    if (bundle?.run.status === 'failed') break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const bundle = await store.getRun(admin.id, created.run.id);
  assert.equal(bundle?.run.status, 'failed');
  assert.deepEqual(receivedArgs, { instruction: '修改商品自动发货规则' });
  const events = await store.listRunEvents(admin.id, created.run.id, 0);
  assert.ok(events.some((event) => event.eventType === 'tool.result' && event.payload.status === 'failed' && (event.payload.result as { code?: string })?.code === 'WORKSPACE_PRODUCT_SEARCH_REQUIRED'));
  assert.ok(events.some((event) => event.eventType === 'run.failed' && String(event.payload.content).includes('工具 workspace_read 调用失败')));
  assert.ok(events.some((event) => event.eventType === 'workspace.message' && event.payload.messageType === 'final_answer' && String(event.payload.content).includes('请修正后点击重连')));
  runtime.stop();
});

test('Pi runtime preserves SKILL error codes from pi_skill_exec failures', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'skill-error@example.com', passwordHash: 'hash', displayName: 'Skill Error' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'skill-error' });
  const session = await store.createAgentSession({ adminId: admin.id, accountId: account.id, title: 'Skill error' });
  const created = await store.createRun({ adminId: admin.id, accountId: account.id, sessionId: session.id, instruction: '执行夸克网盘 Skill' });
  const call = { id: 'skill-error-call', type: 'function' as const, function: { name: 'pi_skill_exec', arguments: JSON.stringify({ skillId: 'quarkclouddrive_816db00f', command: 'browse' }) } };
  let round = 0;
  const model: ModelClient = {
    async stream(_input, handlers) {
      round += 1;
      if (round === 1) {
        await handlers.onToolCall?.(call);
        return { content: '', model: 'skill-error-model', toolCalls: [call] };
      }
      return { content: '停止', model: 'skill-error-model' };
    },
    async complete() { return { content: 'unused', model: 'unused' }; },
  };
  const skillManager = {
    handleInstruction: async () => undefined,
    buildSystemPrompt: async () => '',
    getModelTools: () => [{ type: 'function' as const, function: { name: 'pi_skill_exec', description: 'exec', parameters: { type: 'object' } } }],
    executeModelTool: async () => {
      const error = new Error('skill quarkclouddrive_816db00f is not installed') as Error & { code: string };
      error.code = 'SKILL_NOT_INSTALLED';
      throw error;
    },
  };
  const runtime = new PiRuntimeAdapter(store, model, {
    workspaceCommands: { getModelTools: () => [], executeModelTool: async () => ({ kind: 'read', title: 'unused', summary: 'unused', content: 'unused' }) } as never,
    skillManager: skillManager as never,
    model: 'skill-error-model',
  });
  runtime.enqueue({ adminId: admin.id, sessionId: session.id, run: created.run, steps: created.steps });
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const bundle = await store.getRun(admin.id, created.run.id);
    if (bundle?.run.status === 'failed') break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal((await store.getRun(admin.id, created.run.id))?.run.status, 'failed');
  const events = await store.listRunEvents(admin.id, created.run.id, 0);
  assert.ok(events.some((event) => event.eventType === 'tool.result' && event.payload.status === 'failed' && (event.payload.result as { code?: string })?.code === 'SKILL_NOT_INSTALLED'));
  runtime.stop();
});

test('Pi runtime treats a Skill nonzero exit as a failed tool, not a successful result', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'skill-exit@example.com', passwordHash: 'hash', displayName: 'Skill Exit' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'skill-exit' });
  const session = await store.createAgentSession({ adminId: admin.id, accountId: account.id, title: 'Skill exit' });
  const created = await store.createRun({ adminId: admin.id, accountId: account.id, sessionId: session.id, instruction: '读取网盘文件' });
  let round = 0;
  const model: ModelClient = {
    async stream() {
      round += 1;
      return round === 1
        ? { content: '', model: 'test', toolCalls: [{ id: 'failed-skill', type: 'function', function: { name: 'pi_skill_exec', arguments: '{}' } }] }
        : { content: '命令失败', model: 'test' };
    },
    async complete() { return { content: 'unused', model: 'test' }; },
  };
  const skillManager = {
    handleInstruction: async () => undefined,
    buildSystemPrompt: async () => '',
    getModelTools: () => [],
    executeModelTool: async () => ({ kind: 'read', title: 'Skill', summary: 'Skill execution failed (1)', content: 'file not found', data: { code: 1, status: 'failed' } }),
  };
  const runtime = new PiRuntimeAdapter(store, model, { workspaceCommands: { getModelTools: () => [], executeModelTool: async () => undefined } as never, skillManager: skillManager as never, model: 'test' });
  try {
    runtime.enqueue({ adminId: admin.id, sessionId: session.id, run: created.run, steps: created.steps });
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline && !['succeeded', 'failed'].includes((await store.getRun(admin.id, created.run.id))?.run.status ?? '')) await new Promise((resolve) => setTimeout(resolve, 10));
    const events = await store.listRunEvents(admin.id, created.run.id, 0);
    assert.ok(events.some((item) => item.eventType === 'tool.result' && item.payload.status === 'failed'));
    assert.equal((await store.getRun(admin.id, created.run.id))?.run.status, 'failed');
  } finally { runtime.stop(); }
});

test('Pi runtime reuses an identical successful Skill call within one run', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'skill-dedup@example.com', passwordHash: 'hash', displayName: 'Skill Dedup' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'skill-dedup' });
  const session = await store.createAgentSession({ adminId: admin.id, accountId: account.id, title: 'Skill dedup' });
  const created = await store.createRun({ adminId: admin.id, accountId: account.id, sessionId: session.id, instruction: '搜索文件' });
  let round = 0;
  let executions = 0;
  const model: ModelClient = {
    async stream() {
      round += 1;
      return round < 3
        ? { content: '', model: 'test', toolCalls: [{ id: `call-${round}`, type: 'function', function: { name: 'pi_skill_exec', arguments: round === 1 ? '{"command":"search","args":["file"]}' : '{"args":["file"],"command":"search"}' } }] }
        : { content: '已找到文件', model: 'test' };
    },
    async complete() { return { content: 'unused', model: 'test' }; },
  };
  const skillManager = {
    handleInstruction: async () => undefined,
    buildSystemPrompt: async () => '',
    getModelTools: () => [],
    executeModelTool: async () => { executions += 1; return { kind: 'read', title: '搜索', summary: '找到文件', content: 'fid=123', data: { status: 'succeeded' } }; },
  };
  const runtime = new PiRuntimeAdapter(store, model, { workspaceCommands: { getModelTools: () => [], executeModelTool: async () => undefined } as never, skillManager: skillManager as never, model: 'test' });
  try {
    runtime.enqueue({ adminId: admin.id, sessionId: session.id, run: created.run, steps: created.steps });
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline && !['succeeded', 'failed'].includes((await store.getRun(admin.id, created.run.id))?.run.status ?? '')) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal((await store.getRun(admin.id, created.run.id))?.run.status, 'succeeded');
    assert.equal(executions, 1);
    const events = await store.listRunEvents(admin.id, created.run.id, 0);
    assert.equal(events.filter((item) => item.eventType === 'tool.result' && item.payload.reused === true).length, 1);
  } finally { runtime.stop(); }
});

test('Pi runtime does not retry a context rejection when fixed instructions cannot be compacted', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'fixed-context@example.com', passwordHash: 'hash', displayName: 'Fixed Context' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'fixed-context' });
  const session = await store.createAgentSession({ adminId: admin.id, accountId: account.id, title: 'Fixed context' });
  const created = await store.createRun({ adminId: admin.id, accountId: account.id, sessionId: session.id, instruction: '读取网盘文件' });
  let attempts = 0;
  const model: ModelClient = {
    async stream() { attempts += 1; throw new PiModelClientError('MODEL_HTTP_ERROR', 'context length exceeded', 413); },
    async complete() { throw new Error('no history exists to summarize'); },
  };
  const commands = { getModelTools: () => [], executeModelTool: async () => undefined } as unknown as WorkspaceCommandOrchestrator;
  const skillManager = { buildSystemPrompt: async () => 'x'.repeat(17_000), getModelTools: () => [], handleInstruction: async () => undefined };
  const runtime = new PiRuntimeAdapter(store, model, { workspaceCommands: commands, skillManager: skillManager as never, model: 'test' });
  try {
    runtime.enqueue({ adminId: admin.id, sessionId: session.id, run: created.run, steps: created.steps });
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline && (await store.getRun(admin.id, created.run.id))?.run.status !== 'failed') await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal((await store.getRun(admin.id, created.run.id))?.run.errorCode, 'MODEL_HTTP_ERROR');
    assert.equal(attempts, 1);
    assert.equal((await store.listRunEvents(admin.id, created.run.id, 0)).filter((event) => event.eventType === 'context.compacted').length, 0);
  } finally { runtime.stop(); }
});

test('Pi runtime reuses a repeated product search and stops a no-progress tool loop', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'product-search-loop@example.com', passwordHash: 'hash', displayName: 'Product Search Loop' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'product-search-loop' });
  const session = await store.createAgentSession({ adminId: admin.id, accountId: account.id, title: 'Product search loop' });
  const created = await store.createRun({ adminId: admin.id, accountId: account.id, sessionId: session.id, instruction: '查找商品并继续处理' });
  let rounds = 0;
  let searches = 0;
  const model: ModelClient = {
    async stream() {
      rounds += 1;
      return { content: '', model: 'test', toolCalls: [{ id: `search-${rounds}`, type: 'function', function: { name: 'workspace_product_search', arguments: '{"query":"AI 技术咨询"}' } }] };
    },
    async complete() { return { content: 'unused', model: 'test' }; },
  };
  const commands = {
    getModelTools: () => [{ type: 'function', function: { name: 'workspace_product_search', description: 'search', parameters: { type: 'object' } } }],
    executeModelTool: async () => { searches += 1; return { kind: 'read', title: '商品搜索', summary: '找到 1 个商品', content: 'productId=product-1' }; },
  } as unknown as WorkspaceCommandOrchestrator;
  const skillManager = { buildSystemPrompt: async () => 'x'.repeat(17_000), getModelTools: () => [], handleInstruction: async () => undefined };
  const runtime = new PiRuntimeAdapter(store, model, { workspaceCommands: commands, skillManager: skillManager as never, model: 'test' });
  try {
    runtime.enqueue({ adminId: admin.id, sessionId: session.id, run: created.run, steps: created.steps });
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline && !['succeeded', 'failed'].includes((await store.getRun(admin.id, created.run.id))?.run.status ?? '')) await new Promise((resolve) => setTimeout(resolve, 10));
    const bundle = await store.getRun(admin.id, created.run.id);
    const events = await store.listRunEvents(admin.id, created.run.id, 0);
    assert.equal(bundle?.run.status, 'failed');
    assert.equal(bundle?.run.errorCode, 'MODEL_TOOL_LOOP_EXCEEDED');
    assert.equal(searches, 1);
    assert.equal(rounds, 4);
    assert.equal(events.filter((item) => item.eventType === 'tool.result' && item.payload.reused === true).length, 2);
    assert.equal(events.filter((item) => item.eventType === 'context.compacted').length, 0);
  } finally { runtime.stop(); }
});

test('Pi runtime preserves the product search cache across Skill writes', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'product-search-skill-write@example.com', passwordHash: 'hash', displayName: 'Product Search Skill Write' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'product-search-skill-write' });
  const session = await store.createAgentSession({ adminId: admin.id, accountId: account.id, title: 'Product search Skill write' });
  const created = await store.createRun({ adminId: admin.id, accountId: account.id, sessionId: session.id, instruction: '查找商品并创建分享' });
  let round = 0;
  let searches = 0;
  let skillWrites = 0;
  let roundThreeMessages = '';
  const model: ModelClient = {
    async stream(input) {
      round += 1;
      if (round === 4) roundThreeMessages = JSON.stringify(input.messages);
      const call = round === 1
        ? { id: 'product-1', type: 'function' as const, function: { name: 'workspace_product_search', arguments: '{"query":"AI 技术咨询"}' } }
        : round === 2
          ? { id: 'share-1', type: 'function' as const, function: { name: 'pi_skill_exec', arguments: '{"command":"share","args":["fid-1"]}' } }
          : round === 3
            ? { id: 'product-2', type: 'function' as const, function: { name: 'workspace_product_search', arguments: '{"query":"AI 技术咨询"}' } }
            : undefined;
      return call ? { content: '', model: 'test', toolCalls: [call] } : { content: '已完成', model: 'test' };
    },
    async complete() { return { content: '{"steps":[]}', model: 'test' }; },
  };
  const skillManager = {
    handleInstruction: async () => undefined,
    buildSystemPrompt: async () => '',
    getModelTools: () => [{ type: 'function', function: { name: 'pi_skill_exec', description: 'exec', parameters: { type: 'object' } } }],
    executeModelTool: async () => { skillWrites += 1; return { kind: 'read' as const, title: '分享', summary: '执行成功', content: 'share complete', data: { status: 'succeeded', code: 0 } }; },
  };
  const commandTool = {
    getModelTools: () => [{ type: 'function', function: { name: 'workspace_product_search', description: 'search', parameters: { type: 'object' } } }],
    executeModelTool: async () => { searches += 1; return { kind: 'products' as const, title: '商品搜索', summary: '找到 1 个商品', content: 'productId=product-1', data: { total: 1, items: [{ id: 'product-1', title: 'AI 技术咨询' }] } }; },
  } as unknown as WorkspaceCommandOrchestrator;
  const runtime = new PiRuntimeAdapter(store, model, { workspaceCommands: commandTool, skillManager: skillManager as never, model: 'test' });
  try {
    runtime.enqueue({ adminId: admin.id, sessionId: session.id, run: created.run, steps: created.steps });
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline && !['succeeded', 'failed'].includes((await store.getRun(admin.id, created.run.id))?.run.status ?? '')) await new Promise((resolve) => setTimeout(resolve, 10));
    const bundle = await store.getRun(admin.id, created.run.id);
    const events = await store.listRunEvents(admin.id, created.run.id, 0);
    assert.equal(bundle?.run.status, 'succeeded');
    assert.equal(searches, 1);
    assert.equal(skillWrites, 1);
    assert.match(roundThreeMessages, /已复用此前相同工具结果/);
    assert.ok(events.some((event) => event.eventType === 'tool.result' && event.payload.toolName === 'workspace_product_search' && event.payload.reused === true));
  } finally { runtime.stop(); }
});

test('Pi runtime preserves Skill documentation reads across a share write', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'skill-read-share-cache@example.com', passwordHash: 'hash', displayName: 'Skill Read Share Cache' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'skill-read-share-cache' });
  const session = await store.createAgentSession({ adminId: admin.id, accountId: account.id, title: 'Skill read share cache' });
  const created = await store.createRun({ adminId: admin.id, accountId: account.id, sessionId: session.id, instruction: '读取分享规范并创建链接' });
  let round = 0;
  let reads = 0;
  let writes = 0;
  const model: ModelClient = {
    async stream() {
      round += 1;
      const call = round === 1
        ? { id: 'read-1', type: 'function' as const, function: { name: 'pi_skill_read', arguments: '{"skillId":"demo","filePath":"references/file-share.md"}' } }
        : round === 2
          ? { id: 'share-1', type: 'function' as const, function: { name: 'pi_skill_exec', arguments: '{"command":"share","args":["fid-1"]}' } }
          : round === 3
            ? { id: 'read-2', type: 'function' as const, function: { name: 'pi_skill_read', arguments: '{"skillId":"demo","filePath":"references/file-share.md"}' } }
            : undefined;
      return call ? { content: '', model: 'test', toolCalls: [call] } : { content: '已完成', model: 'test' };
    },
    async complete() { return { content: '{"steps":[]}', model: 'test' }; },
  };
  const skillManager = {
    handleInstruction: async () => undefined,
    buildSystemPrompt: async () => '',
    getModelTools: () => [{ type: 'function', function: { name: 'pi_skill_read', description: 'read', parameters: { type: 'object' } } }, { type: 'function', function: { name: 'pi_skill_exec', description: 'exec', parameters: { type: 'object' } } }],
    executeModelTool: async (name: string) => {
      if (name === 'pi_skill_read') { reads += 1; return { kind: 'read' as const, title: 'Skill reference loaded', summary: 'Skill reference loaded', content: 'share command docs', data: { status: 'succeeded' } }; }
      writes += 1;
      return { kind: 'read' as const, title: 'Skill execution complete', summary: 'Skill execution complete', content: 'share complete', data: { status: 'succeeded', code: 0 } };
    },
  };
  const runtime = new PiRuntimeAdapter(store, model, { workspaceCommands: { getModelTools: () => [], executeModelTool: async () => undefined } as never, skillManager: skillManager as never, model: 'test' });
  try {
    runtime.enqueue({ adminId: admin.id, sessionId: session.id, run: created.run, steps: created.steps });
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline && !['succeeded', 'failed'].includes((await store.getRun(admin.id, created.run.id))?.run.status ?? '')) await new Promise((resolve) => setTimeout(resolve, 10));
    const bundle = await store.getRun(admin.id, created.run.id);
    const events = await store.listRunEvents(admin.id, created.run.id, 0);
    assert.equal(bundle?.run.status, 'succeeded');
    assert.equal(reads, 1);
    assert.equal(writes, 1);
    assert.ok(events.some((event) => event.eventType === 'tool.result' && event.payload.toolName === 'pi_skill_read' && event.payload.reused === true));
  } finally { runtime.stop(); }
});

test('Pi runtime bounds Skill-read and share-write alternation', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'skill-read-share-alternation@example.com', passwordHash: 'hash', displayName: 'Skill Read Share Alternation' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'skill-read-share-alternation' });
  const session = await store.createAgentSession({ adminId: admin.id, accountId: account.id, title: 'Skill read share alternation' });
  const created = await store.createRun({ adminId: admin.id, accountId: account.id, sessionId: session.id, instruction: '反复读取分享规范并执行分享' });
  let round = 0;
  let reads = 0;
  let writes = 0;
  const model: ModelClient = {
    async stream() {
      round += 1;
      const call = round % 2 === 1
        ? { id: `read-${round}`, type: 'function' as const, function: { name: 'pi_skill_read', arguments: '{"skillId":"demo","filePath":"references/file-share.md"}' } }
        : { id: `share-${round}`, type: 'function' as const, function: { name: 'pi_skill_exec', arguments: JSON.stringify({ command: 'share', args: [`fid-${round}`] }) } };
      return { content: '', model: 'test', toolCalls: [call] };
    },
    async complete() { return { content: 'unused', model: 'test' }; },
  };
  const skillManager = {
    handleInstruction: async () => undefined,
    buildSystemPrompt: async () => '',
    getModelTools: () => [{ type: 'function', function: { name: 'pi_skill_read', description: 'read', parameters: { type: 'object' } } }, { type: 'function', function: { name: 'pi_skill_exec', description: 'exec', parameters: { type: 'object' } } }],
    executeModelTool: async (name: string) => {
      if (name === 'pi_skill_read') { reads += 1; return { kind: 'read' as const, title: 'Skill reference loaded', summary: 'Skill reference loaded', content: 'share command docs', data: { status: 'succeeded' } }; }
      writes += 1;
      return { kind: 'read' as const, title: 'Skill execution complete', summary: 'Skill execution complete', content: 'share complete', data: { status: 'succeeded', code: 0 } };
    },
  };
  const runtime = new PiRuntimeAdapter(store, model, { workspaceCommands: { getModelTools: () => [], executeModelTool: async () => undefined } as never, skillManager: skillManager as never, model: 'test' });
  try {
    runtime.enqueue({ adminId: admin.id, sessionId: session.id, run: created.run, steps: created.steps });
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline && !['succeeded', 'failed'].includes((await store.getRun(admin.id, created.run.id))?.run.status ?? '')) await new Promise((resolve) => setTimeout(resolve, 10));
    const bundle = await store.getRun(admin.id, created.run.id);
    assert.equal(bundle?.run.status, 'failed');
    assert.equal(bundle?.run.errorCode, 'MODEL_TOOL_LOOP_EXCEEDED');
    assert.equal(round, 5);
    assert.equal(reads, 1);
    assert.equal(writes, 2);
  } finally { runtime.stop(); }
});

test('Pi runtime keeps the product id through compaction and advances to the write plan', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'product-search-compaction@example.com', passwordHash: 'hash', displayName: 'Product Search Compaction' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'product-search-compaction' });
  const session = await store.createAgentSession({ adminId: admin.id, accountId: account.id, title: 'Product search compaction' });
  const created = await store.createRun({ adminId: admin.id, accountId: account.id, sessionId: session.id, instruction: '查找商品后准备卡券关联' });
  let round = 0;
  let searches = 0;
  let prepareWrites = 0;
  let secondRequest = '';
  const model: ModelClient = {
    async complete(input) {
      if (String(input.messages[0]?.content ?? '').includes('制定最短的工具执行顺序')) return { content: '{"steps":[]}', model: 'test' };
      return { content: '已定位商品，准备关联卡券。', model: 'test' };
    },
    async stream(input) {
      round += 1;
      if (round === 2) secondRequest = JSON.stringify(input.messages);
      if (round === 1) return { content: '', model: 'test', toolCalls: [{ id: 'search-1', type: 'function', function: { name: 'workspace_product_search', arguments: '{"query":"AI 技术咨询"}' } }] };
      return { content: '', model: 'test', toolCalls: [{ id: 'prepare-1', type: 'function', function: { name: 'workspace_prepare_write', arguments: JSON.stringify({ operation: 'coupon_bind', parameters: { batchId: '18', productId: 'product-early' } }) } }] };
    },
  };
  const commandTool = {
    getModelTools: () => [
      { type: 'function', function: { name: 'workspace_product_search', description: 'search', parameters: { type: 'object' } } },
      { type: 'function', function: { name: 'workspace_prepare_write', description: 'prepare', parameters: { type: 'object' } } },
    ],
    executeModelTool: async (name: string) => {
      if (name === 'workspace_product_search') {
        searches += 1;
        return {
          kind: 'read' as const,
          title: '商品搜索',
          summary: '已按名称/外部编号筛选 1 个商品',
          content: `匹配到 1 个商品：productId=product-early · title=AI 技术咨询，需求定制开发服务 · externalProductRef=1082410574993${'x'.repeat(30_000)}`,
          data: { total: 1, items: [{ id: 'product-early', title: 'AI 技术咨询，需求定制开发服务', externalProductRef: '1082410574993', description: 'x'.repeat(30_000) }] },
        };
      }
      prepareWrites += 1;
      return {
        kind: 'write_plan' as const,
        title: '卡券商品关联确认',
        summary: '等待确认',
        content: '等待确认',
        plan: {
          kind: 'coupon_bind',
          action: 'coupon_bind',
          title: '卡券商品关联确认',
          summary: '等待确认',
          content: '等待确认',
          policyRef: 'workspace.coupon_bind.confirm',
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          manifest: { action: 'coupon_bind', accountId: account.id, batchId: '18', productId: 'product-early' },
        },
      };
    },
  } as unknown as WorkspaceCommandOrchestrator;
  const runtime = new PiRuntimeAdapter(store, model, { workspaceCommands: commandTool, model: 'test' });
  try {
    runtime.enqueue({ adminId: admin.id, sessionId: session.id, run: created.run, steps: created.steps });
    const terminal = new Set(['waiting_confirmation', 'succeeded', 'failed', 'cancelled', 'expired']);
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline && !terminal.has((await store.getRun(admin.id, created.run.id))?.run.status ?? '')) await new Promise((resolve) => setTimeout(resolve, 10));
    const bundle = await store.getRun(admin.id, created.run.id);
    const events = await store.listRunEvents(admin.id, created.run.id, 0);
    assert.equal(bundle?.run.status, 'waiting_confirmation');
    assert.equal(bundle?.run.errorCode, undefined);
    assert.equal(searches, 1);
    assert.equal(prepareWrites, 1);
    assert.match(secondRequest, /productId=product-early/);
    assert.ok(events.some((event) => event.eventType === 'context.compacted'));
    assert.ok(!events.some((event) => event.payload.errorCode === 'MODEL_TOOL_LOOP_EXCEEDED'));
  } finally { runtime.stop(); }
});

test('Pi runtime stops varying Skill queries on semantic no-progress and preserves the budget on reconnect', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'skill-semantic-loop@example.com', passwordHash: 'hash', displayName: 'Skill Semantic Loop' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'skill-semantic-loop' });
  const session = await store.createAgentSession({ adminId: admin.id, accountId: account.id, title: 'Skill semantic loop' });
  const created = await store.createRun({ adminId: admin.id, accountId: account.id, sessionId: session.id, instruction: '查找 03 PPT Master 并创建分享' });
  let round = 0;
  const model: ModelClient = {
    async stream() {
      round += 1;
      return { content: '', model: 'test', toolCalls: [{ id: `search-${round}`, type: 'function', function: { name: 'pi_skill_search', arguments: JSON.stringify({ skillId: 'quarkclouddrive', query: `missing-${round}`, mode: 'literal' }) } }] };
    },
    async complete() { return { content: 'unused', model: 'test' }; },
  };
  const skillManager = {
    handleInstruction: async () => undefined,
    buildSystemPrompt: async () => '',
    getModelTools: () => [],
    executeModelTool: async () => ({ kind: 'read' as const, title: 'Skill search', summary: 'No Skill instruction matches', content: 'No matches', data: { status: 'succeeded', matches: 0 } }),
  };
  const runtime = new PiRuntimeAdapter(store, model, { workspaceCommands: { getModelTools: () => [], executeModelTool: async () => undefined } as never, skillManager: skillManager as never, model: 'test' });
  try {
    await store.appendRunEvent({ runId: created.run.id, eventType: 'workspace.skill.progress', payload: { phase: 'discovery', discoveryCalls: 7, executionCalls: 0, noProgressCount: 7, evidenceFingerprint: 'pi_skill_search:no-match', suggestedTool: 'pi_skill_exec' } });
    runtime.enqueue({ adminId: admin.id, sessionId: session.id, run: created.run, steps: created.steps, resumeFromFailure: true });
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline && !['succeeded', 'failed', 'cancelled', 'expired'].includes((await store.getRun(admin.id, created.run.id))?.run.status ?? '')) await new Promise((resolve) => setTimeout(resolve, 10));
    const bundle = await store.getRun(admin.id, created.run.id);
    const events = await store.listRunEvents(admin.id, created.run.id, 0);
    assert.equal(bundle?.run.status, 'succeeded');
    assert.equal(round, 1);
    assert.ok(events.some((event) => event.eventType === 'workspace.skill.progress' && event.payload.noProgressCount === 8));
    assert.ok(events.some((event) => event.eventType === 'workspace.skill.lifecycle' && event.payload.data && (event.payload.data as Record<string, unknown>).code === 'SKILL_DISCOVERY_NO_PROGRESS'));
    assert.equal(bundle?.run.errorCode, undefined);
  } finally { runtime.stop(); }
});

test('Pi runtime bounds a 38-query Skill search loop before any execution', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'skill-38-query-loop@example.com', passwordHash: 'hash', displayName: 'Skill 38 Query Loop' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'skill-38-query-loop' });
  const session = await store.createAgentSession({ adminId: admin.id, accountId: account.id, title: 'Skill 38 query loop' });
  const created = await store.createRun({ adminId: admin.id, accountId: account.id, sessionId: session.id, instruction: '用 03 PPT Master 的网盘公开分享链接创建' });
  let rounds = 0;
  const model: ModelClient = {
    async stream() {
      rounds += 1;
      return { content: '', model: 'test', toolCalls: [{ id: `search-${rounds}`, type: 'function', function: { name: 'pi_skill_search', arguments: JSON.stringify({ skillId: 'quarkclouddrive', query: `03 PPT Master 变体 ${rounds}`, mode: 'literal' }) } }] };
    },
    async complete() { return { content: 'unused', model: 'test' }; },
  };
  const skillManager = {
    handleInstruction: async () => undefined,
    buildSystemPrompt: async () => '',
    getModelTools: () => [],
    executeModelTool: async () => ({ kind: 'read' as const, title: 'Skill search', summary: 'No Skill instruction matches', content: 'No matches', data: { status: 'succeeded', matches: 0 } }),
  };
  const runtime = new PiRuntimeAdapter(store, model, { workspaceCommands: { getModelTools: () => [], executeModelTool: async () => undefined } as never, skillManager: skillManager as never, model: 'test' });
  try {
    runtime.enqueue({ adminId: admin.id, sessionId: session.id, run: created.run, steps: created.steps });
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline && (await store.getRun(admin.id, created.run.id))?.run.status !== 'succeeded') await new Promise((resolve) => setTimeout(resolve, 10));
    const bundle = await store.getRun(admin.id, created.run.id);
    const events = await store.listRunEvents(admin.id, created.run.id, 0);
    assert.equal(bundle?.run.status, 'succeeded');
    assert.equal(rounds, 9);
    assert.equal(events.filter((event) => event.eventType === 'tool.result' && event.payload.toolName === 'pi_skill_exec').length, 0);
    assert.ok(events.some((event) => event.eventType === 'workspace.skill.lifecycle' && event.payload.status === 'pending_user_action' && (event.payload.data as Record<string, unknown>)?.code === 'SKILL_DISCOVERY_NO_PROGRESS'));
    assert.ok(events.some((event) => event.eventType === 'workspace.skill.progress' && event.payload.noProgressCount === 8));
    assert.equal(bundle?.run.errorCode, undefined);
  } finally { runtime.stop(); }
});

for (const toolName of ['workspace_read', 'pi_skill_list']) {
  test(`Pi runtime stops repeated ${toolName} reads without executing them again`, async () => {
    const store = new MemoryStore();
    const admin = await store.createAdmin({ email: `${toolName}@example.com`, passwordHash: 'hash', displayName: toolName });
    const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: toolName });
    const session = await store.createAgentSession({ adminId: admin.id, accountId: account.id, title: toolName });
    const created = await store.createRun({ adminId: admin.id, accountId: account.id, sessionId: session.id, instruction: '读取当前状态' });
    let round = 0;
    let executions = 0;
    const model: ModelClient = {
      async stream() { return { content: '', model: 'test', toolCalls: [{ id: `read-${++round}`, type: 'function', function: { name: toolName, arguments: toolName === 'workspace_read' ? '{"instruction":"读取当前状态"}' : '{}' } }] }; },
      async complete() { return { content: 'unused', model: 'test' }; },
    };
    const toolResult = () => { executions += 1; return { kind: 'read', title: '当前状态', summary: '读取成功', content: '状态正常' }; };
    const runtime = new PiRuntimeAdapter(store, model, {
      workspaceCommands: { getModelTools: () => [], executeModelTool: async () => toolResult() } as never,
      skillManager: toolName === 'pi_skill_list' ? { handleInstruction: async () => undefined, buildSystemPrompt: async () => '', getModelTools: () => [], executeModelTool: async () => toolResult() } as never : undefined,
      model: 'test',
    });
    try {
      runtime.enqueue({ adminId: admin.id, sessionId: session.id, run: created.run, steps: created.steps });
      const deadline = Date.now() + 2_000;
      while (Date.now() < deadline && (await store.getRun(admin.id, created.run.id))?.run.status !== 'failed') await new Promise((resolve) => setTimeout(resolve, 10));
      assert.equal((await store.getRun(admin.id, created.run.id))?.run.errorCode, 'MODEL_TOOL_LOOP_EXCEEDED');
      assert.equal(executions, 1);
      assert.equal(round, 3);
    } finally { runtime.stop(); }
  });
}

test('Pi runtime invalidates read results after a Skill write but deduplicates that write', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'skill-write-cache@example.com', passwordHash: 'hash', displayName: 'Skill Write Cache' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'skill-write-cache' });
  const session = await store.createAgentSession({ adminId: admin.id, accountId: account.id, title: 'Skill write cache' });
  const created = await store.createRun({ adminId: admin.id, accountId: account.id, sessionId: session.id, instruction: '查询并分享文件' });
  let round = 0;
  const executed: string[] = [];
  const model: ModelClient = {
    async stream() {
      round += 1;
      const command = round % 2 === 1 ? 'get-share-update-files' : 'share';
      return round <= 4
        ? { content: '', model: 'test', toolCalls: [{ id: `call-${round}`, type: 'function', function: { name: 'pi_skill_exec', arguments: JSON.stringify({ command, args: ['file'] }) } }] }
        : { content: '完成', model: 'test' };
    },
    async complete() { return { content: 'unused', model: 'test' }; },
  };
  const skillManager = {
    handleInstruction: async () => undefined,
    buildSystemPrompt: async () => '',
    getModelTools: () => [],
    executeModelTool: async (_name: string, args: { command: string }) => {
      executed.push(args.command);
      return { kind: 'read', title: args.command, summary: '执行成功', content: args.command, data: { status: 'succeeded', code: 0 } };
    },
  };
  const runtime = new PiRuntimeAdapter(store, model, { workspaceCommands: { getModelTools: () => [], executeModelTool: async () => undefined } as never, skillManager: skillManager as never, model: 'test' });
  try {
    runtime.enqueue({ adminId: admin.id, sessionId: session.id, run: created.run, steps: created.steps });
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline && !['succeeded', 'failed'].includes((await store.getRun(admin.id, created.run.id))?.run.status ?? '')) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal((await store.getRun(admin.id, created.run.id))?.run.status, 'succeeded');
    assert.deepEqual(executed, ['get-share-update-files', 'share', 'get-share-update-files']);
    const events = await store.listRunEvents(admin.id, created.run.id, 0);
    assert.equal(events.filter((item) => item.eventType === 'tool.result' && item.payload.reused === true).length, 1);
  } finally { runtime.stop(); }
});

test('Pi runtime invalidates Skill instructions after a successful install', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'skill-install-cache@example.com', passwordHash: 'hash', displayName: 'Skill Install Cache' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'skill-install-cache' });
  const session = await store.createAgentSession({ adminId: admin.id, accountId: account.id, title: 'Skill install cache' });
  const created = await store.createRun({ adminId: admin.id, accountId: account.id, sessionId: session.id, instruction: '更新 Skill 后读取新说明' });
  const tools = ['pi_skill_read', 'pi_skill_install', 'pi_skill_read'];
  let round = 0;
  let reads = 0;
  const model: ModelClient = {
    async stream() {
      const tool = tools[round++];
      return tool ? { content: '', model: 'test', toolCalls: [{ id: `skill-${round}`, type: 'function', function: { name: tool, arguments: tool === 'pi_skill_install' ? '{"source":"fixture"}' : '{"skillId":"demo"}' } }] } : { content: '完成', model: 'test' };
    },
    async complete() { return { content: 'unused', model: 'test' }; },
  };
  const skillManager = {
    handleInstruction: async () => undefined,
    buildSystemPrompt: async () => '',
    getModelTools: () => [],
    executeModelTool: async (name: string) => {
      if (name === 'pi_skill_read') reads += 1;
      return { kind: 'read', title: name, summary: name, content: `version=${reads}`, data: { status: 'succeeded' } };
    },
  };
  const runtime = new PiRuntimeAdapter(store, model, { workspaceCommands: { getModelTools: () => [], executeModelTool: async () => undefined } as never, skillManager: skillManager as never, model: 'test' });
  try {
    runtime.enqueue({ adminId: admin.id, sessionId: session.id, run: created.run, steps: created.steps });
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline && !['succeeded', 'failed'].includes((await store.getRun(admin.id, created.run.id))?.run.status ?? '')) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal((await store.getRun(admin.id, created.run.id))?.run.status, 'succeeded');
    assert.equal(reads, 2);
  } finally { runtime.stop(); }
});

test('Pi runtime discards a durable pre-install Skill instruction on reconnect', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'skill-reinstall-resume@example.com', passwordHash: 'hash', displayName: 'Skill Reinstall Resume' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'skill-reinstall-resume' });
  const session = await store.createAgentSession({ adminId: admin.id, accountId: account.id, title: 'Skill reinstall resume' });
  const created = await store.createRun({ adminId: admin.id, accountId: account.id, sessionId: session.id, instruction: '读取更新后的 Skill 说明' });
  await store.appendRunEvent({ runId: created.run.id, eventType: 'tool.call.started', payload: { toolCallId: 'old-read', toolName: 'pi_skill_read', arguments: '{"skillId":"demo"}' } });
  await store.appendRunEvent({ runId: created.run.id, eventType: 'tool.result', payload: { toolCallId: 'old-read', toolName: 'pi_skill_read', status: 'succeeded', result: { kind: 'read', title: '旧说明', summary: '旧说明', content: 'version=1' } } });
  await store.appendRunEvent({ runId: created.run.id, eventType: 'tool.result', payload: { toolCallId: 'install', toolName: 'pi_skill_install', status: 'succeeded', result: { kind: 'read', title: '安装成功', summary: '安装成功', content: 'version=2', data: { item: { id: 'demo', enabled: true } } } } });
  let reads = 0;
  let round = 0;
  const model: ModelClient = {
    async stream() { return round++ === 0 ? { content: '', model: 'test', toolCalls: [{ id: 'new-read', type: 'function', function: { name: 'pi_skill_read', arguments: '{"skillId":"demo"}' } }] } : { content: '完成', model: 'test' }; },
    async complete() { return { content: 'unused', model: 'test' }; },
  };
  const skillManager = { handleInstruction: async () => undefined, buildSystemPrompt: async () => '', getModelTools: () => [], executeModelTool: async () => { reads += 1; return { kind: 'read', title: '新说明', summary: '新说明', content: 'version=2' }; } };
  const runtime = new PiRuntimeAdapter(store, model, { workspaceCommands: { getModelTools: () => [], executeModelTool: async () => undefined } as never, skillManager: skillManager as never, model: 'test' });
  try {
    runtime.enqueue({ adminId: admin.id, sessionId: session.id, run: created.run, steps: created.steps });
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline && !['succeeded', 'failed'].includes((await store.getRun(admin.id, created.run.id))?.run.status ?? '')) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal((await store.getRun(admin.id, created.run.id))?.run.status, 'succeeded');
    assert.equal(reads, 1);
  } finally { runtime.stop(); }
});

test('Pi runtime reuses a durable Skill result after another read and continuation', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'skill-resume-cache@example.com', passwordHash: 'hash', displayName: 'Skill Resume' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'skill-resume-cache' });
  const session = await store.createAgentSession({ adminId: admin.id, accountId: account.id, title: 'Resume cache' });
  const created = await store.createRun({ adminId: admin.id, accountId: account.id, sessionId: session.id, instruction: '搜索文件' });
  await store.appendRunEvent({ runId: created.run.id, eventType: 'tool.call.started', payload: { toolCallId: 'prior', toolName: 'pi_skill_exec', arguments: '{"command":"search","args":["file"]}' } });
  await store.appendRunEvent({ runId: created.run.id, eventType: 'tool.result', payload: { toolCallId: 'prior', toolName: 'pi_skill_exec', status: 'succeeded', result: { kind: 'read', title: '搜索', summary: '找到文件', content: 'fid=123', data: { status: 'succeeded' } } } });
  await store.appendRunEvent({ runId: created.run.id, eventType: 'tool.call.started', payload: { toolCallId: 'other-read', toolName: 'pi_skill_exec', arguments: '{"command":"search","args":["another-file"]}' } });
  await store.appendRunEvent({ runId: created.run.id, eventType: 'tool.result', payload: { toolCallId: 'other-read', toolName: 'pi_skill_exec', status: 'succeeded', result: { kind: 'read', title: '搜索', summary: '找到另一个文件', content: 'fid=456', data: { status: 'succeeded' } } } });
  let round = 0;
  let executions = 0;
  const model: ModelClient = {
    async stream() { round += 1; return round === 1 ? { content: '', model: 'test', toolCalls: [{ id: 'again', type: 'function', function: { name: 'pi_skill_exec', arguments: '{"args":["file"],"command":"search"}' } }] } : { content: '完成', model: 'test' }; },
    async complete() { return { content: 'unused', model: 'test' }; },
  };
  const skillManager = { handleInstruction: async () => undefined, buildSystemPrompt: async () => '', getModelTools: () => [], executeModelTool: async () => { executions += 1; throw new Error('must reuse prior result'); } };
  const runtime = new PiRuntimeAdapter(store, model, { workspaceCommands: { getModelTools: () => [], executeModelTool: async () => undefined } as never, skillManager: skillManager as never, model: 'test' });
  try {
    runtime.enqueue({ adminId: admin.id, sessionId: session.id, run: created.run, steps: created.steps });
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline && !['succeeded', 'failed'].includes((await store.getRun(admin.id, created.run.id))?.run.status ?? '')) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal((await store.getRun(admin.id, created.run.id))?.run.status, 'succeeded');
    assert.equal(executions, 0);
    assert.ok((await store.listRunEvents(admin.id, created.run.id, 0)).some((item) => item.eventType === 'tool.result' && item.payload.reused === true));
  } finally { runtime.stop(); }
});

test('Pi runtime keeps the Skill login-required state actionable despite a nonzero exit', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'skill-login-required@example.com', passwordHash: 'hash', displayName: 'Skill Login' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'skill-login-required' });
  const session = await store.createAgentSession({ adminId: admin.id, accountId: account.id, title: 'Skill login' });
  const created = await store.createRun({ adminId: admin.id, accountId: account.id, sessionId: session.id, instruction: '搜索文件' });
  const model: ModelClient = {
    async stream() { return { content: '', model: 'test', toolCalls: [{ id: 'login-needed', type: 'function', function: { name: 'pi_skill_exec', arguments: '{}' } }] }; },
    async complete() { return { content: 'unused', model: 'test' }; },
  };
  const skillManager = { handleInstruction: async () => undefined, buildSystemPrompt: async () => '', getModelTools: () => [], executeModelTool: async () => ({ kind: 'read', title: 'Skill', summary: 'Skill login required', content: '请先登录', data: { code: 1, status: 'unauthorized', requiresLogin: true, userActionRequired: true } }) };
  const runtime = new PiRuntimeAdapter(store, model, { workspaceCommands: { getModelTools: () => [], executeModelTool: async () => undefined } as never, skillManager: skillManager as never, model: 'test' });
  try {
    runtime.enqueue({ adminId: admin.id, sessionId: session.id, run: created.run, steps: created.steps });
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline && !['succeeded', 'failed'].includes((await store.getRun(admin.id, created.run.id))?.run.status ?? '')) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal((await store.getRun(admin.id, created.run.id))?.run.status, 'succeeded');
    assert.ok((await store.listRunEvents(admin.id, created.run.id, 0)).some((item) => item.eventType === 'workspace.skill.lifecycle' && item.payload.status === 'pending_user_action'));
  } finally { runtime.stop(); }
});

test('workspace model messages follow the language of the current user instruction', () => {
  assert.equal(detectWorkspaceResponseLanguage('请查看商品状态'), 'zh-CN');
  assert.equal(detectWorkspaceResponseLanguage('Check the product status'), 'zh-CN');

  const chineseMessages = buildWorkspaceModelMessages([{ role: 'assistant', content: 'previous English history' }], '请用中文总结商品状态');
  const chineseSystem = chineseMessages.find((message) => message.role === 'system');
  assert.match(String(chineseSystem?.content), /简体中文/);
  assert.equal(chineseMessages.at(-1)?.role, 'user');

  const englishInputMessages = buildWorkspaceModelMessages([], 'Summarize the product status');
  const chineseOnlySystem = englishInputMessages.find((message) => message.role === 'system');
  assert.match(String(chineseOnlySystem?.content), /简体中文/);
  assert.doesNotMatch(String(chineseOnlySystem?.content), /Response language rule|write reasoning summaries/i);
});

test('workspace PI model messages carry image and document attachments', () => {
  const messages = buildWorkspaceModelMessages([], '请分析附件', '', [
    { kind: 'image', name: '截图.png', mimeType: 'image/png', size: 12, dataUrl: 'data:image/png;base64,AAAA' },
    { kind: 'document', name: '说明.pdf', mimeType: 'application/pdf', size: 24, dataUrl: 'data:application/pdf;base64,BBBB' },
  ]);
  const content = messages.at(-1)?.content;
  assert.ok(Array.isArray(content));
  assert.ok(content.some((part) => part.type === 'image_url'));
  assert.ok(content.some((part) => part.type === 'file'));
});

test('Pi runtime adds the current Chinese language rule to non-streaming fallback requests', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'language-fallback@example.com', passwordHash: 'hash', displayName: 'Language Fallback' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'language-fallback' });
  const session = await store.createAgentSession({ adminId: admin.id, accountId: account.id, title: 'Language fallback' });
  const created = await store.createRun({ adminId: admin.id, accountId: account.id, sessionId: session.id, instruction: '\u8bf7\u7ed9\u6211\u4e00\u4e2a\u7b80\u77ed\u603b\u7ed3' });
  let request;
  const model: ModelClient = {
    async complete(input) {
      request = { messages: input.messages };
      return { content: 'done', model: 'fallback-model' };
    },
  };
  const runtime = new PiRuntimeAdapter(store, model, { model: 'fallback-model' });
  runtime.enqueue({ adminId: admin.id, sessionId: session.id, run: created.run, steps: created.steps });
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const bundle = await store.getRun(admin.id, created.run.id);
    if (bundle?.run.status === 'succeeded' || bundle?.run.status === 'failed') break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal((await store.getRun(admin.id, created.run.id))?.run.status, 'succeeded');
  assert.match(String(request?.messages.find((message) => message.role === 'system')?.content), /\u7b80\u4f53\u4e2d\u6587/u);
  runtime.stop();
});

test('OpenAI Responses streaming forwards reasoning summary and function calls', async () => {
  const client = new OpenAICompatibleModelClient({
    apiKey: 'test-key',
    baseUrl: 'https://model.example/v1',
    model: 'responses-stream-model',
    wireApi: 'responses',
    fetchImpl: async () => sse(
      'event: response.reasoning_summary_text.delta\ndata: {"type":"response.reasoning_summary_text.delta","delta":"先分析"}\n\n',
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"处理中"}\n\n',
      'event: response.output_item.added\ndata: {"type":"response.output_item.added","output_index":0,"item":{"type":"function_call","call_id":"call-r1","name":"workspace_read","arguments":""}}\n\n',
      'event: response.function_call_arguments.delta\ndata: {"type":"response.function_call_arguments.delta","output_index":0,"call_id":"call-r1","delta":"{\\"instruction\\":\\"查看商品\\"}"}\n\n',
      'event: response.output_item.done\ndata: {"type":"response.output_item.done","output_index":0,"item":{"type":"function_call","call_id":"call-r1","name":"workspace_read","arguments":"{\\"instruction\\":\\"查看商品\\"}"}}\n\n',
      'event: response.completed\ndata: {"type":"response.completed","response":{"model":"responses-stream-model","output":[{"type":"function_call","call_id":"call-r1","name":"workspace_read","arguments":"{\\"instruction\\":\\"查看商品\\"}"}],"usage":{"input_tokens":2,"output_tokens":3}}}\n\n',
      'data: [DONE]\n\n',
    ) as typeof fetch,
  });
  const reasoning: string[] = [];
  const calls: string[] = [];
  const result = await client.stream({ messages: [{ role: 'user', content: '查看商品' }] }, {
    onReasoningDelta: (delta) => { reasoning.push(delta); },
    onToolCall: (call) => { calls.push(call.function.name); },
  });
  assert.deepEqual(reasoning, ['先分析']);
  assert.deepEqual(calls, ['workspace_read']);
  assert.equal(result.toolCalls?.[0]?.id, 'call-r1');
  assert.deepEqual(result.usage, { input_tokens: 2, output_tokens: 3 });
});

test('Pi runtime replays a wrong tool choice and lets the model correct itself from the tool error', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'tool-recovery@example.com', passwordHash: 'hash', displayName: 'Tool Recovery' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'tool-recovery' });
  const session = await store.createAgentSession({ adminId: admin.id, accountId: account.id, title: 'Tool recovery' });
  const instruction = '\u5e2e\u6211\u53d6\u6d88 \u89c6\u9891\u4e0b\u8f7d\u53ca\u6587\u6848\u63d0\u53d6\u6e90\u7801\uff0c\u5305\u6559\u5305\u4f1a \u8fd9\u4e2a\u5546\u54c1\u7684\u81ea\u52a8\u5316\u89c4\u5219';
  const created = await store.createRun({ adminId: admin.id, accountId: account.id, sessionId: session.id, instruction });
  const selectedTools: string[] = [];
  let round = 0;
  const readCall = { id: 'call-read', type: 'function' as const, function: { name: 'workspace_read', arguments: JSON.stringify({ instruction }) } };
  const writeCall = { id: 'call-write', type: 'function' as const, function: { name: 'workspace_prepare_write', arguments: JSON.stringify({ instruction }) } };
  const model: ModelClient = {
    async stream(_input, handlers) {
      round += 1;
      if (round === 1) {
        selectedTools.push(readCall.function.name);
        await handlers.onToolCall?.(readCall);
        return { content: '', model: 'recovery-model', toolCalls: [readCall] };
      }
      if (round === 2) {
        selectedTools.push(writeCall.function.name);
        await handlers.onToolCall?.(writeCall);
        return { content: '', model: 'recovery-model', toolCalls: [writeCall] };
      }
      await handlers.onTextDelta?.('confirmation plan ready');
      return { content: 'confirmation plan ready', model: 'recovery-model' };
    },
    async complete() { return { content: 'unused', model: 'unused' }; },
  };
  const commandTool = {
    getModelTools: () => [
      { type: 'function', function: { name: 'workspace_read', description: 'read', parameters: { type: 'object' } } },
      { type: 'function', function: { name: 'workspace_prepare_write', description: 'write', parameters: { type: 'object' } } },
    ],
    executeModelTool: async (name: string) => {
      if (name === 'workspace_read') {
        const error = new Error('mutation requires workspace_prepare_write') as Error & { code: string };
        error.code = 'WORKSPACE_WRITE_REQUIRED';
        throw error;
      }
      return { kind: 'write_plan' as const, title: 'Disable automation confirmation', summary: 'Prepared disable plan', content: 'Awaiting confirmation', plan: { kind: 'product_automation_update', action: 'product_automation_update', title: 'Disable automation confirmation', summary: 'Prepared disable plan', content: 'Awaiting confirmation', policyRef: 'workspace.product_automation_update.confirm', expiresAt: new Date(Date.now() + 60_000).toISOString(), manifest: { action: 'product_automation_update', productId: 'product-1' } } };
    },
  } as unknown as WorkspaceCommandOrchestrator;
  const runtime = new PiRuntimeAdapter(store, model, { workspaceCommands: commandTool, model: 'recovery-model' });
  runtime.enqueue({ adminId: admin.id, sessionId: session.id, run: created.run, steps: created.steps });
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const bundle = await store.getRun(admin.id, created.run.id);
    if (bundle?.run.status === 'waiting_confirmation' || bundle?.run.status === 'failed') break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const bundle = await store.getRun(admin.id, created.run.id);
  assert.equal(bundle?.run.status, 'waiting_confirmation');
  assert.deepEqual(selectedTools, ['workspace_read', 'workspace_prepare_write']);
  const events = await store.listRunEvents(admin.id, created.run.id, 0);
  assert.ok(events.some((event) => event.eventType === 'tool.result' && event.payload.status === 'failed' && (event.payload.result as { code?: string })?.code === 'WORKSPACE_WRITE_REQUIRED' && (event.payload.result as { suggestedTool?: string })?.suggestedTool === 'workspace_prepare_write'));
  assert.ok(events.some((event) => event.eventType === 'workspace.confirmation.created'));
  runtime.stop();
});

test('Pi runtime closes a Skill login run after pending user action', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'skill-pending@example.com', passwordHash: 'hash', displayName: 'Skill Pending' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'skill-pending' });
  const session = await store.createAgentSession({ adminId: admin.id, accountId: account.id, title: 'Skill Pending' });
  const created = await store.createRun({ adminId: admin.id, accountId: account.id, sessionId: session.id, instruction: '登录夸克网盘' });
  let rounds = 0;
  const model: ModelClient = {
    async stream(_input, handlers) {
      rounds += 1;
      const call = { id: 'skill-login', type: 'function' as const, function: { name: 'pi_skill_login', arguments: JSON.stringify({ skillId: 'quarkclouddrive' }) } };
      await handlers.onToolCall?.(call);
      return { content: '', model: 'pending-model', toolCalls: [call] };
    },
    async complete() { return { content: 'unused', model: 'unused' }; },
  };
  const commandTool = {
    getModelTools: () => [{ type: 'function', function: { name: 'pi_skill_login', description: 'login', parameters: { type: 'object' } } }],
    executeModelTool: async () => ({ kind: 'read' as const, title: 'quarkclouddrive | login', summary: 'Skill login needs user action', content: '请在浏览器中完成登录后把授权码粘贴回当前对话。', data: { status: 'pending_user_action', userActionRequired: true, authUrl: 'https://example.test/login' } }),
  } as unknown as WorkspaceCommandOrchestrator;
  const runtime = new PiRuntimeAdapter(store, model, { workspaceCommands: commandTool, model: 'pending-model' });
  runtime.enqueue({ adminId: admin.id, sessionId: session.id, run: created.run, steps: created.steps });
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const bundle = await store.getRun(admin.id, created.run.id);
    if (bundle?.run.status === 'succeeded' || bundle?.run.status === 'failed') break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const bundle = await store.getRun(admin.id, created.run.id);
  assert.equal(bundle?.run.status, 'succeeded');
  assert.equal(rounds, 1);
  const events = await store.listRunEvents(admin.id, created.run.id, 0);
  assert.ok(events.some((event) => event.eventType === 'workspace.skill.lifecycle' && event.payload.status === 'pending_user_action'));
  assert.ok(events.some((event) => event.eventType === 'run.succeeded' && String(event.payload.content).includes('授权码')));
  runtime.stop();
});
