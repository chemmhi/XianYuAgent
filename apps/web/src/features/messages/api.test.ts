import { describe, expect, it } from 'vitest';
import { createMessagesApi } from './api';
import type { MessageVM } from './types';

const sentImage: MessageVM = {
  messageId: 'm-image',
  conversationId: 'c-1',
  accountId: 'a-1',
  direction: 'outbound',
  senderRole: 'agent',
  bodyType: 'image',
  bodyRef: 'https://cdn.example.com/chat/image.png',
  redactionState: 'visible',
  status: 'created',
  createdAt: '2026-09-20T08:00:00.000Z',
  riskFlags: [],
  handlingMode: 'human',
};

describe('messages API media contract', () => {
  it('leaves first-page conversation refresh mode to the server background policy', async () => {
    let capturedPath = '';
    const api = createMessagesApi({
      get: async <T>(path: string) => { capturedPath = path; return { data: { items: [], hasMore: false } } as unknown as T; },
    });
    await api.listConversations({ accountId: 'a-1', limit: 50 });
    expect(capturedPath).not.toContain('refreshExternal=');
  });

  it('can read the local conversation index without refreshing Xianyu', async () => {
    let capturedPath = '';
    const api = createMessagesApi({
      get: async <T>(path: string) => { capturedPath = path; return { data: { items: [], hasMore: false } } as unknown as T; },
    });
    await api.listConversations({ accountId: 'a-1', limit: 50, refreshExternal: false });
    expect(capturedPath).toContain('/api/v1/conversations?');
    expect(capturedPath).toContain('refreshExternal=false');
  });

  it('posts a conversation read receipt after opening the timeline', async () => {
    let capturedPath = '';
    const api = createMessagesApi({
      get: async <T>() => ({ data: null } as unknown as T),
      post: async <T>(path: string) => { capturedPath = path; return { data: { conversationId: 'c-1', accountId: 'a-1', buyerRef: 'b-1', unreadCount: 0 } } as unknown as T; },
    });
    const result = await api.markConversationRead?.({ accountId: 'a-1', conversationId: 'c-1' });
    expect(result?.conversationId).toBe('c-1');
    expect(result?.unreadCount).toBe(0);
    expect(capturedPath).toBe('/api/v1/conversations/c-1/read');
  });

  it('passes the opaque history cursor for older-message pagination', async () => {
    let capturedPath = '';
    const api = createMessagesApi({
      get: async <T>(path: string) => { capturedPath = path; return { data: { items: [], hasMore: false, latestCursor: 4, hasMoreHistory: false } } as unknown as T; },
    });
    const result = await api.listMessages({ accountId: 'a-1', conversationId: 'c-1', beforeCursor: 'eyJmb28iOiJiYXIifQ', limit: 25 });
    expect(result.latestCursor).toBe(4);
    expect(capturedPath).toContain('beforeCursor=eyJmb28iOiJiYXIifQ');
    expect(capturedPath).toContain('limit=25');
  });

  it('can request a local-only timeline refresh for realtime reconciliation', async () => {
    let capturedPath = '';
    const api = createMessagesApi({
      get: async <T>(path: string) => { capturedPath = path; return { data: { items: [], hasMore: false, latestCursor: 4, hasMoreHistory: false } } as unknown as T; },
    });
    await api.listMessages({ accountId: 'a-1', conversationId: 'c-1', cursor: 4, refreshExternal: false });
    expect(capturedPath).toContain('cursor=4');
    expect(capturedPath).toContain('refreshExternal=false');
  });

  it('posts a multipart image payload without forcing JSON headers', async () => {
    let capturedPath = '';
    let capturedBody: unknown;
    let capturedHeaders: HeadersInit | undefined;
    const api = createMessagesApi({
      get: async <T>() => ({ data: null } as unknown as T),
      post: async <T>(path: string, body?: unknown, init?: RequestInit) => {
        capturedPath = path;
        capturedBody = body;
        capturedHeaders = init?.headers;
        return { data: sentImage } as unknown as T;
      },
    });
    const file = new File([new Uint8Array([137, 80, 78, 71])], 'preview.png', { type: 'image/png' });
    const result = await api.sendImage({ accountId: 'a-1', conversationId: 'c-1', file, idempotencyKey: 'image-1' });

    expect(result).toEqual(sentImage);
    expect(capturedPath).toBe('/api/v1/conversations/c-1/images');
    expect(capturedBody).toBeInstanceOf(FormData);
    expect((capturedBody as FormData).get('image')).toBeInstanceOf(File);
    expect((capturedBody as FormData).get('image')).toMatchObject({ name: 'preview.png', type: 'image/png' });
    expect(new Headers(capturedHeaders).get('Idempotency-Key')).toBe('image-1');
    expect(new Headers(capturedHeaders).has('Content-Type')).toBe(false);
  });
});
