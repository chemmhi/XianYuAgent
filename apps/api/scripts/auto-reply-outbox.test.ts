import assert from 'node:assert/strict';
import test from 'node:test';
import { MessageService } from '../src/messages.js';
import { ReliableExternalAutoReplySender } from '../src/auto-reply-outbox.js';
import { MemoryStore } from '../src/store-memory.js';
import { XianyuImClient } from '../src/xianyu-im.js';

async function fixture() {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'outbox@example.com', passwordHash: 'hash', displayName: 'Outbox' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'seller-outbox' });
  const conversation = await store.createConversation({ adminId: admin.id, accountId: account.id, buyerRef: 'buyer-outbox', buyerDisplayName: 'Buyer', externalConversationRef: 'conv-outbox' });
  const messages = new MessageService(store, async () => 'audit-outbox');
  return { store, messages, admin, account, conversation };
}

test('reliable sender persists a live send and replays the same request without a second external call', async () => {
  const f = await fixture();
  let calls = 0;
  const sender = new ReliableExternalAutoReplySender(f.store, f.messages, async () => { calls += 1; return { externalMessageRef: 'sent-1.PNM' }; });
  const input = { adminId: f.admin.id, accountId: f.account.id, requestId: 'outbox-request-1', traceId: 'outbox-trace-1', runId: 'outbox-run-1', inboundMessageId: 'inbound-1', conversation: f.conversation, recipientRef: f.conversation.buyerRef, text: '已确认可以发货。', mode: 'live' as const };
  const first = await sender.send(input);
  const replay = await sender.send(input);
  assert.equal(first.outcome, 'known_success');
  assert.equal(replay.outcome, 'known_success');
  assert.equal(replay.externalMessageRef, 'sent-1.PNM');
  assert.equal(calls, 1);
  const record = await f.store.getAutoReplyOutbox('auto_reply_send', input.requestId);
  assert.equal(record?.status, 'succeeded');
  assert.equal(record?.attempt, 1);
});

test('outbox recovery persists the local outbound message after a crash window', async () => {
  const f = await fixture();
  let calls = 0;
  const sender = new ReliableExternalAutoReplySender(f.store, f.messages, async () => { calls += 1; return { externalMessageRef: 'sent-recover.PNM' }; });
  const input = { adminId: f.admin.id, accountId: f.account.id, requestId: 'outbox-recover-request', traceId: 'outbox-recover-trace', runId: 'outbox-recover-run', inboundMessageId: 'inbound-recover', conversation: f.conversation, recipientRef: f.conversation.buyerRef, text: '恢复发送记录。', mode: 'live' as const };
  const sent = await sender.send(input);
  assert.equal(sent.outcome, 'known_success');
  const recovered = await sender.recoverRun({ adminId: f.admin.id, runId: input.runId });
  assert.equal(recovered.outboundMessageIds.length, 1);
  const replayed = await sender.recoverRun({ adminId: f.admin.id, runId: input.runId });
  assert.deepEqual(replayed.outboundMessageIds, recovered.outboundMessageIds);
  assert.equal(calls, 1);
  const outbound = await f.store.findMessageByExternalRef(f.admin.id, f.conversation.id, 'sent-recover.PNM');
  assert.equal(outbound?.bodyText, '恢复发送记录。');
});

test('targeted claim does not steal a different pending outbox job during replay', async () => {
  const f = await fixture();
  let calls = 0;
  const sender = new ReliableExternalAutoReplySender(f.store, f.messages, async (input) => { calls += 1; return { externalMessageRef: `sent-${input.requestId}.PNM` }; });
  const firstInput = { adminId: f.admin.id, accountId: f.account.id, requestId: 'outbox-first-request', traceId: 'outbox-first-trace', runId: 'outbox-first-run', inboundMessageId: 'inbound-first', conversation: f.conversation, recipientRef: f.conversation.buyerRef, text: '第一条。', mode: 'live' as const };
  const secondInput = { ...firstInput, requestId: 'outbox-second-request', traceId: 'outbox-second-trace', runId: 'outbox-second-run', inboundMessageId: 'inbound-second', text: '第二条。' };
  await f.store.enqueueAutoReplyOutbox({ scope: 'auto_reply_send', aggregateType: 'auto_reply_run', aggregateId: '00000000-0000-4000-8000-000000000001', operation: 'send_text', idempotencyKey: firstInput.requestId, payload: { ...firstInput, conversation: { id: f.conversation.id, accountId: f.conversation.accountId, buyerRef: f.conversation.buyerRef } } });
  const second = await sender.send(secondInput);
  assert.equal(second.outcome, 'known_success');
  assert.equal(second.externalMessageRef, 'sent-outbox-second-request.PNM');
  assert.equal(calls, 1);
  assert.equal((await f.store.getAutoReplyOutbox('auto_reply_send', firstInput.requestId))?.status, 'pending');
  assert.equal((await f.store.getAutoReplyOutbox('auto_reply_send', secondInput.requestId))?.status, 'succeeded');
});

test('Xianyu sendText derives a stable external uuid from requestId', async () => {
  const client = new XianyuImClient({ accountId: 'account-1', credential: { cookieHeader: 'unb=seller-1', accessToken: 'token' } });
  const bodies: unknown[][] = [];
  (client as unknown as { sendLwp: (lwp: string, body: unknown[]) => Promise<Record<string, unknown>> }).sendLwp = async (_lwp, body) => { bodies.push(body); return { body: { messageId: 'sent.PNM' } }; };
  await client.sendText('conversation-1', 'buyer-1', 'hello', 'same-request');
  await client.sendText('conversation-1', 'buyer-1', 'hello', 'same-request');
  await client.sendText('conversation-1', 'buyer-1', 'hello', 'different-request');
  assert.equal((bodies[0]?.[0] as Record<string, unknown>).uuid, (bodies[1]?.[0] as Record<string, unknown>).uuid);
  assert.notEqual((bodies[0]?.[0] as Record<string, unknown>).uuid, (bodies[2]?.[0] as Record<string, unknown>).uuid);
});
