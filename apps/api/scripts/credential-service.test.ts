import assert from 'node:assert/strict';
import test from 'node:test';
import { CredentialService } from '../src/services.js';

test('clears a stale IM access token when a fresh browser cookie replaces credentials', async () => {
  let credential: any = {
    id: 'credential-1', accountId: 'account-1', platform: 'xianyu', status: 'active',
    cookieHeader: 'unb=old-seller; _m_h5_tk=old', accessToken: 'old-im-token', deviceId: 'device-1',
    metadata: {}, createdAt: '2026-09-22T00:00:00.000Z', updatedAt: '2026-09-22T00:00:00.000Z',
  };
  const account = { id: 'account-1', platform: 'xianyu', status: 'connected' };
  const store = {
    getAccount: async () => account,
    getCredential: async () => credential,
    upsertCredential: async (input: any) => { credential = { ...credential, ...input, accessToken: input.accessToken }; return credential; },
    updateAccount: async () => account,
  };
  const service = new CredentialService(store as never, async () => 'audit-1');

  const saved = await service.save({
    adminId: 'admin-1', accountId: 'account-1', cookieHeader: 'unb=new-seller; _m_h5_tk=fresh',
    clearAccessToken: true, metadata: { loginMethod: 'qr_http' }, requestId: 'req-1', traceId: 'trace-1',
  });

  assert.equal(saved.accessToken, undefined);
  assert.equal(credential.accessToken, undefined);
  assert.equal(credential.cookieHeader, 'unb=new-seller; _m_h5_tk=fresh');
});

test('preserves the IM access token for MTOP cookie refresh persistence', async () => {
  let credential: any = {
    id: 'credential-1', accountId: 'account-1', platform: 'xianyu', status: 'active',
    cookieHeader: 'unb=old-seller; _m_h5_tk=old', accessToken: 'old-im-token', deviceId: 'device-1',
    metadata: {}, createdAt: '2026-09-22T00:00:00.000Z', updatedAt: '2026-09-22T00:00:00.000Z',
  };
  const account = { id: 'account-1', platform: 'xianyu', status: 'connected' };
  const store = {
    getAccount: async () => account,
    getCredential: async () => credential,
    upsertCredential: async (input: any) => { credential = { ...credential, ...input }; return credential; },
    updateAccount: async () => account,
  };
  const service = new CredentialService(store as never, async () => 'audit-1');

  const saved = await service.save({
    adminId: 'admin-1', accountId: 'account-1', cookieHeader: 'unb=old-seller; _m_h5_tk=rotated',
    requestId: 'req-1', traceId: 'trace-1',
  });

  assert.equal(saved.accessToken, 'old-im-token');
  assert.equal(credential.accessToken, 'old-im-token');
});
