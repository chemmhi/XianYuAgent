import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ProductToolbar } from './ProductToolbar';

describe('ProductToolbar', () => {
  it('does not render the redundant total-count item', () => {
    const html = renderToStaticMarkup(createElement(ProductToolbar, {
      contextLoading: false,
      contextError: null,
      contextMissing: false,
      filters: { page: 1, pageSize: 20, accountId: 'account-1', keyword: '商品', status: 'all' },
      phase: 'empty',
      syncing: false,
      onKeywordChange: vi.fn(),
      onStatusChange: vi.fn(),
      onRefresh: vi.fn(),
      onSync: vi.fn(),
      onCreate: vi.fn(),
      onChooseAccount: vi.fn(),
    }));

    expect(html).not.toContain('products-total');
    expect(html).not.toContain('共 0 件');
    expect(html).toContain('刷新');
    expect(html).not.toContain('刷新本地');
    expect(html).toContain('aria-label="清空搜索"');
  });
});
