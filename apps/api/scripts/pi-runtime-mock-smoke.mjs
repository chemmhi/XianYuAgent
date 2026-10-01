import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { MemoryStore } from '../dist/store-memory.js';
import { PiRuntimeAdapter, OpenAICompatibleModelClient } from '../dist/pi-runtime.js';
import { WorkspaceService } from '../dist/workspace.js';

const modelName = 'mock-openai-compatible-model';
const mockApiKey = 'mock-local-only-key';
const calls = [];

const provider = createServer(async (request, response) => {
  if (request.method !== 'POST' || request.url !== '/v1/responses') {
    response.writeHead(404);
    response.end();
    return;
  }

  const body = await readJson(request);
  calls.push({
    authorization: request.headers.authorization,
    contentType: request.headers['content-type'],
    body,
  });

  if (JSON.stringify(body).includes('force model failure')) {
    response.writeHead(503, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: { message: 'mock provider unavailable' } }));
    return;
  }

  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify({
    id: 'resp-mock',
    model: modelName,
    output_text: 'mock provider response',
    usage: { prompt_tokens: 3, completion_tokens: 3, total_tokens: 6 },
  }));
});

const port = await listen(provider);
const baseUrl = `http://127.0.0.1:${port}/v1`;
const store = new MemoryStore();
const admin = await store.createAdmin({ email: 'pi-runtime-smoke@example.com', passwordHash: 'test-only', displayName: 'Pi Runtime Smoke' });
const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'pi-runtime-smoke', displayName: 'Pi Runtime Smoke Account' });
const session = await store.createAgentSession({ adminId: admin.id, accountId: account.id, title: 'Pi mock integration', summary: 'Workspace to OpenAI-compatible provider' });
const audit = async () => 'audit-pi-runtime-smoke';
const modelClient = new OpenAICompatibleModelClient({ apiKey: mockApiKey, baseUrl, model: modelName, timeoutMs: 2_000 });
const runtime = new PiRuntimeAdapter(store, modelClient, { model: modelName });
const workspace = new WorkspaceService(store, runtime, audit);

async function waitForTerminal(runId) {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const bundle = await store.getRun(admin.id, runId);
    if (bundle && ['succeeded', 'failed', 'cancelled', 'expired'].includes(bundle.run.status)) return bundle;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`run ${runId} did not reach a terminal state`);
}

try {
  const success = await workspace.startRun({
    adminId: admin.id,
    accountId: account.id,
    sessionId: session.id,
    instruction: 'return a deterministic mock answer',
    clientRunRef: 'pi-runtime-success',
    requestId: 'pi-runtime-smoke-success',
    traceId: 'pi-runtime-smoke-success',
  });
  assert.equal(success.run.status, 'queued');
  const successBundle = await waitForTerminal(success.run.runId);
  assert.equal(successBundle.run.status, 'succeeded');
  assert.equal(successBundle.run.resultSummary, 'mock provider response');
  assert.equal(successBundle.steps[0]?.status, 'succeeded');

  const successEvents = await workspace.listEvents({ adminId: admin.id, runId: success.run.runId });
  assert.ok(successEvents.some((event) => event.eventType === 'runtime.started'));
  assert.ok(successEvents.some((event) => event.eventType === 'runtime.succeeded'));
  assert.ok(successEvents.some((event) => event.eventType === 'run.succeeded'));

  const failure = await workspace.startRun({
    adminId: admin.id,
    accountId: account.id,
    sessionId: session.id,
    instruction: 'force model failure',
    clientRunRef: 'pi-runtime-failure',
    requestId: 'pi-runtime-smoke-failure',
    traceId: 'pi-runtime-smoke-failure',
  });
  const failureBundle = await waitForTerminal(failure.run.runId);
  assert.equal(failureBundle.run.status, 'failed');
  assert.equal(failureBundle.run.errorCode, 'MODEL_HTTP_ERROR');
  assert.equal(failureBundle.steps[0]?.errorCode, 'MODEL_HTTP_ERROR');

  const failureEvents = await workspace.listEvents({ adminId: admin.id, runId: failure.run.runId });
  const serializedFailure = JSON.stringify(failureEvents);
  assert.ok(failureEvents.some((event) => event.eventType === 'runtime.failed'));
  assert.ok(!serializedFailure.includes(mockApiKey));

  assert.equal(calls.length, 2);
  assert.equal(calls[0].authorization, `Bearer ${mockApiKey}`);
  assert.equal(calls[0].contentType, 'application/json');
  assert.equal(calls[0].body.model, modelName);
  assert.ok(Array.isArray(calls[0].body.input));
  assert.equal(calls[0].body.input[0]?.type, 'message');
  assert.equal(calls[0].body.input[0]?.content, 'return a deterministic mock answer');

  console.log(JSON.stringify({
    provider: {
      endpoint: '/v1/responses',
      requests: calls.length,
      authorizationForwarded: calls.every((call) => typeof call.authorization === 'string' && call.authorization.startsWith('Bearer ')),
      keyPrinted: false,
      model: calls[0].body.model,
    },
    successRun: { status: successBundle.run.status, resultSummary: successBundle.run.resultSummary, runtimeEvents: successEvents.filter((event) => event.eventType.startsWith('runtime.')).map((event) => event.eventType) },
    failureRun: { status: failureBundle.run.status, errorCode: failureBundle.run.errorCode, providerDetailsRedacted: !serializedFailure.includes(mockApiKey) },
  }, null, 2));
} finally {
  runtime.stop();
  await close(provider);
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch (error) { reject(error); }
    });
    request.on('error', reject);
  });
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
