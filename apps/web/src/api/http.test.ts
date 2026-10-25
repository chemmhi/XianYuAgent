import { createSessionBoundary } from '../features/auth/session-boundary';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHttpClient } from './http';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('http client CSRF recovery', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('refreshes the session cookie and retries a failed mutation once', async () => {
    const documentStub = { cookie: 'csrf_token=stale-token' };
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('document', documentStub);
    vi.stubGlobal('fetch', fetchMock);
    fetchMock
      .mockResolvedValueOnce(jsonResponse(403, { success: false, message: 'csrf token invalid', error: { code: 'CSRF_INVALID' } }))
      .mockImplementationOnce(async () => {
        documentStub.cookie = 'csrf_token=fresh-token';
        return jsonResponse(200, { success: true, data: { authenticated: true } });
      })
      .mockResolvedValueOnce(jsonResponse(200, { success: true, data: { messageId: 'sent-1' } }));

    const client = createHttpClient({ baseUrl: 'https://api.example.test', getCsrfToken: () => 'stale-token' });
    await expect(client.post('/api/v1/conversations/c1/messages', { text: 'hello' }, { headers: { 'Idempotency-Key': 'msg-1' } }))
      .resolves.toEqual({ success: true, data: { messageId: 'sent-1' } });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const firstInit = fetchMock.mock.calls[0]?.[1];
    expect(new Headers(firstInit?.headers).get('X-CSRF-Token')).toBe('stale-token');
    expect(fetchMock.mock.calls[1]?.[0]).toBe('https://api.example.test/api/v1/auth/session');
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe('GET');
    const retryInit = fetchMock.mock.calls[2]?.[1];
    expect(new Headers(retryInit?.headers).get('X-CSRF-Token')).toBe('fresh-token');
    expect(new Headers(retryInit?.headers).get('Idempotency-Key')).toBe('msg-1');
  });

  it('does not loop when the retried mutation is still rejected', async () => {
    const documentStub = { cookie: 'csrf_token=stale-token' };
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('document', documentStub);
    vi.stubGlobal('fetch', fetchMock);
    fetchMock
      .mockResolvedValueOnce(jsonResponse(403, { success: false, message: 'csrf token invalid', error: { code: 'CSRF_INVALID' } }))
      .mockImplementationOnce(async () => {
        documentStub.cookie = 'csrf_token=fresh-token';
        return jsonResponse(200, { success: true, data: { authenticated: true } });
      })
      .mockResolvedValueOnce(jsonResponse(403, { success: false, message: 'csrf token invalid', error: { code: 'CSRF_INVALID' } }));

    const client = createHttpClient({ baseUrl: 'https://api.example.test' });
    await expect(client.post('/api/v1/conversations/c1/messages', { text: 'hello' }))
      .rejects.toMatchObject({ status: 403, payload: { error: { code: 'CSRF_INVALID' } } });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});


describe('session access rejection', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('expires business auth failures and ignores login or upstream failures', async () => {
    const boundary = createSessionBoundary(); const listener = vi.fn(); boundary.subscribe(listener);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(401, { error: { code: 'UNAUTHENTICATED' } }));
    vi.stubGlobal('fetch', fetchMock);
    const client = createHttpClient({ sessionBoundary: boundary });
    await expect(client.get('/api/v1/accounts')).rejects.toMatchObject({ status: 401 });
    expect(listener).toHaveBeenCalledOnce(); listener.mockClear();
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: { code: 'UNAUTHENTICATED' } }));
    await expect(client.post('/api/v1/auth/password-login', {})).rejects.toMatchObject({ status: 401 });
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: { code: 'PLATFORM_LOGIN_REQUIRED' } }));
    await expect(client.get('/api/v1/other')).rejects.toMatchObject({ status: 401 });
    expect(listener).not.toHaveBeenCalled();
  });
  it('aborts old requests and cannot log out the next login from a late 401', async () => {
    const boundary = createSessionBoundary(); const listener = vi.fn(); boundary.subscribe(listener);
    let resolve!: (response: Response) => void;
    const fetchMock = vi.fn<typeof fetch>(() => new Promise(done => { resolve = done; }));
    vi.stubGlobal('fetch', fetchMock);
    const pending = createHttpClient({ sessionBoundary: boundary }).get('/api/v1/accounts');
    boundary.advance();
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
    resolve(jsonResponse(401, { error: { code: 'UNAUTHENTICATED' } }));
    await expect(pending).rejects.toMatchObject({ status: 401 });
    expect(listener).not.toHaveBeenCalled();
  });
  it('never retries an old-session mutation using the next session CSRF cookie', async () => {
    const boundary = createSessionBoundary(); let resolve!: (response: Response) => void;
    const fetchMock = vi.fn<typeof fetch>(() => new Promise(done => { resolve = done; }));
    vi.stubGlobal('fetch', fetchMock);
    const pending = createHttpClient({ sessionBoundary: boundary }).post('/api/v1/coupons', { label: 'old user data' });
    boundary.advance(); resolve(jsonResponse(403, { error: { code: 'CSRF_INVALID' } }));
    await expect(pending).rejects.toMatchObject({ status: 403 });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
