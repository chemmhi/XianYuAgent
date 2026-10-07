import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiKeyCredentialService } from '../src/credential-store.js';
import { MemoryStore } from '../src/store-memory.js';
import { OpenAISettingsService, createFallbackModelClient } from '../src/openai-settings.js';
import type { ModelClient } from '../src/pi-runtime.js';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

async function fixture(fetchImpl: typeof fetch = (async () => new Response(JSON.stringify({ data: [{ id: 'provider-model-a' }, { id: 'provider-model-b' }] }), { status: 200 })) as typeof fetch, wireApi: 'responses' | 'chat' = 'responses') {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: `openai-${Date.now()}@example.com`, passwordHash: 'hash', displayName: 'OpenAI Test' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: `seller-${Date.now()}` });
  const key = 'test-encryption-key';
  const credentials = new ApiKeyCredentialService(store, key, async () => 'audit');
  const service = new OpenAISettingsService(store, credentials, key, async () => 'audit', fetchImpl, wireApi);
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

test('application config defaults to Responses while honoring explicit Chat compatibility', () => {
  const base = { API_KEY: 'test-key', BASE_URL: 'https://model.example/v1', MODEL: 'test-model' };
  assert.equal(loadConfig(base).modelWireApi, 'responses');
  assert.equal(loadConfig({ ...base, WIRE_API: 'responses' }).modelWireApi, 'responses');
  assert.equal(loadConfig({ ...base, WIRE_API: 'chat' }).modelWireApi, 'chat');
});

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
  assert.equal(primary.apiKeyHint?.length, 'primary-secret-key'.length);
  assert.equal(primary.apiKeyHint?.startsWith('prim'), true);
  assert.equal(primary.apiKeyHint?.endsWith('-key'), true);
  assert.match(primary.apiKeyHint ?? '', /\*/);
  assert.equal(primary.apiKeyHint?.includes('primary-secret-key'), false);
  assert.equal(backup.apiKeyHint?.length, 'backup-secret-key'.length);
  assert.equal(backup.apiKeyHint?.slice(0, 4), 'back');
  assert.equal(backup.apiKeyHint?.slice(-4), '-key');
  assert.equal(backup.apiKeyHint?.includes('backup-secret-key'), false);

  const listed = await service.list({ adminId: admin.id, accountId: account.id });
  assert.deepEqual(listed.map((item) => item.role).sort(), ['backup', 'primary']);
  assert.equal(listed.some((item) => JSON.stringify(item).includes('secret-key')), false);

  const models = await service.listModels({ adminId: admin.id, accountId: account.id, configId: primary.id });
  assert.deepEqual(models, [{ id: 'provider-model-a' }, { id: 'provider-model-b' }]);
  assert.deepEqual(calls, [`https://primary.example/v1/models|Bearer primary-secret-key`]);

  const stored = await store.getCredentialRefSecret(admin.id, primary.id!);
  assert.ok(stored);
  assert.equal(stored?.secretCiphertext.includes('primary-secret-key'), false);
});

test('keeps connectivity probes ephemeral so a fresh process requires an explicit retest', async () => {
  const { admin, account, service } = await fixture();
  const saved = await service.save(input(admin.id, account.id, 'primary'));
  const result = await service.test(input(admin.id, account.id, 'primary', { configId: saved.id, apiKey: undefined }));

  assert.equal(result.ok, true);
  const listed = await service.list({ adminId: admin.id, accountId: account.id });
  const reloaded = listed.find((item) => item.role === 'primary');
  assert.equal(reloaded?.id, saved.id);
  assert.equal(reloaded?.lastConnectivity ?? 'unknown', 'unknown');
});

test('save with metadata update and key rotation advances config generation once', async () => {
  const { store, admin, account, service } = await fixture();
  const created = await service.save(input(admin.id, account.id, 'primary'));
  assert.equal(await service.getConfigGeneration(admin.id, account.id), 1);

  await service.save(input(admin.id, account.id, 'primary', {
    configId: created.id,
    expectedVersion: created.version,
    apiKey: 'primary-rotated-key',
    label: 'rotated',
  }));

  assert.equal(await service.getConfigGeneration(admin.id, account.id), 2);
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

test('fallback advertises web_search only when every provider supports it', async () => {
  const primary: ModelClient = {
    supportsWebSearch: true,
    complete: async () => { throw new Error('primary unavailable'); },
  };
  const backup: ModelClient = {
    supportsWebSearch: false,
    complete: async () => ({ content: 'fallback reply', model: 'chat-backup' }),
  };
  const client = createFallbackModelClient(primary, backup);
  assert.equal(client.supportsWebSearch, false);
  const result = await client.complete({
    messages: [{ role: 'user', content: 'github上有没有这个skill' }],
  });
  assert.equal(result.content, 'fallback reply');
});

test('persists manual routing mode with optimistic locking', async () => {
  const { admin, account, service } = await fixture();
  await service.save(input(admin.id, account.id, 'backup'));
  const initial = await service.getRouting(admin.id, account.id, 0);
  assert.equal(initial.mode, 'auto');
  const switched = await service.updateRouting({ adminId: admin.id, accountId: account.id, expectedVersion: 0, mode: 'manual_backup', preferredRole: 'backup', configGeneration: 2, requestId: 'routing-1', traceId: 'trace-routing-1' });
  assert.equal(switched.mode, 'manual_backup');
  assert.equal(switched.preferredRole, 'backup');
  assert.equal(switched.routingVersion, 1);
  await assert.rejects(() => service.updateRouting({ adminId: admin.id, accountId: account.id, expectedVersion: 0, mode: 'auto', configGeneration: 2, requestId: 'routing-2', traceId: 'trace-routing-2' }), (error: unknown) => (error as { statusCode?: number }).statusCode === 409);
});

test('rejects manual routing to an unconfigured provider role', async () => {
  const { admin, account, service } = await fixture();
  await assert.rejects(
    () => service.updateRouting({ adminId: admin.id, accountId: account.id, expectedVersion: 0, mode: 'manual_backup', preferredRole: 'backup', configGeneration: 0, requestId: 'routing-missing', traceId: 'trace-routing-missing' }),
    (error: unknown) => (error as { statusCode?: number; code?: string }).statusCode === 422 && (error as { code?: string }).code === 'MODEL_PROVIDER_ROLE_NOT_CONFIGURED',
  );
});

test('OpenAI settings apply one global wire mode to every provider', async () => {
  const { admin, account, service } = await fixture();

  const defaulted = await service.save(input(admin.id, account.id, 'primary'));
  assert.equal(defaulted.wireApi, 'responses');
  const chatInput = { ...input(admin.id, account.id, 'primary', { configId: defaulted.id, expectedVersion: defaulted.version, apiKey: undefined }), wireApi: 'chat' as const };
  const chat = await service.save(chatInput);
  assert.equal(chat.wireApi, 'responses');
  const resolved = await service.resolveById(admin.id, chat.id!, account.id);
  assert.equal(resolved?.wireApi, 'responses');

  const chatFixture = await fixture(undefined, 'chat');
  const explicitChat = await chatFixture.service.save(input(chatFixture.admin.id, chatFixture.account.id, 'primary'));
  const explicitChatBackup = await chatFixture.service.save(input(chatFixture.admin.id, chatFixture.account.id, 'backup'));
  assert.equal(explicitChat.wireApi, 'chat');
  assert.equal(explicitChatBackup.wireApi, 'chat');
  const chatResolved = await chatFixture.service.resolveById(chatFixture.admin.id, explicitChat.id!, chatFixture.account.id);
  assert.equal(chatResolved?.wireApi, 'chat');
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
    const text = authorization === 'Bearer backup-secret-key' ? 'BACKUP_REPLY' : authorization === 'Bearer primary-updated-secret' ? 'UPDATED_REPLY' : 'PRIMARY_REPLY';
    return new Response(JSON.stringify({ model: 'runtime-model', output_text: JSON.stringify({ decision: 'reply', text }) }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

  const runtime = createApp(loadConfig({ AUTO_REPLY_AGENT_SEND_DELAY_SECONDS: '0', HOST: '127.0.0.1', PORT: '0', DATABASE_URL: '', REDIS_URL: '', ALLOW_IN_MEMORY: 'true', COOKIE_SECURE: 'false', XIANYU_QR_MODE: 'stub', AGENT_RUNTIME: 'in-process', AUTO_REPLY_SEND_MODE: 'simulate', AUTOMATION_BUYER_ALLOWLIST: '["Buyer"]', AUTO_REPLY_AGENT_DEBOUNCE_MS: '0' }));
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
    const fourth = await createInbound('第四条消息', 'openai-agent-4');
    const fourthResult = await runtime.autoReply.processInbound({ adminId: admin.id, conversationId: conversation.id, inboundMessageId: fourth.message.id, senderName: 'Buyer' });
    assert.equal(fourthResult.outboundMessage?.bodyText, 'BACKUP_REPLY');
    assert.equal(providerCalls.some((call) => call.authorization === 'Bearer primary-fail-secret'), true);
    assert.equal(providerCalls.some((call) => call.authorization === 'Bearer backup-secret-key'), true);
    assert.equal(providerCalls.filter((call) => call.authorization === 'Bearer primary-fail-secret').length, 1);
    assert.ok(backup.id);
  } finally {
    await runtime.close();
    globalThis.fetch = originalFetch;
  }
});

test('runtime client forwards persisted reasoning effort to the Responses request', async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ body: Record<string, unknown> }> = [];
  globalThis.fetch = (async (input, init) => {
    void input;
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    requests.push({ body });
    return new Response(JSON.stringify({ model: 'reasoning-model', output_text: 'ok' }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

  try {
    const { admin, account, service } = await fixture();
    const saved = await service.save(input(admin.id, account.id, 'primary'));
    const resolved = await service.resolveById(admin.id, saved.id!, account.id);
    assert.ok(resolved);
    const client = await service.createRuntimeClient({ ...resolved!, reasoningEffort: 'high' } as Awaited<NonNullable<typeof resolved>> & { reasoningEffort: string });
    await client.complete({ messages: [{ role: 'user', content: 'think carefully' }] });
    assert.deepEqual(requests[0]?.body.reasoning, { effort: 'high' });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
