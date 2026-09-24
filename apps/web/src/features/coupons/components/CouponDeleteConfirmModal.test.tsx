import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CouponBatchVM } from '../types';
import { CouponDeleteConfirmModal } from './CouponDeleteConfirmModal';

const batch = (overrides: Partial<CouponBatchVM> = {}): CouponBatchVM => ({
  batchId: '1', accountId: 'account-1', label: '测试卡券', purpose: 'text', status: 'active', version: 1,
  updatedAt: new Date(0).toISOString(), bindings: [], ...overrides,
});

describe('CouponDeleteConfirmModal', () => {
  it('warns when the coupon is linked to products', () => {
    const html = renderToStaticMarkup(createElement(CouponDeleteConfirmModal, {
      batches: [batch({ bindings: [{ bindingId: 'binding-1', batchId: '1', productId: 'product-1', productTitle: '商品一', priority: 0, status: 'active' }] })],
      onClose: vi.fn(), onConfirm: vi.fn(),
    }));

    expect(html).toContain('role="dialog"');
    expect(html).toContain('coupons-modal card coupon-delete-modal');
    expect(html).toContain('coupons-modal-footer');
    expect(html).toContain('已有卡券关联商品');
    expect(html).toContain('商品列表和商品自动化配置中将不再显示这些卡券');
    expect(html).toContain('data-testid="coupon-delete-confirm"');
  });

  it('supports cancelling and confirming an unbound coupon', () => {
    const html = renderToStaticMarkup(createElement(CouponDeleteConfirmModal, { batches: [batch()], onClose: vi.fn(), onConfirm: vi.fn() }));
    expect(html).toContain('删除后不可在卡券列表继续使用');
    expect(html).toContain('data-testid="coupon-delete-cancel"');
  });
});
