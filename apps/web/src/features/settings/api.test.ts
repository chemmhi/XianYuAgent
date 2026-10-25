import { describe, expect, it } from 'vitest';
import { createCredentialApi, createInviteApi } from './api';

describe('invite api adapter', () => {
  it('maps both UI statuses to the supported server actions and encodes invite ids', async () => {
    const paths: string[] = [];
    const api = createInviteApi({
      get: async <T>() => ({ success: true, data: {} }) as T,
      post: async <T>(path: string) => { paths.push(path); return { success: true, data: { updated: true } } as T; },
    });
    await api.setStatus('invite/one', 'disabled');
    await api.setStatus('invite/one', 'active');
    expect(paths).toEqual(['/api/v1/auth/invites/invite%2Fone/disable', '/api/v1/auth/invites/invite%2Fone/enable']);
  });
});

describe('credential api adapter', () => {
  it('keeps account scope in list and uses redacted credential refs', async () => {
    const calls: Array<{ path: string; body?: unknown }> = [];
    const api = createCredentialApi({
      get: async <T>(path: string) => { calls.push({ path }); return { success: true, data: { accountId: 'acct-1', items: [{ id: 'cred-1', accountId: 'acct-1', kind: 'api_key', purpose: 'model_client', status: 'active', version: 1, provider: 'openai-compatible', alias: 'primary', fingerprint: 'deadbeef', metadata: {}, createdAt: '2026-09-20T00:00:00.000Z', updatedAt: '2026-09-20T00:00:00.000Z', canReveal: false }] } } as T; },
      post: async <T>(path: string, body?: unknown) => { calls.push({ path, body }); return { success: true, data: { id: 'cred-1', accountId: 'acct-1', kind: 'api_key', purpose: 'model_client', status: 'active', version: 1, provider: 'openai-compatible', alias: 'primary', fingerprint: 'deadbeef', metadata: {}, createdAt: '2026-09-20T00:00:00.000Z', updatedAt: '2026-09-20T00:00:00.000Z', canReveal: false } } as T; },
      patch: async <T>(path: string, body?: unknown) => { calls.push({ path, body }); return { success: true, data: { id: 'cred-1', accountId: 'acct-1', kind: 'api_key', purpose: 'model_client', status: 'active', version: 2, provider: 'openai-compatible', alias: 'primary', fingerprint: 'deadbeef', metadata: {}, createdAt: '2026-09-20T00:00:00.000Z', updatedAt: '2026-09-20T00:00:00.000Z', canReveal: false } } as T; },
    });

    const listed = await api.list('acct-1');
    expect(listed.accountId).toBe('acct-1');
    expect(calls[0].path).toContain('accountId=acct-1');
    expect(listed.items[0].canReveal).toBe(false);

    await api.update({ credentialId: 'cred-1', expectedVersion: 1, alias: 'primary' });
    expect(calls[1].path).toBe('/api/v1/credentials/cred-1');
    expect(calls[1].body).toMatchObject({ expectedVersion: 1, alias: 'primary' });
  });
});
