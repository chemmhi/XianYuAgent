import { describe, expect, it } from 'vitest';
import { createSocketGenerationGuard } from './controller';
import { applyRealtimeEvent, mergeConversation, mergeTimelineMessages } from './model';
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

  it('updates conversation ordering when a newer event arrives', () => {
    const newer = { ...conversation, version: 2, updatedAt: '2026-09-19T00:00:02.000Z', unreadCount: 1 };
    expect(mergeConversation([conversation], newer)[0]?.version).toBe(2);
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
});
