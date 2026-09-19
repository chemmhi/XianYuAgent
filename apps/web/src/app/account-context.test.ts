import { describe, expect, it } from 'vitest';
import { chooseInitialAccountId } from './account-context';
import type { AccountVM } from '../features/accounts/types';

function account(id: string, status: AccountVM['status'], connection: AccountVM['connection']['status'] = 'offline'): AccountVM {
  return {
    id,
    platform: 'xianyu',
    sellerRef: id,
    displayName: id,
    status,
    connection: { status: connection },
    enabled: status !== 'disabled',
    aiEnabled: false,
    credentialState: status === 'connected' ? 'configured' : 'unknown',
    version: 1,
    updatedAt: new Date(0).toISOString(),
  };
}

describe('chooseInitialAccountId', () => {
  it('keeps a valid preferred account across page changes', () => {
    expect(chooseInitialAccountId([account('a', 'connected'), account('b', 'connected')], 'b')).toBe('b');
  });

  it('does not silently choose among multiple usable accounts', () => {
    expect(chooseInitialAccountId([account('disabled', 'disabled', 'online'), account('offline', 'disconnected'), account('online', 'pending', 'online')])).toBeUndefined();
  });

  it('returns undefined when no usable account exists', () => {
    expect(chooseInitialAccountId([account('disabled', 'disabled')])).toBeUndefined();
  });
});
