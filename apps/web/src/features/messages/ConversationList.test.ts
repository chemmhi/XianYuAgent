import { describe, expect, it } from 'vitest';
import { conversationDisplayName, conversationInitial } from './components/ConversationList';

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
});
