import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryStore } from '../src/store-memory.js';
import { parsePushPayloadDetailed } from '../src/xianyu-im.js';
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
