import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { OrderSyncToolbar } from './OrderSyncToolbar';

const baseProps = {
  contextLoading: false,
  contextMissing: false,
  loading: false,
  syncing: false,
  filters: { page: 1, pageSize: 20, accountId: 'account-1', paymentStatus: 'all', orderStatus: 'all', deliveryStatus: 'all', afterSalesStatus: 'all' } as const,
  onFilterChange: vi.fn(),
  onRefresh: vi.fn(),
  onSync: vi.fn(),
};

describe('OrderSyncToolbar', () => {
  it('uses the concise refresh and sync labels', () => {
    const html = renderToStaticMarkup(createElement(OrderSyncToolbar, baseProps));
    expect(html).toContain('>刷新<');
    expect(html).toContain('>同步闲鱼<');
    expect(html).not.toContain('刷新本地');
    expect(html).not.toContain('刷新闲鱼订单');
  });

  it('shows a stable syncing label while disabling both actions', () => {
    const html = renderToStaticMarkup(createElement(OrderSyncToolbar, { ...baseProps, syncing: true }));
    expect(html).toContain('>同步中…<');
    expect(html).toContain('data-testid="refresh-orders" disabled');
    expect(html).toContain('data-testid="sync-orders" disabled');
  });
});
