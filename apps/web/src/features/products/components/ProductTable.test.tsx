import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ProductVM } from '../types';
import { ProductTable } from './ProductTable';

const product: ProductVM = {
  id: 'product-1',
  accountId: 'account-1',
  title: '测试商品',
  externalProductRef: 'item-1',
  attributesJson: {},
  configVersion: 1,
  status: 'published',
  createdAt: '2026-09-23T00:00:00.000Z',
  updatedAt: '2026-09-23T00:00:00.000Z',
  skuCount: 0,
  assetCount: 0,
};

describe('ProductTable', () => {
  it('places detail before automation and keeps an explicit action gap', () => {
    const html = renderToStaticMarkup(createElement(ProductTable, {
      products: [product],
      page: 1,
      totalPages: 1,
      total: 1,
      sortBy: 'xianyuOrder',
      sortOrder: 'asc',
      onSortChange: vi.fn(),
      onPageChange: vi.fn(),
      onOpen: vi.fn(),
      onOpenXianyuDetail: vi.fn(),
      selectedIds: [],
      onToggleSelected: vi.fn(),
      onToggleAll: vi.fn(),
      onOpenAutomation: vi.fn(),
    }));

    expect(html.indexOf('data-testid="product-detail-product-1"')).toBeLessThan(html.indexOf('data-testid="product-automation-product-1"'));
    expect(readFileSync(fileURLToPath(new URL('./products.css', import.meta.url)), 'utf8')).toContain('.products-row-actions { display: flex; align-items: center; justify-content: flex-end; gap: 8px; }');
  });

  it('constrains the product table to the available page height', () => {
    const css = readFileSync(fileURLToPath(new URL('./products.css', import.meta.url)), 'utf8');
    expect(css).toContain('.products-domain { min-width: 0; min-height: 0; height: 100%; display: flex; flex-direction: column; }');
    expect(css).toContain('.products-table-region { display: flex; flex: 1 1 auto; min-height: 0;');
    expect(css).toContain('.products-table-scroll { flex: 1 1 auto; min-height: 0; overflow: auto;');
  });
});
