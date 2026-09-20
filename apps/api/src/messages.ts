import type { ConversationEventRecord, ConversationListQuery, ConversationRecord, MessageListQuery, MessageRecord, Store } from './domain.js';
import { ServiceError } from './services.js';
import { decodeConversationCursor } from './conversation-cursor.js';

export interface ConversationVM {
  conversationId: string;
  accountId: string;
  buyerRef: string;
  buyerDisplayName?: string;
  itemRef?: string;
  itemTitle?: string;
  unreadCount: number;
  lastMessagePreview?: string;
  lastMessageAt?: string;
  handlingMode: 'ai' | 'human';
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface MessageVM {
  messageId: string;
  conversationId: string;
  accountId: string;
  direction: MessageRecord['direction'];
  senderRole: MessageRecord['senderRole'];
  bodyType: MessageRecord['bodyType'];
  bodyText?: string;
  bodyRef?: string;
  redactionState: MessageRecord['redactionState'];
  status: MessageRecord['status'];
  createdAt: string;
  externalMessageRef?: string;
  source?: MessageRecord['source'];
  orderRef?: string;
  productRef?: string;
  riskFlags: string[];
  handlingMode: MessageRecord['handlingMode'];
}

export interface RealtimeEventVM {
  eventId: string;
  conversationId: string;
  accountId: string;
  cursor: number;
  type: ConversationEventRecord['type'];
  occurredAt: string;
  traceId: string;
  payload: Record<string, unknown>;
}

type EventListener = (event: RealtimeEventVM) => void;

function toConversationVM(conversation: ConversationRecord): ConversationVM {
  return { conversationId: conversation.id, accountId: conversation.accountId, buyerRef: conversation.buyerRef, buyerDisplayName: conversation.buyerDisplayName, itemRef: conversation.itemRef, itemTitle: conversation.itemTitle, unreadCount: conversation.unreadCount, lastMessagePreview: conversation.lastMessagePreview, lastMessageAt: conversation.lastMessageAt, handlingMode: conversation.handlingMode, version: conversation.version, createdAt: conversation.createdAt, updatedAt: conversation.updatedAt };
}

function toMessageVM(message: MessageRecord): MessageVM {
  return { messageId: message.id, conversationId: message.conversationId, accountId: message.accountId, direction: message.direction, senderRole: message.senderRole, bodyType: message.bodyType, bodyText: message.redactionState === 'visible' ? message.bodyText : undefined, bodyRef: message.bodyRef, redactionState: message.redactionState, status: message.status, createdAt: message.createdAt, externalMessageRef: message.externalMessageRef, source: message.source, orderRef: message.orderRef, productRef: message.productRef, riskFlags: [...message.riskFlags], handlingMode: message.handlingMode };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function toEventPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const normalized = { ...payload };
  if (isRecord(normalized.message) && typeof normalized.message.messageId !== 'string' && typeof normalized.message.id === 'string') {
    normalized.message = toMessageVM(normalized.message as unknown as MessageRecord);
  }
  if (isRecord(normalized.conversation) && typeof normalized.conversation.conversationId !== 'string' && typeof normalized.conversation.id === 'string') {
    normalized.conversation = toConversationVM(normalized.conversation as unknown as ConversationRecord);
  }
  return normalized;
}

function toEventView(event: ConversationEventRecord): RealtimeEventVM {
  return { eventId: event.eventId, conversationId: event.conversationId, accountId: event.accountId, cursor: event.cursor, type: event.type, occurredAt: event.occurredAt, traceId: event.traceId, payload: toEventPayload(event.payload) };
}

export class MessageRealtimeHub {
  private readonly listeners = new Map<string, Set<EventListener>>();
  private readonly seenEventIds = new Map<string, number>();
  private readonly seenEventLimit = 5000;

  subscribe(conversationId: string, listener: EventListener): () => void {
    const listeners = this.listeners.get(conversationId) ?? new Set<EventListener>();
    listeners.add(listener);
    this.listeners.set(conversationId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(conversationId);
    };
  }

  publish(event: ConversationEventRecord): void {
    if (this.seenEventIds.has(event.eventId)) return;
    this.seenEventIds.set(event.eventId, Date.now());
    if (this.seenEventIds.size > this.seenEventLimit) {
      const oldest = this.seenEventIds.keys().next().value;
      if (oldest) this.seenEventIds.delete(oldest);
    }
    const listeners = this.listeners.get(event.conversationId);
    if (!listeners) return;
    const view = toEventView(event);
    for (const listener of listeners) {
      try { listener(view); } catch { /* one stale subscriber must not break the publish loop */ }
    }
  }

}

export class MessageService {
  constructor(
    private readonly store: Store,
    private readonly audit: (input: { actorId: string; action: string; targetRef?: string; requestId: string; traceId: string; payload: unknown; accountId?: string }) => Promise<string>,
    readonly realtime = new MessageRealtimeHub(),
    private readonly publishExternal?: (event: ConversationEventRecord) => Promise<void> | void,
  ) {}

  async listConversations(adminId: string, query: ConversationListQuery): Promise<{ items: ConversationVM[]; nextCursor?: string; hasMore: boolean }> {
    if (query.accountId && !(await this.store.hasAccountScope(adminId, query.accountId))) throw new ServiceError(403, 'FORBIDDEN', 'account scope required');
    this.validateLimit(query.limit, 100);
    if (query.cursor !== undefined && !decodeConversationCursor(query.cursor)) throw new ServiceError(422, 'VALIDATION_FAILED', 'cursor is invalid');
    const result = await this.store.listConversations(adminId, query);
    return { ...result, items: result.items.map((conversation) => this.toConversationView(conversation)) };
  }

  async getConversation(adminId: string, conversationId: string): Promise<ConversationVM> {
    const conversation = await this.store.getConversation(adminId, conversationId);
    if (!conversation) throw new ServiceError(404, 'NOT_FOUND', 'conversation not found');
    return this.toConversationView(conversation);
  }

  async listMessages(adminId: string, conversationId: string, query: MessageListQuery): Promise<{ items: MessageVM[]; nextCursor?: number; hasMore: boolean; latestCursor: number }> {
    await this.getConversation(adminId, conversationId);
    this.validateLimit(query.limit, 200);
    if (query.cursor !== undefined && (!Number.isSafeInteger(query.cursor) || query.cursor < 0)) throw new ServiceError(422, 'VALIDATION_FAILED', 'cursor must be a non-negative integer');
    const result = await this.store.listMessages(adminId, conversationId, query);
    return { ...result, items: result.items.map((message) => this.toMessageView(message)) };
  }

  async listEvents(adminId: string, conversationId: string, afterCursor: number, limit = 100): Promise<RealtimeEventVM[]> {
    await this.getConversation(adminId, conversationId);
    this.validateLimit(limit, 200);
    if (!Number.isSafeInteger(afterCursor) || afterCursor < 0) throw new ServiceError(422, 'VALIDATION_FAILED', 'cursor must be a non-negative integer');
    const events = await this.store.listConversationEvents(adminId, conversationId, afterCursor, limit);
    return events.map((event) => toEventView(event));
  }

  async createMessage(input: { adminId: string; conversationId: string; direction: MessageRecord['direction']; senderRole: MessageRecord['senderRole']; bodyType: MessageRecord['bodyType']; bodyText?: string; bodyRef?: string; externalMessageRef?: string; source?: MessageRecord['source']; orderRef?: string; productRef?: string; riskFlags?: string[]; requestId: string; traceId: string }): Promise<{ message: MessageVM; event: RealtimeEventVM }> {
    const created = await this.store.createMessage(input);
    await this.audit({ actorId: input.adminId, action: 'conversation.message.created', targetRef: created.message.id, requestId: input.requestId, traceId: input.traceId, payload: { direction: created.message.direction, bodyType: created.message.bodyType, source: created.message.source }, accountId: created.message.accountId });
    const event = toEventView(created.event);
    this.realtime.publish(created.event);
    try { void Promise.resolve(this.publishExternal?.(created.event)).catch(() => undefined); } catch { /* Redis transport must not fail a committed message */ }
    return { message: this.toMessageView(created.message), event };
  }

  private toConversationView(conversation: Awaited<ReturnType<Store['getConversation']>> extends infer T ? Exclude<T, undefined> : never): ConversationVM { return toConversationVM(conversation); }

  private toMessageView(message: MessageRecord): MessageVM { return toMessageVM(message); }

  private validateLimit(value: number | undefined, max: number): void {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 1 || value > max)) throw new ServiceError(422, 'VALIDATION_FAILED', `limit must be between 1 and ${max}`);
  }
}
