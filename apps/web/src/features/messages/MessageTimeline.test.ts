import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { MessageTimeline, resolveMessageReadState } from './components/MessageTimeline';
import type { MessageVM } from './types';

function message(overrides: Partial<MessageVM>): MessageVM {
  return {
    messageId: 'm-1',
    conversationId: 'c-1',
    accountId: 'a-1',
    direction: 'inbound',
    senderRole: 'buyer',
    bodyType: 'text',
    redactionState: 'visible',
    status: 'created',
    createdAt: '2026-09-20T08:00:00.000Z',
    riskFlags: [],
    handlingMode: 'human',
    ...overrides,
  };
}

describe('MessageTimeline', () => {
  it('renders http links as safe clickable anchors and preserves punctuation', () => {
    const html = renderToStaticMarkup(createElement(MessageTimeline, { phase: 'success', messages: [message({ bodyText: '请查看 https://example.com/item?id=1。' })] }));
    expect(html).toContain('class="messages-link"');
    expect(html).toContain('href="https://example.com/item?id=1"');
    expect(html).toContain('>https://example.com/item?id=1</a>。');
    expect(html).toContain('target="_blank"');
  });

  it('does not turn unsafe protocols into links', () => {
    const html = renderToStaticMarkup(createElement(MessageTimeline, { phase: 'success', messages: [message({ bodyText: 'javascript:alert(1) data:text/html,blocked' })] }));
    expect(html).not.toContain('messages-link');
    expect(html).not.toContain('href=');
  });

  it('renders image history as a preview that opens the original asset', () => {
    const html = renderToStaticMarkup(createElement(MessageTimeline, { phase: 'success', messages: [message({ bodyType: 'image', bodyRef: 'https://cdn.example.com/chat/photo.jpg' })] }));
    expect(html).toContain('class="messages-image"');
    expect(html).toContain('src="https://cdn.example.com/chat/photo.jpg"');
    expect(html).toContain('class="messages-image-button"');
  });

  it('renders Xianyu bracketed emoji markers as official image assets', () => {
    const html = renderToStaticMarkup(createElement(MessageTimeline, { phase: 'success', messages: [message({ bodyText: '收到[尊嘟假嘟]' })] }));
    expect(html).toContain('class="messages-emoji-inline"');
    expect(html).toContain('alt="[尊嘟假嘟]"');
    expect(html).not.toContain('收到[尊嘟假嘟]');
  });

  it('renders avatar, compact message metadata, and outbound read state without names', () => {
    const html = renderToStaticMarkup(createElement(MessageTimeline, {
      phase: 'success',
      messages: [
        message({ direction: 'inbound', senderRole: 'buyer', source: 'ai', bodyText: '自动回复' }),
        message({ messageId: 'm-2', direction: 'outbound', senderRole: 'agent', source: 'human', bodyText: '已收到', readState: 'read' }),
      ],
      outboundParticipant: { displayName: 'Seller', avatarUrl: 'https://cdn.example.com/seller.png' },
    }));
    expect(html).toContain('messages-message-avatar self');
    expect(html).toContain('https://cdn.example.com/seller.png');
    expect(html).not.toContain('messages-message-author');
    expect(html).not.toContain('Seller');
    expect(html).toContain('AI');
    expect(html).toContain('人工');
    expect(html).toContain('messages-read-state');
    expect(html).toContain('>已读</span>');
  });

  it('renders outbound unread state from the supplied message receipt', () => {
    const html = renderToStaticMarkup(createElement(MessageTimeline, { phase: 'success', messages: [message({ direction: 'outbound', senderRole: 'agent', readState: 'unread', bodyText: '待确认' })] }));
    expect(html).toContain('messages-read-state unread');
    expect(html).toContain('>未读</span>');
    expect(html).not.toContain('>已读</span>');
  });

  it('does not claim a read state when the adapter provides no receipt', () => {
    expect(resolveMessageReadState(message({ direction: 'outbound' }))).toBeUndefined();
    expect(resolveMessageReadState(message({ direction: 'outbound', status: 'created' }))).toBeUndefined();
    expect(resolveMessageReadState({ ...message({ direction: 'outbound' }), status: 'sent' } as unknown as MessageVM)).toBe('unread');
  });

  it('renders system messages as a centered status row', () => {
    const html = renderToStaticMarkup(createElement(MessageTimeline, { phase: 'success', messages: [message({ bodyType: 'system', senderRole: 'system', bodyText: '订单已付款' })] }));
    expect(html).toContain('messages-system-row');
    expect(html).not.toContain('messages-bubble-row');
  });
});
