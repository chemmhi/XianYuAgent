import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { XianyuImService } from '../src/xianyu-im-service.js';

describe('xianyu IM credential refresh', () => {
  it('preserves the browser cookie snapshot while saving refreshed IM credentials', async () => {
    const previousMetadata = { cookies_refresh_snapshot: JSON.stringify([{ name: '_m_h5_tk', value: 'fresh', domain: '.goofish.com', path: '/' }]), loginMethod: 'qr_http' };
    let captured: Record<string, unknown> | undefined;
    const store = {
      getCredential: async () => ({ metadata: previousMetadata, expiresAt: '2026-10-01T00:00:00.000Z' }),
      upsertCredential: async (input: Record<string, unknown>) => { captured = input; return input; },
    };
    const service = new XianyuImService(store as never, {} as never, {} as never);
    await (service as unknown as { saveCredential: (adminId: string, account: { id: string; platform: string }, credential: Record<string, unknown>) => Promise<void> }).saveCredential(
      'admin-1',
      { id: 'account-1', platform: 'xianyu' },
      { cookieHeader: 'unb=seller-1; _m_h5_tk=rotated', accessToken: 'access-2', deviceId: 'device-1' },
    );

    assert.deepEqual(captured?.metadata, previousMetadata);
    assert.equal(captured?.expiresAt, '2026-10-01T00:00:00.000Z');
    assert.equal(captured?.accessToken, 'access-2');
  });
});
