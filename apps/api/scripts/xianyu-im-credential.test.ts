import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { XianyuImService } from '../src/xianyu-im-service.js';
import { ServiceError } from '../src/services.js';

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

  it('maps remote slider validation to a recoverable account re-auth error', async () => {
    const store = {
      upsertCredential: async () => { throw new Error('should not persist invalid token'); },
    };
    const mtop = {
      fetchImToken: async () => ({ success: false, accountInvalid: true, errorCode: 'ACCOUNT_VALIDATION_REQUIRED', message: 'FAIL_SYS_USER_VALIDATE', cookieHeader: '' }),
    };
    const service = new XianyuImService(store as never, mtop as never, {} as never);
    await assert.rejects(
      () => (service as unknown as { refreshCredential: (adminId: string, account: { id: string; platform: string }, credential: { deviceId?: string; metadata?: Record<string, string>; expiresAt?: string }) => Promise<unknown> }).refreshCredential(
        'admin-1',
        { id: 'account-1', platform: 'xianyu' },
        { deviceId: 'device-1' },
      ),
      (error: unknown) => error instanceof ServiceError
        && error.statusCode === 409
        && error.code === 'ACCOUNT_VALIDATION_REQUIRED'
        && error.message.includes('滑块验证'),
    );
  });

  it('persists an expired account when listener bootstrap finds missing credentials', async () => {
    let account = { id: 'account-1', platform: 'xianyu', status: 'connected' as const };
    const store = {
      getAccount: async () => account,
      getCredential: async () => undefined,
      updateAccount: async (_adminId: string, _accountId: string, patch: { status?: string }) => {
        account = { ...account, status: patch.status as typeof account.status };
        return account;
      },
    };
    const service = new XianyuImService(store as never, {} as never, {} as never);

    await assert.rejects(() => service.startListener('admin-1', 'account-1'), (error: unknown) => error instanceof ServiceError && error.code === 'CREDENTIAL_MISSING');
    assert.equal(account.status, 'expired');
  });

  it('waits for the IM session before uploading an image', async () => {
    const order: string[] = [];
    const store = {
      getConversation: async () => ({ id: 'conversation-1', accountId: 'account-1', externalConversationRef: 'conversation-external', buyerRef: 'buyer-1' }),
    };
    const mtop = {
      uploadChatImage: async () => {
        order.push('upload');
        return { success: true, accountInvalid: false, url: 'https://img.example/image.png', width: 1, height: 1, cookieHeader: '' };
      },
    };
    const messages = {
      createMessage: async () => ({ message: { messageId: 'message-1', bodyType: 'image' } }),
    };
    const service = new XianyuImService(store as never, mtop as never, messages as never);
    const fakeClient = {
      connect: async () => { order.push('connect'); },
      sendImage: async () => { order.push('sendImage'); return { externalMessageRef: 'external-message-1' }; },
    };
    (service as unknown as { clients: Map<string, unknown> }).clients.set('admin-1:account-1', fakeClient);

    await service.sendImage('admin-1', 'account-1', 'conversation-1', { filename: 'image.png', contentType: 'image/png', data: Buffer.from([1]) }, 'request-1', 'trace-1');

    assert.deepEqual(order, ['connect', 'upload', 'sendImage']);
  });
});
