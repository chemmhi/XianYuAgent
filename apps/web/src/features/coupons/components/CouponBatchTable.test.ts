import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { CouponBatchTable } from './CouponBatchTable';
import type { CouponBatchVM } from '../types';

const batch: CouponBatchVM = {
  batchId: '1',
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
  metadata: { description: '备注内容', multiSpec: true, specName: '版本', specValue: '标准版' },
};

describe('CouponBatchTable', () => {
  it('renders server-backed pagination controls and page status', () => {
    const html = renderToStaticMarkup(createElement(CouponBatchTable, {
      batches: [batch],
      selectedIds: new Set<string>(),
      page: 2,
      pageSize: 20,
      total: 21,
      totalPages: 3,
      sortBy: 'createdAt',
      sortOrder: 'desc',
      onSortChange: vi.fn(),
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

  it('renders the exposed sequence ID and separates the remark column from the name', () => {
    const html = renderToStaticMarkup(createElement(CouponBatchTable, {
      batches: [batch],
      selectedIds: new Set<string>(),
      page: 2,
      pageSize: 20,
      total: 21,
      totalPages: 2,
      sortBy: 'createdAt',
      sortOrder: 'desc',
      onSortChange: vi.fn(),
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

    expect(html).toContain('<span class="coupons-muted coupons-row-number">1</span>');
    expect(html).toContain('<span>备注信息</span>');
    expect(html).toContain('<span class="coupons-note" title="备注内容">备注内容</span>');
    expect(html).toContain('<div class="coupons-title"><strong>资料包</strong></div>');
    expect(html).not.toContain('规格：版本 = 标准版');
  });

  it('wraps the table in a scroll region while keeping pagination outside it', () => {
    const html = renderToStaticMarkup(createElement(CouponBatchTable, {
      batches: [batch],
      selectedIds: new Set<string>(),
      page: 1,
      pageSize: 20,
      total: 1,
      totalPages: 1,
      sortBy: 'createdAt',
      sortOrder: 'desc',
      onSortChange: vi.fn(),
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

    expect(html).toContain('<div class="coupons-table-region"><div class="coupons-table-scroll"><div class="coupons-table"');
    expect(html.indexOf('class="coupons-table-scroll"')).toBeLessThan(html.indexOf('data-testid="coupons-pagination"'));
  });

  it('renders the created-time sort control with descending state by default', () => {
    const html = renderToStaticMarkup(createElement(CouponBatchTable, {
      batches: [batch],
      selectedIds: new Set<string>(),
      page: 1,
      pageSize: 20,
      total: 1,
      totalPages: 1,
      sortBy: 'createdAt',
      sortOrder: 'desc',
      onSortChange: vi.fn(),
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

    expect(html).toContain('data-testid="coupon-sort-createdAt"');
    expect(html).toContain('aria-sort="descending"');
    expect(html).toContain('当前降序');
  });
});
