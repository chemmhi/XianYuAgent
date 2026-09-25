import { describe, expect, test } from 'vitest';
import { normalizeError } from './controller';

describe('message send error mapping', () => {
  test('maps Failed to fetch into a retryable network message', () => {
    expect(normalizeError(new TypeError('Failed to fetch'))).toEqual({
      code: 'NETWORK_ERROR',
      message: '消息服务暂时不可用，请检查连接后重试。',
      retryable: true,
    });
  });
});
