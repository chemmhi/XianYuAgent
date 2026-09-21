import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AccountToolbar } from './AccountToolbar';

describe('AccountToolbar', () => {
  it('exposes both account status and connection status filters', () => {
    const html = renderToStaticMarkup(createElement(AccountToolbar, {
      filters: { page: 1, pageSize: 20, search: '主账号', status: 'all', connectionStatus: 'all' },
      phase: 'success',
      onSearchChange: vi.fn(),
      onStatusChange: vi.fn(),
      onConnectionStatusChange: vi.fn(),
      onRefresh: vi.fn(),
      onAddAccount: vi.fn(),
    }));

    expect(html).toContain('aria-label="账号状态筛选"');
    expect(html).toContain('aria-label="连接状态筛选"');
    expect(html).toContain('全部状态');
    expect(html).toContain('全部连接');
    expect(html).toContain('连接中');
    expect(html).toContain('已过期');
    expect(html).toContain('aria-label="清空搜索"');
  });
});
