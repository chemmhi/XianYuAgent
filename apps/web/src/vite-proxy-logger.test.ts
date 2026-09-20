import { describe, expect, it } from 'vitest';
import { isTransientProxyErrorLog } from './vite-proxy-logger';

describe('vite proxy error classification', () => {
  it('suppresses transient HTTP proxy connection failures', () => {
    expect(isTransientProxyErrorLog('http proxy error: /api/v1/conversations', { code: 'ECONNREFUSED' })).toBe(true);
    expect(isTransientProxyErrorLog('ws proxy error:\nError: read ECONNRESET', { code: 'ECONNRESET' })).toBe(true);
  });

  it('keeps application and non-transient proxy failures visible', () => {
    expect(isTransientProxyErrorLog('http proxy error: /api', { code: 'ERR_TLS_CERT_ALTNAME_INVALID' })).toBe(false);
    expect(isTransientProxyErrorLog('request failed: ECONNREFUSED')).toBe(false);
  });
});
