import { createElement } from 'react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ProductsApi } from '../../products/api';
import type { CouponBatchVM } from '../types';
import { CouponRelationModal, CouponRelationProductLabel } from './CouponRelationModal';

const batch: CouponBatchVM = {
  batchId: '4', accountId: 'account-001', label: '测试卡券', purpose: 'text', deliveryScope: 'operator_only', status: 'draft', totalCount: 0,
  availableCount: 0, reservedCount: 0, consumedCount: 0, version: 1, updatedAt: '2026-09-20T00:00:00.000Z', bindings: [], metadata: {}, stockAlert: 'exhausted',
};

describe('CouponRelationModal', () => {
  it('keeps loading and empty guidance inside full-area state wrappers', () => {
    const html = renderToStaticMarkup(createElement(CouponRelationModal, {
      batch,
      productsApi: {} as ProductsApi,
      submitting: false,
      onClose: vi.fn(),
      onSave: vi.fn(async () => {}),
    }));

    expect((html.match(/coupons-relation-state/g) ?? []).length).toBe(2);
    expect(html).toContain('加载中…');
    expect(html).toContain('请在左侧选择商品');
  });

  it('renders the product title without exposing the product id', () => {
    const html = renderToStaticMarkup(createElement(CouponRelationProductLabel, { title: 'PPT Master pptmaster' }));

    expect(html).toContain('PPT Master pptmaster');
    expect(html).not.toContain('<small');
    expect(html).not.toContain('1078553391460');
  });

  it('keeps the relation panel bounded and scrollable in CSS', () => {
    const css = readFileSync(fileURLToPath(new URL('./coupons.css', import.meta.url)), 'utf8');

    expect(css).toContain('height: min(680px, calc(100vh - 48px));');
    expect(css).toContain('.coupons-relation-state { min-height: 100%; display: grid; place-items: center;');
    expect(css).toContain('.coupons-relation-scroll { min-height: 0; overflow-y: auto;');
  });
});
