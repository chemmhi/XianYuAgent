import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHttpClient } from './http';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('http client hot-restart recovery', () => {
  it('retries a transient GET network failure and returns the recovered payload', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { ok: true } }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const request = createHttpClient().get<{ data: { ok: boolean } }>('/api/health');
    await vi.runAllTimersAsync();

    await expect(request).resolves.toEqual({ data: { ok: true } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries a transient gateway response for GET but never retries POST', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('bad gateway', { status: 502 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { ok: true } }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const request = createHttpClient().get<{ data: { ok: boolean } }>('/api/health');
    await vi.runAllTimersAsync();
    await expect(request).resolves.toEqual({ data: { ok: true } });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fetchMock.mockReset().mockRejectedValue(new TypeError('fetch failed'));
    await expect(createHttpClient().post('/api/messages', { text: 'hello' })).rejects.toThrow('fetch failed');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('stops after the bounded retry budget and does not retry an abort', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    vi.stubGlobal('fetch', fetchMock);

    const failedRequest = createHttpClient().get('/api/health');
    const failedAssertion = expect(failedRequest).rejects.toThrow('fetch failed');
    await vi.runAllTimersAsync();
    await failedAssertion;
    expect(fetchMock).toHaveBeenCalledTimes(4);

    fetchMock.mockReset().mockRejectedValue(new DOMException('The request was aborted', 'AbortError'));
    await expect(createHttpClient().get('/api/health')).rejects.toThrow('aborted');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
