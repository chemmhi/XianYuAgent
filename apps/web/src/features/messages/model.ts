import type { ConversationVM, MessageVM, RealtimeEvent } from './types';

export interface MergeState { conversations: ConversationVM[]; messages: MessageVM[]; cursor: number; seenEventIds: Set<string>; }

export function mergeTimelineMessages(existing: MessageVM[], incoming: MessageVM[]): MessageVM[] {
  const byId = new Map(existing.map((message) => [message.messageId, message]));
  for (const message of incoming) byId.set(message.messageId, message);
  return [...byId.values()].sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.messageId.localeCompare(right.messageId));
}

export function mergeConversation(existing: ConversationVM[], incoming: ConversationVM): ConversationVM[] {
  const byId = new Map(existing.map((conversation) => [conversation.conversationId, conversation]));
  byId.set(incoming.conversationId, incoming);
  return [...byId.values()].sort((left, right) => conversationSortKey(right).localeCompare(conversationSortKey(left)) || left.conversationId.localeCompare(right.conversationId));
}

function conversationSortKey(conversation: ConversationVM): string {
  return conversation.lastMessageAt ?? conversation.updatedAt;
}

export function filterConversations(conversations: ConversationVM[], search: string, unreadOnly: boolean): ConversationVM[] {
  const keyword = search.trim().toLocaleLowerCase();
  return conversations.filter((conversation) => {
    if (unreadOnly && conversation.unreadCount <= 0) return false;
    if (!keyword) return true;
    return [conversation.buyerDisplayName, conversation.buyerRef, conversation.itemTitle, conversation.lastMessagePreview]
      .filter(Boolean)
      .some((value) => String(value).toLocaleLowerCase().includes(keyword));
  });
}

export function applyRealtimeEvent(state: MergeState, event: RealtimeEvent): MergeState {
  if (state.seenEventIds.has(event.eventId)) return state;
  const seenEventIds = new Set(state.seenEventIds).add(event.eventId);
  let conversations = state.conversations;
  let messages = state.messages;
  const message = isMessage(event.payload.message) ? event.payload.message : undefined;
  const conversation = isConversation(event.payload.conversation) ? event.payload.conversation : undefined;
  if (conversation) conversations = mergeConversation(conversations, conversation);
  if (message && !messages.some((item) => item.messageId === message.messageId)) messages = mergeTimelineMessages(messages, [message]);
  return { conversations, messages, cursor: Math.max(state.cursor, event.cursor), seenEventIds };
}

function isMessage(value: unknown): value is MessageVM { return Boolean(value && typeof value === 'object' && typeof (value as { messageId?: unknown }).messageId === 'string'); }
function isConversation(value: unknown): value is ConversationVM { return Boolean(value && typeof value === 'object' && typeof (value as { conversationId?: unknown }).conversationId === 'string'); }
