import { describe, expect, it, vi } from 'vitest';
import { createCouponsApi, createMockCouponsApi, type CouponsApiTransport } from './api';

const batchPayload = {
  batchId: 'batch-001',
  accountId: 'account-001',
  label: '资料包',
  purpose: 'text',
  deliveryScope: 'buyer_deliverable',
  status: 'exhausted',
  totalCount: 2,
  availableCount: 0,
  reservedCount: 0,
  consumedCount: 2,
  version: 3,
  updatedAt: '2026-09-19T00:00:00.000Z',
  productBindings: [{ id: 'binding-001', productId: 'product-001', priority: 0, status: 'active' }],
} as const;

describe('coupons api adapter', () => {
  it('normalizes backend ids, binding status and exhausted batches', async () => {
    const get: CouponsApiTransport['get'] = async <T>() => ({ success: true, data: { items: [batchPayload], total: 1, page: 1, pageSize: 20, totalPages: 1 } } as T);
    const api = createCouponsApi({
      get,
      post: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    });

    const page = await api.list({ keyword: '资料', stockAlert: 'exhausted' });
    expect(page.items[0]).toMatchObject({ batchId: 'batch-001', status: 'exhausted', stockAlert: 'exhausted' });
    expect(page.items[0].bindings[0]).toMatchObject({ bindingId: 'binding-001', batchId: 'batch-001', status: 'active' });
  });

  it('creates a batch, imports initial items, then returns hydrated detail', async () => {
    const postMock = vi.fn(async (path: string, body?: unknown) => {
      if (path === '/api/v1/coupons/batches') return { success: true, data: { ...batchPayload, batchId: 'batch-new', status: 'active', totalCount: 0, availableCount: 0, consumedCount: 0 } } as const;
      expect(path).toBe('/api/v1/coupons/batches/batch-new/items/import');
      expect(body).toEqual({ items: ['A-001', 'A-002'] });
      return { success: true, data: { ...batchPayload, batchId: 'batch-new', totalCount: 2, availableCount: 2, consumedCount: 0 } } as const;
    });
    const post = postMock as unknown as CouponsApiTransport['post'];
    const getMock = vi.fn(async () => ({ success: true, data: { ...batchPayload, batchId: 'batch-new', totalCount: 2, availableCount: 2, consumedCount: 0, items: [] } }));
    const get = getMock as unknown as CouponsApiTransport['get'];
    const transport: CouponsApiTransport = { get, post, patch: vi.fn(), delete: vi.fn() };

    const batch = await createCouponsApi(transport).createBatch({ accountId: 'account-001', label: '新批次', purpose: 'text', deliveryScope: 'operator_only', items: ['A-001', 'A-002'] });
    expect(batch.batchId).toBe('batch-new');
    expect(postMock).toHaveBeenCalledTimes(2);
    expect(getMock).toHaveBeenCalledWith('/api/v1/coupons/batches/batch-new');
  });

  it('supports mock filtering and initial inventory without exposing plaintext in summaries', async () => {
    const api = createMockCouponsApi();
    const page = await api.list({ keyword: 'GitHub', stockAlert: 'low_stock' });
    expect(page.items).toHaveLength(1);
    expect(page.items[0].items?.[0].maskedLabel).toBeTruthy();
    expect(page.items[0].items?.[0].maskedLabel).not.toContain('GitHub');
  });

  it('maps card metadata previews and sends purpose filters and updates', async () => {
    const get = vi.fn(async <T>(path: string) => {
      if (path.includes('/batch-001')) return { success: true, data: { ...batchPayload, metadata: { description: '备注', textContent: '正文预览', dockable: true, price: '9.90' }, contentPreview: { text: '正文预览' } } } as T;
      return { success: true, data: { items: [{ ...batchPayload, metadata: { description: '备注' }, contentPreview: { text: '正文预览' } }], total: 1, page: 1, pageSize: 20, totalPages: 1 } } as T;
    });
    const patch = vi.fn(async <T>() => ({ success: true, data: { ...batchPayload, metadata: { description: 'updated' } } } as T));
    const api = createCouponsApi({
      get: get as unknown as CouponsApiTransport['get'],
      post: vi.fn() as unknown as CouponsApiTransport['post'],
      patch: patch as unknown as CouponsApiTransport['patch'],
      delete: vi.fn() as unknown as CouponsApiTransport['delete'],
    });
    const page = await api.list({ purpose: 'text', keyword: '备注', status: 'active', stockAlert: 'normal' });
    expect(get).toHaveBeenCalledWith('/api/v1/coupons/batches?keyword=%E5%A4%87%E6%B3%A8&status=active&stockAlert=normal&purpose=text&page=1&pageSize=20');
    expect(page.items[0].contentPreview?.text).toBe('正文预览');
    await api.updateBatch('batch-001', { status: 'paused', metadata: { description: 'updated' } });
    expect(patch).toHaveBeenCalledWith('/api/v1/coupons/batches/batch-001', { status: 'paused', metadata: { description: 'updated' } }, expect.objectContaining({ headers: expect.objectContaining({ 'Idempotency-Key': expect.any(String) }) }));
  });
});
