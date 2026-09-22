import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AccountVM } from '../types';
import { AccountDeleteModal } from './AccountDeleteModal';

const account: AccountVM = {
  id: 'account-1',
  platform: 'xianyu',
  sellerRef: 'seller-123456789',
  displayName: '青鱼旗舰店',
  status: 'connected',
  connection: { status: 'online' },
  enabled: true,
  aiEnabled: true,
  credentialState: 'configured',
  version: 1,
  updatedAt: new Date(0).toISOString(),
};

describe('AccountDeleteModal', () => {
  it('renders the product confirmation copy and account summary', () => {
    const html = renderToStaticMarkup(createElement(AccountDeleteModal, {
      account,
      onClose: vi.fn(),
      onConfirm: vi.fn(),
    }));

    expect(html).toContain('role="dialog"');
    expect(html).toContain('删除后会撤销登录凭证');
    expect(html).toContain('历史商品记录会保留');
    expect(html).toContain('青鱼旗舰店');
    expect(html).toContain('账号 ID：sell••••6789 · 当前在线');
    expect(html).toContain('data-testid="account-delete-cancel"');
    expect(html).toContain('data-testid="account-delete-confirm"');
  });

  it('disables all dismissal and confirmation controls while deleting', () => {
    const html = renderToStaticMarkup(createElement(AccountDeleteModal, {
      account,
      submitting: true,
      onClose: vi.fn(),
      onConfirm: vi.fn(),
    }));

    expect(html).toContain('aria-label="关闭删除账号弹窗" disabled');
    expect(html).toContain('data-testid="account-delete-cancel" disabled');
    expect(html).toContain('data-testid="account-delete-confirm" disabled="">删除中…</button>');
  });

  it('surfaces a delete failure without leaving the product modal', () => {
    const html = renderToStaticMarkup(createElement(AccountDeleteModal, {
      account,
      error: '账号删除失败，请稍后重试',
      onClose: vi.fn(),
      onConfirm: vi.fn(),
    }));

    expect(html).toContain('role="alert"');
    expect(html).toContain('账号删除失败，请稍后重试');
  });
});
