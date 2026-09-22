import { describe, expect, it } from 'vitest';
import { createProductsApi, createMockProductsApi } from './api';

describe('products canonical API adapter', () => {
  it('maps the shared envelope and sends the frozen filter names', async () => {
    const calls: string[] = [];
    const api = createProductsApi({
      async get<T>(path: string) {
        calls.push(path);
        if (path.endsWith('/product-1')) {
          return { success: true, data: { id: 'product-1', accountId: 'account-1', title: '商品一', status: 'published', configVersion: 2, priceMinor: 3990, createdAt: '2026-09-19T00:00:00.000Z', updatedAt: '2026-09-20T00:00:00.000Z', skuCount: 1, assetCount: 2, couponBatches: [{ id: 'batch-1', label: '卡券一' }] } } as T;
        }
          return { success: true, data: { items: [{ id: 'product-1', accountId: 'account-1', title: '商品一', status: 'published', configVersion: 2, priceMinor: 3990, createdAt: '2026-09-19T00:00:00.000Z', updatedAt: '2026-09-20T00:00:00.000Z', skuCount: 1, assetCount: 2, couponBatches: [{ id: 'batch-1', label: '卡券一' }] }], total: 1, page: 1, pageSize: 20, totalPages: 1 } } as T;
      },
    });

    const page = await api.list({ accountId: 'account-1', keyword: '商品', status: 'published' });
    const detail = await api.getDetail('product-1');

    expect(calls[0]).toBe('/api/v1/products?keyword=%E5%95%86%E5%93%81&accountId=account-1&status=published&page=1&pageSize=20');
    expect(calls[1]).toBe('/api/v1/products/product-1');
    expect(page.items[0]).toMatchObject({ id: 'product-1', priceMinor: 3990, configVersion: 2, attributesJson: {}, createdAt: '2026-09-19T00:00:00.000Z', couponBatches: [{ id: 'batch-1', label: '卡券一' }] });
    expect(detail.id).toBe('product-1');
  });

  it('sends explicit default date sorting parameters', async () => {
    const calls: string[] = [];
    const api = createProductsApi({ async get<T>(path: string) { calls.push(path); return { success: true, data: { items: [], total: 0, page: 1, pageSize: 20, totalPages: 1 } } as T; } });
    await api.list({ sortBy: 'updatedAt', sortOrder: 'desc' });
    expect(calls[0]).toBe('/api/v1/products?sortBy=updatedAt&sortOrder=desc&page=1&pageSize=20');
  });

  it('supports account and keyword scoping in the local adapter', async () => {
    const api = createMockProductsApi();
    const result = await api.list({ accountId: 'account-001', keyword: 'GitHub' });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.title).toContain('GitHub');
  });

  it('sorts the local adapter by creation and update timestamps', async () => {
    const api = createMockProductsApi([
      { id: 'older', accountId: 'account-1', title: '旧商品', attributesJson: {}, configVersion: 1, status: 'published', createdAt: '2026-09-18T00:00:00.000Z', updatedAt: '2026-09-20T01:00:00.000Z', skuCount: 0, assetCount: 0 },
      { id: 'newer', accountId: 'account-1', title: '新商品', attributesJson: {}, configVersion: 1, status: 'published', createdAt: '2026-09-19T00:00:00.000Z', updatedAt: '2026-09-20T02:00:00.000Z', skuCount: 0, assetCount: 0 },
    ]);
    expect((await api.list({ sortBy: 'createdAt', sortOrder: 'desc' })).items.map((item) => item.id)).toEqual(['newer', 'older']);
    expect((await api.list({ sortBy: 'updatedAt', sortOrder: 'asc' })).items.map((item) => item.id)).toEqual(['older', 'newer']);
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

  it('reads and persists Xianyu detail through the dedicated route', async () => {
    const calls: Array<{ method: string; path: string; body?: unknown; headers?: Headers }> = [];
    const api = createProductsApi({
      async get<T>(path: string) {
        calls.push({ method: 'GET', path });
        return { success: true, data: { productId: 'product-1', itemId: '1078553391460', title: 'PPT Master', priceText: '8.50', browseCount: 315, wantCount: 33, images: [{ storageKey: 'products/1/hero.jpg', url: 'https://cdn.example/hero.jpg', width: 640, height: 640 }], seller: { nickname: '陈陈cc' } } } as T;
      },
      async post<T>(path: string, body?: unknown, init?: RequestInit) {
        calls.push({ method: 'POST', path, body, headers: new Headers(init?.headers) });
        return { success: true, data: { productId: 'product-1', itemId: '1078553391460', title: 'PPT Master', images: ['https://cdn.example/hero.jpg'] } } as T;
      },
    });

    const persisted = await api.syncXianyuDetail('product-1');
    const read = await api.getXianyuDetail('product-1');

    expect(calls[0]).toMatchObject({ method: 'POST', path: '/api/v1/products/product-1/detail/refresh' });
    expect(calls[0]?.headers?.get('Idempotency-Key')).toMatch(/^product-detail-/);
    expect(calls[1]).toMatchObject({ method: 'GET', path: '/api/v1/products/product-1/detail' });
    expect(persisted).toMatchObject({ productId: 'product-1', itemId: '1078553391460', title: 'PPT Master', images: [{ url: 'https://cdn.example/hero.jpg' }] });
    expect(read).toMatchObject({ browseCount: 315, wantCount: 33, images: [{ storageKey: 'products/1/hero.jpg', width: 640, height: 640 }], seller: { nickname: '陈陈cc' } });
  });

  it('rehydrates persisted summary and object-storage assets from a nested product payload', async () => {
    const api = createProductsApi({
      async get<T>() {
        return { success: true, data: { product: { id: 'product-2', title: '已保存商品', attributesJson: { xianyu: { imageUrls: ['https://cdn.example/fallback.jpg'], detail: { itemId: 'item-2', summary: { browseCount: 18, wantCount: 2 }, syncedAt: '2026-09-22T02:00:00.000Z' } } } }, assets: [{ storageKey: 'products/2/hero.webp', sourceUrl: 'https://cdn.example/hero.webp', mimeType: 'image/webp', metadata: { width: 800, height: 600 } }] } } as T;
      },
    });
    const detail = await api.getXianyuDetail('product-2');
    expect(detail).toMatchObject({ productId: 'product-2', itemId: 'item-2', title: '已保存商品', browseCount: 18, wantCount: 2, detailSyncedAt: '2026-09-22T02:00:00.000Z', images: [{ storageKey: 'products/2/hero.webp', url: 'https://cdn.example/hero.webp', width: 800, height: 600 }] });
  });
});
