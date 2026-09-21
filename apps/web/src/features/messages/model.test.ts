import { describe, expect, it } from 'vitest';
import { createSocketGenerationGuard } from './controller';
import { applyRealtimeEvent, filterConversations, markConversationRead, mergeConversation, mergeTimelineMessages, reconcileConversations } from './model';
import type { ConversationVM, MessageVM, RealtimeEvent } from './types';

const conversation: ConversationVM = { conversationId: 'c1', accountId: 'a1', buyerRef: 'b1', buyerDisplayName: '买家', unreadCount: 0, handlingMode: 'ai', version: 1, createdAt: '2026-09-19T00:00:00.000Z', updatedAt: '2026-09-19T00:00:00.000Z' };
const message: MessageVM = { messageId: 'm1', conversationId: 'c1', accountId: 'a1', direction: 'inbound', senderRole: 'buyer', bodyType: 'text', bodyText: '你好', redactionState: 'visible', status: 'created', createdAt: '2026-09-19T00:00:01.000Z', riskFlags: [], handlingMode: 'ai' };

describe('messages realtime model', () => {
  it('invalidates delayed callbacks from a replaced realtime socket', () => {
    const guard = createSocketGenerationGuard();
    const first = guard.begin();
    const second = guard.begin();

    expect(guard.isCurrent(first)).toBe(false);
    expect(guard.isCurrent(second)).toBe(true);
  });

  it('merges timeline messages by messageId without duplicates', () => {
    expect(mergeTimelineMessages([message], [message])).toHaveLength(1);
  });

  it('preserves an existing outbound read state when a later payload omits it', () => {
    const readMessage = { ...message, direction: 'outbound' as const, senderRole: 'agent' as const, readState: 'read' as const };
    const { readState: _ignoredReadState, ...partialMessage } = readMessage;
    expect(mergeTimelineMessages([readMessage], [partialMessage])[0]?.readState).toBe('read');
  });

  it('does not infer seller read state from a buyer reply', () => {
    const sellerBeforeReply: MessageVM = { ...message, messageId: 'seller-1', direction: 'outbound', senderRole: 'agent', bodyText: '已发货', createdAt: '2026-09-19T00:00:02.000Z' };
    const buyerReply: MessageVM = { ...message, messageId: 'buyer-2', createdAt: '2026-09-19T00:00:03.000Z' };
    const sellerAfterReply: MessageVM = { ...sellerBeforeReply, messageId: 'seller-3', bodyText: '补充说明', createdAt: '2026-09-19T00:00:04.000Z' };
    const reconciled = mergeTimelineMessages([], [sellerBeforeReply, buyerReply, sellerAfterReply]);
    expect(reconciled.find((item) => item.messageId === 'seller-1')?.readState).toBeUndefined();
    expect(reconciled.find((item) => item.messageId === 'seller-3')?.readState).toBeUndefined();
  });

  it('updates conversation ordering when a newer event arrives', () => {
    const newer = { ...conversation, version: 2, updatedAt: '2026-09-19T00:00:02.000Z', unreadCount: 1 };
    expect(mergeConversation([conversation], newer)[0]?.version).toBe(2);
  });

  it('reconciles an unselected buyer thread while preserving the selected thread as read', () => {
    const selected = { ...conversation, unreadCount: 0 };
    const other = { ...conversation, conversationId: 'c2', buyerRef: 'b2', unreadCount: 0, lastMessageAt: '2026-09-19T00:00:00.000Z' };
    const updatedOther = { ...other, unreadCount: 1, lastMessagePreview: '买家新消息', lastMessageAt: '2026-09-21T00:00:02.000Z', updatedAt: '2026-09-21T00:00:02.000Z', version: 2 };
    const result = reconcileConversations([selected, other], [updatedOther], selected.conversationId);
    expect(result.map((item) => item.conversationId)).toEqual(['c2', 'c1']);
    expect(result[0]?.lastMessagePreview).toBe('买家新消息');
    expect(result[0]?.unreadCount).toBe(1);
    expect(result[1]?.unreadCount).toBe(0);
  });

  it('does not let a stale local poll overwrite a newer realtime conversation update', () => {
    const newer = { ...conversation, version: 4, unreadCount: 1, lastMessagePreview: '实时新消息', lastMessageAt: '2026-09-21T00:00:04.000Z', updatedAt: '2026-09-21T00:00:04.000Z' };
    const stale = { ...conversation, version: 3, unreadCount: 0, lastMessagePreview: '旧快照', lastMessageAt: '2026-09-21T00:00:03.000Z', updatedAt: '2026-09-21T00:00:03.000Z' };
    expect(reconcileConversations([newer], [stale])[0]?.lastMessagePreview).toBe('实时新消息');
  });

  it('orders conversations by latest message time before metadata refresh time', () => {
    const olderMessage = { ...conversation, conversationId: 'older', updatedAt: '2026-09-20T10:00:00.000Z', lastMessageAt: '2026-09-20T10:00:00.000Z' };
    const newerMessage = { ...conversation, conversationId: 'newer', updatedAt: '2026-09-20T09:00:00.000Z', lastMessageAt: '2026-09-20T11:00:00.000Z' };
    expect(mergeConversation([olderMessage], newerMessage).map((item) => item.conversationId)).toEqual(['newer', 'older']);
  });

  it('dedupes repeated event ids and repeated message ids', () => {
    const event: RealtimeEvent = { eventId: 'e1', conversationId: 'c1', accountId: 'a1', cursor: 1, type: 'chat.message.created', occurredAt: '2026-09-19T00:00:01.000Z', traceId: 't1', payload: { message, conversation: { ...conversation, version: 2, updatedAt: '2026-09-19T00:00:01.000Z', unreadCount: 1 } } };
    const initial = { conversations: [conversation], messages: [message], cursor: 0, seenEventIds: new Set<string>() };
    const once = applyRealtimeEvent(initial, event);
    const twice = applyRealtimeEvent(once, event);
    expect(once.messages).toHaveLength(1);
    expect(twice.messages).toHaveLength(1);
    expect(twice.cursor).toBe(1);
  });

  it('filters by buyer, item, preview and unread state', () => {
    const unread = { ...conversation, conversationId: 'c2', buyerRef: 'buyer-2', buyerDisplayName: '小王', itemTitle: '蓝色外套', lastMessagePreview: '请问还有货吗', unreadCount: 2 };
    expect(filterConversations([conversation, unread], '外套', false)).toEqual([unread]);
    expect(filterConversations([conversation, unread], 'buyer-2', false)).toEqual([unread]);
    expect(filterConversations([conversation, unread], '请问', false)).toEqual([unread]);
    expect(filterConversations([conversation, unread], '', true)).toEqual([unread]);
  });

  it('clears the selected conversation unread count without mutating other rows', () => {
    const unread = { ...conversation, conversationId: 'c2', unreadCount: 3 };
    const cleared = markConversationRead([conversation, unread], 'c2');
    expect(cleared.map((item) => item.unreadCount)).toEqual([0, 0]);
    expect(markConversationRead([conversation, unread], 'missing')).toEqual([conversation, unread]);
  });
});
