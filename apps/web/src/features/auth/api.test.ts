import { describe, expect, it, vi } from 'vitest';
import { createAuthApi } from './api';

describe('auth api', () => {
  it('reads the canonical session envelope', async () => {
    const get = vi.fn().mockResolvedValue({ success: true, data: { authenticated: false, bootstrapRequired: false } });
    const api = createAuthApi({ get });
    await expect(api.getSession()).resolves.toEqual({ authenticated: false, bootstrapRequired: false });
    expect(get).toHaveBeenCalledWith('/api/v1/auth/session');
  });

  it('sends login and bootstrap through canonical endpoints', async () => {
    const post = vi.fn()
      .mockResolvedValueOnce({ success: true, data: { authenticated: true, bootstrapRequired: false } })
      .mockResolvedValueOnce({ success: true, data: { authenticated: true, bootstrapRequired: false } });
    const api = createAuthApi({ get: vi.fn(), post });
    await api.login({ email: 'admin@example.com', password: 'password-123' });
    await api.bootstrap({ email: 'first@example.com', password: 'password-123', displayName: 'First Admin' });
    expect(post).toHaveBeenNthCalledWith(1, '/api/v1/auth/password-login', { email: 'admin@example.com', password: 'password-123' });
    expect(post).toHaveBeenNthCalledWith(2, '/api/v1/auth/bootstrap', { email: 'first@example.com', password: 'password-123', displayName: 'First Admin' }, expect.objectContaining({ headers: expect.objectContaining({ 'Idempotency-Key': expect.stringContaining('auth-bootstrap-') }) }));
  });

  it('surfaces canonical auth errors instead of treating them as success', async () => {
    const post = vi.fn().mockResolvedValue({ success: false, data: null, message: 'session required', error: { code: 'UNAUTHENTICATED' } });
    const api = createAuthApi({ get: vi.fn(), post });
    await expect(api.login({ email: 'admin@example.com', password: 'wrong' })).rejects.toThrow('session required');
  });
});
