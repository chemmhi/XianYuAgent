import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createDefaultAutoReplyRepairPolicy } from '../src/auto-reply-repair-config.js';
import { AutoReplyRepairRepository } from '../src/auto-reply-repair-repository.js';
import type { ConversationState, Store } from '../src/domain.js';

function testConfig() {
  return loadConfig({
    ...process.env,
    HOST: '127.0.0.1',
    PORT: '0',
    DATABASE_URL: '',
    REDIS_URL: '',
    ALLOW_IN_MEMORY: 'true',
    COOKIE_SECURE: 'false',
    XIANYU_QR_MODE: 'stub',
    AGENT_RUNTIME: 'in-process',
    AUTO_REPLY_MODEL_ENABLED: 'false',
    AUTO_REPLY_SEND_MODE: 'simulate',
    AUTO_REPLY_REPAIR_MODE: 'shadow',
    AUTO_REPLY_AGENT_DEBOUNCE_MS: '0',
  });
}

test('AR-VS-08 shadow runtime is wired into the buyer entry path and is idempotent', async () => {
  const runtime = createApp(testConfig());
  await runtime.listen();
  try {
    const boot = await runtime.auth.bootstrap({ email: 'ar-vs08-runtime@example.com', password: 'password-123', displayName: 'AR-VS-08 Runtime' });
    const adminId = boot.admin.id;
    const account = await runtime.store.createAccount({ adminId, platform: 'xianyu', sellerRef: 'ar-vs08-runtime-seller' });
    const product = await runtime.store.createProduct({ adminId, accountId: account.id, externalProductRef: 'ar-vs08-runtime-product', title: 'AR-VS-08 商品', priceMinor: 2_590, status: 'published' });
    const conversation = await runtime.store.createConversation({ adminId, accountId: account.id, buyerRef: 'ar-vs08-runtime-buyer', buyerDisplayName: 'AR-VS-08 买家', itemRef: product.externalProductRef, itemTitle: product.title, externalConversationRef: 'ar-vs08-runtime-conversation' });
    const inbound = await runtime.store.createMessage({ adminId, conversationId: conversation.id, direction: 'inbound', senderRole: 'buyer', bodyType: 'text', bodyText: '请问多少钱？', externalMessageRef: 'ar-vs08-runtime-inbound.PNM', source: 'system', traceId: 'ar-vs08-runtime-inbound' });

    const first = await runtime.autoReply.processInbound({ adminId, conversationId: conversation.id, inboundMessageId: inbound.message.id, requestId: 'ar-vs08-runtime-request', traceId: 'ar-vs08-runtime-trace' });
    assert.equal(first.run.status, 'persisted');
    assert.equal(first.repair?.mode, 'shadow');
    assert.ok(first.repair?.policyDecisionId);
    assert.equal(first.repair?.primaryAction, 'ANSWER_FACT');
    assert.equal(first.repair?.stateVersion, 1);
    assert.equal(first.repair?.resolutionStatus, 'review_pending');
    assert.equal(runtime.autoReplyRepair.currentMode, 'shadow');

    const reviews = await runtime.autoReplyRepair.listReviews(account.id, conversation.id);
    assert.deepEqual(reviews.map((item) => item.reviewType), ['PRE_SEND', 'OUTCOME']);
    assert.equal(reviews[1]?.resolutionStatus, 'review_pending');
    assert.deepEqual(reviews[1]?.evidenceTypes, []);

    const duplicate = await runtime.autoReply.processInbound({ adminId, conversationId: conversation.id, inboundMessageId: inbound.message.id, requestId: 'ar-vs08-runtime-request-replay', traceId: 'ar-vs08-runtime-trace-replay' });
    assert.equal(duplicate.run.id, first.run.id);
    assert.equal((await runtime.autoReplyRepair.listReviews(account.id, conversation.id)).length, 2);
  } finally {
    await runtime.close();
  }
});

test('repository keeps state_id separate from update expected_state_version', async () => {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const pool = {
    async query(text: string, values: unknown[] = []) {
      calls.push({ text, values });
      return { rows: [], rowCount: 1 };
    },
  };
  const repository = new AutoReplyRepairRepository({ pool } as unknown as Store);
  const state: ConversationState = {
    stateId: '11111111-1111-4111-8111-111111111111',
    accountId: '22222222-2222-4222-8222-222222222222',
    conversationId: '33333333-3333-4333-8333-333333333333',
    stateVersion: 1,
    goalStatus: 'active',
    pendingQuestions: [],
    clarificationRound: 0,
    awaitingUser: false,
    transitionAt: '2026-09-23T00:00:00.000Z',
    lastSourceSequence: 1,
    processedEventIds: [],
    processedIdempotencyKeys: [],
  };
  assert.equal(await repository.saveConversationState(state, 0), true);
  assert.equal(calls[0]?.values[0], state.stateId);
  assert.equal(await repository.saveConversationState({ ...state, stateVersion: 2 }, 1), true);
  assert.equal(calls[1]?.values[0], 1);
  assert.equal(calls[1]?.values[1], state.accountId);
  assert.equal(calls[1]?.values[2], state.conversationId);
});

test('versioned repair seed has a stable policy hash', () => {
  const first = createDefaultAutoReplyRepairPolicy('account-1', new Date('2026-09-23T00:00:00.000Z')).policyConfig;
  const second = createDefaultAutoReplyRepairPolicy('account-1', new Date('2026-09-23T00:00:01.000Z')).policyConfig;
  assert.equal(first.policyVersion, second.policyVersion);
  assert.equal(first.policyHash, second.policyHash);
});
