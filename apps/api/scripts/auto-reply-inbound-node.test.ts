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
