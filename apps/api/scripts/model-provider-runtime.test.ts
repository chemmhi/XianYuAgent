import assert from 'node:assert/strict';
import test from 'node:test';
import { ModelProviderRuntimePool } from '../src/model-provider-runtime.js';
import type { OpenAIResolvedConfig } from '../src/openai-settings.js';
import { PiModelClientError, type ModelClient } from '../src/pi-runtime.js';

function config(role: 'primary' | 'backup', version: number): OpenAIResolvedConfig {
  return { id: `${role}-${version}`, accountId: 'account-1', role, provider: `${role}-provider`, alias: role, baseUrl: `https://${role}.example/v1`, model: `${role}-model`, wireApi: 'responses', timeoutMs: 1_000, status: 'active', version, apiKeyConfigured: true, apiKey: `${role}-secret`, canReveal: false };
}

test('runtime pool reuses a service and preserves breaker state between resolves', async () => {
  const calls: string[] = [];
  const clients: Record<string, ModelClient> = {
    primary: { complete: async () => { calls.push('primary'); throw new PiModelClientError('MODEL_TIMEOUT', 'down'); } },
    backup: { complete: async () => { calls.push('backup'); return { content: 'ok', model: 'backup-model' }; } },
  };
  const pool = new ModelProviderRuntimePool({ createClient: async (item) => clients[item.role]!, overallTimeoutMs: 2_000 });
  const configs = [config('primary', 1), config('backup', 1)];
  const first = await pool.resolve({ adminId: 'admin-1', accountId: 'account-1', configs, mode: 'auto', routingVersion: 0 });
  await first.complete({ messages: [{ role: 'user', content: 'first' }] });
  const second = await pool.resolve({ adminId: 'admin-1', accountId: 'account-1', configs, mode: 'auto', routingVersion: 0 });
  await second.complete({ messages: [{ role: 'user', content: 'second' }] });
  assert.deepEqual(calls, ['primary', 'backup', 'backup']);
  assert.equal(first, second);
  await pool.close();
});

test('runtime pool starts a fresh generation after config version changes', async () => {
  let created = 0;
  const pool = new ModelProviderRuntimePool({ createClient: async () => { created += 1; return { complete: async () => ({ content: 'ok', model: 'model' }) }; } });
  const first = await pool.resolve({ adminId: 'admin-1', accountId: 'account-1', configs: [config('primary', 1)], mode: 'auto', routingVersion: 0 });
  const second = await pool.resolve({ adminId: 'admin-1', accountId: 'account-1', configs: [config('primary', 2)], mode: 'auto', routingVersion: 0 });
  assert.notEqual(first, second);
  assert.equal(created, 2);
  await pool.close();
});

test('runtime pool preserves backup role when primary is absent', async () => {
  const pool = new ModelProviderRuntimePool({ createClient: async () => ({ complete: async () => ({ content: 'ok', model: 'backup-model' }) }) });
  const service = await pool.resolve({ adminId: 'admin-1', accountId: 'account-1', configs: [config('backup', 1)], mode: 'auto', routingVersion: 0 });
  const snapshot = service.getRuntimeSnapshot();
  assert.equal(snapshot.effectiveRole, 'backup');
  assert.equal(snapshot.providerStates.primary.state, 'CLOSED');
  assert.equal(snapshot.providerStates.backup.state, 'CLOSED');
  await pool.close();
});

test('runtime pool isolates primary construction failure and keeps backup usable', async () => {
  const pool = new ModelProviderRuntimePool({
    createClient: async (item) => {
      if (item.role === 'primary') throw new Error('primary construction failed');
      return { complete: async () => ({ content: 'backup-ok', model: 'backup-model' }), supportsStructuredOutput: true };
    },
  });
  const service = await pool.resolve({ adminId: 'admin-1', accountId: 'account-1', configs: [config('primary', 1), config('backup', 1)], mode: 'auto', routingVersion: 0 });
  const result = await service.complete({ messages: [{ role: 'user', content: 'hello' }] });
  assert.equal(result.content, 'backup-ok');
  const snapshot = service.getRuntimeSnapshot();
  assert.equal(snapshot.providerStates.primary.state, 'OPEN');
  assert.equal(snapshot.providerStates.primary.lastTransitionReason, 'PROVIDER_CONSTRUCTION_FAILED');
  assert.equal(snapshot.providerStates.primary.constructionErrorCode, 'MODEL_PROVIDER_RUNTIME_INIT_FAILED');
  await pool.close();
});

test('runtime pool preserves both construction diagnostics when neither role can initialize', async () => {
  const pool = new ModelProviderRuntimePool({ createClient: async (item) => { throw new Error(`${item.role} failed`); } });
  const service = await pool.resolve({ adminId: 'admin-1', accountId: 'account-1', configs: [config('primary', 1), config('backup', 1)], mode: 'auto', routingVersion: 0 });
  await assert.rejects(() => service.complete({ messages: [{ role: 'user', content: 'hello' }] }), /temporarily unavailable/);
  const snapshot = service.getRuntimeSnapshot();
  assert.equal(snapshot.providerStates.primary.constructionErrorCode, 'MODEL_PROVIDER_RUNTIME_INIT_FAILED');
  assert.equal(snapshot.providerStates.backup.constructionErrorCode, 'MODEL_PROVIDER_RUNTIME_INIT_FAILED');
  await pool.close();
});

test('runtime pool fences Redis state when account generation changes without credential version change', async () => {
  let created = 0;
  const pool = new ModelProviderRuntimePool({ createClient: async () => { created += 1; return { complete: async () => ({ content: 'ok', model: 'model' }) }; } });
  const configs = [config('primary', 1)];
  const first = await pool.resolve({ adminId: 'admin-1', accountId: 'account-1', configs, configGeneration: 1, mode: 'auto', routingVersion: 0 });
  const second = await pool.resolve({ adminId: 'admin-1', accountId: 'account-1', configs, configGeneration: 2, mode: 'auto', routingVersion: 0 });
  assert.notEqual(first, second);
  assert.equal(second.getRuntimeSnapshot().configGeneration, 2);
  assert.equal(created, 2);
  await pool.close();
});
