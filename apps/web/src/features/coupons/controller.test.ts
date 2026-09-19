import { describe, expect, it } from 'vitest';
import { toCouponsLoadError } from './controller';

describe('coupons controller error mapping', () => {
  it('maps permission, missing, conflict and network errors', () => {
    expect(toCouponsLoadError(Object.assign(new Error('forbidden'), { status: 403 }))).toMatchObject({ code: 'FORBIDDEN', retryable: false });
    expect(toCouponsLoadError(Object.assign(new Error('missing'), { status: 404 }))).toMatchObject({ code: 'NOT_FOUND', retryable: false });
    expect(toCouponsLoadError(Object.assign(new Error('conflict'), { status: 409 }))).toMatchObject({ code: 'CONFLICT', retryable: true });
    expect(toCouponsLoadError(new TypeError('offline'))).toMatchObject({ code: 'NETWORK_ERROR', retryable: true });
  });
});
