import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { OrderFilters } from './OrderFilters';

describe('OrderFilters', () => {
  it('renders one search input and one business status filter', () => {
    const html = renderToStaticMarkup(createElement(OrderFilters, {
      filters: { keyword: '', paymentStatus: 'all', orderStatus: 'all', deliveryStatus: 'all', afterSalesStatus: 'all' },
      onChange: vi.fn(),
    }));

    expect(html.match(/<select /g)).toHaveLength(1);
    expect(html).toContain('class="ui-select-control orders-status-select"');
    expect(html).toContain('class="ui-select-chevron"');
    expect(html).toContain('placeholder="搜索订单号、买家或商品"');
    expect(html).toContain('>全部</option>');
    expect(html).toContain('>待付款</option>');
    expect(html).toContain('>待发货</option>');
    expect(html).toContain('>待收货</option>');
    expect(html).toContain('>待评价</option>');
    expect(html).toContain('>退款中</option>');
    expect(html).not.toContain('支付状态');
    expect(html).not.toContain('发货状态');
    expect(html).not.toContain('售后状态');
  });
});
