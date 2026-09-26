import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryStore } from '../src/store-memory.js';
import { MessageService } from '../src/messages.js';
import { XianyuImService } from '../src/xianyu-im-service.js';

test('trusted platform payment-state reminders refresh orders, while buyer text does not', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'unpaid-refresh@example.com', passwordHash: 'hash', displayName: 'Unpaid Refresh' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'seller-unpaid-refresh' });
  const conversation = await store.createConversation({
    adminId: admin.id,
    accountId: account.id,
    buyerRef: 'buyer-unpaid-refresh',
    buyerDisplayName: 'Buyer',
    externalConversationRef: 'conversation-unpaid-refresh',
  });
  const messages = new MessageService(store, async () => 'audit');
  const refreshes: string[] = [];
  const service = new XianyuImService(
    store,
    {} as never,
    messages,
    undefined,
    undefined,
    undefined,
    async ({ event }) => { refreshes.push(event.externalMessageRef); },
  );

  const baseEvent = {
    accountId: account.id,
    externalConversationRef: conversation.externalConversationRef!,
    senderRef: conversation.buyerRef,
    senderName: conversation.buyerDisplayName,
    direction: 'inbound' as const,
    bodyType: 'text' as const,
    bodyText: '[我已拍下，待付款]',
    occurredAt: '2026-09-26T01:00:00.000Z',
  };

  await service.handleExternalEvent(admin.id, { ...baseEvent, externalMessageRef: 'trusted-unpaid-event', platformSystemMessage: true });
  await service.handleExternalEvent(admin.id, {
    ...baseEvent,
    externalMessageRef: 'trusted-paid-event',
    bodyText: '[我已付款，等待你发货]',
    platformSystemMessage: true,
  });
  await service.handleExternalEvent(admin.id, { ...baseEvent, externalMessageRef: 'buyer-text-event' });

  assert.deepEqual(refreshes, ['trusted-unpaid-event', 'trusted-paid-event']);
});
