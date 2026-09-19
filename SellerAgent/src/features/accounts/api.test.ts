import { describe, expect, it } from 'vitest';
import { createAccountsApi } from './api';

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
});
