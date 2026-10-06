import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryStore } from '../src/store-memory.js';
import { buildWorkspaceModelMessages, detectWorkspaceResponseLanguage, OpenAICompatibleModelClient, PiRuntimeAdapter, type ModelClient, type ModelCompletionResult, type ModelStreamHandlers } from '../src/pi-runtime.js';
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
    executeModelTool: async () => ({ kind: 'read' as const, title: '商品', summary: '读取完成', content: '工具返回商品', data: { count: 1 } }),
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
  assert.ok(events.some((event) => event.eventType === 'reasoning.delta' && String(event.payload.contentDelta).includes('读取')));
  assert.ok(events.some((event) => event.eventType === 'tool.call.started' && event.payload.toolName === 'workspace_read'));
  assert.ok(events.some((event) => event.eventType === 'tool.result' && event.payload.status === 'succeeded'));
  assert.ok(events.some((event) => event.eventType === 'assistant.delta' && String(event.payload.contentDelta).includes('商品读取完成')));
  assert.match(String(requests[0]?.messages.find((message) => message.role === 'system')?.content), /简体中文/);
  assert.match(String(requests[0]?.messages.find((message) => message.role === 'system')?.content), /思考摘要/);
  assert.equal((await store.getRun(admin.id, created.run.id))?.run.status, 'succeeded');
  runtime.stop();
});

test('workspace model messages follow the language of the current user instruction', () => {
  assert.equal(detectWorkspaceResponseLanguage('请查看商品状态'), 'zh-CN');
  assert.equal(detectWorkspaceResponseLanguage('Check the product status'), 'en');

  const chineseMessages = buildWorkspaceModelMessages([{ role: 'assistant', content: 'previous English history' }], '请用中文总结商品状态');
  const chineseSystem = chineseMessages.find((message) => message.role === 'system');
  assert.match(String(chineseSystem?.content), /简体中文/);
  assert.equal(chineseMessages.at(-1)?.role, 'user');

  const englishMessages = buildWorkspaceModelMessages([], 'Summarize the product status');
  const englishSystem = englishMessages.find((message) => message.role === 'system');
  assert.match(String(englishSystem?.content), /Response language rule/);
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
