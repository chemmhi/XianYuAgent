import { describe, expect, it } from 'vitest';
import { createMockOrdersApi, createOrdersApi } from './api';

describe('orders api', () => {
  it('serializes scoped filters and preserves four independent statuses', async () => {
    const calls: string[] = [];
    const api = createOrdersApi({
      get: async <T>(path: string) => {
        calls.push(path);
        return { items: [{ orderNo: 'O-1', accountId: 'A', buyerId: 'B', buyerNickname: '买家昵称', buyerName: '买家姓名', itemId: 'I', itemTitle: '商品标题', itemImageUrl: 'https://img.example/product.png', amountMinor: 1990, paymentStatus: 'paid', orderStatus: 'completed', deliveryStatus: 'delivered', afterSalesStatus: 'none', createdAt: '2026-09-20T09:00:00Z', configVersion: 1 }] } as T;
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
    expect(page.items[0]).toMatchObject({ paymentStatus: 'paid', orderStatus: 'completed', deliveryStatus: 'delivered', afterSalesStatus: 'none', amountMinor: 1990, buyerNickname: '买家昵称', buyerName: '买家姓名', itemTitle: '商品标题', itemImageUrl: 'https://img.example/product.png' });
  });

  it('does not expose an item id as the product title when the backend has no title', async () => {
    const api = createOrdersApi({
      get: async <T>() => ({ items: [{ orderNo: 'O-2', accountId: 'A', buyerId: 'B', buyerName: '买家', itemId: 'ITEM-2', amountMinor: 100, paymentStatus: 'paid', orderStatus: 'open', deliveryStatus: 'pending', afterSalesStatus: 'none', createdAt: '2026-09-20T09:00:00Z', configVersion: 1 }] } as T),
      post: async <T>() => undefined as T,
    });
    const page = await api.list({ accountId: 'A', page: 1, pageSize: 20 });
    expect(page.items[0]?.itemTitle).toBe('');
  });

  it('maps aliased and nested product titles while still hiding ids', async () => {
    const api = createOrdersApi({
      get: async <T>() => ({ items: [
        { orderNo: 'O-3', accountId: 'A', buyerId: 'B', itemId: 'ITEM-3', display_item_title: '会话聚合商品', amountMinor: 100, paymentStatus: 'paid', orderStatus: 'open', deliveryStatus: 'pending', afterSalesStatus: 'none', createdAt: '2026-09-20T09:00:00Z', configVersion: 1 },
        { orderNo: 'O-4', accountId: 'A', buyerId: 'B', itemId: 'ITEM-4', product: { title: '嵌套商品标题' }, amountMinor: 100, paymentStatus: 'paid', orderStatus: 'open', deliveryStatus: 'pending', afterSalesStatus: 'none', createdAt: '2026-09-20T09:00:00Z', configVersion: 1 },
        { orderNo: 'O-5', accountId: 'A', buyerId: 'B', itemId: 'ITEM-5', productName: 'ITEM-5', amountMinor: 100, paymentStatus: 'paid', orderStatus: 'open', deliveryStatus: 'pending', afterSalesStatus: 'none', createdAt: '2026-09-20T09:00:00Z', configVersion: 1 },
      ] } as T),
      post: async <T>() => undefined as T,
    });
    const page = await api.list({ accountId: 'A', page: 1, pageSize: 20 });
    expect(page.items.map((item) => item.itemTitle)).toEqual(['会话聚合商品', '嵌套商品标题', '']);
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

  it('does not search mock orders by buyer id or item id', async () => {
    const api = createMockOrdersApi();
    expect((await api.list({ keyword: 'buyer_712633', page: 1, pageSize: 20 })).total).toBe(0);
    expect((await api.list({ keyword: 'ITEM-93688', page: 1, pageSize: 20 })).total).toBe(0);
  });

  it('sends an idempotency key for Xianyu refresh mutations', async () => {
    const calls: Array<{ path: string; body: unknown; init?: RequestInit }> = [];
    const api = createOrdersApi({
      get: async <T>() => ({ items: [] } as T),
      post: async <T>(path: string, body?: unknown, init?: RequestInit) => { calls.push({ path, body, init }); return undefined as T; },
    });
    await api.refresh('ACCOUNT-A');
    expect(calls[0]?.path).toBe('/api/v1/orders/refresh');
    expect(calls[0]?.body).toEqual({ accountId: 'ACCOUNT-A' });
    expect((calls[0]?.init?.headers as Record<string, string>)['Idempotency-Key']).toMatch(/^order-refresh-ACCOUNT-A-/);
  });
});
