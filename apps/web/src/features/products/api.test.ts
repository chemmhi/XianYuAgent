import { describe, expect, it } from 'vitest';
import { createProductsApi, createMockProductsApi } from './api';

describe('products canonical API adapter', () => {
  it('maps the shared envelope and sends the frozen filter names', async () => {
    const calls: string[] = [];
    const api = createProductsApi({
      async get<T>(path: string) {
        calls.push(path);
        if (path.endsWith('/product-1')) {
          return { success: true, data: { id: 'product-1', accountId: 'account-1', title: '商品一', status: 'published', configVersion: 2, priceMinor: 3990, updatedAt: '2026-09-20T00:00:00.000Z', skuCount: 1, assetCount: 2 } } as T;
        }
        return { success: true, data: { items: [{ id: 'product-1', accountId: 'account-1', title: '商品一', status: 'published', configVersion: 2, priceMinor: 3990, updatedAt: '2026-09-20T00:00:00.000Z', skuCount: 1, assetCount: 2 }], total: 1, page: 1, pageSize: 20, totalPages: 1 } } as T;
      },
    });

    const page = await api.list({ accountId: 'account-1', keyword: '商品', status: 'published' });
    const detail = await api.getDetail('product-1');

    expect(calls[0]).toBe('/api/v1/products?keyword=%E5%95%86%E5%93%81&accountId=account-1&status=published&page=1&pageSize=20');
    expect(calls[1]).toBe('/api/v1/products/product-1');
    expect(page.items[0]).toMatchObject({ id: 'product-1', priceMinor: 3990, configVersion: 2, attributesJson: {} });
    expect(detail.id).toBe('product-1');
  });

  it('supports account and keyword scoping in the local adapter', async () => {
    const api = createMockProductsApi();
    const result = await api.list({ accountId: 'account-001', keyword: 'GitHub' });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.title).toContain('GitHub');
  });

  it('sends canonical create and patch headers for draft writes', async () => {
    const calls: Array<{ method: string; path: string; body?: unknown; headers?: Headers }> = [];
    const api = createProductsApi({
      async get<T>() { return { success: true, data: { items: [], total: 0, page: 1, pageSize: 20, totalPages: 1 } } as T; },
      async post<T>(path: string, body?: unknown, init?: RequestInit) { calls.push({ method: 'POST', path, body, headers: new Headers(init?.headers) }); return { success: true, data: { id: 'product-1', accountId: 'account-1', title: '草稿', status: 'draft', configVersion: 1, updatedAt: '2026-09-20T00:00:00.000Z' } } as T; },
      async patch<T>(path: string, body?: unknown, init?: RequestInit) { calls.push({ method: 'PATCH', path, body, headers: new Headers(init?.headers) }); return { success: true, data: { id: 'product-1', accountId: 'account-1', title: '草稿2', status: 'draft', configVersion: 2, updatedAt: '2026-09-20T00:00:00.000Z' } } as T; },
    });

    await api.createDraft({ accountId: 'account-1', title: '草稿', priceMinor: 1990 }, { idempotencyKey: 'create-key' });
    await api.updateDraft('product-1', { title: '草稿2' }, { configVersion: 1, idempotencyKey: 'update-key' });
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/api/v1/products' });
    expect(calls[0]?.headers?.get('Idempotency-Key')).toBe('create-key');
    expect(calls[1]).toMatchObject({ method: 'PATCH', path: '/api/v1/products/product-1' });
    expect(calls[1]?.headers?.get('Idempotency-Key')).toBe('update-key');
    expect(calls[1]?.headers?.get('If-Match-Version')).toBe('1');
  });
});
