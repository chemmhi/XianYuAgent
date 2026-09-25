import { describe, expect, it } from 'vitest';
import { resolveRuntimeApi } from './runtime';

describe('runtime API selection', () => {
  it('prefers the provided live adapter', () => {
    const provided = { source: 'live' };
    expect(resolveRuntimeApi(provided, () => ({ source: 'mock' }), 'API_NOT_PROVIDED')).toBe(provided);
  });

  it('uses the fallback adapter in non-production test builds', () => {
    expect(resolveRuntimeApi(undefined, () => ({ source: 'mock' }), 'API_NOT_PROVIDED')).toEqual({ source: 'mock' });
  });
});
