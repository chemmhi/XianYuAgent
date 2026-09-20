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
