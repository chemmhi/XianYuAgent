import { describe, expect, it } from 'vitest';
import { loggedOutState } from './controller';

describe('auth controller logout state', () => {
  it('clears the authenticated shell after a successful revoke', () => {
    expect(loggedOutState()).toEqual({
      phase: 'login-required',
      session: { authenticated: false, bootstrapRequired: false },
      admin: null,
      error: null,
      busy: false,
    });
  });

  it('keeps the local shell cleared and surfaces revoke failures', () => {
    expect(loggedOutState(new Error('logout failed'))).toEqual({
      phase: 'login-required',
      session: { authenticated: false, bootstrapRequired: false },
      admin: null,
      error: 'logout failed',
      busy: false,
    });
  });
});
