import { describe, expect, it } from 'vitest';
import { conversationListRefreshExternal, withMessageSendTimeout } from './controller';

describe('messages controller request policy', () => {
  it('uses a local conversation snapshot while realtime is connected', () => {
    expect(conversationListRefreshExternal('connected')).toBe(false);
    expect(conversationListRefreshExternal('connecting')).toBeUndefined();
    expect(conversationListRefreshExternal('reconnecting')).toBeUndefined();
  });

  it('fails a stalled send instead of leaving the composer submitting forever', async () => {
    await expect(withMessageSendTimeout(new Promise<string>(() => undefined), 5)).rejects.toThrow('消息发送超时，请重试');
  });
});
