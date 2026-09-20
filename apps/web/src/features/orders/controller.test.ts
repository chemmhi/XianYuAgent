import { describe, expect, it } from 'vitest';
import { toOrdersLoadError } from './controller';

describe('orders controller error mapping', () => {
  it('maps permission and missing order errors', () => {
    expect(toOrdersLoadError({ status: 403 })).toMatchObject({ code: 'FORBIDDEN', retryable: false });
    expect(toOrdersLoadError({ status: 404 })).toMatchObject({ code: 'NOT_FOUND', retryable: false });
  });

  it('keeps network errors retryable', () => {
    expect(toOrdersLoadError(new TypeError('fetch failed'))).toMatchObject({ code: 'NETWORK_ERROR', retryable: true });
  });
});

