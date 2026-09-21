import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { CouponBatchTable } from './CouponBatchTable';
import type { CouponBatchVM } from '../types';

const batch: CouponBatchVM = {
  batchId: 'batch-001',
  accountId: 'account-001',
  label: '资料包',
  purpose: 'text',
  deliveryScope: 'operator_only',
  status: 'active',
  totalCount: 2,
  availableCount: 2,
  reservedCount: 0,
  consumedCount: 0,
  stockAlert: 'normal',
  version: 1,
  updatedAt: '2026-09-21T00:00:00.000Z',
  bindings: [],
};

describe('CouponBatchTable', () => {
  it('renders server-backed pagination controls and page status', () => {
    const html = renderToStaticMarkup(createElement(CouponBatchTable, {
      batches: [batch],
      selectedIds: new Set<string>(),
      page: 2,
      total: 21,
      totalPages: 3,
      onPageChange: vi.fn(),
      onSelect: vi.fn(),
      onSelectAll: vi.fn(),
      onOpen: vi.fn(),
      onEdit: vi.fn(),
      onCopy: vi.fn(),
      onBind: vi.fn(),
      onToggle: vi.fn(),
      onDelete: vi.fn(),
      onImagePreview: vi.fn(),
    }));

    expect(html).toContain('data-testid="coupons-pagination"');
    expect(html).toContain('共 21 个批次');
    expect(html).toContain('第 2 / 3 页');
    expect(html).toContain('data-testid="coupons-prev-page"');
    expect(html).toContain('data-testid="coupons-next-page"');
    expect(html).toContain('coupons-page-button active');
  });
});
