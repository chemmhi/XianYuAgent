import { describe, expect, it } from 'vitest';
import { createAccountsApi, createMockAccountsApi } from './api';

describe('accounts canonical API adapter', () => {
  it('unwraps the shared API envelope before mapping account rows', async () => {
    const api = createAccountsApi({
      async get<T>() {
        return {
          success: true,
          data: {
            items: [{
              id: 'account-1',
              platform: 'xianyu',
              sellerRef: 'seller-001',
              displayName: '主账号',
              status: 'connected',
              connection: { status: 'online' },
              credentialState: 'configured',
              version: 1,
              updatedAt: '2026-09-19T00:00:00.000Z',
            }],
            total: 1,
            page: 1,
            pageSize: 20,
            totalPages: 1,
          },
          requestId: 'req_test',
          traceId: 'trc_test',
        } as T;
      },
    });

    const result = await api.list();

    expect(result.items[0]).toMatchObject({
      id: 'account-1',
      displayName: '主账号',
      connection: { status: 'online' },
    });
    expect(result.total).toBe(1);
  });

  it('creates and polls QR sessions through canonical account-scoped routes', async () => {
    const calls: Array<{ path: string; body?: unknown; headers?: HeadersInit }> = [];
    const qrPayload = {
      success: true,
      data: {
        id: 'login-session-1',
        qrSessionId: 'qr-session-1',
        accountId: 'account-1',
        status: 'waiting',
        qrImageDataUrl: 'data:image/svg+xml;base64,stub',
        expiresAt: '2026-09-19T00:05:00.000Z',
        pollAfterMs: 1200,
      },
    };
    const api = createAccountsApi({
      async get<T>(path: string) {
        calls.push({ path });
        return qrPayload as T;
      },
      async post<T>(path: string, body?: unknown, init?: RequestInit) {
        calls.push({ path, body, headers: init?.headers });
        return qrPayload as T;
      },
    });

    const created = await api.createQrSession('account-1');
    const polled = await api.getQrSession('account-1', created.qrSessionId);

    expect(created).toMatchObject({ qrSessionId: 'qr-session-1', accountId: 'account-1', pollAfterMs: 1200 });
    expect(polled.status).toBe('waiting');
    expect(calls[0]).toMatchObject({ path: '/api/v1/auth/qr-sessions' });
    expect(calls[0]?.headers).toEqual(expect.objectContaining({ 'Idempotency-Key': expect.any(String) }));
    expect(calls[1]?.path).toBe('/api/v1/auth/qr-sessions/qr-session-1?accountId=account-1');
  });

  it('creates an account through the canonical mutation and maps the response', async () => {
    const calls: Array<{ path: string; body?: unknown; headers?: HeadersInit }> = [];
    const api = createAccountsApi({
      async get<T>(_path: string) { throw new Error('unexpected GET'); },
      async post<T>(path: string, body?: unknown, init?: RequestInit) {
        calls.push({ path, body, headers: init?.headers });
        return {
          success: true,
          data: {
            id: 'account-new',
            sellerRef: 'seller-new',
            displayName: '新店铺',
            status: 'pending',
            connection: { status: 'unknown' },
            credentialState: 'missing',
          },
        } as T;
      },
    });

    const created = await api.createAccount({ platform: 'xianyu', sellerRef: 'seller-new', displayName: '新店铺' });

    expect(created).toMatchObject({ id: 'account-new', displayName: '新店铺', status: 'pending', credentialState: 'missing' });
    expect(calls[0]).toMatchObject({ path: '/api/v1/accounts', body: { platform: 'xianyu', sellerRef: 'seller-new', displayName: '新店铺' } });
    expect(calls[0]?.headers).toEqual(expect.objectContaining({ 'Idempotency-Key': expect.any(String) }));
  });

  it('adds a mock account and rejects duplicate seller references', async () => {
    const api = createMockAccountsApi([]);
    const created = await api.createAccount({ platform: 'xianyu', sellerRef: 'seller-new', displayName: '新店铺' });
    expect((await api.list()).items).toHaveLength(1);
    expect(created.status).toBe('pending');
    await expect(api.createAccount({ platform: 'xianyu', sellerRef: 'seller-new' })).rejects.toThrow('ACCOUNT_ALREADY_EXISTS');
  });
});
