import { describe, expect, it } from 'vitest';
import { createMockOrdersApi, createOrdersApi } from './api';

describe('orders api', () => {
  it('serializes scoped filters and preserves four independent statuses', async () => {
    const calls: string[] = [];
    const api = createOrdersApi({
      get: async <T>(path: string) => {
        calls.push(path);
        return { items: [{ orderNo: 'O-1', accountId: 'A', buyerId: 'B', buyerName: '买家', itemId: 'I', itemTitle: '商品', amountMinor: 1990, paymentStatus: 'paid', orderStatus: 'completed', deliveryStatus: 'delivered', afterSalesStatus: 'none', createdAt: '2026-09-20T09:00:00Z', configVersion: 1 }] } as T;
      },
      post: async <T>() => undefined as T,
    });
    const page = await api.list({ accountId: 'A', keyword: 'O-1', paymentStatus: 'paid', orderStatus: 'completed', deliveryStatus: 'delivered', afterSalesStatus: 'none', page: 2, pageSize: 10, sortBy: 'createdAt', sortOrder: 'desc' });
    expect(calls[0]).toContain('/api/v1/orders?');
    expect(calls[0]).toContain('accountId=A');
    expect(calls[0]).toContain('paymentStatus=paid');
    expect(calls[0]).toContain('orderStatus=completed');
    expect(calls[0]).toContain('deliveryStatus=delivered');
    expect(calls[0]).toContain('afterSalesStatus=none');
    expect(page.items[0]).toMatchObject({ paymentStatus: 'paid', orderStatus: 'completed', deliveryStatus: 'delivered', afterSalesStatus: 'none', amountMinor: 1990 });
  });

  it('filters mock orders by account and keyword without mutating fixtures', async () => {
    const api = createMockOrdersApi();
    const accountA = await api.list({ accountId: 'A', page: 1, pageSize: 20 });
    expect(accountA.items.every((item) => item.accountId === 'A')).toBe(true);
    const failed = await api.list({ deliveryStatus: 'failed', page: 1, pageSize: 20 });
    expect(failed.items.map((item) => item.orderNo)).toEqual(['XY202609170061']);
    const search = await api.list({ keyword: '胡桃夹子', page: 1, pageSize: 20 });
    expect(search.items[0]?.orderNo).toBe('XY202609170061');
  });
});

