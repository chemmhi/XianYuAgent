import assert from 'node:assert/strict';
import test from 'node:test';
import { ModelClientService, type ModelClient } from '../src/model-client.js';

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
