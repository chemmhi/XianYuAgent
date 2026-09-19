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

  it('maps mutation conflicts without discarding the local draft', () => {
    expect(toProductsMutationError({ status: 409 })).toMatchObject({ code: 'VERSION_CONFLICT', retryable: false });
  });

  it('maps write validation failures distinctly', () => {
    expect(toProductsMutationError({ status: 422 })).toMatchObject({ code: 'VALIDATION_FAILED', retryable: false });
  });
});
