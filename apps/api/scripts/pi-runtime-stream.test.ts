import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryStore } from '../src/store-memory.js';
import { buildWorkspaceModelMessages, detectWorkspaceResponseLanguage, OpenAICompatibleModelClient, PiModelClientError, PiRuntimeAdapter, type ModelClient, type ModelCompletionResult, type ModelStreamHandlers } from '../src/pi-runtime.js';
import type { WorkspaceCommandOrchestrator } from '../src/workspace-commands.js';

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
    getModelTools: () => [{ type: 'function', function: { name: 'workspace_read', description: 'read', parameters: { type: 'object' } } }],
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
    async complete() { return { content: 'unused', model: 'unused' }; },
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
      const command = round % 2 === 1 ? 'search' : 'share';
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
    assert.deepEqual(executed, ['search', 'share', 'search']);
    const events = await store.listRunEvents(admin.id, created.run.id, 0);
    assert.equal(events.filter((item) => item.eventType === 'tool.result' && item.payload.reused === true).length, 1);
  } finally { runtime.stop(); }
});

test('Pi runtime reuses a durable Skill result after continuation', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'skill-resume-cache@example.com', passwordHash: 'hash', displayName: 'Skill Resume' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'skill-resume-cache' });
  const session = await store.createAgentSession({ adminId: admin.id, accountId: account.id, title: 'Resume cache' });
  const created = await store.createRun({ adminId: admin.id, accountId: account.id, sessionId: session.id, instruction: '搜索文件' });
  await store.appendRunEvent({ runId: created.run.id, eventType: 'tool.call.started', payload: { toolCallId: 'prior', toolName: 'pi_skill_exec', arguments: '{"command":"search","args":["file"]}' } });
  await store.appendRunEvent({ runId: created.run.id, eventType: 'tool.result', payload: { toolCallId: 'prior', toolName: 'pi_skill_exec', status: 'succeeded', result: { kind: 'read', title: '搜索', summary: '找到文件', content: 'fid=123', data: { status: 'succeeded' } } } });
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
