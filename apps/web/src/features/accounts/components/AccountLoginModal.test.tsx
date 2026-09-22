import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AccountsApi } from '../api';
import type { AccountVM } from '../types';
import { AccountLoginModal } from './AccountLoginModal';

const account: AccountVM = {
  id: 'account-1',
  platform: 'xianyu',
  sellerRef: 'seller-1',
  displayName: '测试账号',
  status: 'connected',
  connection: { status: 'online' },
  enabled: true,
  aiEnabled: false,
  credentialState: 'refresh_required',
  version: 1,
  updatedAt: new Date(0).toISOString(),
};

describe('AccountLoginModal', () => {
  it('can open reauthorization directly on manual Cookie entry', () => {
    const html = renderToStaticMarkup(createElement(AccountLoginModal, {
      api: {} as AccountsApi,
      account,
      initialMethod: 'cookie',
      onClose: vi.fn(),
      onCompleted: vi.fn(),
    }));

    expect(html).toContain('data-login-method="cookie" class="account-login-method active"');
    expect(html).toContain('验证 Cookie 并更新账号');
    expect(html).not.toContain('data-login-method="qr" class="account-login-method active"');
  });
});
