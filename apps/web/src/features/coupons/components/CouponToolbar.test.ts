import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { CouponToolbar } from './CouponToolbar';

describe('CouponToolbar', () => {
  it('renders the compact list actions without redundant search buttons', () => {
    const html = renderToStaticMarkup(createElement(CouponToolbar, {
      filters: { page: 1, pageSize: 20, keyword: '', purpose: 'all', status: 'all', stockAlert: 'all' },
      phase: 'success',
      onKeywordChange: vi.fn(),
      onPurposeChange: vi.fn(),
      onStatusChange: vi.fn(),
      onStockAlertChange: vi.fn(),
      onCreate: vi.fn(),
      onRefresh: vi.fn(),
    }));

    expect(html).toContain('搜索卡券名称或描述');
    expect(html).toContain('卡券类型');
    expect(html).toContain('卡券状态');
    expect(html).toContain('库存预警');
    expect(html).toContain('全部状态');
    expect(html).toContain('全部库存');
    expect(html).toContain('刷新');
    expect(html).toContain('新建卡券');
    expect(html.indexOf('刷新')).toBeLessThan(html.indexOf('新建卡券'));
    expect(html).not.toContain('coupons-total');
    expect(html).not.toContain('共 2 张');
    expect(html).not.toContain('查询');
    expect(html).not.toContain('重置筛选');
  });
});
