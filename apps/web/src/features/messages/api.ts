import type { ConversationVM, MessageVM, RealtimeEvent } from './types';

interface Envelope<T> { data?: T; }

export interface MessagesApi {
  listConversations(input: { accountId: string; cursor?: string; limit?: number }): Promise<{ items: ConversationVM[]; nextCursor?: string; hasMore: boolean }>;
  listMessages(input: { accountId: string; conversationId: string; cursor?: number; limit?: number }): Promise<{ items: MessageVM[]; nextCursor?: number; hasMore: boolean; latestCursor: number }>;
  openRealtime(input: { accountId: string; conversationId: string; cursor: number; onEvent: (event: RealtimeEvent) => void; onOpen?: () => void; onClose?: () => void; onError?: () => void }): { close: () => void };
}

export function createMessagesApi(input: { get: <T>(path: string) => Promise<T>; baseUrl?: string }): MessagesApi {
  return {
    async listConversations(query) {
      const params = new URLSearchParams({ accountId: query.accountId, limit: String(query.limit ?? 50) });
      if (query.cursor !== undefined) params.set('cursor', String(query.cursor));
      const payload = await input.get<Envelope<{ items: ConversationVM[]; nextCursor?: string; hasMore: boolean }>>(`/api/v1/conversations?${params.toString()}`);
      return payload.data ?? { items: [], hasMore: false };
    },
    async listMessages(query) {
      const params = new URLSearchParams({ limit: String(query.limit ?? 100) });
      if (query.cursor !== undefined) params.set('cursor', String(query.cursor));
      const payload = await input.get<Envelope<{ items: MessageVM[]; nextCursor?: number; hasMore: boolean; latestCursor: number }>>(`/api/v1/conversations/${encodeURIComponent(query.conversationId)}/messages?${params.toString()}`);
      return payload.data ?? { items: [], hasMore: false, latestCursor: 0 };
    },
    openRealtime(query) {
      const socket = new WebSocket(toWebSocketUrl(input.baseUrl, `/api/v1/conversations/${encodeURIComponent(query.conversationId)}/events?cursor=${encodeURIComponent(String(query.cursor))}`));
      socket.addEventListener('open', () => query.onOpen?.());
      socket.addEventListener('message', (event) => {
        try { query.onEvent(JSON.parse(String(event.data)) as RealtimeEvent); } catch { query.onError?.(); }
      });
      socket.addEventListener('error', () => query.onError?.());
      socket.addEventListener('close', () => query.onClose?.());
      return { close: () => socket.close() };
    },
  };
}

function toWebSocketUrl(baseUrl: string | undefined, path: string): string {
  const resolved = baseUrl || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:8080');
  const url = new URL(path, resolved);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}
