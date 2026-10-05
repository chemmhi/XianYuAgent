import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryStore } from '../src/store-memory.js';
import { OpenAICompatibleModelClient, PiRuntimeAdapter, type ModelClient, type ModelCompletionResult, type ModelStreamHandlers } from '../src/pi-runtime.js';
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
  const model: ModelClient = {
    async stream(_input, handlers: ModelStreamHandlers): Promise<ModelCompletionResult> {
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
  assert.equal((await store.getRun(admin.id, created.run.id))?.run.status, 'succeeded');
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
