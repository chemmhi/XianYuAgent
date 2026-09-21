import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { loadPiRuntimeConfig, OpenAICompatibleModelClient, PiModelClientError, PiRuntimeAdapter } from '../dist/pi-runtime.js';

const requests = [];
const server = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
  requests.push({ url: request.url, headers: request.headers, body });

  if (body.model === 'timeout-model') {
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (body.model === 'fail-model') {
    response.writeHead(401, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: { message: 'invalid key test-key-should-not-leak' } }));
    return;
  }
  if (Array.isArray(body.input)) {
    response.writeHead(200, { 'content-type': 'application/json' });
    if (body.model === 'responses-tool-model' && !body.input.some((item) => item?.type === 'function_call_output')) {
      response.end(JSON.stringify({
        id: 'resp_test_tool',
        model: body.model,
        output: [{ type: 'function_call', call_id: 'call_responses_1', name: 'get_product_info', arguments: '{"productRef":"item-1"}' }],
      }));
    } else {
      response.end(JSON.stringify({
        id: 'resp_test_message',
        model: body.model,
        output_text: 'Responses answer',
        output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Responses answer' }] }],
        usage: { input_tokens: 3, output_tokens: 2 },
      }));
    }
    return;
  }
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify({
    model: body.model,
    choices: [{ message: { role: 'assistant', content: 'Pi answer with sk-test-secret-value' } }],
  }));
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const address = server.address();
const baseUrl = `http://127.0.0.1:${address.port}/v1`;

function createRun(model = 'test-model') {
  const run = { id: `run-${model}`, accountId: 'account-1', sessionId: 'session-1', route: 'workspace', instruction: '请回答当前工作区状态', status: 'queued', requestedBy: 'admin-1', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  const step = { id: `step-${model}`, runId: run.id, stepNo: 1, kind: 'plan', label: '解析指令', status: 'pending', attempt: 1, createdAt: run.createdAt };
  return { run, step };
}

function createStore() {
  const events = [];
  return {
    events,
    async updateRun(runId, patch) { void runId; void patch; },
    async updateRunStep(stepId, patch) { void stepId; void patch; },
    async appendRunEvent(input) {
      const event = { sequence: events.length + 1, ...input, createdAt: new Date().toISOString() };
      events.push(event);
      return event;
    },
  };
}

async function waitFor(predicate, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('timed out waiting for Pi Runtime event');
}

try {
  const envConfig = loadPiRuntimeConfig({ API_KEY: 'test-key', BASE_URL: `${baseUrl}/`, MODEL: 'test-model', MODEL_TIMEOUT_MS: '123' });
  assert.deepEqual(envConfig, { apiKey: 'test-key', baseUrl: `${baseUrl}/`, model: 'test-model', timeoutMs: 123, wireApi: 'chat' });
  assert.equal(loadPiRuntimeConfig({ API_KEY: 'test-key', WIRE_API: 'responses' })?.wireApi, 'responses');
  assert.equal(loadPiRuntimeConfig({ API_KEY: 'test-key', MODEL_WIRE_API: 'responses' })?.wireApi, 'responses');
  assert.equal(loadPiRuntimeConfig({}), undefined);

  const client = new OpenAICompatibleModelClient({ apiKey: 'test-key', baseUrl, model: 'test-model', timeoutMs: 500 });
  const result = await client.complete({ messages: [{ role: 'user', content: 'hello' }] });
  assert.equal(result.content, 'Pi answer with sk-test-secret-value');
  assert.equal(result.model, 'test-model');
  assert.equal(requests[0].headers.authorization, 'Bearer test-key');
  assert.equal(requests[0].body.messages[0].content, 'hello');

  const responsesClient = new OpenAICompatibleModelClient({ apiKey: 'test-key', baseUrl, model: 'responses-model', wireApi: 'responses', timeoutMs: 500 });
  const responsesResult = await responsesClient.complete({
    messages: [{ role: 'system', content: 'system instructions' }, { role: 'user', content: 'hello responses' }],
    tools: [{ type: 'function', function: { name: 'get_product_info', description: 'read product', parameters: { type: 'object' } } }],
    toolChoice: 'auto',
  });
  assert.equal(responsesResult.content, 'Responses answer');
  assert.equal(responsesResult.model, 'responses-model');
  assert.deepEqual(responsesResult.usage, { input_tokens: 3, output_tokens: 2 });
  const responsesRequest = requests.find((request) => request.body.model === 'responses-model');
  assert.equal(responsesRequest?.url, '/v1/responses');
  assert.equal(responsesRequest?.body.input[0].type, 'message');
  assert.equal(responsesRequest?.body.input[1].content, 'hello responses');
  assert.equal(responsesRequest?.body.tools[0].name, 'get_product_info');
  assert.equal(responsesRequest?.body.tools[0].function, undefined);

  const responsesToolClient = new OpenAICompatibleModelClient({ apiKey: 'test-key', baseUrl, model: 'responses-tool-model', wireApi: 'responses', timeoutMs: 500 });
  const responsesToolResult = await responsesToolClient.complete({ messages: [{ role: 'user', content: 'lookup' }] });
  assert.equal(responsesToolResult.toolCalls?.[0]?.id, 'call_responses_1');
  assert.equal(responsesToolResult.toolCalls?.[0]?.function.name, 'get_product_info');
  assert.equal(responsesToolResult.toolCalls?.[0]?.function.arguments, '{"productRef":"item-1"}');
  const responsesToolFollowup = await responsesToolClient.complete({ messages: [
    { role: 'assistant', content: '', toolCalls: responsesToolResult.toolCalls },
    { role: 'tool', name: 'get_product_info', toolCallId: 'call_responses_1', content: '{"ok":true}' },
  ] });
  assert.equal(responsesToolFollowup.content, 'Responses answer');
  const followupRequest = requests.filter((request) => request.body.model === 'responses-tool-model').at(-1);
  assert.equal(followupRequest?.body.input[0].type, 'function_call');
  assert.equal(followupRequest?.body.input[1].type, 'function_call_output');
  assert.equal(followupRequest?.body.input[1].call_id, 'call_responses_1');

  const failedClient = new OpenAICompatibleModelClient({ apiKey: 'test-key', baseUrl, model: 'fail-model', timeoutMs: 500 });
  await assert.rejects(() => failedClient.complete({ messages: [{ role: 'user', content: 'hello' }] }), (error) => {
    assert.ok(error instanceof PiModelClientError);
    assert.equal(error.code, 'MODEL_HTTP_ERROR');
    assert.doesNotMatch(error.message, /test-key/);
    return true;
  });

  const timeoutClient = new OpenAICompatibleModelClient({ apiKey: 'test-key', baseUrl, model: 'timeout-model', timeoutMs: 20 });
  await assert.rejects(() => timeoutClient.complete({ messages: [{ role: 'user', content: 'hello' }] }), (error) => {
    assert.ok(error instanceof PiModelClientError);
    assert.equal(error.code, 'MODEL_TIMEOUT');
    return true;
  });

  const store = createStore();
  const messages = [];
  const { run, step } = createRun();
  const adapter = new PiRuntimeAdapter(store, client, {
    model: 'test-model',
    redactSecrets: ['test-key'],
    messageSink: (message) => messages.push(message),
  });
  adapter.enqueue({ run, steps: [step], history: [{ role: 'system', content: 'safe context' }] });
  await waitFor(() => store.events.some((event) => event.eventType === 'run.succeeded'));
  assert.equal(run.status, 'succeeded');
  assert.equal(step.status, 'succeeded');
  assert.equal(messages[0].messageType, 'user_message');
  assert.ok(messages.some((message) => message.messageType === 'final_answer'));
  assert.ok(store.events.some((event) => event.payload.messageType === 'reasoning_summary'));
  assert.ok(store.events.some((event) => event.payload.messageType === 'final_answer'));

  const failedStore = createStore();
  const failedRun = createRun('fail-model');
  const failedAdapter = new PiRuntimeAdapter(failedStore, failedClient, { model: 'fail-model' });
  failedAdapter.enqueue({ run: failedRun.run, steps: [failedRun.step] });
  await waitFor(() => failedStore.events.some((event) => event.eventType === 'run.failed'));
  assert.equal(failedRun.run.status, 'failed');
  assert.equal(failedRun.step.status, 'failed');
  assert.equal(failedStore.events.find((event) => event.eventType === 'run.failed').payload.errorCode, 'MODEL_HTTP_ERROR');

  const stoppedStore = createStore();
  const stoppedRun = createRun('timeout-model');
  const stoppedAdapter = new PiRuntimeAdapter(stoppedStore, timeoutClient, { model: 'timeout-model' });
  stoppedAdapter.enqueue({ run: stoppedRun.run, steps: [stoppedRun.step] });
  stoppedAdapter.stop();
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(stoppedStore.events.some((event) => event.eventType === 'run.failed'), false);

  console.log('pi runtime adapter smoke passed');
} finally {
  server.close();
  await once(server, 'close').catch(() => undefined);
}
