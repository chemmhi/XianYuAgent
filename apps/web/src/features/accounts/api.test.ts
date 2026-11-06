import { describe, expect, it } from 'vitest';
import { createAccountsApi, createMockAccountsApi } from './api';

describe('accounts canonical API adapter', () => {
  it('uses one presenter identity across background discovery, polling and native verification',async()=>{
    const paths:string[]=[],bodies:unknown[]=[];
    const api=createAccountsApi({async get<T>(path:string){paths.push(path);return {session:path.includes('/pending?')?null:{id:'automatic',status:'verification_required'}} as T;},async post<T>(_path:string,body:unknown){bodies.push(body);return {} as T;}});
    expect(await api.getPendingPasswordSession!()).toBeNull();await api.getPasswordSession!('automatic');
    const presenter=new URL('http://fixture'+paths[0]).searchParams.get('presenterId');expect(presenter).toMatch(/^[0-9a-f-]{36}$/);expect(paths[1]).toBe('/api/v1/accounts/password-login/automatic?presenterId='+presenter);
    await api.submitPasswordVerification!('automatic',{challengeId:'nonce',candidate:{value:'proof',expire:123,host:'passport.goofish.com'}});expect(bodies[0]).toMatchObject({presenterId:presenter,challengeId:'nonce'});
  });
  it('uses async password sessions, keeps secrets on the initial POST, and maps the successful account', async () => {
    const posts: Array<{ path: string; body: unknown }> = [];
    const api = createAccountsApi({ async post<T>(path: string, body: unknown) { posts.push({ path, body }); return { session: { id: 'password-session', status: 'logging_in', expiresAt: '2030-01-01T00:00:00Z' } } as T; },
      async get<T>(path: string) { expect(path).toMatch(/^\/api\/v1\/accounts\/password-login\/password-session\?presenterId=[0-9a-f-]{36}$/); return { success: true, data: { session: { id: 'password-session', status: 'succeeded', credentialsSaved: true, account: { id: 'restored', displayName: '恢复账号', status: 'disconnected' } } } } as T; } });
    const input = { account: 'fixture-user', password: 'fixture-password', accountId: 'restored', acceptTerms: true };
    expect((await api.createPasswordSession!(input)).id).toBe('password-session'); expect(posts[0]).toEqual({ path:'/api/v1/accounts/password-login', body:input });
    const result = await api.getPasswordSession!('password-session'); expect(result.account?.id).toBe('restored'); expect(result.credentialsSaved).toBe(true);
    await api.cancelPasswordSession!('password-session'); expect(posts[1]).toEqual({ path:'/api/v1/accounts/password-login/password-session/cancel',body:{} });
  });
  it('uses the settings-backed boolean, preserves false, and does not interpret unavailable as off', async () => {
    const api = createAccountsApi({ async get<T>() { return { items: [
      { id: 'on', displayName: '已开启', autoReplyEnabled: true, aiEnabled: false, degradedSource: 'im' },
      { id: 'off', displayName: '已关闭', autoReplyEnabled: false, aiEnabled: true },
      { id: 'unavailable', displayName: '不可用', autoReplyEnabled: null, aiEnabled: true },
      { id: 'legacy', displayName: '旧接口', aiEnabled: true },
      { id: 'missing', displayName: '字段缺失' },
    ] } as T; } });
    const page = await api.list();
    expect(page.items.map(row => row.aiEnabled)).toEqual([true, false, undefined, true, undefined]);
    expect(page.items[0].degradedSource).toBe('im');
  });
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

  it('passes account search, filters, and pagination to the canonical list route', async () => {
    const calls: string[] = [];
    const api = createAccountsApi({
      async get<T>(path: string) {
        calls.push(path);
        return { success: true, data: { items: [], total: 0, page: 2, pageSize: 10, totalPages: 1 } } as T;
      },
    });

    const result = await api.list({ search: '主账号', status: 'pending', connectionStatus: 'connecting', page: 2, pageSize: 10 });

    expect(calls[0]).toBe('/api/v1/accounts?search=%E4%B8%BB%E8%B4%A6%E5%8F%B7&status=pending&connectionStatus=connecting&page=2&pageSize=10');
    expect(result).toMatchObject({ page: 2, pageSize: 10, totalPages: 1 });
  });

  it('does not default degraded or disconnected accounts to a healthy connection', async () => {
    const api = createAccountsApi({
      async get<T>() {
        return {
          success: true,
          data: {
            items: [
              { id: 'account-degraded', displayName: '降级账号', status: 'degraded' },
              { id: 'account-disconnected', displayName: '断开账号', status: 'disconnected' },
            ],
            total: 2,
            page: 1,
            pageSize: 20,
            totalPages: 1,
          },
        } as T;
      },
    });

    const result = await api.list();

    expect(result.items[0]).toMatchObject({ status: 'degraded', connection: { status: 'unknown' }, credentialState: 'unknown' });
    expect(result.items[1]).toMatchObject({ status: 'disconnected', connection: { status: 'offline' }, credentialState: 'unknown' });
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
    expect(calls[1]?.path).toBe('/api/v1/auth/qr-sessions/qr-session-1');
  });

  it('preserves verification_required instead of showing a QR login failure', async () => {
    const api = createAccountsApi({
      async get<T>() {
        return {
          success: true,
          data: {
            id: 'login-session-verification',
            qrSessionId: 'qr-session-verification',
            accountId: 'account-1',
            status: 'verification_required',
            verificationUrl: 'https://passport.goofish.com/verify/challenge',
            verificationAutoLaunch: true,
            errorCode: 'VERIFICATION_REQUIRED',
            expiresAt: '2026-09-24T00:05:00.000Z',
            pollAfterMs: 1200,
          },
        } as T;
      },
    });

    const session = await api.getQrSession('account-1', 'qr-session-verification');

    expect(session).toMatchObject({
      status: 'verification_required',
      verificationUrl: 'https://passport.goofish.com/verify/challenge',
      verificationAutoLaunch: true,
      errorCode: 'VERIFICATION_REQUIRED',
    });
  });

  it('submits Cookie login without asking the UI for a placeholder account id', async () => {
    const calls: Array<{ path: string; body?: unknown }> = [];
    const api = createAccountsApi({
      async get<T>() { throw new Error('unexpected GET'); },
      async post<T>(path: string, body?: unknown) {
        calls.push({ path, body });
        return { success: true, data: { account: { id: 'account-cookie', sellerRef: 'seller-cookie', displayName: '闲鱼昵称', status: 'connected', connection: { status: 'online' }, credentialState: 'configured' } } } as T;
      },
    });

    const account = await api.loginWithCookie({ cookieHeader: 'unb=seller-cookie; _m_h5_tk=token_1' });
    expect(account).toMatchObject({ id: 'account-cookie', displayName: '闲鱼昵称', sellerRef: 'seller-cookie' });
    expect(calls[0]).toMatchObject({ path: '/api/v1/auth/cookie-login', body: { cookieHeader: 'unb=seller-cookie; _m_h5_tk=token_1' } });
  });

  it('targets the existing account when refreshing Cookie credentials', async () => {
    const calls: Array<{ path: string; body?: unknown }> = [];
    const api = createAccountsApi({
      async get<T>() { throw new Error('unexpected GET'); },
      async post<T>(path: string, body?: unknown) {
        calls.push({ path, body });
        return { success: true, data: { account: { id: 'account-existing', sellerRef: 'seller-cookie', displayName: '闲鱼昵称', status: 'connected', connection: { status: 'online' }, credentialState: 'configured' } } } as T;
      },
    });

    const account = await api.loginWithCookie({ accountId: 'account-existing', cookieHeader: 'unb=seller-cookie; _m_h5_tk=fresh-token' });
    expect(account).toMatchObject({ id: 'account-existing', credentialState: 'configured' });
    expect(calls[0]).toMatchObject({ path: '/api/v1/auth/cookie-login', body: { accountId: 'account-existing', cookieHeader: 'unb=seller-cookie; _m_h5_tk=fresh-token' } });
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
