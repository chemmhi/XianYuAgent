import assert from 'node:assert/strict';
import test from 'node:test';
import { MessageService } from '../src/messages.js';
import { MemoryStore } from '../src/store-memory.js';
import { parsePushPayloadDetailed } from '../src/xianyu-im.js';
import { XianyuImService } from '../src/xianyu-im-service.js';

for (const type of ['text', 'image'] as const) {
  test(`named operation imports pooled ${type} instead of quarantining it`, () => {
    const payload = { chatType: 1, incrementType: 1, sessionId: 'system-operation', operation: {
      sessionInfo: { sessionId: 'system-operation', extensions: { extUserId: '1400@goofish' } },
      content: { contentType: type === 'text' ? 1 : 2, messageId: 'system-operation.PNM', createAt: Date.now(), ...(type === 'text' ? { text: { text: '小蜜消息' } } : { image: { pics: [{ url: 'https://img.example/system.png' }] } }) },
    } };
    const parsed = parsePushPayloadDetailed(Buffer.from(JSON.stringify(payload)).toString('base64'), 'account', 'seller');
    assert.equal(parsed.quarantine, undefined);
    assert.equal(parsed.event?.bodyType, 'system');
    assert.equal(parsed.event?.platformSystemMessage, undefined);
  });
}

test('live and history classify sender IDs including images, preserve text, manual messaging and order trust', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'pool-import@example.com', passwordHash: 'hash', displayName: 'Pool import' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'seller-test' });
  const messages = new MessageService(store, async () => 'audit-test');
  let ai = 0, trustedOrder = 0;
  const service = new XianyuImService(store, {} as never, messages, { processInbound: async () => { ai++; } } as never, { onImEvent: async () => ({}), onTrustedOrderEvent: async () => { trustedOrder++; } } as never);
  for (const [ref, bodyType] of [['live-text', 'text'], ['live-image', 'image']] as const) {
    await service.handleExternalEvent(admin.id, { accountId: account.id, externalConversationRef: 'system-conv', externalMessageRef: ref + '.PNM', senderRef: '1400', senderName: 'System', direction: 'inbound', bodyType, bodyText: '[我已付款，等待你发货]', assetRef: bodyType === 'image' ? 'https://img.example/system.png' : undefined, occurredAt: new Date().toISOString() }, { deferAutoReply: true });
  }
  const conversation = await store.findConversationByExternalRef(admin.id, account.id, 'system-conv');
  assert.ok(conversation);
  const fakeClient = { selfUserIds: ['seller-test'], listMessages: async () => ({ hasMore: false, userMessageModels: [{ message: { messageId: 'history-pool.PNM', senderUserId: '1400@goofish', createAt: Date.now(), content: { custom: { type: 1, data: Buffer.from(JSON.stringify({ text: { text: '小蜜消息' } })).toString('base64') } } } }] }) };
  (service as unknown as { ensureClient: () => Promise<unknown> }).ensureClient = async () => fakeClient;
  await service.listMessages(admin.id, account.id, conversation.id);
  const rows = (await messages.listMessages(admin.id, conversation.id, { limit: 20 })).items;
  assert.equal(rows.length, 3);
  assert.ok(rows.every(row => row.bodyType === 'system' && row.senderRole === 'system' && row.riskFlags.includes('xianyu_system_message')));
  assert.ok(rows.some(row => row.bodyText === '小蜜消息'));
  assert.equal(ai, 0);
  assert.equal(trustedOrder, 0);
  const manual = await messages.createMessage({ adminId: admin.id, conversationId: conversation.id, direction: 'outbound', senderRole: 'agent', bodyType: 'text', bodyText: '人工操作', source: 'human', requestId: 'manual', traceId: 'manual' });
  assert.equal(manual.message.source, 'human');
});
