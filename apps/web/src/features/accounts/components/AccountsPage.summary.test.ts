import { describe, expect, it } from 'vitest';
import { summarize } from './AccountsPage';
import type { AccountVM } from '../types';

const account = (status: AccountVM['status'], connection: AccountVM['connection']['status'] = 'unknown', credentialState: AccountVM['credentialState'] = 'unknown'): AccountVM => ({
  id: `${status}-${connection}`,
  platform: 'xianyu',
  sellerRef: 'seller-1',
  displayName: '测试账号',
  status,
  connection: { status: connection },
  enabled: status !== 'disabled',
  aiEnabled: false,
  credentialState,
  version: 1,
  updatedAt: new Date(0).toISOString(),
});

describe('account health summary', () => {
  it('counts every non-healthy account as needing attention', () => {
    const result = summarize([
      account('connected', 'online', 'configured'),
      account('degraded', 'unknown'),
      account('expired', 'expired'),
      account('disconnected', 'offline'),
      account('pending', 'connecting', 'missing'),
      account('disabled', 'offline'),
    ]);

    expect(result.online).toBe(1);
    expect(result.needsAttention).toBe(4);
  });
});
