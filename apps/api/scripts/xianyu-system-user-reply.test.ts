import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AutoReplyService, type AutoReplyGenerator } from '../src/auto-reply.js';
import { ReliableExternalAutoReplySender } from '../src/auto-reply-outbox.js';
import { MessageService } from '../src/messages.js';
import { MemoryStore } from '../src/store-memory.js';
import { parsePushPayloadDetailed } from '../src/xianyu-im.js';
import { XianyuImService } from '../src/xianyu-im-service.js';

function config() {
  const dir = mkdtempSync(join(tmpdir(), 'system-reply-'));
  const path = join(dir, 'users.json'), previous = process.env.XIANYU_SYSTEM_USERS_FILE;
  process.env.XIANYU_SYSTEM_USERS_FILE = path;
  const put = (userIds: string[]) => writeFileSync(path, JSON.stringify({ version: 1, userIds }));
  put(['1400']);
  return { put, path, close() { if (previous === undefined) delete process.env.XIANYU_SYSTEM_USERS_FILE; else process.env.XIANYU_SYSTEM_USERS_FILE = previous; rmSync(dir, { recursive: true, force: true }); } };
}
async function fixture(buyerRef = '1400', generator?: AutoReplyGenerator) {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'system-pool@example.com', passwordHash: 'hash', displayName: 'System pool' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'seller-test' });
  const conversation = await store.createConversation({ adminId: admin.id, accountId: account.id, buyerRef, buyerDisplayName: '闲小蜜发来一条新消息', externalConversationRef: 'conv-system-pool' });
  const messages = new MessageService(store, async () => 'audit-test');
  const inbound = (await messages.createMessage({ adminId: admin.id, conversationId: conversation.id, direction: 'inbound', senderRole: 'buyer', bodyType: 'text', bodyText: '小蜜消息', source: 'system', requestId: 'inbound-test', traceId: 'inbound-test' })).message;
  let generated = 0, sent = 0;
  const sender = new ReliableExternalAutoReplySender(store, messages, async () => { sent++; return { externalMessageRef: `sent-${sent}.PNM` }; });
  const autoReply = new AutoReplyService(store, messages, async () => 'audit-test', { enabled: true, sendMode: 'live', replySegmentDelayMs: 0, sendDelaySeconds: 0, sender, generator: generator ?? { generate: async () => { generated++; return '您好，有什么需要？'; } } });
  return { store, admin, account, conversation, messages, inbound, sender, autoReply, counts: () => ({ generated, sent }), input: { adminId: admin.id, conversationId: conversation.id, inboundMessageId: inbound.messageId } };
}
function compact(sender: string) {
  const content = Buffer.from(JSON.stringify({ contentType: 1, text: { text: '小蜜消息' } })).toString('base64');
  return Buffer.from(JSON.stringify({ 1: { 2: 'conv@goofish', 3: 'notice.PNM', 5: Date.now(), 6: { 3: { 5: content } }, 10: { senderUserId: sender, senderNick: '闲小蜜发来一条新消息' } } })).toString('base64');
}

test('official sender identity overrides a normal compact text envelope; nickname is not identity', () => {
  const c = config();
  try {
    const official = parsePushPayloadDetailed(compact('1400@goofish'), 'account', 'seller').event;
    assert.equal(official?.bodyType, 'system');
    assert.equal(official?.platformSystemMessage, undefined, 'identity must not upgrade order-event trust');
    assert.equal(official?.bodyText, '小蜜消息');
    assert.equal(parsePushPayloadDetailed(compact('2400'), 'account', 'seller').event?.bodyType, 'text');
    c.put(['1400', '2400']);
    assert.equal(parsePushPayloadDetailed(compact('2400'), 'account', 'seller').event?.bodyType, 'system');
  } finally { c.close(); }
});

test('legacy buyer/text rows for a pooled conversation never invoke the model, including replay', async () => {
  const c = config();
  try {
    const f = await fixture();
    const first = await f.autoReply.processInbound(f.input);
    const replay = await f.autoReply.processInbound(f.input);
    assert.equal(first.run.status, 'skipped');
    assert.equal(first.run.failureCode, 'XIANYU_SYSTEM_USER_IGNORED');
    assert.equal(replay.run.id, first.run.id);
    assert.deepEqual(f.counts(), { generated: 0, sent: 0 });
  } finally { c.close(); }
});

test('old pending outbox is dead-lettered before replay and never reactivated after ID removal', async () => {
  const c = config();
  try {
    const f = await fixture();
    const run = await f.store.createAutoReplyRun({ adminId: f.admin.id, accountId: f.account.id, conversationId: f.conversation.id, inboundMessageId: f.inbound.messageId, intent: 'general', status: 'generated', decision: 'replied', inputDigest: 'digest' });
    await f.store.enqueueAutoReplyOutbox({ scope: 'auto_reply_send', aggregateType: 'auto_reply_run', aggregateId: run.id, operation: 'send_text', idempotencyKey: 'old-request', payload: { adminId: f.admin.id, accountId: f.account.id, conversation: f.conversation, recipientRef: f.conversation.buyerRef, text: '旧回复', requestId: 'old-request', traceId: 'old-trace' } });
    const replay = await f.autoReply.processInbound(f.input);
    assert.equal(replay.run.status, 'skipped');
    assert.equal((await f.store.getAutoReplyOutbox('auto_reply_send', 'old-request'))?.status, 'dead_lettered');
    c.put([]);
    await f.sender.recoverRun({ adminId: f.admin.id, runId: run.id });
    assert.equal(f.counts().sent, 0);
  } finally { c.close(); }
});

test('hot addition during generation fences send; same nickname and text alone do not block real buyer', async () => {
  const c = config();
  try {
    const positive = await fixture('2400');
    assert.equal((await positive.autoReply.processInbound(positive.input)).run.status, 'persisted');
    assert.deepEqual(positive.counts(), { generated: 1, sent: 1 });
    const f = await fixture('2400', { generate: async () => { c.put(['1400', '2400']); return '您好'; } });
    const result = await f.autoReply.processInbound(f.input);
    assert.equal(result.run.failureCode, 'XIANYU_SYSTEM_USER_IGNORED');
    assert.equal(f.counts().sent, 0);
  } finally { c.close(); }
});

test('pool additions between segments stop remaining sends and preserve the first successful message', async () => {
  const c = config();
  try {
    const f = await fixture('2400', { generate: async () => ({ text: '第一条。第二条。', segments: ['第一条。', '第二条。'] }) });
    const create = f.messages.createMessage.bind(f.messages);
    f.messages.createMessage = async input => { const result = await create(input); if (input.source === 'ai') c.put(['1400', '2400']); return result; };
    const result = await f.autoReply.processInbound(f.input);
    assert.equal(result.run.failureCode, 'XIANYU_SYSTEM_USER_IGNORED');
    assert.equal(f.counts().sent, 1);
    const rows = (await f.messages.listMessages(f.admin.id, f.conversation.id, { limit: 20 })).items;
    assert.equal(rows.filter(row => row.source === 'ai').length, 1);
    assert.ok(result.run.outboundMessageId);
  } finally { c.close(); }
});

test('direct sender and recovery check recipient and current pool; wrong admin cannot recover jobs', async () => {
  const c = config();
  try {
    const f = await fixture('2400');
    const input = { adminId: f.admin.id, accountId: f.account.id, conversation: f.conversation, recipientRef: '1400@goofish', text: '禁止自动发送', requestId: 'direct-blocked', traceId: 'direct', runId: 'direct-run', mode: 'live' as const };
    await assert.rejects(() => f.sender.send(input), /XIANYU_SYSTEM_USER_IGNORED/);
    assert.equal((await f.store.getAutoReplyOutbox('auto_reply_send', input.requestId))?.status, 'dead_lettered');
    const queued = await f.store.enqueueAutoReplyOutbox({ scope: 'auto_reply_send', aggregateType: 'auto_reply_run', aggregateId: 'future-run', operation: 'send_text', idempotencyKey: 'future', availableAt: new Date(Date.now() + 3600000).toISOString(), payload: { ...input, recipientRef: '2400', requestId: 'future' } });
    await f.sender.recoverRun({ adminId: 'wrong-admin', runId: 'future-run' });
    assert.equal((await f.store.getAutoReplyOutbox('auto_reply_send', 'future'))?.status, 'pending');
    c.put(['1400', '2400']);
    await f.sender.recoverRun({ adminId: f.admin.id, runId: queued.record.aggregateId });
    assert.equal((await f.store.getAutoReplyOutbox('auto_reply_send', 'future'))?.status, 'dead_lettered');
    assert.equal(f.counts().sent, 0);
  } finally { c.close(); }
});

test('invalid cold configuration blocks AI while import and manual message persistence still work', async () => {
  const c = config();
  try {
    writeFileSync(c.path, '{}');
    const f = await fixture('2400');
    const result = await f.autoReply.processInbound(f.input);
    assert.equal(result.run.failureCode, 'SYSTEM_USERS_CONFIG_UNAVAILABLE');
    assert.deepEqual(f.counts(), { generated: 0, sent: 0 });
    const manual = await f.messages.createMessage({ adminId: f.admin.id, conversationId: f.conversation.id, direction: 'outbound', senderRole: 'agent', bodyType: 'text', bodyText: '人工消息', source: 'human', requestId: 'manual', traceId: 'manual' });
    assert.equal(manual.message.source, 'human');
    c.put(['1400']);
    const next = (await f.messages.createMessage({ adminId: f.admin.id, conversationId: f.conversation.id, direction: 'inbound', senderRole: 'buyer', bodyType: 'text', bodyText: '新的问题', source: 'system', requestId: 'next', traceId: 'next' })).message;
    assert.equal((await f.autoReply.processInbound({ ...f.input, inboundMessageId: next.messageId })).run.status, 'persisted');
  } finally { c.close(); }
});

test('successful external sends reconcile history after pool addition, including unavailable cold config', async () => {
  const c = config();
  try {
    const f = await fixture('2400');
    const run = await f.store.createAutoReplyRun({ adminId: f.admin.id, accountId: f.account.id, conversationId: f.conversation.id, inboundMessageId: f.inbound.messageId, intent: 'general', status: 'generated', decision: 'replied', inputDigest: 'digest' });
    const input = { adminId: f.admin.id, accountId: f.account.id, conversation: f.conversation, recipientRef: '2400', text: '已成功提交平台', requestId: 'success-before-crash', traceId: 'success', runId: run.id, mode: 'live' as const };
    await f.sender.send(input);
    c.put(['1400', '2400']);
    const replay = await f.autoReply.processInbound(f.input);
    assert.equal(replay.run.status, 'persisted');
    assert.equal(replay.outboundMessage?.bodyText, input.text);
    const bad = c.path + '.cold'; writeFileSync(bad, '{}'); process.env.XIANYU_SYSTEM_USERS_FILE = bad;
    assert.equal((await f.sender.recoverRun({ adminId: f.admin.id, runId: run.id })).outboundMessageIds.length, 1);
    assert.equal(f.counts().sent, 1);
  } finally { c.close(); }
});

test('AI owner fences hot additions while waiting for connection; manual send remains available', async () => {
  const c = config();
  try {
    const f = await fixture('2400');
    await f.store.updateAccount(f.admin.id, f.account.id, { status: 'connected' });
    let writes = 0;
    const service = new XianyuImService(f.store, {} as never, f.messages);
    (service as unknown as { ensureClient: () => Promise<unknown> }).ensureClient = async () => { c.put(['1400', '2400']); return { sendText: async () => { writes++; return { externalMessageRef: 'manual.PNM' }; } }; };
    await assert.rejects(() => service.sendAutoReplyText(f.admin.id, f.account.id, f.conversation.id, 'AI', 'ai-owner', 'ai-owner'), { code: 'XIANYU_SYSTEM_USER_IGNORED' });
    assert.equal(writes, 0);
    assert.equal((await f.store.getAccount(f.admin.id, f.account.id))?.status, 'connected');
    assert.deepEqual(await f.store.listAccountVerificationRisks(f.admin.id, f.account.id), []);
    await service.sendText(f.admin.id, f.account.id, f.conversation.id, '人工消息', 'human-owner', 'human-owner');
    assert.equal(writes, 1);
  } finally { c.close(); }
});

test('unavailable configuration rejects an AI send without marking the platform account unhealthy', async () => {
  const c = config();
  try {
    const f = await fixture('2400');
    await f.store.updateAccount(f.admin.id, f.account.id, { status: 'connected' });
    writeFileSync(c.path, '{}');
    const service = new XianyuImService(f.store, {} as never, f.messages);
    (service as unknown as { ensureClient: () => Promise<unknown> }).ensureClient = async () => ({ sendText: async () => { throw new Error('must never write'); } });
    await assert.rejects(() => service.sendAutoReplyText(f.admin.id, f.account.id, f.conversation.id, 'AI', 'config-error', 'config-error'), { code: 'SYSTEM_USERS_CONFIG_UNAVAILABLE' });
    assert.equal((await f.store.getAccount(f.admin.id, f.account.id))?.status, 'connected');
    assert.deepEqual(await f.store.listAccountVerificationRisks(f.admin.id, f.account.id), []);
  } finally { c.close(); }
});
