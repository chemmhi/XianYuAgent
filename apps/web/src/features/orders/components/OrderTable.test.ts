import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { OrderTable } from './OrderTable';
import type { OrderVM } from '../types';

const order: OrderVM = {
  orderNo: 'O-1', accountId: 'A', buyerId: 'buyer-1', buyerName: '买家姓名', itemId: 'I-1', itemTitle: '测试商品', amountMinor: 1990,
  paymentStatus: 'paid', orderStatus: 'open', deliveryStatus: 'delivered', afterSalesStatus: 'none', deliveryType: 'manual', createdAt: '2026-09-20T09:00:00Z', configVersion: 1,
};

describe('OrderTable', () => {
  it('renders the requested columns while keeping the detail action', () => {
    const html = renderToStaticMarkup(createElement(OrderTable, { orders: [order], page: 1, totalPages: 1, total: 1, onPageChange: vi.fn(), onOpen: vi.fn() }));
    expect(html).toContain('订单号');
    expect(html).toContain('买家昵称');
    expect(html).toContain('商品名称');
    expect(html).toContain('金额');
    expect(html).toContain('下单时间');
    expect(html).toContain('当前状态');
    expect(html).toContain('操作');
    expect(html).toContain('查看详情');
    expect(html).toContain('title="买家姓名：买家姓名"');
    expect(html).toContain('待收货');
    expect(html).not.toContain('支付状态');
    expect(html).not.toContain('发货状态');
    expect(html).not.toContain('售后');
    expect(html).not.toContain('账号');
  });
});
