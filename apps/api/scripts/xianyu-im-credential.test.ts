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

  it('runs the configured verification browser for IM token validation and retries with cleaned cookies', async () => {
    let fetchCount = 0;
    const saved: Array<Record<string, unknown>> = [];
    const store = {
      getCredential: async () => ({
        cookieHeader: 'unb=seller-1; _m_h5_tk=token-1; x5secdata=challenge',
        metadata: {
          cookies_refresh_snapshot: JSON.stringify([
            { name: 'unb', value: 'seller-1', domain: '.goofish.com', path: '/' },
            { name: '_m_h5_tk', value: 'token-1_suffix', domain: '.goofish.com', path: '/' },
            { name: 'x5secdata', value: 'challenge', domain: '.goofish.com', path: '/' },
          ]),
        },
        expiresAt: '2026-10-01T00:00:00.000Z',
      }),
      upsertCredential: async (input: Record<string, unknown>) => { saved.push(input); return input; },
    };
    const verificationBrowser = {
      enabled: true,
      waitForCompletion: async (input: { verificationUrl: string; initialCookieSnapshot?: unknown[] }) => {
        assert.equal(input.verificationUrl, 'https://punish.goofish.com/verify?token=redacted');
        assert.equal(input.initialCookieSnapshot?.some((cookie) => (cookie as { name?: string }).name === 'x5secdata'), true);
        return {
          finalUrl: 'https://www.goofish.com/im',
          cookieSnapshot: [
            { name: 'unb', value: 'seller-1', domain: '.goofish.com', path: '/' },
            { name: '_m_h5_tk', value: 'token-2_suffix', domain: '.goofish.com', path: '/' },
            { name: 'x5sec', value: 'passed', domain: '.goofish.com', path: '/' },
            { name: 'x5secdata', value: 'stale', domain: '.goofish.com', path: '/' },
          ],
        };
      },
    };
    const service = new XianyuImService(store as never, {
      fetchImToken: async () => {
        fetchCount += 1;
        return fetchCount === 1
          ? { success: false, accountInvalid: true, errorCode: 'ACCOUNT_VALIDATION_REQUIRED', message: 'FAIL_SYS_USER_VALIDATE', verificationUrl: 'https://punish.goofish.com/verify?token=redacted', cookieHeader: 'unb=seller-1; _m_h5_tk=token-1_suffix; x5secdata=challenge' }
          : { success: true, accountInvalid: false, accessToken: 'access-2', cookieHeader: 'unb=seller-1; _m_h5_tk=token-2_suffix; x5sec=passed' };
      },
    } as never, {} as never, undefined, undefined, verificationBrowser as never);

    const result = await (service as unknown as { refreshCredential: (adminId: string, account: { id: string; platform: string }, credential: Record<string, unknown>) => Promise<Record<string, unknown>> }).refreshCredential(
      'admin-1',
      { id: 'account-1', platform: 'xianyu' },
      { cookieHeader: 'unb=seller-1; _m_h5_tk=token-1', metadata: {}, expiresAt: '2026-10-01T00:00:00.000Z' },
    );

    assert.equal(fetchCount, 2);
    assert.equal(result.accessToken, 'access-2');
    assert.equal(saved.length, 2);
    assert.match(String(saved[0]?.cookieHeader), /x5sec=passed/);
    assert.doesNotMatch(String(saved[0]?.cookieHeader), /x5secdata=/);
    assert.equal(saved[1]?.accessToken, 'access-2');
  });

  it('fails IM refresh immediately when auto verification cannot complete', async () => {
    let allowManualFallback: boolean | undefined;
    let maxWaitMs: number | undefined;
    const store = {
      getCredential: async () => ({ cookieHeader: 'unb=seller-1; _m_h5_tk=token-1', metadata: {}, expiresAt: '2026-10-01T00:00:00.000Z' }),
      upsertCredential: async () => { throw new Error('should not persist failed verification'); },
    };
    const service = new XianyuImService(store as never, {
      fetchImToken: async () => ({ success: false, accountInvalid: true, errorCode: 'ACCOUNT_VALIDATION_REQUIRED', message: 'FAIL_SYS_USER_VALIDATE', verificationUrl: 'https://punish.goofish.com/verify?token=redacted', cookieHeader: 'unb=seller-1; _m_h5_tk=token-1' }),
    } as never, {} as never, undefined, undefined, {
      enabled: true,
      waitForCompletion: async (input: { allowManualFallback?: boolean; maxWaitMs?: number }) => {
        allowManualFallback = input.allowManualFallback;
        maxWaitMs = input.maxWaitMs;
        throw new Error('XIANYU_VERIFICATION_AUTO_SOLVE_FAILED:slider_timeout');
      },
    } as never);

    const startedAt = Date.now();
    await assert.rejects(
      () => (service as unknown as { refreshCredential: (adminId: string, account: { id: string; platform: string }, credential: Record<string, unknown>) => Promise<unknown> }).refreshCredential(
        'admin-1',
        { id: 'account-1', platform: 'xianyu' },
        { cookieHeader: 'unb=seller-1; _m_h5_tk=token-1', metadata: {}, expiresAt: '2026-10-01T00:00:00.000Z' },
      ),
      (error: unknown) => error instanceof ServiceError && error.statusCode === 409 && error.code === 'ACCOUNT_VALIDATION_REQUIRED',
    );
    assert.equal(allowManualFallback, false);
    assert.equal(maxWaitMs, 20_000);
    assert.ok(Date.now() - startedAt < 1_000);
  });

  it('does not reopen a blank verification browser on every reconnect retry', async () => {
    let browserCalls = 0;
    const store = {
      getCredential: async () => ({ cookieHeader: 'unb=seller-1; _m_h5_tk=token-1', metadata: {}, expiresAt: '2026-10-01T00:00:00.000Z' }),
      upsertCredential: async () => { throw new Error('should not persist failed verification'); },
    };
    const service = new XianyuImService(store as never, {
      fetchImToken: async () => ({ success: false, accountInvalid: true, errorCode: 'ACCOUNT_VALIDATION_REQUIRED', message: 'FAIL_SYS_USER_VALIDATE', verificationUrl: 'https://punish.goofish.com/verify?token=redacted', cookieHeader: 'unb=seller-1; _m_h5_tk=token-1' }),
    } as never, {} as never, undefined, undefined, {
      enabled: true,
      waitForCompletion: async () => {
        browserCalls += 1;
        throw new Error('XIANYU_VERIFICATION_AUTO_SOLVE_FAILED:slider_timeout');
      },
    } as never);
    const refresh = () => (service as unknown as { refreshCredential: (adminId: string, account: { id: string; platform: string }, credential: Record<string, unknown>) => Promise<unknown> }).refreshCredential(
      'admin-1',
      { id: 'account-1', platform: 'xianyu' },
      { cookieHeader: 'unb=seller-1; _m_h5_tk=token-1', metadata: {}, expiresAt: '2026-10-01T00:00:00.000Z' },
    );

    await assert.rejects(refresh, (error: unknown) => error instanceof ServiceError && error.code === 'ACCOUNT_VALIDATION_REQUIRED');
    await assert.rejects(refresh, (error: unknown) => error instanceof ServiceError && error.code === 'ACCOUNT_VALIDATION_REQUIRED');
    assert.equal(browserCalls, 1);
  });

  it('cleans up a failed IM client so validation cannot leave a reconnect timer behind', async () => {
    const store = {
      getAccount: async () => ({ id: 'account-1', platform: 'xianyu', sellerRef: 'seller-1', status: 'connected' as const }),
      getCredential: async () => ({ cookieHeader: 'unb=seller-1; _m_h5_tk=token-1', deviceId: 'device-1', status: 'active' as const }),
      updateAccount: async () => undefined,
    };
    const service = new XianyuImService(store as never, {
      fetchImToken: async () => ({ success: false, accountInvalid: true, errorCode: 'ACCOUNT_VALIDATION_REQUIRED', message: 'FAIL_SYS_USER_VALIDATE', verificationUrl: 'https://punish.goofish.com/verify?token=redacted', cookieHeader: 'unb=seller-1; _m_h5_tk=token-1' }),
    } as never, {} as never, undefined, undefined, {
      enabled: true,
      waitForCompletion: async () => { throw new Error('XIANYU_VERIFICATION_AUTO_SOLVE_FAILED:slider_timeout'); },
    } as never);

    await assert.rejects(() => service.startListener('admin-1', 'account-1'), (error: unknown) => error instanceof ServiceError && error.code === 'ACCOUNT_VALIDATION_REQUIRED');
    assert.equal((service as unknown as { clients: Map<string, unknown> }).clients.size, 0);
    assert.equal((service as unknown as { clientInFlight: Map<string, unknown> }).clientInFlight.size, 0);
  });

  it('disconnects an existing failed IM client before replacing it', async () => {
    let disconnectCalls = 0;
    const store = {
      getAccount: async () => ({ id: 'account-1', platform: 'xianyu', sellerRef: 'seller-1', status: 'connected' as const }),
      getCredential: async () => undefined,
      updateAccount: async () => undefined,
    };
    const service = new XianyuImService(store as never, {} as never, {} as never);
    (service as unknown as { clients: Map<string, unknown> }).clients.set('admin-1:account-1', {
      connect: async () => { throw new Error('XIANYU_VERIFICATION_AUTO_SOLVE_FAILED:slider_timeout'); },
      disconnect: async () => { disconnectCalls += 1; },
    });

    await assert.rejects(
      () => (service as unknown as { ensureClient: (adminId: string, accountId: string) => Promise<unknown> }).ensureClient('admin-1', 'account-1'),
      (error: unknown) => error instanceof ServiceError && error.code === 'CREDENTIAL_MISSING',
    );
    assert.equal(disconnectCalls, 1);
    assert.equal((service as unknown as { clients: Map<string, unknown> }).clients.size, 0);
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

  it('keeps a freshly logged-in account connected when IM bootstrap hits slider validation', async () => {
    let account = { id: 'account-1', platform: 'xianyu', status: 'connected' as const };
    let updatedCredentialStatus: string | undefined;
    const store = {
      getAccount: async () => account,
      getCredential: async () => ({ cookieHeader: 'unb=seller-1; _m_h5_tk=token-1', deviceId: 'device-1', status: 'active' as const }),
      updateAccount: async (_adminId: string, _accountId: string, patch: { status?: string }) => {
        account = { ...account, status: patch.status as typeof account.status };
        return account;
      },
      markCredentialVerified: async (input: { status: string }) => { updatedCredentialStatus = input.status; return { status: input.status }; },
    };
    const service = new XianyuImService(store as never, {
      fetchImToken: async () => ({ success: false, accountInvalid: true, errorCode: 'ACCOUNT_VALIDATION_REQUIRED', message: 'FAIL_SYS_USER_VALIDATE', cookieHeader: '' }),
    } as never, {} as never);

    await assert.rejects(() => service.startListener('admin-1', 'account-1'), (error: unknown) => error instanceof ServiceError && error.code === 'ACCOUNT_VALIDATION_REQUIRED');
    assert.equal(account.status, 'connected');
    assert.equal(updatedCredentialStatus, undefined);
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
    const sentImageRequestIds: string[] = [];
    const fakeClient = {
      connect: async () => { order.push('connect'); },
      sendImage: async (_conversationRef: string, _recipientRef: string, _imageUrl: string, _width: number, _height: number, requestId?: string) => { order.push('sendImage'); sentImageRequestIds.push(String(requestId)); return { externalMessageRef: 'external-message-1' }; },
    };
    (service as unknown as { clients: Map<string, unknown> }).clients.set('admin-1:account-1', fakeClient);

    await service.sendImage('admin-1', 'account-1', 'conversation-1', { filename: 'image.png', contentType: 'image/png', data: Buffer.from([1]) }, 'request-1', 'trace-1');

    assert.deepEqual(order, ['connect', 'upload', 'sendImage']);
    assert.deepEqual(sentImageRequestIds, ['request-1']);
  });

  it('rebuilds a cached IM client after slider rejection and retries once with the same request id', async () => {
    const sentRequestIds: string[] = [];
    let refreshCalls = 0;
    let disconnectCalls = 0;
    const store = {
      getConversation: async () => ({ id: 'conversation-1', accountId: 'account-1', externalConversationRef: 'conversation-external', buyerRef: 'buyer-1' }),
      getAccount: async () => ({ id: 'account-1', platform: 'xianyu', sellerRef: 'seller-1', status: 'connected' as const }),
      getCredential: async () => ({ cookieHeader: 'unb=seller-1; _m_h5_tk=token-1', accessToken: 'access-1', deviceId: 'device-1' }),
      updateAccount: async () => undefined,
    };
    const service = new XianyuImService(store as never, {} as never, {} as never);
    const staleClient = {
      sendText: async () => { throw new Error('FAIL_SYS_USER_VALIDATE'); },
      disconnect: async () => { disconnectCalls += 1; },
    };
    const freshClient = {
      sendText: async (_conversationRef: string, _recipientRef: string, _text: string, requestId: string) => {
        sentRequestIds.push(requestId);
        return { externalMessageRef: 'fresh-message' };
      },
      disconnect: async () => undefined,
    };
    const internal = service as unknown as {
      clients: Map<string, unknown>;
      ensureClient: (adminId: string, accountId: string, options?: { forceCredentialRefresh?: boolean }) => Promise<unknown>;
      refreshCredential: (...args: unknown[]) => Promise<unknown>;
    };
    internal.clients.set('admin-1:account-1', staleClient);
    internal.ensureClient = async (_adminId, _accountId, options) => options?.forceCredentialRefresh ? freshClient : staleClient;
    internal.refreshCredential = async () => { refreshCalls += 1; return { cookieHeader: 'unb=seller-1', accessToken: 'access-2', deviceId: 'device-1' }; };

    const result = await service.sendExternalText('admin-1', 'account-1', 'conversation-1', '你好', 'request-1', 'trace-1');

    assert.deepEqual(result, { externalMessageRef: 'fresh-message' });
    assert.equal(refreshCalls, 1);
    assert.equal(disconnectCalls, 1);
    assert.deepEqual(sentRequestIds, ['request-1']);
  });
});
