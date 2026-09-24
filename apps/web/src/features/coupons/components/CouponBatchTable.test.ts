import { createElement } from 'react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { CouponBatchTable } from './CouponBatchTable';
import type { CouponBatchVM } from '../types';

const couponsCss = readFileSync(fileURLToPath(new URL('./coupons.css', import.meta.url)), 'utf8');

const batch: CouponBatchVM = {
  batchId: '88',
  accountId: 'account-001',
  label: '资料包',
  purpose: 'text',
  status: 'active',
  version: 1,
  updatedAt: '2026-09-21T00:00:00.000Z',
  bindings: [],
  metadata: { description: '备注内容', textContent: '正文预览', multiSpec: true, specName: '版本', specValue: '标准版' },
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
      onEdit: vi.fn(),
      onCopy: vi.fn(),
      onBind: vi.fn(),
      onToggle: vi.fn(),
      onDelete: vi.fn(),
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
      onEdit: vi.fn(),
      onCopy: vi.fn(),
      onBind: vi.fn(),
      onToggle: vi.fn(),
      onDelete: vi.fn(),
    }));

    expect(html).toContain('<span class="coupons-muted coupons-row-number">88</span>');
    expect(html).toContain('<span>名称</span><span>类型</span><span>内容预览</span><span>备注信息</span>');
    expect(html).toContain('<span class="coupons-note" title="备注内容">备注内容</span>');
    expect(html).toContain('<span class="coupons-preview-cell" title="正文预览">正文预览</span>');
    expect(html).toContain('<div class="coupons-title"><strong title="资料包">资料包</strong></div>');
    expect(html).not.toContain('对接信息');
    expect(html).not.toContain('库存 2');
    expect(html).not.toContain('查看明细');
    expect(html).toContain('aria-label="更多"');
    expect(html).toContain('aria-label="关联商品"');
    expect(html.indexOf('aria-label="编辑"')).toBeLessThan(html.indexOf('aria-label="关联商品"'));
    expect(html.indexOf('aria-label="关联商品"')).toBeLessThan(html.indexOf('aria-label="更多"'));
    expect(html).not.toContain('aria-label="复制"');
    expect(html).not.toContain('coupons-action-icon');
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
      onEdit: vi.fn(),
      onCopy: vi.fn(),
      onBind: vi.fn(),
      onToggle: vi.fn(),
      onDelete: vi.fn(),
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
      onEdit: vi.fn(),
      onCopy: vi.fn(),
      onBind: vi.fn(),
      onToggle: vi.fn(),
      onDelete: vi.fn(),
    }));

    expect(html).toContain('data-testid="coupon-sort-createdAt"');
    expect(html).toContain('aria-sort="descending"');
    expect(html).toContain('当前降序');
  });

  it('uses the shared table typography and text-button action treatment', () => {
    expect(couponsCss).toContain('.coupons-row { display: grid;');
    expect(couponsCss).toContain('font-size: 14px; line-height: 1.6;');
    expect(couponsCss).toContain('.coupons-head { position: sticky;');
    expect(couponsCss).toContain('font-size: 13px; line-height: 1.5;');
    expect(couponsCss).toContain('.coupons-preview-cell {');
    expect(couponsCss).toContain('text-overflow: ellipsis; white-space: nowrap;');
    expect(couponsCss).toContain('.coupons-more-menu {');
    expect(couponsCss).not.toContain('.coupons-action-icon');
    expect(couponsCss).not.toContain('.coupons-drawer');
  });

  it('renders a disabled-safe status switch and image thumbnails without enable/disable menu actions', () => {
    const html = renderToStaticMarkup(createElement(CouponBatchTable, {
      batches: [{ ...batch, label: '一张很长的卡券名称', purpose: 'image', contentPreview: { imageUrls: ['data:image/png;base64,aGVsbG8='] } }, { ...batch, batchId: '89', status: 'paused' }],
      selectedIds: new Set<string>(),
      page: 1,
      pageSize: 20,
      total: 2,
      totalPages: 1,
      sortBy: 'createdAt',
      sortOrder: 'desc',
      togglingBatchId: '89',
      onSortChange: vi.fn(),
      onPageChange: vi.fn(),
      onSelect: vi.fn(),
      onSelectAll: vi.fn(),
      onEdit: vi.fn(),
      onCopy: vi.fn(),
      onBind: vi.fn(),
      onToggle: vi.fn(),
      onDelete: vi.fn(),
    }));

    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-label="一张很长的卡券名称已启用"');
    expect(html).toContain('aria-label="资料包未启用"');
    expect(html).toContain('class="coupons-preview-cell coupons-preview-images"');
    expect(html).toContain('class="coupons-preview-thumb"');
    expect(html).toContain('title="一张很长的卡券名称"');
    expect(html).not.toContain('>禁用</button>');
    expect(html).not.toContain('>启用</button>');
  });
});
