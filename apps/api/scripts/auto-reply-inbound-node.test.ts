import assert from 'node:assert/strict';
import test from 'node:test';
import { MessageService } from '../src/messages.js';
import { MemoryStore } from '../src/store-memory.js';
import { parsePushPayloadDetailed } from '../src/xianyu-im.js';
import { XianyuImService } from '../src/xianyu-im-service.js';
import { InboundInboxWorker } from '../src/inbound-inbox-worker.js';

test('malformed push payload returns a structured quarantine result', () => {
  const receivedAt = '2026-09-21T14:00:00.000Z';
  const result = parsePushPayloadDetailed('not-base64-json', 'account-1', 'seller-1', receivedAt);
  assert.equal(result.event, undefined);
  assert.equal(result.quarantine?.reasonCode, 'PUSH_PAYLOAD_DECODE_FAILED');
  assert.equal(result.quarantine?.receivedAt, receivedAt);
});

test('invalid source timestamp uses received time and records quality risk', () => {
  const receivedAt = '2026-09-21T14:00:00.000Z';
  const encoded = Buffer.from(JSON.stringify({ 1: { 2: 'conv-1@goofish', 3: 'message-1.PNM', 5: 'not-a-timestamp', 10: { senderUserId: 'buyer-1', senderNick: 'Buyer' } } }), 'utf8').toString('base64');
  const result = parsePushPayloadDetailed(encoded, 'account-1', 'seller-1', receivedAt);
  assert.equal(result.quarantine, undefined);
  assert.equal(result.event?.occurredAt, receivedAt);
  assert.equal(result.event?.receivedAt, receivedAt);
  assert.equal(result.event?.timestampQuality, 'received');
  assert.deepEqual(result.event?.riskFlags, ['source_timestamp_invalid']);
});

test('push parser preserves explicit source event id and sequence from the gateway envelope', () => {
  const encoded = Buffer.from(JSON.stringify({
    1: { 2: 'conv-source-order@goofish', 3: 'message-source-order.PNM', 5: 1767225600000, 10: { senderUserId: 'buyer-1', senderNick: 'Buyer' } },
  }), 'utf8').toString('base64');
  const result = parsePushPayloadDetailed(encoded, 'account-1', 'seller-1', '2026-09-21T14:00:00.000Z', { eventId: 'push-event-17', sequence: 17 });
  assert.equal(result.quarantine, undefined);
  assert.equal(result.event?.sourceEventId, 'push-event-17');
  assert.equal(result.event?.sourceSequence, 17);
});

test('deferred inbox record carries source ordering into the repair worker input', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'source-order@example.com', passwordHash: 'hash', displayName: 'Source Order' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'seller-source-order' });
  const conversation = await store.createConversation({ adminId: admin.id, accountId: account.id, buyerRef: 'buyer-source-order', externalConversationRef: 'conv-source-order' });
  const message = await store.createMessage({ adminId: admin.id, conversationId: conversation.id, direction: 'inbound', senderRole: 'buyer', bodyType: 'text', bodyText: 'hello', externalMessageRef: 'message-source-order.PNM', source: 'system', traceId: 'source-order-test' });
  const queued = await store.enqueueInboundInbox({ adminId: admin.id, accountId: account.id, conversationId: conversation.id, inboundMessageId: message.message.id, externalConversationRef: 'conv-source-order', externalMessageRef: 'message-source-order.PNM', sourceEventId: 'push-event-17', sourceSequence: 17 });
  assert.equal(queued.record.sourceEventId, 'push-event-17');
  assert.equal(queued.record.sourceSequence, 17);
});

test('inbox processing forwards persisted source ordering to AutoReplyService', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'source-forward@example.com', passwordHash: 'hash', displayName: 'Source Forward' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'seller-source-forward' });
  const conversation = await store.createConversation({ adminId: admin.id, accountId: account.id, buyerRef: 'buyer-source-forward', buyerDisplayName: 'Buyer', externalConversationRef: 'conv-source-forward' });
  const message = await store.createMessage({ adminId: admin.id, conversationId: conversation.id, direction: 'inbound', senderRole: 'buyer', bodyType: 'text', bodyText: 'hello', externalMessageRef: 'message-source-forward.PNM', source: 'system', traceId: 'source-forward-test' });
  const queued = await store.enqueueInboundInbox({ adminId: admin.id, accountId: account.id, conversationId: conversation.id, inboundMessageId: message.message.id, externalConversationRef: 'conv-source-forward', externalMessageRef: 'message-source-forward.PNM', sourceEventId: 'push-event-forward', sourceSequence: 29 });
  const claimed = (await store.claimInboundInbox({ workerId: 'source-forward-worker', limit: 1, leaseMs: 5_000 }))[0];
  assert.equal(claimed?.id, queued.record.id);

  const calls: Array<{ sourceEventId?: string; sourceSequence?: number }> = [];
  const autoReply = { processInbound: async (input: { sourceEventId?: string; sourceSequence?: number }) => { calls.push(input); return undefined; } };
  const messages = new MessageService(store, async () => 'audit-source-forward');
  const service = new XianyuImService(store, {} as never, messages, autoReply as never);
  await service.processInboundInbox(claimed!);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.sourceEventId, 'push-event-forward');
  assert.equal(calls[0]?.sourceSequence, 29);
});

test('recent history recovery enqueues a buyer message missed by live push', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'recovery@example.com', passwordHash: 'hash', displayName: 'Recovery' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'seller-recovery' });
  const conversation = await store.createConversation({ adminId: admin.id, accountId: account.id, buyerRef: 'buyer-recovery', buyerDisplayName: 'Recovery Buyer', externalConversationRef: 'conv-recovery' });
  await store.createMessage({ adminId: admin.id, conversationId: conversation.id, direction: 'inbound', senderRole: 'buyer', bodyType: 'text', bodyText: '上一条', externalMessageRef: 'recovery-old.PNM', source: 'system', createdAt: '2026-09-24T03:00:00.000Z' });

  const encoded = Buffer.from(JSON.stringify({ contentType: 1, text: { text: '漏掉的这一条' } }), 'utf8').toString('base64');
  const fakeClient = {
    listMessages: async () => ({
      hasMore: false,
      userMessageModels: [{ message: { messageId: 'recovery-missed.PNM', senderUserId: 'buyer-recovery', createAt: Date.parse('2026-09-24T03:00:05.000Z'), content: { custom: { data: encoded } } } }],
    }),
  };
  const messages = new MessageService(store, async () => 'audit-recovery');
  const calls: Array<{ inboundMessageId: string; sourceEventId?: string }> = [];
  const autoReply = { processInbound: async (input: { inboundMessageId: string; sourceEventId?: string }) => { calls.push(input); return undefined; } };
  const service = new XianyuImService(store, {} as never, messages, autoReply as never);
  (service as unknown as { ensureClient: () => Promise<unknown> }).ensureClient = async () => fakeClient;

  const result = await service.recoverRecentMessages(admin.id, account.id);
  assert.equal(result.imported, 1);
  assert.equal(result.queued, 1);

  const claimed = await store.claimInboundInbox({ workerId: 'recovery-worker', limit: 1, leaseMs: 5_000 });
  assert.equal(claimed[0]?.externalMessageRef, 'recovery-missed.PNM');
  await service.processInboundInbox(claimed[0]!);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.inboundMessageId, claimed[0]!.inboundMessageId);
  assert.equal(calls[0]?.sourceEventId, 'history:recovery-missed.PNM');

  const repeat = await service.recoverRecentMessages(admin.id, account.id);
  assert.equal(repeat.imported, 0);
  assert.equal(repeat.queued, 0);
});

test('seller identity is reconciled to outbound before persistence and inbox enqueue', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'seller-direction@example.com', passwordHash: 'hash', displayName: 'Seller Direction' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'seller-account-ref' });
  await store.updateAccount(admin.id, account.id, { platformUserId: 'seller-platform-ref' });
  const conversation = await store.createConversation({ adminId: admin.id, accountId: account.id, buyerRef: 'buyer-direction', externalConversationRef: 'conv-direction' });
  const messages = new MessageService(store, async () => 'audit-seller-direction');
  const autoReply = { processInbound: async () => undefined };
  const service = new XianyuImService(store, {} as never, messages, autoReply as never);

  const result = await service.handleExternalEvent(admin.id, {
    accountId: account.id,
    externalConversationRef: 'conv-direction',
    externalMessageRef: 'seller-direction-1.PNM',
    senderRef: 'seller-platform-ref',
    direction: 'inbound',
    bodyType: 'text',
    bodyText: '卖家自己发出的消息',
    occurredAt: '2026-09-24T03:00:00.000Z',
  });
  assert.equal(result.created, true);

  const history = await store.listMessages(admin.id, conversation.id, { limit: 20 });
  assert.equal(history.items[0]?.direction, 'outbound');
  assert.equal(history.items[0]?.senderRole, 'agent');
  assert.ok(history.items[0]?.riskFlags.includes('sender_identity_reconciled'));
  assert.deepEqual(await store.claimInboundInbox({ workerId: 'seller-direction-worker', limit: 10, leaseMs: 5_000 }), []);
});

test('new buyer push persists product metadata before the conversation list refreshes', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'push-item@example.com', passwordHash: 'hash', displayName: 'Push Item' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'push-item-seller' });
  const messages = new MessageService(store, async () => 'audit-push-item');
  const autoReply = { processInbound: async () => undefined };
  const service = new XianyuImService(store, {} as never, messages, autoReply as never);

  const result = await service.handleExternalEvent(admin.id, {
    accountId: account.id,
    externalConversationRef: 'push-item-conversation',
    externalMessageRef: 'push-item-message.PNM',
    senderRef: 'push-item-buyer',
    senderName: 'Push Item Buyer',
    itemRef: 'push-item-1',
    itemTitle: 'Push Item Product',
    itemImageUrl: 'https://img.example/push-item.png',
    direction: 'inbound',
    bodyType: 'text',
    bodyText: '请问还有吗',
    occurredAt: '2026-09-24T03:00:00.000Z',
  });
  assert.equal(result.created, true);

  const conversation = await store.findConversationByExternalRef(admin.id, account.id, 'push-item-conversation');
  assert.equal(conversation?.itemRef, 'push-item-1');
  assert.equal(conversation?.itemTitle, 'Push Item Product');
  assert.equal(conversation?.itemImageUrl, 'https://img.example/push-item.png');
});

test('listener fallback wakes the durable inbox when no dedicated worker is polling', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'fallback-worker@example.com', passwordHash: 'hash', displayName: 'Fallback Worker' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'fallback-seller' });
  const calls: string[] = [];
  const messages = new MessageService(store, async () => 'audit-fallback-worker');
  const autoReply = { processInbound: async (input: { inboundMessageId: string }) => { calls.push(input.inboundMessageId); return undefined; } };
  const service = new XianyuImService(store, {} as never, messages, autoReply as never);

  const result = await service.handleExternalEvent(admin.id, {
    accountId: account.id,
    externalConversationRef: 'fallback-conversation',
    externalMessageRef: 'fallback-message.PNM',
    senderRef: 'fallback-buyer',
    senderName: 'Fallback Buyer',
    direction: 'inbound',
    bodyType: 'text',
    bodyText: '你好',
    occurredAt: '2026-09-24T03:00:00.000Z',
  }, { deferAutoReply: true });
  assert.equal(result.autoReply, undefined);
  const conversation = await store.findConversationByExternalRef(admin.id, account.id, 'fallback-conversation');
  assert.ok(conversation);
  const inbound = await store.listMessages(admin.id, conversation.id, { limit: 10 });

  service.wakeInboundInboxWorker();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(calls, [inbound.items[0]!.id]);
});

test('history recovery treats account seller identity as outbound', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'seller-history@example.com', passwordHash: 'hash', displayName: 'Seller History' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'seller-history-ref' });
  const conversation = await store.createConversation({ adminId: admin.id, accountId: account.id, buyerRef: 'buyer-history', externalConversationRef: 'conv-history-seller' });
  const encoded = Buffer.from(JSON.stringify({ text: { text: '历史卖家消息' } }), 'utf8').toString('base64');
  const fakeClient = {
    selfUserIds: ['seller-history-ref'],
    listMessages: async () => ({
      hasMore: false,
      userMessageModels: [{ message: { messageId: 'seller-history-1.PNM', senderUserId: 'seller-history-ref', createAt: Date.parse('2026-09-24T03:00:05.000Z'), content: { custom: { data: encoded } } } }],
    }),
  };
  const messages = new MessageService(store, async () => 'audit-seller-history');
  const autoReply = { processInbound: async () => { throw new Error('seller history must not reach auto reply'); } };
  const service = new XianyuImService(store, {} as never, messages, autoReply as never);
  (service as unknown as { ensureClient: () => Promise<unknown> }).ensureClient = async () => fakeClient;

  const result = await service.recoverRecentMessages(admin.id, account.id);
  assert.equal(result.imported, 1);
  assert.equal(result.queued, 0);
  const history = await store.listMessages(admin.id, conversation.id, { limit: 20 });
  assert.equal(history.items[0]?.direction, 'outbound');
  assert.equal(history.items[0]?.senderRole, 'agent');
  assert.deepEqual(await store.claimInboundInbox({ workerId: 'seller-history-worker', limit: 10, leaseMs: 5_000 }), []);
});

test('history/live alias resolves to the same local message', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'alias@example.com', passwordHash: 'hash', displayName: 'Alias' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'seller-alias' });
  const conversation = await store.createConversation({ adminId: admin.id, accountId: account.id, buyerRef: 'buyer-alias', externalConversationRef: 'conv-alias' });
  const created = await store.createMessage({ adminId: admin.id, conversationId: conversation.id, direction: 'inbound', senderRole: 'buyer', bodyType: 'text', bodyText: 'hello', externalMessageRef: 'canonical-1.PNM', externalMessageRefAliases: ['transport-uuid-1'], source: 'system', traceId: 'alias-test' });
  const resolved = await store.findMessageByExternalRef(admin.id, conversation.id, 'transport-uuid-1');
  assert.equal(resolved?.id, created.message.id);
});

test('inbox worker retries transient failed runs but acknowledges terminal failures', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'worker@example.com', passwordHash: 'hash', displayName: 'Worker' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'seller-worker' });
  const conversation = await store.createConversation({ adminId: admin.id, accountId: account.id, buyerRef: 'buyer-worker', externalConversationRef: 'conv-worker' });
  const message = await store.createMessage({ adminId: admin.id, conversationId: conversation.id, direction: 'inbound', senderRole: 'buyer', bodyType: 'text', bodyText: 'hello', externalMessageRef: 'worker-message.PNM', source: 'system', traceId: 'worker-test' });
  const queued = await store.enqueueInboundInbox({ adminId: admin.id, accountId: account.id, conversationId: conversation.id, inboundMessageId: message.message.id, externalConversationRef: 'conv-worker', externalMessageRef: 'worker-message.PNM' });
  const worker = new InboundInboxWorker(store, { processInboundInbox: async () => ({ run: { status: 'failed', failureCode: 'MODEL_TIMEOUT' } }) }, { workerId: 'worker-test', maxAttempts: 2, leaseMs: 5_000, pollMs: 250 });
  assert.equal(await worker.pollOnce(), 1);
  await new Promise((resolve) => setTimeout(resolve, 1_100));
  const reclaimed = await store.claimInboundInbox({ workerId: 'worker-test-2', limit: 1, leaseMs: 5_000 });
  assert.equal(reclaimed[0]?.id, queued.record.id);
  assert.equal(reclaimed[0]?.attempt, 2);
});
