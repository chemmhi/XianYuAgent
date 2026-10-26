import { expect, it } from 'vitest';
import { createVerificationApi, type VerificationTransport } from './api';
import { session } from './test-fixtures';
it('uses manual_only for user retry and unique idempotency keys for each explicit action', async () => {
  const calls: Array<{ path: string; body: unknown; init?: RequestInit }> = [];
  const api = createVerificationApi({ get: async () => ({ success: true, data: { sessions: [], serverTime: 100 } }),
    post: async (path, body, init) => { calls.push({ path, body, init }); return { success: true, data: { session: session() } }; } } as VerificationTransport);
  await api.retry({ accountId: 'account' });
  await api.command('session', 'claim', { clientInstanceId: 'client', connectionId: 'actual-stream', expectedVersion: 1, frameId: 'displayed-frame', action: 'claim' });
  expect(calls[0].body).toEqual({ accountId: 'account', mode: 'manual_only' });
  expect(calls[1].body).toMatchObject({ connectionId: 'actual-stream', frameId: 'displayed-frame', expectedVersion: 1 });
  const keys = calls.map(call => new Headers(call.init?.headers).get('Idempotency-Key'));
  expect(keys.every(Boolean)).toBe(true); expect(new Set(keys).size).toBe(2);
});
it('unwraps the existing API envelope and does not invent success for rejected requests', async () => {
  const api = createVerificationApi({ get: async () => ({ success: true, data: { session: session() } }), post: async () => ({ success: false, message: '控制权已变化', data: null }) } as VerificationTransport);
  expect((await api.get('session')).id).toBe('session');
  await expect(api.command('session', 'claim', {})).rejects.toThrow('控制权已变化');
});
