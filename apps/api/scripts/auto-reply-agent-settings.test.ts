import assert from 'node:assert/strict';
import test from 'node:test';
import { AutoReplyAgentSettingsService, DEFAULT_AUTO_REPLY_AGENT_CONFIG } from '../src/auto-reply-agent-settings.js';
import { MemoryStore } from '../src/store-memory.js';

test('auto reply agent settings are versioned, audited and isolated from workspace settings', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'agent-settings@example.com', passwordHash: 'hash', displayName: 'Agent Settings' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'agent-settings-seller' });
  const audits: Array<{ action: string; payload: unknown }> = [];
  const service = new AutoReplyAgentSettingsService(store, DEFAULT_AUTO_REPLY_AGENT_CONFIG, async (input) => { audits.push({ action: input.action, payload: input.payload }); return 'audit-1'; });

  const defaults = await service.get(admin.id, account.id);
  assert.equal(defaults.configVersion, 0);
  assert.equal(defaults.sendMode, 'simulate');
  assert.equal(defaults.maxLoops, 4);

  const saved = await service.update({ adminId: admin.id, accountId: account.id, expectedVersion: 0, patch: { maxLoops: 6, debounceMs: 1_500, systemPrompt: '只回答商品事实。' }, requestId: 'req-1', traceId: 'trace-1' });
  assert.equal(saved.configVersion, 1);
  assert.equal(saved.maxLoops, 6);
  assert.equal(saved.debounceMs, 1_500);
  assert.notEqual(saved.configDigest, defaults.configDigest);
  assert.equal(audits.length, 1);
  assert.deepEqual(audits[0]?.payload, { configVersion: 1, configDigest: saved.configDigest, changedFields: ['debounceMs', 'maxLoops', 'systemPrompt'] });
  assert.equal(JSON.stringify(audits[0]?.payload).includes('只回答商品事实'), false);

  const reread = await service.get(admin.id, account.id);
  assert.equal(reread.configVersion, 1);
  assert.equal(reread.maxLoops, 6);
  await assert.rejects(() => service.update({ adminId: admin.id, accountId: account.id, expectedVersion: 0, patch: { maxLoops: 2 }, requestId: 'req-2', traceId: 'trace-2' }), (error: unknown) => error instanceof Error && error.message.includes('version conflict'));

  const otherAccount = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'agent-settings-other-seller' });
  const otherDefaults = await service.get(admin.id, otherAccount.id);
  assert.equal(otherDefaults.configVersion, 0);
  assert.equal(otherDefaults.maxLoops, DEFAULT_AUTO_REPLY_AGENT_CONFIG.maxLoops);
});

test('auto reply agent settings reject unsafe values before persistence', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'agent-settings-validation@example.com', passwordHash: 'hash', displayName: 'Agent Settings' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'agent-settings-validation-seller' });
  const service = new AutoReplyAgentSettingsService(store, DEFAULT_AUTO_REPLY_AGENT_CONFIG, async () => 'audit-1');
  await assert.rejects(() => service.update({ adminId: admin.id, accountId: account.id, expectedVersion: 0, patch: { maxLoops: 99 }, requestId: 'req-3', traceId: 'trace-3' }), (error: unknown) => error instanceof Error && error.message.includes('maxLoops'));
  await assert.rejects(() => service.update({ adminId: admin.id, accountId: account.id, expectedVersion: 0, patch: { systemPrompt: '' }, requestId: 'req-4', traceId: 'trace-4' }), (error: unknown) => error instanceof Error && error.message.includes('systemPrompt'));
  assert.equal((await service.get(admin.id, account.id)).configVersion, 0);
});
