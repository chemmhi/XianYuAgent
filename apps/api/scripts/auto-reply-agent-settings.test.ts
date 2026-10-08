import assert from 'node:assert/strict';
import test from 'node:test';
import { autoReplyAgentConfigFromEnv, AutoReplyAgentSettingsService, DEFAULT_AUTO_REPLY_AGENT_CONFIG } from '../src/auto-reply-agent-settings.js';
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
  assert.equal(defaults.sendDelaySeconds, 300);
  assert.equal(defaults.totalTimeoutSeconds, 600);
  assert.equal(defaults.maxLoops, 4);
  assert.equal('allowPaidOrderReply' in defaults, false);

  const saved = await service.update({ adminId: admin.id, accountId: account.id, expectedVersion: 0, patch: { maxLoops: 6, debounceMs: 1_500, sendDelaySeconds: 12, systemPrompt: '只回答商品事实。' }, requestId: 'req-1', traceId: 'trace-1' });
  assert.equal(saved.configVersion, 1);
  assert.equal(saved.maxLoops, 6);
  assert.equal(saved.debounceMs, defaults.debounceMs);
  assert.equal(saved.sendDelaySeconds, 12);
  assert.equal('allowPaidOrderReply' in saved, false);
  assert.notEqual(saved.configDigest, defaults.configDigest);
  assert.equal(audits.length, 1);
  assert.deepEqual(audits[0]?.payload, { configVersion: 1, configDigest: saved.configDigest, changedFields: ['maxLoops', 'sendDelaySeconds', 'systemPrompt'] });
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

test('auto reply agent settings persist every editable field without dropping values', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'agent-settings-roundtrip@example.com', passwordHash: 'hash', displayName: 'Agent Settings Roundtrip' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'agent-settings-roundtrip-seller' });
  const service = new AutoReplyAgentSettingsService(store, DEFAULT_AUTO_REPLY_AGENT_CONFIG, async () => 'audit-1');
  const patch = {
    enabled: false,
    systemPrompt: '回归系统提示词',
    userPromptTemplate: '买家问题：{{buyerMessage}}\n{{context}}',
    maxLoops: 7,
    maxToolCalls: 9,
    toolTimeoutSeconds: 15,
    totalTimeoutSeconds: 90,
    maxHistory: 15,
    maxReplyLength: 120,
    replySegmentDelaySeconds: 0.45,
    sendDelaySeconds: 1,
    sendMode: 'live' as const,
  };
  const saved = await service.update({ adminId: admin.id, accountId: account.id, expectedVersion: 0, patch, requestId: 'req-roundtrip', traceId: 'trace-roundtrip' });
  for (const [key, value] of Object.entries(patch)) assert.equal(saved[key as keyof typeof patch], value, `${key} was not persisted`);
  assert.equal(saved.debounceMs, DEFAULT_AUTO_REPLY_AGENT_CONFIG.debounceMs);
  const reread = await service.get(admin.id, account.id);
  for (const [key, value] of Object.entries(patch)) assert.equal(reread[key as keyof typeof patch], value, `${key} was not readable after persistence`);
});

test('auto reply agent max reply length accepts 30 and rejects values below it', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'agent-settings-length@example.com', passwordHash: 'hash', displayName: 'Agent Settings Length' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'agent-settings-length-seller' });
  const service = new AutoReplyAgentSettingsService(store, DEFAULT_AUTO_REPLY_AGENT_CONFIG, async () => 'audit-1');
  const envFallback = autoReplyAgentConfigFromEnv({ AUTO_REPLY_AGENT_MAX_REPLY_LENGTH: '29' });
  assert.equal(envFallback.maxReplyLength, DEFAULT_AUTO_REPLY_AGENT_CONFIG.maxReplyLength);
  const accepted = await service.update({ adminId: admin.id, accountId: account.id, expectedVersion: 0, patch: { maxReplyLength: 30 }, requestId: 'req-5', traceId: 'trace-5' });
  assert.equal(accepted.maxReplyLength, 30);
  await assert.rejects(() => service.update({ adminId: admin.id, accountId: account.id, expectedVersion: accepted.configVersion, patch: { maxReplyLength: 29 }, requestId: 'req-6', traceId: 'trace-6' }), (error: unknown) => error instanceof Error && error.message.includes('maxReplyLength'));
  await assert.rejects(() => service.update({ adminId: admin.id, accountId: account.id, expectedVersion: accepted.configVersion, patch: { sendDelaySeconds: 86_401 }, requestId: 'req-7', traceId: 'trace-7' }), (error: unknown) => error instanceof Error && error.message.includes('sendDelaySeconds'));
});

test('duration settings use seconds while preserving legacy millisecond patches and env values', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'agent-settings-duration@example.com', passwordHash: 'hash', displayName: 'Agent Settings Duration' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'agent-settings-duration-seller' });
  const service = new AutoReplyAgentSettingsService(store, DEFAULT_AUTO_REPLY_AGENT_CONFIG, async () => 'audit-1');
  const legacy = await service.update({ adminId: admin.id, accountId: account.id, expectedVersion: 0, patch: { toolTimeoutMs: 1_500, totalTimeoutMs: 90_000, replySegmentDelayMs: 450 }, requestId: 'req-duration-legacy', traceId: 'trace-duration-legacy' });
  assert.equal(legacy.toolTimeoutSeconds, 1.5);
  assert.equal(legacy.totalTimeoutSeconds, 90);
  assert.equal(legacy.replySegmentDelaySeconds, 0.45);
  const max = await service.update({ adminId: admin.id, accountId: account.id, expectedVersion: legacy.configVersion, patch: { totalTimeoutSeconds: 600 }, requestId: 'req-duration-max', traceId: 'trace-duration-max' });
  assert.equal(max.totalTimeoutSeconds, 600);
  const env = autoReplyAgentConfigFromEnv({ AUTO_REPLY_AGENT_TOOL_TIMEOUT_SECONDS: '2.5', AUTO_REPLY_AGENT_TOTAL_TIMEOUT_SECONDS: '600', AUTO_REPLY_AGENT_REPLY_SEGMENT_DELAY_SECONDS: '0.45' });
  assert.equal(env.toolTimeoutSeconds, 2.5);
  assert.equal(env.totalTimeoutSeconds, 600);
  assert.equal(env.replySegmentDelaySeconds, 0.45);
});
