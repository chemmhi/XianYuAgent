import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { toCouponsLoadError } from './controller';

describe('coupons controller error mapping', () => {
  it('maps permission, missing, conflict and network errors', () => {
    expect(toCouponsLoadError(Object.assign(new Error('forbidden'), { status: 403 }))).toMatchObject({ code: 'FORBIDDEN', retryable: false });
    expect(toCouponsLoadError(Object.assign(new Error('missing'), { status: 404 }))).toMatchObject({ code: 'NOT_FOUND', retryable: false });
    expect(toCouponsLoadError(Object.assign(new Error('conflict'), { status: 409 }))).toMatchObject({ code: 'CONFLICT', retryable: true });
    expect(toCouponsLoadError(new TypeError('offline'))).toMatchObject({ code: 'NETWORK_ERROR', retryable: true });
  });

  it('does not reopen the removed detail drawer after editing', () => {
    const source = readFileSync(fileURLToPath(new URL('./controller.ts', import.meta.url)), 'utf8');

    expect(source).not.toContain('openBatch');
    expect(source).not.toContain('setDetail');
    expect(source).toContain('runMutation(() => api.updateBatch(batchId, input))');
  });

  it('allows relation writes to suppress their intermediate list reload', () => {
    const source = readFileSync(fileURLToPath(new URL('./controller.ts', import.meta.url)), 'utf8');

    expect(source).toContain('options.reload !== false');
    expect(source).toContain('api.bindBatch(batchId, productId), options');
    expect(source).toContain('api.unbindBatch(batchId, productId), options');
  });
});
