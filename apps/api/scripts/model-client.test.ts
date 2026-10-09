import assert from 'node:assert/strict';
import test from 'node:test';
import { ModelClientService, type ModelClient } from '../src/model-client.js';
import { OpenAICompatibleModelClient, PiModelClientError } from '../src/pi-runtime.js';

function reply(content: string, model = 'test-model') {
  return { content, model };
}

test('ModelClientService uses the primary provider when it succeeds', async () => {
  const calls: string[] = [];
  const primary: ModelClient = { complete: async () => { calls.push('primary'); return reply('主回复', 'primary-model'); } };
  const backup: ModelClient = { complete: async () => { calls.push('backup'); return reply('备用回复', 'backup-model'); } };

  const result = await new ModelClientService({ primary, backup }).complete({ messages: [{ role: 'user', content: 'hello' }] });

  assert.deepEqual(result, reply('主回复', 'primary-model'));
  assert.deepEqual(calls, ['primary']);
});

test('ModelClientService switches to backup after a primary failure', async () => {
  const calls: string[] = [];
  const primary: ModelClient = { complete: async () => { calls.push('primary'); throw new Error('primary unavailable'); } };
  const backup: ModelClient = { complete: async () => { calls.push('backup'); return reply('备用回复', 'backup-model'); } };
  const failovers: string[] = [];

  const result = await new ModelClientService({
    primary,
    backup,
    onFailover: ({ provider }) => { failovers.push(provider); },
  }).complete({ messages: [{ role: 'user', content: 'hello' }] });

  assert.deepEqual(result, reply('备用回复', 'backup-model'));
  assert.deepEqual(calls, ['primary', 'backup']);
  assert.deepEqual(failovers, ['primary']);
});

test('ModelClientService preserves the backup failure when both providers fail', async () => {
  const primary: ModelClient = { complete: async () => { throw new Error('primary unavailable'); } };
  const backup: ModelClient = { complete: async () => { throw new Error('backup unavailable'); } };

  await assert.rejects(
    () => new ModelClientService({ primary, backup }).complete({ messages: [{ role: 'user', content: 'hello' }] }),
    /backup unavailable/,
  );
});

test('ModelClientService only advertises web search when every provider supports it', () => {
  const primary: ModelClient = { supportsWebSearch: true, complete: async () => reply('主回复') };
  const backup: ModelClient = { supportsWebSearch: false, complete: async () => reply('备用回复') };

  assert.equal(new ModelClientService({ primary, backup }).supportsWebSearch, false);
  assert.equal(new ModelClientService({ primary }).supportsWebSearch, true);
});

test('ModelClientService only advertises structured output when every provider supports it', () => {
  const primary: ModelClient = { supportsStructuredOutput: true, complete: async () => reply('主回复') };
  const backup: ModelClient = { supportsStructuredOutput: false, complete: async () => reply('备用回复') };

  assert.equal(new ModelClientService({ primary, backup }).supportsStructuredOutput, false);
  assert.equal(new ModelClientService({ primary }).supportsStructuredOutput, true);
});

test('Responses structured output uses identical provider-agnostic json_schema formatting', async () => {
  const requests: Array<{ provider: string; body: Record<string, unknown> }> = [];
  const fetchImpl = (async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    requests.push({ provider: String(body.model), body });
    return new Response(JSON.stringify({ model: body.model, output_text: '{"decision":"reply"}' }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const structuredOutput = {
    name: 'auto_reply_decision',
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: { decision: { type: 'string' } },
      required: ['decision'],
    },
  };

  const openai = new OpenAICompatibleModelClient({ apiKey: 'test-key', baseUrl: 'https://model.example/v1', model: 'openai-model', provider: 'openai', wireApi: 'responses', fetchImpl });
  const deepseek = new OpenAICompatibleModelClient({ apiKey: 'test-key', baseUrl: 'https://api.deepseek.example/v1', model: 'deepseek-model', provider: 'deepseek', wireApi: 'responses', fetchImpl });
  const cch = new OpenAICompatibleModelClient({ apiKey: 'test-key', baseUrl: 'https://cch.example/v1', model: 'cch-model', provider: 'cch', wireApi: 'responses', fetchImpl });
  await openai.complete({ messages: [{ role: 'user', content: 'reply' }], structuredOutput });
  await deepseek.complete({
    messages: [{ role: 'user', content: 'reply' }],
    tools: [{ type: 'function', function: { name: 'get_product_info', description: 'read product facts', parameters: { type: 'object' } } }],
    toolChoice: 'auto',
    structuredOutput,
  });
  await cch.complete({ messages: [{ role: 'user', content: 'reply' }], structuredOutput });

  const openaiFormat = ((requests[0]?.body.text as Record<string, unknown>).format) as Record<string, unknown>;
  const deepseekFormat = ((requests[1]?.body.text as Record<string, unknown>).format) as Record<string, unknown>;
  const cchFormat = ((requests[2]?.body.text as Record<string, unknown>).format) as Record<string, unknown>;
  const expectedFormat = { type: 'json_schema', name: 'auto_reply_decision', schema: structuredOutput.schema };
  assert.deepEqual(openaiFormat, expectedFormat);
  assert.deepEqual(deepseekFormat, expectedFormat);
  assert.deepEqual(cchFormat, expectedFormat);
  assert.deepEqual(requests[1]?.body.tools, [{ type: 'function', name: 'get_product_info', description: 'read product facts', parameters: { type: 'object' } }]);
  assert.equal(openai.supportsStructuredOutput, true);
  assert.equal(deepseek.supportsStructuredOutput, true);
  assert.equal(deepseek.supportsWebSearch, true);
  assert.equal(cch.supportsWebSearch, false);
});

test('Responses accepts unknown providers as metadata without enabling web_search', () => {
  const custom = new OpenAICompatibleModelClient({ apiKey: 'test-key', baseUrl: 'https://model.example/v1', model: 'unknown-model', provider: 'custom-compatible', wireApi: 'responses' });
  assert.equal(custom.supportsStructuredOutput, true);
  assert.equal(custom.supportsWebSearch, false);
  const legacyAlias = new OpenAICompatibleModelClient({ apiKey: 'test-key', baseUrl: 'https://model.example/v1', model: 'legacy-openai-compatible-model', provider: 'openai-compatible', wireApi: 'responses' });
  assert.equal(legacyAlias.supportsStructuredOutput, true);
  assert.equal(legacyAlias.supportsWebSearch, true);
});

test('ModelClientService falls back after invalid final structured output', async () => {
  const calls: string[] = [];
  const validator = (result: { content: string }) => {
    if (!result.content.includes('valid')) throw new PiModelClientError('MODEL_INVALID_RESPONSE', 'invalid final output');
  };
  const primary: ModelClient = { complete: async () => { calls.push('primary'); return reply('{"decision":"broken"}'); } };
  const backup: ModelClient = { complete: async () => { calls.push('backup'); return reply('{"decision":"valid"}'); } };
  const service = new ModelClientService({ primary, backup });
  const result = await service.complete({ messages: [{ role: 'user', content: 'hello' }], validateFinalOutput: validator });
  assert.equal(result.content, '{"decision":"valid"}');
  assert.deepEqual(calls, ['primary', 'backup']);
});

test('ModelClientService preserves invalid-output classification after both final attempts fail', async () => {
  const validator = () => { throw new PiModelClientError('MODEL_INVALID_RESPONSE', 'invalid final output'); };
  const service = new ModelClientService({
    primary: { complete: async () => reply('bad-primary') },
    backup: { complete: async () => reply('bad-backup') },
  });
  await assert.rejects(() => service.complete({ messages: [{ role: 'user', content: 'hello' }], validateFinalOutput: validator }), (error: unknown) => error instanceof PiModelClientError && error.code === 'MODEL_INVALID_RESPONSE');
});

test('Responses rejects failed, incomplete, and refusal payloads as invalid responses', async () => {
  const payloads = [
    { status: 'failed', error: { message: 'provider failed' } },
    { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } },
    { status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: '拒绝输出' }] }] },
  ];
  for (const payload of payloads) {
    const client = new OpenAICompatibleModelClient({
      apiKey: 'test-key',
      baseUrl: 'https://model.example/v1',
      model: 'responses-model',
      wireApi: 'responses',
      fetchImpl: (async () => new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch,
    });
    await assert.rejects(
      () => client.complete({ messages: [{ role: 'user', content: 'reply' }] }),
      (error: unknown) => error instanceof PiModelClientError && error.code === 'MODEL_INVALID_RESPONSE',
    );
  }
});

test('ModelClientService bypasses an OPEN primary on subsequent requests', async () => {
  const calls: string[] = [];
  const primary: ModelClient = { complete: async () => { calls.push('primary'); throw new PiModelClientError('MODEL_TIMEOUT', 'primary timed out'); } };
  const backup: ModelClient = { complete: async () => { calls.push('backup'); return reply('备用回复', 'backup-model'); } };
  const service = new ModelClientService({ primary, backup, overallTimeoutMs: 5_000 });

  await service.complete({ messages: [{ role: 'user', content: 'first' }] });
  await service.complete({ messages: [{ role: 'user', content: 'second' }] });

  assert.deepEqual(calls, ['primary', 'backup', 'backup']);
  assert.equal(service.getRuntimeSnapshot().effectiveRole, 'backup');
  assert.equal(service.getRuntimeSnapshot().providerStates.primary.state, 'OPEN');
});

test('ModelClientService allows only one half-open safe probe', async () => {
  let now = 0;
  let probeCalls = 0;
  const primary: ModelClient = {
    complete: async () => { throw new PiModelClientError('MODEL_TIMEOUT', 'down'); },
    safeProbe: async () => { probeCalls += 1; await new Promise((resolve) => setTimeout(resolve, 5)); return { ok: true, latencyMs: 5 }; },
  };
  const backup: ModelClient = { complete: async () => reply('备用回复') };
  const service = new ModelClientService({ primary, backup, now: () => now, overallTimeoutMs: 5_000 });
  await service.complete({ messages: [{ role: 'user', content: 'first' }] });
  now = 60_000;
  const [first, second] = await Promise.all([service.probeProvider('primary'), service.probeProvider('primary')]);
  assert.equal(probeCalls, 1);
  assert.equal(first.ok || second.ok, true);
  assert.equal(service.getRuntimeSnapshot().providerStates.primary.state, 'CLOSED');
});

test('ModelClientService never replays a partial stream to backup', async () => {
  const calls: string[] = [];
  const primary: ModelClient = {
    stream: async (_input, handlers) => { calls.push('primary'); await handlers.onTextDelta?.('partial'); throw new PiModelClientError('MODEL_NETWORK_ERROR', 'stream broke'); },
    complete: async () => reply('unused'),
  };
  const backup: ModelClient = { complete: async () => { calls.push('backup'); return reply('should not replay'); } };
  const service = new ModelClientService({ primary, backup });
  await assert.rejects(() => service.stream!({ messages: [{ role: 'user', content: 'hello' }] }, { onTextDelta: async () => undefined }), /stream broke/);
  assert.deepEqual(calls, ['primary']);
});

test('ModelClientService retries a buffered stream after partial provider output', async () => {
  const calls: string[] = [];
  const primary: ModelClient = {
    stream: async (_input, handlers) => { calls.push('primary'); await handlers.onTextDelta?.('{"decision":"'); throw new PiModelClientError('MODEL_NETWORK_ERROR', 'stream broke'); },
    complete: async () => reply('unused'),
  };
  const backup: ModelClient = {
    stream: async (_input, handlers) => { calls.push('backup'); await handlers.onTextDelta?.('{"decision":"reply","text":"ok"}'); return reply('{"decision":"reply","text":"ok"}'); },
    complete: async () => reply('unused'),
  };
  const service = new ModelClientService({ primary, backup });
  const result = await service.stream!({ messages: [{ role: 'user', content: 'hello' }], buffered: true }, { onTextDelta: async () => undefined });
  assert.equal(result.content, '{"decision":"reply","text":"ok"}');
  assert.deepEqual(calls, ['primary', 'backup']);
});

test('ModelClientService converts thrown probe errors into a retryable OPEN result', async () => {
  let now = 60_000;
  const primary: ModelClient = { complete: async () => reply('unused'), safeProbe: async () => { throw new Error('probe transport failed'); } };
  const service = new ModelClientService({ primary, now: () => now });
  const result = await service.probeProvider('primary');
  assert.equal(result.code, 'PROBE_FAILED');
  assert.equal(service.getRuntimeSnapshot().providerStates.primary.state, 'OPEN');
  assert.equal(service.getRuntimeSnapshot().providerStates.primary.nextProbeAt !== undefined, true);
  now += 60_000;
});

test('ModelClientService does not hydrate a stale CLOSED snapshot over a local OPEN circuit', async () => {
  const primary: ModelClient = { complete: async () => { throw new PiModelClientError('MODEL_TIMEOUT', 'down'); } };
  const service = new ModelClientService({ primary, configGeneration: 7 });
  await assert.rejects(() => service.complete({ messages: [{ role: 'user', content: 'first' }] }));
  assert.equal(service.getRuntimeSnapshot().providerStates.primary.state, 'OPEN');

  service.hydrateCircuitSnapshots({
    generation: 7,
    stateRevision: 99,
    providerStates: {
      primary: { role: 'primary', state: 'CLOSED', failureCount: 0, generation: 7, lastTransitionReason: 'request_succeeded' },
    },
  });
  assert.equal(service.getRuntimeSnapshot().providerStates.primary.state, 'OPEN');

  service.hydrateCircuitSnapshots({
    generation: 7,
    stateRevision: 100,
    providerStates: {
      primary: { role: 'primary', state: 'CLOSED', failureCount: 0, generation: 7, lastTransitionReason: 'safe_probe_succeeded' },
    },
  });
  assert.equal(service.getRuntimeSnapshot().providerStates.primary.state, 'CLOSED');
});

test('ModelClientService persists manual-only auth circuit state across hydration', async () => {
  let now = 0;
  const primary: ModelClient = {
    complete: async () => { throw new PiModelClientError('MODEL_HTTP_ERROR', 'unauthorized', 401); },
    safeProbe: async () => ({ ok: false, code: 'PROBE_AUTH_FAILED', latencyMs: 1 }),
  };
  const service = new ModelClientService({ primary, configGeneration: 8, now: () => now });
  await assert.rejects(() => service.complete({ messages: [{ role: 'user', content: 'first' }] }));
  const persisted = service.getRuntimeSnapshot();
  assert.equal(persisted.providerStates.primary.manualOnly, true);
  assert.equal(persisted.providerStates.primary.nextProbeAt, undefined);

  const restored = new ModelClientService({ primary, configGeneration: 8, now: () => now });
  restored.hydrateCircuitSnapshots({ generation: 8, stateRevision: persisted.stateRevision + 1, providerStates: persisted.providerStates });
  assert.equal(restored.getRuntimeSnapshot().providerStates.primary.manualOnly, true);
  const probe = await restored.probeProvider('primary');
  assert.equal(probe.code, 'PROBE_AUTH_FAILED');
  assert.equal(restored.getRuntimeSnapshot().providerStates.primary.nextProbeAt, undefined);
});

test('ModelClientService emits a fast-fail event when both circuits are OPEN', async () => {
  const events: string[] = [];
  const primary: ModelClient = { complete: async () => { throw new PiModelClientError('MODEL_TIMEOUT', 'down'); } };
  const backup: ModelClient = { complete: async () => { throw new PiModelClientError('MODEL_TIMEOUT', 'down'); } };
  const service = new ModelClientService({ primary, backup, onFastFail: ({ reason }) => { events.push(reason); } });
  await assert.rejects(() => service.complete({ messages: [{ role: 'user', content: 'first' }] }));
  await assert.rejects(() => service.complete({ messages: [{ role: 'user', content: 'second' }] }), (error: unknown) => error instanceof PiModelClientError && error.code === 'MODEL_PROVIDER_UNAVAILABLE');
  assert.deepEqual(events, ['no_available_provider']);
});

test('ModelClientService honors an Auto Reply request deadline instead of resetting to the Workspace budget', async () => {
  let receivedDeadline: number | undefined;
  const service = new ModelClientService({
    overallTimeoutMs: 10,
    primary: {
      complete: async (input) => { receivedDeadline = input.deadlineAt; return reply('ok'); },
    },
  });
  const deadlineAt = Date.now() + 1_000;
  await service.complete({ messages: [{ role: 'user', content: 'hello' }], deadlineAt, timeoutPhase: 'model_generation' });
  assert.equal(receivedDeadline, deadlineAt);
});

test('an internal Agent deadline is MODEL_TIMEOUT without fallback or circuit opening', async () => {
  const calls: string[] = [];
  const primary: ModelClient = {
    complete: async () => { calls.push('primary'); throw new PiModelClientError('MODEL_TIMEOUT', 'agent deadline', undefined, undefined, { origin: 'agent_deadline', timeoutPhase: 'model_generation' }); },
  };
  const backup: ModelClient = { complete: async () => { calls.push('backup'); return reply('备用回复'); } };
  const service = new ModelClientService({ primary, backup });
  await assert.rejects(() => service.complete({ messages: [{ role: 'user', content: 'hello' }] }), (error: unknown) => error instanceof PiModelClientError && error.origin === 'agent_deadline');
  assert.deepEqual(calls, ['primary']);
  assert.equal(service.getRuntimeSnapshot().providerStates.primary.state, 'CLOSED');
});

test('Auto Reply request deadline is the transport timeout even when provider timeout is shorter', async () => {
  const client = new OpenAICompatibleModelClient({
    apiKey: 'test-key',
    baseUrl: 'https://model.example/v1',
    model: 'deadline-model',
    wireApi: 'chat',
    timeoutMs: 5,
    fetchImpl: async (_input, init) => await new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(() => resolve(new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200, headers: { 'content-type': 'application/json' } })), 10);
      init?.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('transport aborted')); }, { once: true });
    }),
  });
  const result = await client.complete({ messages: [{ role: 'user', content: 'hello' }], deadlineAt: Date.now() + 40, timeoutPhase: 'model_generation' });
  assert.equal(result.content, 'ok');
});

test('OpenAI transport preserves internal deadline origin instead of misclassifying it as user abort', async () => {
  const controller = new AbortController();
  const client = new OpenAICompatibleModelClient({
    apiKey: 'test-key',
    baseUrl: 'https://model.example/v1',
    model: 'timeout-model',
    wireApi: 'chat',
    fetchImpl: async (_input, init) => await new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('transport aborted')), { once: true });
    }),
  });
  const request = client.complete({ messages: [{ role: 'user', content: 'slow' }], signal: controller.signal, timeoutPhase: 'model_generation' });
  setTimeout(() => controller.abort({ kind: 'agent_deadline' }), 5);
  await assert.rejects(request, (error: unknown) => error instanceof PiModelClientError && error.code === 'MODEL_TIMEOUT' && error.origin === 'agent_deadline' && error.timeoutPhase === 'model_generation');
});

test('OpenAI transport preserves an already-aborted Agent deadline reason', async () => {
  const controller = new AbortController();
  controller.abort({ kind: 'agent_deadline' });
  const client = new OpenAICompatibleModelClient({
    apiKey: 'test-key',
    baseUrl: 'https://model.example/v1',
    model: 'timeout-model',
    wireApi: 'chat',
    fetchImpl: async (_input, init) => {
      if (init?.signal?.aborted) throw new Error('transport aborted');
      return new Response(JSON.stringify({ choices: [{ message: { content: 'unexpected' } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  await assert.rejects(() => client.complete({ messages: [{ role: 'user', content: 'slow' }], signal: controller.signal, timeoutPhase: 'model_generation' }), (error: unknown) => error instanceof PiModelClientError && error.code === 'MODEL_TIMEOUT' && error.origin === 'agent_deadline');
});
