export type MessagesLoadPhase = 'idle' | 'loading' | 'success' | 'empty' | 'error' | 'forbidden';
export type TimelineLoadPhase = 'idle' | 'loading' | 'success' | 'empty' | 'error' | 'forbidden';
export type RealtimePhase = 'closed' | 'connecting' | 'connected' | 'reconnecting' | 'timeout' | 'forbidden';
export type SendPhase = 'idle' | 'submitting' | 'sent' | 'error';
export type MessageReadState = 'read' | 'unread';

export interface ConversationVM {
  conversationId: string;
  accountId: string;
  buyerRef: string;
  buyerDisplayName?: string;
  buyerAvatarUrl?: string;
  itemRef?: string;
  itemTitle?: string;
  itemImageUrl?: string;
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
  direction: 'inbound' | 'outbound';
  senderRole: 'buyer' | 'agent' | 'system';
  bodyType: 'text' | 'image' | 'system';
  bodyText?: string;
  bodyRef?: string;
  redactionState: 'visible' | 'redacted';
  status: 'created';
  /** Optional read receipt supplied by the external chat adapter. */
  readState?: MessageReadState;
  readAt?: string;
  createdAt: string;
  externalMessageRef?: string;
  source?: 'human' | 'ai' | 'system';
  orderRef?: string;
  productRef?: string;
  riskFlags: string[];
  handlingMode: 'ai' | 'human';
}

export interface RealtimeEvent {
  eventId: string;
  conversationId: string;
  accountId: string;
  cursor: number;
  type: 'chat.message.created' | 'chat.message.updated' | 'chat.conversation.updated' | 'chat.connection.changed';
  occurredAt: string;
  traceId: string;
  payload: Record<string, unknown>;
}

export interface MessagesError { code: string; message: string; retryable: boolean; }

export interface MessagesState {
  accountId?: string;
  listPhase: MessagesLoadPhase;
  loadingMore: boolean;
  hasMore: boolean;
  nextCursor?: string;
  timelinePhase: TimelineLoadPhase;
  realtimePhase: RealtimePhase;
  conversations: ConversationVM[];
  activeConversationId?: string;
  messages: MessageVM[];
  cursor: number;
  historyCursor?: string;
  hasMoreHistory: boolean;
  loadingMoreHistory: boolean;
  sendPhase: SendPhase;
  sendError?: string;
  error: MessagesError | null;
}
