import { describe, expect, it } from 'vitest';
import { createProductsApi, createMockProductsApi } from './api';

describe('products canonical API adapter', () => {
  it('maps the shared envelope and sends the frozen filter names', async () => {
    const calls: string[] = [];
    const api = createProductsApi({
      async get<T>(path: string) {
        calls.push(path);
        if (path.endsWith('/product-1')) {
          return { success: true, data: { id: 'product-1', accountId: 'account-1', title: '商品一', status: 'published', configVersion: 2, priceMinor: 3990, createdAt: '2026-09-19T00:00:00.000Z', updatedAt: '2026-09-20T00:00:00.000Z', xianyuUpdatedAt: '2026-09-20T01:00:00.000Z', xianyuListRank: 1, skuCount: 1, assetCount: 2, couponBatches: [{ id: 'batch-1', label: '卡券一' }] } } as T;
        }
          return { success: true, data: { items: [{ id: 'product-1', accountId: 'account-1', title: '商品一', status: 'published', configVersion: 2, priceMinor: 3990, createdAt: '2026-09-19T00:00:00.000Z', updatedAt: '2026-09-20T00:00:00.000Z', xianyuUpdatedAt: '2026-09-20T01:00:00.000Z', xianyuListRank: 1, skuCount: 1, assetCount: 2, couponBatches: [{ id: 'batch-1', label: '卡券一' }] }], total: 1, page: 1, pageSize: 20, totalPages: 1 } } as T;
      },
    });

    const page = await api.list({ accountId: 'account-1', keyword: '商品', status: 'published' });
    const detail = await api.getDetail('product-1');

    expect(calls[0]).toBe('/api/v1/products?keyword=%E5%95%86%E5%93%81&accountId=account-1&status=published&sortBy=xianyuOrder&sortOrder=asc&page=1&pageSize=20');
    expect(calls[1]).toBe('/api/v1/products/product-1');
    expect(page.items[0]).toMatchObject({ id: 'product-1', priceMinor: 3990, configVersion: 2, attributesJson: {}, createdAt: '2026-09-19T00:00:00.000Z', xianyuUpdatedAt: '2026-09-20T01:00:00.000Z', xianyuListRank: 1, couponBatches: [{ id: 'batch-1', label: '卡券一' }] });
    expect(detail.id).toBe('product-1');
  });

  it('sends explicit default date sorting parameters', async () => {
    const calls: string[] = [];
    const api = createProductsApi({ async get<T>(path: string) { calls.push(path); return { success: true, data: { items: [], total: 0, page: 1, pageSize: 20, totalPages: 1 } } as T; } });
    await api.list({ sortBy: 'updatedAt', sortOrder: 'desc' });
    expect(calls[0]).toBe('/api/v1/products?sortBy=updatedAt&sortOrder=desc&page=1&pageSize=20');
  });

  it('defaults list requests to the Xianyu page order when sorting is omitted', async () => {
    const calls: string[] = [];
    const api = createProductsApi({ async get<T>(path: string) { calls.push(path); return { success: true, data: { items: [], total: 0, page: 1, pageSize: 20, totalPages: 1 } } as T; } });

    await api.list();

    expect(calls[0]).toBe('/api/v1/products?sortBy=xianyuOrder&sortOrder=asc&page=1&pageSize=20');
  });

  it('supports account and keyword scoping in the local adapter', async () => {
    const api = createMockProductsApi();
    const result = await api.list({ accountId: 'account-001', keyword: 'GitHub' });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.title).toContain('GitHub');
  });

  it('sorts the local adapter by creation and update timestamps', async () => {
    const api = createMockProductsApi([
      { id: 'older', accountId: 'account-1', title: '旧商品', attributesJson: {}, configVersion: 1, status: 'published', createdAt: '2026-09-18T00:00:00.000Z', updatedAt: '2026-09-20T01:00:00.000Z', xianyuUpdatedAt: '2026-09-20T01:00:00.000Z', skuCount: 0, assetCount: 0 },
      { id: 'newer', accountId: 'account-1', title: '新商品', attributesJson: {}, configVersion: 1, status: 'published', createdAt: '2026-09-19T00:00:00.000Z', updatedAt: '2026-09-20T02:00:00.000Z', xianyuUpdatedAt: '2026-09-20T02:00:00.000Z', skuCount: 0, assetCount: 0 },
    ]);
    expect((await api.list({ sortBy: 'createdAt', sortOrder: 'desc' })).items.map((item) => item.id)).toEqual(['newer', 'older']);
    expect((await api.list({ sortBy: 'updatedAt', sortOrder: 'asc' })).items.map((item) => item.id)).toEqual(['older', 'newer']);
  });

  it('defaults the local adapter to the stored Xianyu page order', async () => {
    const api = createMockProductsApi([
      { id: 'older', accountId: 'account-1', title: '旧商品', attributesJson: {}, configVersion: 1, status: 'published', createdAt: '2026-09-18T00:00:00.000Z', updatedAt: '2026-09-20T01:00:00.000Z', xianyuUpdatedAt: '2026-09-20T01:00:00.000Z', xianyuListRank: 2, skuCount: 0, assetCount: 0 },
      { id: 'newer', accountId: 'account-1', title: '新商品', attributesJson: {}, configVersion: 1, status: 'published', createdAt: '2026-09-19T00:00:00.000Z', updatedAt: '2026-09-20T02:00:00.000Z', xianyuUpdatedAt: '2026-09-20T02:00:00.000Z', xianyuListRank: 1, skuCount: 0, assetCount: 0 },
    ]);

    expect((await api.list()).items.map((item) => item.id)).toEqual(['newer', 'older']);
  });

  it('sorts synced products by Xianyu update time when explicitly requested', async () => {
    const api = createMockProductsApi([
      { id: 'local-newer', accountId: 'account-1', title: '远端旧商品', attributesJson: {}, configVersion: 1, status: 'published', createdAt: '2026-09-18T00:00:00.000Z', updatedAt: '2026-09-22T12:01:00.000Z', xianyuUpdatedAt: '2026-09-20T10:00:00.000Z', skuCount: 0, assetCount: 0 },
      { id: 'remote-newer', accountId: 'account-1', title: '远端新商品', attributesJson: {}, configVersion: 1, status: 'published', createdAt: '2026-09-19T00:00:00.000Z', updatedAt: '2026-09-22T12:00:00.000Z', xianyuUpdatedAt: '2026-09-22T10:00:00.000Z', skuCount: 0, assetCount: 0 },
    ]);

    expect((await api.list({ sortBy: 'updatedAt', sortOrder: 'desc' })).items.map((item) => item.id)).toEqual(['remote-newer', 'local-newer']);
  });

  it('keeps products without Xianyu time after products with remote time', async () => {
    const api = createMockProductsApi([
      { id: 'missing-remote-time', accountId: 'account-1', title: '未获取时间', attributesJson: {}, configVersion: 1, status: 'published', createdAt: '2026-09-18T00:00:00.000Z', updatedAt: '2026-09-22T13:00:00.000Z', skuCount: 0, assetCount: 0 },
      { id: 'remote-time', accountId: 'account-1', title: '已获取时间', attributesJson: {}, configVersion: 1, status: 'published', createdAt: '2026-09-19T00:00:00.000Z', updatedAt: '2026-09-22T12:00:00.000Z', xianyuUpdatedAt: '2026-09-22T10:00:00.000Z', skuCount: 0, assetCount: 0 },
    ]);

    expect((await api.list({ sortBy: 'updatedAt', sortOrder: 'desc' })).items.map((item) => item.id)).toEqual(['remote-time', 'missing-remote-time']);
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

  it('persists a product-scoped knowledge base with account and version headers', async () => {
    let request: { path: string; body?: unknown; headers?: Headers } | undefined;
    const api = createProductsApi({
      async get<T>() { return { success: true, data: { items: [], total: 0, page: 1, pageSize: 20, totalPages: 1 } } as T; },
      async patch<T>(path: string, body?: unknown, init?: RequestInit) {
        request = { path, body, headers: new Headers(init?.headers) };
        return { success: true, data: { id: 'product-1', accountId: 'account-1', title: '商品一', knowledgeBase: '支持数字资料交付。', status: 'published', configVersion: 8, updatedAt: '2026-09-28T00:00:00.000Z' } } as T;
      },
    });

    const product = await api.updateKnowledgeBase('product-1', { accountId: 'account-1', knowledgeBase: '支持数字资料交付。', configVersion: 7, idempotencyKey: 'kb-key' });

    expect(request).toMatchObject({ path: '/api/v1/products/product-1', body: { accountId: 'account-1', knowledgeBase: '支持数字资料交付。' } });
    expect(request?.headers?.get('Idempotency-Key')).toBe('kb-key');
    expect(request?.headers?.get('If-Match-Version')).toBe('7');
    expect(product).toMatchObject({ accountId: 'account-1', knowledgeBase: '支持数字资料交付。', configVersion: 8 });
  });

  it('replays the publish multipart contract and forwards the selected address', async () => {
    let request: { path: string; body?: unknown; headers?: Headers } | undefined;
    const api = createProductsApi({
      async get<T>() { return { success: true, data: { items: [], total: 0, page: 1, pageSize: 20, totalPages: 1 } } as T; },
      async post<T>(path: string, body?: unknown, init?: RequestInit) {
        request = { path, body, headers: new Headers(init?.headers) };
        return { success: true, data: { product: { id: 'local-1', accountId: 'account-1', title: '裙子', status: 'published', configVersion: 1, externalProductRef: '1085806034681' }, itemId: '1085806034681', itemUrl: 'https://www.goofish.com/item?id=1085806034681', category: { catId: 'cat-1', catName: '服饰', channelCatId: 'channel-1' }, postageMode: 'free', imageUrls: ['https://img.example/1.jpg'], replay: { source: 'reference-project', steps: [{ api: 'mtop.idle.pc.idleitem.publish', status: 'succeeded' }] } } } as T;
      },
    });
    const file = new File(['image'], 'dress.png', { type: 'image/png' });
    const result = await api.publishProduct({ accountId: 'account-1', title: '裙子', description: '九成新', priceMinor: 20000, postageMode: 'free', location: '深圳湾公园', attachments: [{ id: 'a1', url: 'blob:a1', name: file.name, mimeType: file.type, size: file.size, file }] }, { idempotencyKey: 'publish-key' });
    expect(request?.path).toBe('/api/v1/products/publish');
    expect(request?.headers?.get('Idempotency-Key')).toBe('publish-key');
    expect(request?.body).toBeInstanceOf(FormData);
    const form = request?.body as FormData;
    expect(form.get('priceMinor')).toBe('20000');
    expect(form.get('postageMode')).toBe('free');
    expect(JSON.parse(String(form.get('location')))).toEqual({ poiName: '深圳湾公园' });
    expect(result.itemId).toBe('1085806034681');
  });

  it('preserves structured official location payloads without adding inventory configuration', async () => {
    let request: { body?: unknown } | undefined;
    const api = createProductsApi({
      async get<T>() { return { success: true, data: { items: [], total: 0, page: 1, pageSize: 20, totalPages: 1 } } as T; },
      async post<T>(_path: string, body?: unknown) {
        request = { body };
        return { success: true, data: { product: { id: 'local-1', accountId: 'account-1', title: '店铺管家', status: 'published', configVersion: 1, externalProductRef: 'item-1' }, itemId: 'item-1', itemUrl: 'https://www.goofish.com/item?id=item-1', category: { catId: 'cat-1', catName: '其他闲置', channelCatId: 'channel-1' }, postageMode: 'free', imageUrls: [], replay: { source: 'reference-project', steps: [] } } } as T;
      },
    });
    const file = new File(['image'], 'one.png', { type: 'image/png' });
    await api.publishProduct({ accountId: 'account-1', title: '店铺管家', description: '闲鱼超级助手', priceMinor: 19900, postageMode: 'free', location: { poiName: '深圳湾公园', poiId: 'B0FFFRDS71', aoiId: 'B0FFFRDS71', addressType: 5, cainiaoDivision: '440305' }, attachments: [{ id: 'a1', url: 'blob:a1', name: file.name, mimeType: file.type, size: file.size, file }] });
    const form = request?.body as FormData;
    expect(JSON.parse(String(form.get('location')))).toEqual({ poiName: '深圳湾公园', poiId: 'B0FFFRDS71', aoiId: 'B0FFFRDS71', addressType: 5, cainiaoDivision: '440305' });
  });

  it('routes description optimization through the configured provider endpoint', async () => {
    const calls: string[] = [];
    const api = createProductsApi({
      async get<T>() { return { success: true, data: { items: [], total: 0, page: 1, pageSize: 20, totalPages: 1 } } as T; },
      async post<T>(path: string) { calls.push(path); return { success: true, data: { description: '优化后的文案', provider: 'configured', model: 'model-x' } } as T; },
    });
    await expect(api.optimizeDescription({ accountId: 'account-1', title: '裙子', description: '九成新' }, { idempotencyKey: 'copy-key' })).resolves.toMatchObject({ description: '优化后的文案', provider: 'configured' });
    expect(calls).toEqual(['/api/v1/products/publish/optimize-description']);
  });

  it('replays the official specification preview multipart contract', async () => {
    let request: { path: string; body?: unknown; headers?: Headers } | undefined;
    const api = createProductsApi({
      async get<T>() { return { success: true, data: { items: [], total: 0, page: 1, pageSize: 20, totalPages: 1 } } as T; },
      async post<T>(path: string, body?: unknown, init?: RequestInit) {
        request = { path, body, headers: new Headers(init?.headers) };
        return { success: true, data: { category: { catId: 'cat-1', catName: '游戏装备', channelCatId: 'channel-1' }, specs: [{ propertyId: '-10000', propertyName: '分类', selected: { text: '游戏装备' }, options: [{ text: '游戏装备' }] }], imageUrls: ['https://img.example/1.jpg'], replay: { source: 'reference-project', steps: [] } } } as T;
      },
    });
    const file = new File(['image'], 'dress.png', { type: 'image/png' });
    const preview = await api.previewProduct({ accountId: 'account-1', title: '游戏资料', description: '新手攻略', attachments: [{ id: 'a1', url: 'blob:a1', name: file.name, mimeType: file.type, size: file.size, file }] }, { idempotencyKey: 'preview-key' });
    expect(request?.path).toBe('/api/v1/products/publish/preview');
    expect(request?.headers?.get('Idempotency-Key')).toBe('preview-key');
    expect(request?.body).toBeInstanceOf(FormData);
    const form = request?.body as FormData;
    expect(form.get('title')).toBe('游戏资料');
    expect(form.get('description')).toBe('新手攻略');
    expect(preview.specs[0]?.propertyName).toBe('分类');
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
