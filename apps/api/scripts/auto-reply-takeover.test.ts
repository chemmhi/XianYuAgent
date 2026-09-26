import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { AutoReplyService, type AutoReplySendInput } from '../src/auto-reply.js';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function bootRuntime(label: string, sendDelaySeconds = 1) {
  const runtime = createApp(loadConfig({
    ...process.env,
    AUTO_REPLY_AGENT_SEND_DELAY_SECONDS: String(sendDelaySeconds),
    AUTO_REPLY_AGENT_DEBOUNCE_MS: '0',
    AUTO_REPLY_AGENT_REPLY_SEGMENT_DELAY_MS: '0',
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
    AUTOMATION_BUYER_ALLOWLIST: '["买家"]',
  }));
  await runtime.listen();
  const boot = await runtime.auth.bootstrap({ email: `${label}@example.com`, password: 'password-123', displayName: label });
  const account = await runtime.store.createAccount({ adminId: boot.admin.id, platform: 'xianyu', sellerRef: `${label}-seller` });
  const conversation = await runtime.store.createConversation({ adminId: boot.admin.id, accountId: account.id, buyerRef: `${label}-buyer`, buyerDisplayName: '买家', externalConversationRef: `${label}-conversation` });
  return { runtime, adminId: boot.admin.id, account, conversation };
}

function inbound(accountId: string, conversationRef: string, ref: string, text: string) {
  return {
    accountId,
    externalConversationRef: conversationRef,
    externalMessageRef: ref,
    senderRef: 'buyer',
    senderName: '买家',
    direction: 'inbound' as const,
    bodyType: 'text' as const,
    bodyText: text,
    occurredAt: new Date().toISOString(),
  };
}

test('first takeover window aggregates buyer messages into one AI reply', { concurrency: false }, async () => {
  const { runtime, adminId, account, conversation } = await bootRuntime('takeover-aggregate');
  try {
    await Promise.all([
      runtime.xianyuIm.handleExternalEvent(adminId, inbound(account.id, conversation.externalConversationRef!, 'takeover-aggregate-1.PNM', '请问价格？')),
      runtime.xianyuIm.handleExternalEvent(adminId, inbound(account.id, conversation.externalConversationRef!, 'takeover-aggregate-2.PNM', '还有库存吗？')),
    ]);
    await wait(1_200);
    const messages = await runtime.messages.listMessages(adminId, conversation.id, { limit: 50 });
    const ai = messages.items.filter((message) => message.direction === 'outbound' && message.source === 'ai');
    assert.equal(ai.length, 1);
  } finally {
    await runtime.close();
  }
});

test('takeover window gives the generator the full buyer conversation before sending', { concurrency: false }, async () => {
  const { runtime, adminId, account, conversation } = await bootRuntime('takeover-context', 1);
  try {
    const seenHistory: string[][] = [];
    let sends = 0;
    const service = new AutoReplyService(runtime.store, runtime.messages, async () => 'takeover-context-audit', {
      sendMode: 'simulate',
      buyerAllowlist: ['买家'],
      sendDelaySeconds: 1,
      debounceMs: 30_000,
      generator: {
        generate: async ({ context }) => {
          seenHistory.push(context.recentMessages.map((message) => message.bodyText ?? ''));
          return '已收到，我会一起处理这几个问题。';
        },
      },
      sender: {
        async send() {
          sends += 1;
          return { outcome: 'simulated' as const, externalMessageRef: `takeover-context-${sends}` };
        },
      },
    });
    const first = await runtime.store.createMessage({ adminId, conversationId: conversation.id, direction: 'inbound', senderRole: 'buyer', bodyType: 'text', bodyText: '第一个问题', source: 'system', externalMessageRef: 'takeover-context-1.PNM' });
    const firstRun = service.processInbound({ adminId, conversationId: conversation.id, inboundMessageId: first.message.id, senderName: '买家' });
    await wait(100);
    const second = await runtime.store.createMessage({ adminId, conversationId: conversation.id, direction: 'inbound', senderRole: 'buyer', bodyType: 'text', bodyText: '第二个问题', source: 'system', externalMessageRef: 'takeover-context-2.PNM' });
    const secondRun = service.processInbound({ adminId, conversationId: conversation.id, inboundMessageId: second.message.id, senderName: '买家' });
    await Promise.all([firstRun, secondRun]);
    assert.equal(sends, 1);
    assert.equal(seenHistory.length, 1);
    assert.ok(seenHistory[0]?.includes('第二个问题'));
  } finally {
    await runtime.close();
  }
});

test('agent takeover stays active and answers the next buyer message without another five minute wait', { concurrency: false }, async () => {
  const { runtime, adminId, account, conversation } = await bootRuntime('takeover-active');
  try {
    await runtime.xianyuIm.handleExternalEvent(adminId, inbound(account.id, conversation.externalConversationRef!, 'takeover-active-1.PNM', '先介绍一下商品'));
    await wait(1_200);
    const startedAt = Date.now();
    await runtime.xianyuIm.handleExternalEvent(adminId, inbound(account.id, conversation.externalConversationRef!, 'takeover-active-2.PNM', '我还有一个问题'));
    const elapsedMs = Date.now() - startedAt;
    assert.ok(elapsedMs < 700, `active agent reply waited ${elapsedMs}ms`);
    const messages = await runtime.messages.listMessages(adminId, conversation.id, { limit: 50 });
    assert.equal(messages.items.filter((message) => message.direction === 'outbound' && message.source === 'ai').length, 2);
  } finally {
    await runtime.close();
  }
});

test('human intervention cancels the active agent and reopens the takeover wait window', { concurrency: false }, async () => {
  const { runtime, adminId, account, conversation } = await bootRuntime('takeover-human');
  try {
    await runtime.xianyuIm.handleExternalEvent(adminId, inbound(account.id, conversation.externalConversationRef!, 'takeover-human-1.PNM', '第一条问题'));
    await wait(1_200);
    await runtime.messages.createMessage({
      adminId,
      conversationId: conversation.id,
      direction: 'outbound',
      senderRole: 'agent',
      bodyType: 'text',
      bodyText: '人工已接管，请稍等。',
      source: 'human',
      requestId: 'takeover-human-reply',
      traceId: 'takeover-human-reply',
    });
    const pending = runtime.xianyuIm.handleExternalEvent(adminId, inbound(account.id, conversation.externalConversationRef!, 'takeover-human-2.PNM', '人工回复后新的问题'));
    await wait(200);
    const during = await runtime.messages.listMessages(adminId, conversation.id, { limit: 50 });
    assert.equal(during.items.filter((message) => message.direction === 'outbound' && message.source === 'ai').length, 1);
    const nextResult = await pending;
    assert.equal(nextResult.autoReply?.run.status, 'persisted');
    let after = await runtime.messages.listMessages(adminId, conversation.id, { limit: 50 });
    for (let attempt = 0; attempt < 20 && after.items.filter((message) => message.direction === 'outbound' && message.source === 'ai').length < 2; attempt += 1) {
      await wait(100);
      after = await runtime.messages.listMessages(adminId, conversation.id, { limit: 50 });
    }
    assert.equal(after.items.filter((message) => message.direction === 'outbound' && message.source === 'ai').length, 2);
  } finally {
    await runtime.close();
  }
});

test('human intervention cancels the initial wait immediately and a later message starts a fresh wait', { concurrency: false }, async () => {
  const { runtime, adminId, account, conversation } = await bootRuntime('takeover-cancel-immediate', 2);
  try {
    const startedAt = Date.now();
    const pending = runtime.xianyuIm.handleExternalEvent(adminId, inbound(account.id, conversation.externalConversationRef!, 'takeover-cancel-immediate-1.PNM', '先等等'));
    await wait(100);
    await runtime.messages.createMessage({
      adminId,
      conversationId: conversation.id,
      direction: 'outbound',
      senderRole: 'agent',
      bodyType: 'text',
      bodyText: '人工接管中。',
      source: 'human',
      requestId: 'takeover-cancel-immediate-human',
      traceId: 'takeover-cancel-immediate-human',
    });
    const cancelled = await pending;
    assert.ok(Date.now() - startedAt < 1_200, 'human takeover should cancel before the full delay');
    assert.equal(cancelled.autoReply?.run.failureCode, 'AUTO_REPLY_CANCELLED_BY_HUMAN_REPLY');

    const nextStartedAt = Date.now();
    const next = runtime.xianyuIm.handleExternalEvent(adminId, inbound(account.id, conversation.externalConversationRef!, 'takeover-cancel-immediate-2.PNM', '人工回复后的新问题'));
    await wait(250);
    const during = await runtime.messages.listMessages(adminId, conversation.id, { limit: 50 });
    assert.equal(during.items.filter((message) => message.direction === 'outbound' && message.source === 'ai').length, 0);
    await next;
    assert.ok(Date.now() - nextStartedAt >= 1_500, 'human intervention should reopen the configured wait window');
  } finally {
    await runtime.close();
  }
});

test('active takeover remains effective after the auto-reply service is recreated', { concurrency: false }, async () => {
  const { runtime, adminId, account, conversation } = await bootRuntime('takeover-restart', 0);
  try {
    const first = await runtime.xianyuIm.handleExternalEvent(adminId, inbound(account.id, conversation.externalConversationRef!, 'takeover-restart-1.PNM', '先回答这个问题'));
    assert.equal(first.autoReply?.run.status, 'persisted');
    const restartedService = new AutoReplyService(runtime.store, runtime.messages, async () => 'takeover-restart-audit', {
      sendMode: 'simulate',
      buyerAllowlist: ['买家'],
      sendDelaySeconds: 2,
      debounceMs: 30_000,
    });
    const inboundMessage = await runtime.store.createMessage({ adminId, conversationId: conversation.id, direction: 'inbound', senderRole: 'buyer', bodyType: 'text', bodyText: '重启后的新问题', source: 'system', externalMessageRef: 'takeover-restart-2.PNM' });
    const startedAt = Date.now();
    const result = await restartedService.processInbound({ adminId, conversationId: conversation.id, inboundMessageId: inboundMessage.message.id, senderName: '买家' });
    assert.ok(Date.now() - startedAt < 1_000, 'persisted AI takeover should not wait again after service recreation');
    assert.equal(result.run.status, 'persisted');
  } finally {
    await runtime.close();
  }
});

test('human intervention during segmented sending stops remaining AI segments', { concurrency: false }, async () => {
  const { runtime, adminId, conversation } = await bootRuntime('takeover-segment', 0);
  try {
    let sends = 0;
    const service = new AutoReplyService(runtime.store, runtime.messages, async () => 'takeover-segment-audit', {
      sendMode: 'simulate',
      buyerAllowlist: ['买家'],
      sendDelaySeconds: 0,
      replySegmentDelayMs: 50,
      generator: { generate: async () => ({ text: '第一段第二段', segments: ['第一段', '第二段'] }) },
      sender: {
        async send(input: AutoReplySendInput) {
          sends += 1;
          if (sends === 1) {
            await runtime.messages.createMessage({
              adminId,
              conversationId: conversation.id,
              direction: 'outbound',
              senderRole: 'agent',
              bodyType: 'text',
              bodyText: '人工接管中。',
              source: 'human',
              requestId: 'takeover-segment-human',
              traceId: 'takeover-segment-human',
            });
          }
          return { outcome: 'simulated' as const, externalMessageRef: `takeover-segment-${sends}` };
        },
      },
    });
    const inboundMessage = await runtime.store.createMessage({ adminId, conversationId: conversation.id, direction: 'inbound', senderRole: 'buyer', bodyType: 'text', bodyText: '请详细说明', source: 'system', externalMessageRef: 'takeover-segment-inbound.PNM' });
    const result = await service.processInbound({ adminId, conversationId: conversation.id, inboundMessageId: inboundMessage.message.id, senderName: '买家' });
    const messages = await runtime.messages.listMessages(adminId, conversation.id, { limit: 50 });
    assert.equal(result.run.failureCode, 'AUTO_REPLY_CANCELLED_BY_HUMAN_REPLY', JSON.stringify({ status: result.run.status, decision: result.run.decision, failureCode: result.run.failureCode, messages: messages.items.map((message) => ({ direction: message.direction, senderRole: message.senderRole, source: message.source, bodyText: message.bodyText })) }));
    assert.equal(messages.items.filter((message) => message.direction === 'outbound' && message.source === 'ai').length, 0);
  } finally {
    await runtime.close();
  }
});
