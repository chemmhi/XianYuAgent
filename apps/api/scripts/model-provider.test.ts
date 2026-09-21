import assert from 'node:assert/strict';
import test from 'node:test';
import { listProviderModels, ModelProviderError, resolveModelsEndpoint } from '../src/model-provider.js';

test('lists provider-owned models without embedding model ids', async () => {
  const calls: Array<{ url: string; authorization?: string }> = [];
  const models = await listProviderModels({
    apiKey: 'test-secret',
    baseUrl: 'https://provider.example/v1',
    fetchImpl: (async (input, init) => {
      calls.push({ url: String(input), authorization: new Headers(init?.headers).get('authorization') ?? undefined });
      return new Response(JSON.stringify({ data: [
        { id: 'provider-model-a' },
        { id: 'provider-model-a' },
        { id: 'provider-model-b', owned_by: 'provider', reasoning_efforts: ['low', 'high', 'low'], thinking_levels: ['balanced'] },
      ] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch,
  });
  assert.deepEqual(models, [
    { id: 'provider-model-a' },
    { id: 'provider-model-b', ownedBy: 'provider', reasoningEfforts: ['low', 'high'], thinkingLevels: ['balanced'] },
  ]);
  assert.deepEqual(calls, [{ url: 'https://provider.example/v1/models', authorization: 'Bearer test-secret' }]);
});

test('rejects cross-host or non-http model endpoints', () => {
  assert.throws(() => resolveModelsEndpoint('https://provider.example/v1', 'https://attacker.example/models'), (error: unknown) => error instanceof ModelProviderError && error.code === 'MODEL_PROVIDER_INVALID_URL');
  assert.throws(() => resolveModelsEndpoint('file:///tmp/provider'), (error: unknown) => error instanceof ModelProviderError && error.code === 'MODEL_PROVIDER_INVALID_URL');
});

test('returns provider errors for empty and failed responses', async () => {
  await assert.rejects(() => listProviderModels({
    apiKey: 'test-secret',
    baseUrl: 'https://provider.example/v1',
    fetchImpl: (async () => new Response(JSON.stringify({ choices: [] }), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch,
  }), (error: unknown) => error instanceof ModelProviderError && error.code === 'MODEL_PROVIDER_INVALID_RESPONSE');
  await assert.rejects(() => listProviderModels({
    apiKey: 'test-secret',
    baseUrl: 'https://provider.example/v1',
    fetchImpl: (async () => new Response('', { status: 401 })) as typeof fetch,
  }), (error: unknown) => error instanceof ModelProviderError && error.code === 'MODEL_PROVIDER_HTTP_ERROR' && error.status === 401);
});
