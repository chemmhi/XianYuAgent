import { describe, expect, it } from 'vitest';
import { toProductsLoadError } from './controller';

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
});
