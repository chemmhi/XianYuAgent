import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiKeyCredentialService } from '../src/credential-store.js';
import { MemoryStore } from '../src/store-memory.js';
import { OpenAISettingsService, createFallbackModelClient } from '../src/openai-settings.js';
import type { ModelClient } from '../src/pi-runtime.js';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

async function fixture(fetchImpl: typeof fetch = (async () => new Response(JSON.stringify({ data: [{ id: 'provider-model-a' }, { id: 'provider-model-b' }] }), { status: 200 })) as typeof fetch) {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: `openai-${Date.now()}@example.com`, passwordHash: 'hash', displayName: 'OpenAI Test' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: `seller-${Date.now()}` });
  const key = 'test-encryption-key';
  const credentials = new ApiKeyCredentialService(store, key, async () => 'audit');
  const service = new OpenAISettingsService(store, credentials, key, async () => 'audit', fetchImpl);
  return { store, admin, account, service };
}

function input(adminId: string, accountId: string, role: 'primary' | 'backup', overrides: Record<string, unknown> = {}) {
  return {
    adminId,
    accountId,
    role,
    provider: role === 'primary' ? 'primary-provider' : 'backup-provider',
    alias: role,
    baseUrl: `https://${role}.example/v1`,
    model: `${role}-model`,
    wireApi: 'responses' as const,
    timeoutMs: 5_000,
    apiKey: `${role}-secret-key`,
    requestId: `request-${role}`,
    traceId: `trace-${role}`,
    ...overrides,
  };
}

test('persists primary and backup configs with redacted views and provider-owned models', async () => {
  const calls: string[] = [];
  const { store, admin, account, service } = await fixture((async (url, init) => {
    calls.push(`${String(url)}|${new Headers(init?.headers).get('authorization')}`);
    return new Response(JSON.stringify({ data: [{ id: 'provider-model-a' }, { id: 'provider-model-b' }] }), { status: 200 });
  }) as typeof fetch);

  const primary = await service.save(input(admin.id, account.id, 'primary'));
  const backup = await service.save(input(admin.id, account.id, 'backup'));
  assert.equal(primary.role, 'primary');
  assert.equal(backup.role, 'backup');
  assert.notEqual(primary.id, backup.id);
  assert.equal('apiKey' in primary, false);
  assert.equal('secret' in primary, false);

  const listed = await service.list({ adminId: admin.id, accountId: account.id });
  assert.deepEqual(listed.map((item) => item.role).sort(), ['backup', 'primary']);
  assert.equal(listed.some((item) => JSON.stringify(item).includes('secret-key')), false);

  const models = await service.listModels({ adminId: admin.id, accountId: account.id, configId: primary.id });
  assert.deepEqual(models, ['provider-model-a', 'provider-model-b']);
  assert.deepEqual(calls, [`https://primary.example/v1/models|Bearer primary-secret-key`]);

  const stored = await store.getCredentialRefSecret(admin.id, primary.id!);
  assert.ok(stored);
  assert.equal(stored?.secretCiphertext.includes('primary-secret-key'), false);
});

test('enforces role uniqueness and optimistic version checks', async () => {
  const { admin, account, service } = await fixture();
  const primary = await service.save(input(admin.id, account.id, 'primary'));
  await assert.rejects(() => service.save(input(admin.id, account.id, 'primary')), /主配置已存在/);
  await assert.rejects(() => service.save(input(admin.id, account.id, 'backup', { configId: primary.id, expectedVersion: 999, apiKey: undefined })), /配置角色不可变/);
  await assert.rejects(() => service.save(input(admin.id, account.id, 'primary', { configId: primary.id, expectedVersion: 999, apiKey: undefined })), /凭证已被其他操作更新|CREDENTIAL_VERSION_CONFLICT/);
});

test('rejects cross-account config probes and falls back to backup client', async () => {
  const first = await fixture();
  const second = await fixture();
  const primary = await first.service.save(input(first.admin.id, first.account.id, 'primary'));
  await assert.rejects(() => first.service.test({ ...input(first.admin.id, second.account.id, 'primary', { configId: primary.id, apiKey: undefined }) }), (error: unknown) => (error as { statusCode?: number }).statusCode === 404);

  const calls: string[] = [];
  const primaryClient: ModelClient = { complete: async () => { calls.push('primary'); throw new Error('primary unavailable'); } };
  const backupClient: ModelClient = { complete: async () => { calls.push('backup'); return { content: '来自备用配置', model: 'backup-model' }; } };
  const result = await createFallbackModelClient(primaryClient, backupClient).complete({ messages: [{ role: 'user', content: 'hello' }] });
  assert.equal(result.content, '来自备用配置');
  assert.deepEqual(calls, ['primary', 'backup']);
});

test('agent resolves latest persisted config and falls back without restart', async () => {
  const originalFetch = globalThis.fetch;
  const providerCalls: Array<{ provider: string; authorization: string }> = [];
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    const authorization = new Headers(init?.headers).get('authorization') ?? '';
    if (url.endsWith('/models')) return new Response(JSON.stringify({ data: [{ id: 'primary-model' }, { id: 'backup-model' }] }), { status: 200 });
    providerCalls.push({ provider: url, authorization });
    if (authorization === 'Bearer primary-fail-secret') return new Response(JSON.stringify({ error: 'primary down' }), { status: 401 });
    const reply = authorization === 'Bearer backup-secret-key' ? 'BACKUP_REPLY' : authorization === 'Bearer primary-updated-secret' ? 'UPDATED_REPLY' : 'PRIMARY_REPLY';
    return new Response(JSON.stringify({ model: 'runtime-model', output_text: reply }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

  const runtime = createApp(loadConfig({ HOST: '127.0.0.1', PORT: '0', DATABASE_URL: '', REDIS_URL: '', ALLOW_IN_MEMORY: 'true', COOKIE_SECURE: 'false', XIANYU_QR_MODE: 'stub', AGENT_RUNTIME: 'in-process', AUTO_REPLY_SEND_MODE: 'simulate', AUTO_REPLY_TEST_BUYER_NAMES: '["Buyer"]', AUTO_REPLY_AGENT_DEBOUNCE_MS: '0' }));
  const admin = await runtime.store.createAdmin({ email: `agent-openai-${Date.now()}@example.com`, passwordHash: 'hash', displayName: 'Agent OpenAI' });
  const account = await runtime.store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: `agent-openai-${Date.now()}` });
  const conversation = await runtime.store.createConversation({ adminId: admin.id, accountId: account.id, buyerRef: 'buyer-openai', buyerDisplayName: 'Buyer', externalConversationRef: `conversation-openai-${Date.now()}` });
  await runtime.openaiSettings.save(input(admin.id, account.id, 'primary', { apiKey: 'primary-secret-key', requestId: 'save-primary', traceId: 'trace-primary' }));
  const backup = await runtime.openaiSettings.save(input(admin.id, account.id, 'backup', { apiKey: 'backup-secret-key', requestId: 'save-backup', traceId: 'trace-backup' }));

  const createInbound = async (bodyText: string, ref: string) => runtime.store.createMessage({ adminId: admin.id, conversationId: conversation.id, direction: 'inbound', senderRole: 'buyer', bodyType: 'text', bodyText, externalMessageRef: ref, source: 'system', traceId: ref });
  try {
    await runtime.listen();
    const first = await createInbound('第一条消息', 'openai-agent-1');
    const firstResult = await runtime.autoReply.processInbound({ adminId: admin.id, conversationId: conversation.id, inboundMessageId: first.message.id, senderName: 'Buyer' });
    assert.equal(firstResult.outboundMessage?.bodyText, 'PRIMARY_REPLY');

    const primary = (await runtime.openaiSettings.list({ adminId: admin.id, accountId: account.id })).find((item) => item.role === 'primary');
    assert.ok(primary?.id);
    await runtime.openaiSettings.save(input(admin.id, account.id, 'primary', { configId: primary?.id, expectedVersion: primary?.version, apiKey: 'primary-updated-secret', requestId: 'save-primary-update', traceId: 'trace-primary-update' }));
    const second = await createInbound('第二条消息', 'openai-agent-2');
    const secondResult = await runtime.autoReply.processInbound({ adminId: admin.id, conversationId: conversation.id, inboundMessageId: second.message.id, senderName: 'Buyer' });
    assert.equal(secondResult.outboundMessage?.bodyText, 'UPDATED_REPLY');

    const updatedPrimary = (await runtime.openaiSettings.list({ adminId: admin.id, accountId: account.id })).find((item) => item.role === 'primary');
    assert.ok(updatedPrimary?.id);
    await runtime.openaiSettings.save(input(admin.id, account.id, 'primary', { configId: updatedPrimary?.id, expectedVersion: updatedPrimary?.version, apiKey: 'primary-fail-secret', requestId: 'save-primary-fail', traceId: 'trace-primary-fail' }));
    const third = await createInbound('第三条消息', 'openai-agent-3');
    const thirdResult = await runtime.autoReply.processInbound({ adminId: admin.id, conversationId: conversation.id, inboundMessageId: third.message.id, senderName: 'Buyer' });
    assert.equal(thirdResult.outboundMessage?.bodyText, 'BACKUP_REPLY');
    assert.equal(providerCalls.some((call) => call.authorization === 'Bearer primary-fail-secret'), true);
    assert.equal(providerCalls.some((call) => call.authorization === 'Bearer backup-secret-key'), true);
    assert.ok(backup.id);
  } finally {
    await runtime.close();
    globalThis.fetch = originalFetch;
  }
});
