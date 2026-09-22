import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ConversationListState, conversationDisplayName, conversationInitial } from './components/ConversationList';

describe('conversation identity fallbacks', () => {
  it('trims a loaded nickname before rendering it', () => {
    expect(conversationDisplayName({ buyerDisplayName: '  买家昵称  ', buyerRef: 'buyer-1' })).toBe('买家昵称');
  });

  it('falls back to the buyer reference when nickname is missing', () => {
    expect(conversationDisplayName({ buyerDisplayName: '  ', buyerRef: 'buyer-42' })).toBe('buyer-42');
    expect(conversationInitial({ buyerDisplayName: undefined, buyerRef: 'buyer-42' })).toBe('B');
  });

  it('uses an explicit placeholder when both identity fields are absent', () => {
    expect(conversationDisplayName({ buyerDisplayName: undefined, buyerRef: '' })).toBe('未知买家');
    expect(conversationInitial({ buyerDisplayName: undefined, buyerRef: '' })).toBe('未');
  });

  it('renders sidebar empty states with the shared centered state class', () => {
    const html = renderToStaticMarkup(createElement(ConversationListState, {
      children: createElement('span', null, '试试用户昵称、商品标题或最后一条消息。'),
    }));

    expect(html).toContain('class="messages-state messages-sidebar-state"');
    expect(html).toContain('试试用户昵称、商品标题或最后一条消息。');
  });
});
