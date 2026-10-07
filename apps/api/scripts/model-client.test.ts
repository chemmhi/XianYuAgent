import assert from 'node:assert/strict';
import test from 'node:test';
import { ModelClientService, type ModelClient } from '../src/model-client.js';
import { PiModelClientError } from '../src/pi-runtime.js';

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
