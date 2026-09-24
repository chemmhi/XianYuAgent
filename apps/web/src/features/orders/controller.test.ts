import { describe, expect, it } from 'vitest';
import { toOrdersLoadError, toOrdersSyncError } from './controller';

describe('orders controller error mapping', () => {
  it('maps permission and missing order errors', () => {
    expect(toOrdersLoadError({ status: 403 })).toMatchObject({ code: 'FORBIDDEN', retryable: false });
    expect(toOrdersLoadError({ status: 404 })).toMatchObject({ code: 'NOT_FOUND', retryable: false });
  });

  it('keeps network errors retryable', () => {
    expect(toOrdersLoadError(new TypeError('fetch failed'))).toMatchObject({ code: 'NETWORK_ERROR', retryable: true });
  });

  it('uses an explicit sync failure message for external refresh errors', () => {
    expect(toOrdersSyncError(new Error('upstream failed'))).toMatchObject({ code: 'UNKNOWN', message: '订单同步失败，请稍后重试。', retryable: true });
    expect(toOrdersSyncError(new TypeError('fetch failed'))).toMatchObject({ code: 'NETWORK_ERROR', message: '订单同步失败，请检查连接后重试。', retryable: true });
  });
});
