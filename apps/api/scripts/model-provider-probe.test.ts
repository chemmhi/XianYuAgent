import assert from 'node:assert/strict';
import test from 'node:test';
import { OpenAICompatibleModelClient } from '../src/pi-runtime.js';

function client(strategy: 'models' | 'completion' | 'health_url' | 'none', fetchImpl: typeof fetch, extra: Record<string, unknown> = {}) {
  return new OpenAICompatibleModelClient({ apiKey: 'secret', baseUrl: 'https://provider.example/v1', model: 'target-model', timeoutMs: 100, probeStrategy: strategy, fetchImpl, ...extra });
}

test('models probe requires target model', async () => {
  const fetchImpl = (async () => new Response(JSON.stringify({ data: [{ id: 'target-model' }] }), { status: 200 })) as typeof fetch;
  assert.equal((await client('models', fetchImpl).safeProbe()).ok, true);
});

test('models probe distinguishes unsupported endpoint from missing model', async () => {
  const unsupported = (async () => new Response('', { status: 404 })) as typeof fetch;
  assert.equal((await client('models', unsupported).safeProbe()).code, 'PROBE_UNSUPPORTED');
  const missing = (async () => new Response(JSON.stringify({ data: [{ id: 'other-model' }] }), { status: 200 })) as typeof fetch;
  assert.equal((await client('models', missing).safeProbe()).code, 'PROBE_MODEL_MISSING');
  const unauthorized = (async () => new Response('', { status: 401 })) as typeof fetch;
  assert.equal((await client('models', unauthorized).safeProbe()).code, 'PROBE_AUTH_FAILED');
});

test('health_url probe is host restricted and none disables auto probing', async () => {
  const fetchImpl = (async () => new Response('', { status: 200 })) as typeof fetch;
  const blocked = await client('health_url', fetchImpl, { probeUrl: 'https://other.example/health' }).safeProbe();
  assert.equal(blocked.code, 'PROBE_UNSUPPORTED');
  const disabled = await client('none', fetchImpl).safeProbe();
  assert.equal(disabled.code, 'PROBE_UNSUPPORTED');
});

test('probe timeout is independent from business timeout', async () => {
  const fetchImpl = (async (_url, init) => {
    await new Promise((resolve) => setTimeout(resolve, 30));
    if (init?.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    return new Response(JSON.stringify({ data: [{ id: 'target-model' }] }), { status: 200 });
  }) as typeof fetch;
  const result = await client('models', fetchImpl, { timeoutMs: 1_000, probeTimeoutMs: 5 }).safeProbe();
  assert.equal(result.code, 'PROBE_TIMEOUT');
});
