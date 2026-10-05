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

test('legacy push parser keeps buyer text as text unless the gateway supplies a reminder marker', () => {
  const systemText = '[我已拍下，待付款]';
  const content = Buffer.from(JSON.stringify({ contentType: 1, text: { text: systemText } }), 'utf8').toString('base64');
  const encoded = Buffer.from(JSON.stringify({
    1: {
      2: 'conv-system@goofish',
      3: 'system-message-1.PNM',
      5: 1767225600000,
      6: { 3: { 5: content } },
      10: { senderUserId: 'buyer-system', senderNick: 'Buyer' },
    },
  }), 'utf8').toString('base64');

  const systemResult = parsePushPayloadDetailed(encoded, 'account-1', 'seller-1');
  assert.equal(systemResult.event?.bodyType, 'text');
  assert.equal(systemResult.event?.bodyText, systemText);
  assert.equal(systemResult.event?.platformSystemMessage, undefined);

  const reminderContent = Buffer.from(JSON.stringify({ contentType: 26, text: { text: systemText } }), 'utf8').toString('base64');
  const reminderEncoded = Buffer.from(JSON.stringify({
    1: {
      2: 'conv-system@goofish',
      3: 'system-reminder-1.PNM',
      5: 1767225600000,
      6: { 3: { 5: reminderContent } },
      10: { senderUserId: 'buyer-system', senderNick: 'Buyer', extJson: '{"contentType":"26"}', reminderContent: systemText, reminderUrl: 'fleamarket://message?messageId=system-reminder-1.PNM' },
    },
  }), 'utf8').toString('base64');
  const reminderResult = parsePushPayloadDetailed(reminderEncoded, 'account-1', 'seller-1');
  assert.equal(reminderResult.event?.bodyType, 'text');
  assert.equal(reminderResult.event?.platformSystemMessage, true);

  const normalContent = Buffer.from(JSON.stringify({ contentType: 1, text: { text: '请问还有货吗？' } }), 'utf8').toString('base64');
  const normalEncoded = Buffer.from(JSON.stringify({
    1: {
      2: 'conv-system@goofish',
      3: 'buyer-message-1.PNM',
      5: 1767225600000,
      6: { 3: { 5: normalContent } },
      10: { senderUserId: 'buyer-system', senderNick: 'Buyer' },
    },
  }), 'utf8').toString('base64');
  const normalResult = parsePushPayloadDetailed(normalEncoded, 'account-1', 'seller-1');
  assert.equal(normalResult.event?.bodyType, 'text');

  const bracketedBuyerText = Buffer.from(JSON.stringify({ contentType: 1, text: { text: '[请问付款后什么时候发货？]' } }), 'utf8').toString('base64');
  const bracketedBuyerEncoded = Buffer.from(JSON.stringify({
    1: {
      2: 'conv-system@goofish',
      3: 'buyer-message-2.PNM',
      5: 1767225600000,
      6: { 3: { 5: bracketedBuyerText } },
      10: { senderUserId: 'buyer-system', senderNick: 'Buyer' },
    },
  }), 'utf8').toString('base64');
  const bracketedBuyerResult = parsePushPayloadDetailed(bracketedBuyerEncoded, 'account-1', 'seller-1');
  assert.equal(bracketedBuyerResult.event?.bodyType, 'text');
});

test('order-status reminder text with a gateway reminder envelope is treated as a trusted platform event', () => {
  const systemText = '[我已付款，等待你发货]';
  const content = Buffer.from(JSON.stringify({ contentType: 1, text: { text: systemText } }), 'utf8').toString('base64');
  const encoded = Buffer.from(JSON.stringify({
    1: {
      2: 'conv-paid-reminder@goofish',
      3: 'paid-reminder-1.PNM',
      5: 1767225600000,
      6: { 3: { 5: content } },
      10: {
        senderUserId: 'buyer-paid-reminder',
        senderNick: 'Buyer',
        reminderContent: systemText,
        reminderUrl: 'fleamarket://message?messageId=paid-reminder-1.PNM',
      },
    },
  }), 'utf8').toString('base64');

  const result = parsePushPayloadDetailed(encoded, 'account-1', 'seller-1');
  assert.equal(result.event?.bodyType, 'text');
  assert.equal(result.event?.platformSystemMessage, true);
});

test('generic platform reminders are marked system while ordinary buyer text stays unmarked', () => {
  const text = "温馨提醒：商品信息近期有过变更，请与买家沟通一致，防止误拍引起纠纷，<font color='#4F7CAF' weight='w400'>查看商品详情</font>";
  const content = Buffer.from(JSON.stringify({ contentType: 14, text: { text } }), 'utf8').toString('base64');
  const reminderEncoded = Buffer.from(JSON.stringify({
    1: {
      2: 'conv-generic-system@goofish',
      3: 'generic-system-1.PNM',
      5: 1767225600000,
      6: { 3: { 5: content } },
      10: { senderUserId: 'buyer-generic-system', senderNick: 'Buyer', extJson: '{"contentType":"14","taskName":"下单前修改商品信息提示_卖家"}', reminderContent: text, reminderUrl: 'fleamarket://message?messageId=generic-system-1.PNM' },
    },
  }), 'utf8').toString('base64');
  const reminder = parsePushPayloadDetailed(reminderEncoded, 'account-1', 'seller-1');
  assert.equal(reminder.event?.bodyType, 'text');
  assert.equal(reminder.event?.platformSystemMessage, true);

  const buyerContent = Buffer.from(JSON.stringify({ contentType: 1, text: { text } }), 'utf8').toString('base64');
  const buyerEncoded = Buffer.from(JSON.stringify({
    1: {
      2: 'conv-generic-system@goofish',
      3: 'buyer-generic-1.PNM',
      5: 1767225600000,
      6: { 3: { 5: buyerContent } },
      10: { senderUserId: 'buyer-generic-system', senderNick: 'Buyer' },
    },
  }), 'utf8').toString('base64');
  const buyer = parsePushPayloadDetailed(buyerEncoded, 'account-1', 'seller-1');
  assert.equal(buyer.event?.bodyType, 'text');
  assert.equal(buyer.event?.platformSystemMessage, undefined);
});


test('platform reminder becomes system only after matching the buyer order status', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'system-enrichment@example.com', passwordHash: 'hash', displayName: 'System Enrichment' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'seller-system-enrichment' });
  const conversation = await store.createConversation({ adminId: admin.id, accountId: account.id, buyerRef: 'buyer-system-enrichment', buyerDisplayName: 'Recovered Buyer', externalConversationRef: 'conv-system-enrichment' });
  await store.createOrder({ adminId: admin.id, order: { orderNo: 'SYSTEM-STATUS-1', accountId: account.id, buyerId: 'buyer-system-enrichment', buyerName: 'Recovered Buyer', conversationId: conversation.id, itemId: 'item-system', itemTitle: '系统状态商品', amountMinor: 1_000, paymentStatus: 'paid', orderStatus: 'open', deliveryStatus: 'pending', afterSalesStatus: 'none', deliveryType: 'manual' } });
  const messages = new MessageService(store, async () => 'audit-system-enrichment');
  const autoReplyCalls: string[] = [];
  const autoReply = { processInbound: async () => { autoReplyCalls.push('called'); return undefined; } };
  const mtop = { fetchChatUserInfo: async () => ({ buyerDisplayName: 'Recovered Buyer' }) };
  const service = new XianyuImService(store, mtop as never, messages, autoReply as never);

  const result = await service.handleExternalEvent(admin.id, {
    accountId: account.id,
    externalConversationRef: 'conv-system-enrichment',
    externalMessageRef: 'system-enrichment-1.PNM',
    senderRef: 'buyer-system-enrichment',
    direction: 'inbound',
    bodyType: 'text',
    bodyText: '[我已付款，等待你发货]',
    platformSystemMessage: true,
    occurredAt: '2026-09-25T14:00:00.000Z',
  });

  assert.equal(result.created, true);
  assert.equal(result.autoReply, undefined);
  assert.deepEqual(autoReplyCalls, []);
  const persistedConversation = await store.findConversationByExternalRef(admin.id, account.id, 'conv-system-enrichment');
  assert.ok(persistedConversation);
  assert.equal(persistedConversation.buyerDisplayName, 'Recovered Buyer');
  const stored = await messages.listMessages(admin.id, persistedConversation.id, { limit: 10 });
  assert.equal(stored.items[0]?.bodyType, 'system');
  assert.equal(stored.items[0]?.senderRole, 'system');
});

test('buyer manually typing the exact status text stays text and can enter auto reply', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'manual-status@example.com', passwordHash: 'hash', displayName: 'Manual Status' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'seller-manual-status' });
  const messages = new MessageService(store, async () => 'audit-manual-status');
  const autoReplyCalls: string[] = [];
  const autoReply = { processInbound: async () => { autoReplyCalls.push('called'); return undefined; } };
  const service = new XianyuImService(store, {} as never, messages, autoReply as never);

  const result = await service.handleExternalEvent(admin.id, {
    accountId: account.id,
    externalConversationRef: 'conv-manual-status',
    externalMessageRef: 'manual-status-1.PNM',
    senderRef: 'buyer-manual-status',
    direction: 'inbound',
    bodyType: 'text',
    bodyText: '[我已付款，等待你发货]',
    occurredAt: '2026-09-25T14:00:00.000Z',
  });

  assert.equal(result.created, true);
  assert.equal(autoReplyCalls.length, 1);
  const conversation = await store.findConversationByExternalRef(admin.id, account.id, 'conv-manual-status');
  assert.ok(conversation);
  const stored = await messages.listMessages(admin.id, conversation.id, { limit: 10 });
  assert.equal(stored.items[0]?.bodyType, 'text');
  assert.equal(stored.items[0]?.senderRole, 'buyer');
  assert.equal(stored.items[0]?.riskFlags.includes('xianyu_system_candidate_unverified'), false);
});

test('platform reminder without a matching order is stored as system and marked unverified', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'unverified-status@example.com', passwordHash: 'hash', displayName: 'Unverified Status' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'seller-unverified-status' });
  const messages = new MessageService(store, async () => 'audit-unverified-status');
  const autoReply = { processInbound: async () => undefined };
  const service = new XianyuImService(store, {} as never, messages, autoReply as never);

  const result = await service.handleExternalEvent(admin.id, {
    accountId: account.id,
    externalConversationRef: 'conv-unverified-status',
    externalMessageRef: 'unverified-status-1.PNM',
    senderRef: 'buyer-unverified-status',
    direction: 'inbound',
    bodyType: 'text',
    bodyText: '[我已付款，等待你发货]',
    platformSystemMessage: true,
    occurredAt: '2026-09-25T14:00:00.000Z',
  });

  assert.equal(result.created, true);
  const conversation = await store.findConversationByExternalRef(admin.id, account.id, 'conv-unverified-status');
  assert.ok(conversation);
  const stored = await messages.listMessages(admin.id, conversation.id, { limit: 10 });
  assert.equal(stored.items[0]?.bodyType, 'system');
  assert.equal(stored.items[0]?.riskFlags.includes('xianyu_system_candidate_unverified'), true);
});

test('generic platform reminder is isolated while a normal buyer message enters auto reply', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'generic-system@example.com', passwordHash: 'hash', displayName: 'Generic System' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'seller-generic-system' });
  const messages = new MessageService(store, async () => 'audit-generic-system');
  const autoReplyCalls: string[] = [];
  const autoReply = { processInbound: async () => { autoReplyCalls.push('called'); return undefined; } };
  const service = new XianyuImService(store, {} as never, messages, autoReply as never);
  const genericText = '恭喜新手卖家，您的宝贝有人来询单啦！也提醒您闲鱼客服不会以聊天的方式要求您缴纳保证金或开通服务保障，请勿轻信，如遇以上问题请立刻举报！';

  const systemResult = await service.handleExternalEvent(admin.id, {
    accountId: account.id,
    externalConversationRef: 'generic-system-conversation',
    externalMessageRef: 'generic-system-message.PNM',
    senderRef: 'generic-system-buyer',
    direction: 'inbound',
    bodyType: 'text',
    bodyText: genericText,
    platformSystemMessage: true,
    occurredAt: '2026-09-25T14:00:00.000Z',
  });
  assert.equal(systemResult.autoReply, undefined);
  assert.deepEqual(autoReplyCalls, []);
  const conversation = await store.findConversationByExternalRef(admin.id, account.id, 'generic-system-conversation');
  assert.ok(conversation);
  const storedSystem = await messages.listMessages(admin.id, conversation.id, { limit: 10 });
  assert.equal(storedSystem.items[0]?.bodyType, 'system');
  assert.equal(storedSystem.items[0]?.senderRole, 'system');

  const buyerResult = await service.handleExternalEvent(admin.id, {
    accountId: account.id,
    externalConversationRef: 'generic-system-conversation',
    externalMessageRef: 'generic-buyer-message.PNM',
    senderRef: 'generic-system-buyer',
    direction: 'inbound',
    bodyType: 'text',
    bodyText: '你好',
    occurredAt: '2026-09-25T14:00:01.000Z',
  });
  assert.equal(buyerResult.created, true);
  assert.deepEqual(autoReplyCalls, ['called']);
  const storedBuyer = await messages.listMessages(admin.id, conversation.id, { limit: 10 });
  const storedBuyerMessage = storedBuyer.items.find((item) => item.externalMessageRef === 'generic-buyer-message.PNM');
  assert.ok(storedBuyerMessage);
  assert.equal(storedBuyerMessage.bodyType, 'text');
  assert.equal(storedBuyerMessage.senderRole, 'buyer');
});


test('history synchronization applies the same platform and order gates', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'history-status@example.com', passwordHash: 'hash', displayName: 'History Status' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'seller-history-status' });
  const conversation = await store.createConversation({ adminId: admin.id, accountId: account.id, buyerRef: 'buyer-history-status', buyerDisplayName: 'History Buyer', externalConversationRef: 'conv-history-status' });
  await store.createOrder({ adminId: admin.id, order: { orderNo: 'HISTORY-STATUS-1', accountId: account.id, buyerId: 'buyer-history-status', buyerName: 'History Buyer', conversationId: conversation.id, itemId: 'item-history', itemTitle: '历史状态商品', amountMinor: 1_000, paymentStatus: 'paid', orderStatus: 'open', deliveryStatus: 'pending', afterSalesStatus: 'none', deliveryType: 'manual' } });
  const text = '[我已付款，等待你发货]';
  const encoded = Buffer.from(JSON.stringify({ text: { text } }), 'utf8').toString('base64');
  const fakeClient = {
    selfUserIds: ['seller-history-status'],
    listMessages: async () => ({ hasMore: false, userMessageModels: [{ message: { messageId: 'history-status-1.PNM', senderUserId: 'buyer-history-status', createAt: Date.parse('2026-09-25T14:00:00.000Z'), extension: { reminderContent: text, reminderUrl: 'fleamarket://message?messageId=history-status-1.PNM', itemId: 'item-history' }, content: { custom: { type: 26, data: encoded } } } }] }),
  };
  const messages = new MessageService(store, async () => 'audit-history-status');
  const service = new XianyuImService(store, {} as never, messages);
  (service as unknown as { ensureClient: () => Promise<unknown> }).ensureClient = async () => fakeClient;

  await service.listMessages(admin.id, account.id, conversation.id);
  const stored = await messages.listMessages(admin.id, conversation.id, { limit: 10 });
  assert.equal(stored.items[0]?.bodyType, 'system');
  assert.equal(stored.items[0]?.riskFlags.includes('xianyu_system_message'), true);
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

test('history resync upgrades an existing buyer row when the platform marker arrives later', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'history-reconcile@example.com', passwordHash: 'hash', displayName: 'History Reconcile' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'seller-history-reconcile' });
  const conversation = await store.createConversation({ adminId: admin.id, accountId: account.id, buyerRef: 'buyer-history-reconcile', externalConversationRef: 'conv-history-reconcile' });
  const messages = new MessageService(store, async () => 'audit-history-reconcile');
  await store.createMessage({ adminId: admin.id, conversationId: conversation.id, direction: 'inbound', senderRole: 'buyer', bodyType: 'text', bodyText: '[卖家已发货]', externalMessageRef: 'history-reconcile-1.PNM', source: 'system', traceId: 'history-reconcile-seed' });

  const encoded = Buffer.from(JSON.stringify({ contentType: 26, text: { text: '[卖家已发货]' } }), 'utf8').toString('base64');
  const fakeClient = {
    selfUserIds: ['seller-history-reconcile'],
    listMessages: async () => ({ hasMore: false, userMessageModels: [{ message: { messageId: 'history-reconcile-1.PNM', senderUserId: 'buyer-history-reconcile', createAt: Date.parse('2026-09-25T14:00:00.000Z'), content: { custom: { type: 26, data: encoded } } } }] }),
  };
  const service = new XianyuImService(store, {} as never, messages);
  (service as unknown as { ensureClient: () => Promise<unknown> }).ensureClient = async () => fakeClient;

  const result = await service.listMessages(admin.id, account.id, conversation.id);
  assert.equal(result.hasMore, false);
  const stored = await messages.listMessages(admin.id, conversation.id, { limit: 10 });
  assert.equal(stored.items[0]?.senderRole, 'system');
  assert.equal(stored.items[0]?.bodyType, 'system');
  assert.equal(stored.items[0]?.bodyText, '[卖家已发货]');
  assert.equal(stored.items[0]?.riskFlags.includes('xianyu_system_message'), true);
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
