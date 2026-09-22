import { describe, expect, it } from 'vitest';
import { toProductsLoadError, toProductsMutationError } from './controller';

describe('products controller error boundary', () => {
  it('maps permission failures to a non-retryable forbidden state', () => {
    expect(toProductsLoadError({ status: 403 })).toMatchObject({ code: 'FORBIDDEN', retryable: false });
  });

  it('maps missing product routes to a visible non-retryable contract error', () => {
    expect(toProductsLoadError({ status: 404 })).toMatchObject({ code: 'NOT_FOUND', retryable: false });
  });

  it('keeps network failures retryable', () => {
    expect(toProductsLoadError(new TypeError('offline'))).toMatchObject({ code: 'NETWORK_ERROR', retryable: true });
  });

  it('maps Xianyu slider validation to the shared re-auth contract without a re-login prompt', () => {
    expect(toProductsLoadError({ status: 409, payload: { error: { code: 'ACCOUNT_REAUTH_REQUIRED', details: { errorCode: 'ACCOUNT_VALIDATION_REQUIRED' } } } })).toMatchObject({ code: 'ACCOUNT_REAUTH_REQUIRED', reason: 'SLIDER_VALIDATION', retryable: false, message: expect.stringContaining('商品详情页完成滑块验证') });
  });

  it('keeps session expiry on the re-login path', () => {
    expect(toProductsLoadError({ status: 409, payload: { error: { code: 'ACCOUNT_REAUTH_REQUIRED', details: { errorCode: 'SESSION_EXPIRED' } } } })).toMatchObject({ code: 'ACCOUNT_REAUTH_REQUIRED', reason: 'REAUTH', retryable: false, message: expect.stringContaining('账号管理重新登录') });
  });

  it('maps mutation conflicts without discarding the local draft', () => {
    expect(toProductsMutationError({ status: 409 })).toMatchObject({ code: 'VERSION_CONFLICT', retryable: false });
  });

  it('maps write validation failures distinctly', () => {
    expect(toProductsMutationError({ status: 422 })).toMatchObject({ code: 'VALIDATION_FAILED', retryable: false });
  });

  it('keeps slider validation guidance for product sync failures', () => {
    expect(toProductsMutationError({ status: 409, payload: { error: { code: 'ACCOUNT_REAUTH_REQUIRED', details: { errorCode: 'ACCOUNT_VALIDATION_REQUIRED' } } } })).toMatchObject({ code: 'ACCOUNT_REAUTH_REQUIRED', reason: 'SLIDER_VALIDATION', retryable: false, message: expect.stringContaining('商品详情页完成滑块验证') });
  });
});
