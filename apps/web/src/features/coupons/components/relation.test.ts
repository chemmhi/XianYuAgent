import { describe, expect, it, vi } from 'vitest';
import type { CouponBatchVM } from '../types';
import { saveCouponRelation } from './relation';

const detail: CouponBatchVM = {
  batchId: 'batch-1',
  accountId: 'account-1',
  label: '测试卡券',
  purpose: 'text',
  deliveryScope: 'operator_only',
  status: 'active',
  totalCount: 1,
  availableCount: 1,
  reservedCount: 0,
  consumedCount: 0,
  stockAlert: 'normal',
  version: 2,
  updatedAt: '2026-09-23T00:00:00.000Z',
  bindings: [{ bindingId: 'binding-1', batchId: 'batch-1', productId: 'product-1', priority: 0, status: 'active' }],
};

describe('saveCouponRelation', () => {
  it('closes only after binding changes and hydrated detail succeed', async () => {
    const calls: string[] = [];
    const onSaved = vi.fn(() => calls.push('close'));
    const result = await saveCouponRelation('batch-1', ['product-1', 'product-2'], ['product-1'], {
      bindBatch: async (batchId, productId, options) => { calls.push(`bind:${batchId}:${productId}:${String(options?.reload)}`); },
      unbindBatch: async (batchId, productId, options) => { calls.push(`unbind:${batchId}:${productId}:${String(options?.reload)}`); },
      getDetail: async (batchId) => { calls.push(`detail:${batchId}`); return detail; },
    }, onSaved);

    expect(result).toBe(detail);
    expect(calls).toEqual(['bind:batch-1:product-2:false', 'detail:batch-1', 'close']);
    expect(onSaved).toHaveBeenCalledWith(detail);
  });

  it('suppresses list reloads for every binding change', async () => {
    const reloads: boolean[] = [];

    await saveCouponRelation('batch-1', ['product-2', 'product-3'], ['product-1'], {
      bindBatch: async (_batchId, _productId, options) => { reloads.push(options?.reload !== false); },
      unbindBatch: async (_batchId, _productId, options) => { reloads.push(options?.reload !== false); },
      getDetail: async () => detail,
    }, vi.fn());

    expect(reloads).toEqual([false, false, false]);
  });

  it('does not signal close when a binding write fails', async () => {
    const onSaved = vi.fn();
    const getDetail = vi.fn(async () => detail);

    await expect(saveCouponRelation('batch-1', [], ['product-1'], {
      bindBatch: vi.fn(),
      unbindBatch: async () => { throw new Error('write failed'); },
      getDetail,
    }, onSaved)).rejects.toThrow('write failed');

    expect(getDetail).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });
});
