import { describe, expect, it } from 'vitest';
import type { AccountVM } from '../accounts/types';
import { chooseProductAccountId } from './account-scope';

function account(id: string, status: AccountVM['status'], connection: AccountVM['connection']['status'] = 'unknown'): AccountVM {
  return { id, platform: 'xianyu', sellerRef: id, displayName: id, status, connection: { status: connection }, enabled: status !== 'disabled', aiEnabled: false, credentialState: 'unknown', version: 1, updatedAt: '2026-09-20T00:00:00.000Z' };
}

describe('product account scope selection', () => {
  it('preserves a valid requested account', () => {
    expect(chooseProductAccountId([account('pending', 'pending'), account('connected', 'connected', 'online')], 'pending')).toBe('pending');
  });

  it('auto-selects the only available account when no request exists', () => {
    expect(chooseProductAccountId([account('connected', 'connected', 'online')])).toBe('connected');
  });

  it('requires explicit selection when multiple accounts are available', () => {
    expect(chooseProductAccountId([account('first', 'connected', 'online'), account('second', 'connected', 'online')])).toBeUndefined();
  });

  it('does not select disabled accounts', () => {
    expect(chooseProductAccountId([account('disabled', 'disabled'), account('pending', 'pending')])).toBe('pending');
    expect(chooseProductAccountId([account('disabled', 'disabled'), account('pending', 'pending'), account('connected', 'connected', 'online')])).toBeUndefined();
    expect(chooseProductAccountId([account('disabled', 'disabled')])).toBeUndefined();
  });
});
