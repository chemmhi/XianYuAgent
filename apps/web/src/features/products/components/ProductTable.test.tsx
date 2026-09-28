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

const productWithKnowledgeBase: ProductVM = { ...product, knowledgeBase: '支持数字资料交付；付款后发送下载说明。' };

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
      onOpenKnowledgeBase: vi.fn(),
      selectedIds: [],
      onToggleSelected: vi.fn(),
      onToggleAll: vi.fn(),
      onOpenAutomation: vi.fn(),
    }));

    expect(html.indexOf('data-testid="product-detail-product-1"')).toBeLessThan(html.indexOf('data-testid="product-knowledge-base-product-1"'));
    expect(html.indexOf('data-testid="product-knowledge-base-product-1"')).toBeLessThan(html.indexOf('data-testid="product-automation-product-1"'));
    expect(readFileSync(fileURLToPath(new URL('./products.css', import.meta.url)), 'utf8')).toContain('.products-row-actions { display: flex; align-items: center; justify-content: flex-end; gap: 6px;');
  });

  it('shows a scoped knowledge-base action and uses a dash for empty content', () => {
    const emptyHtml = renderToStaticMarkup(createElement(ProductTable, {
      products: [product], page: 1, totalPages: 1, total: 1, sortBy: 'xianyuOrder', sortOrder: 'asc',
      onSortChange: vi.fn(), onPageChange: vi.fn(), onOpen: vi.fn(), onOpenXianyuDetail: vi.fn(), onOpenKnowledgeBase: vi.fn(),
    }));
    const filledHtml = renderToStaticMarkup(createElement(ProductTable, {
      products: [productWithKnowledgeBase], page: 1, totalPages: 1, total: 1, sortBy: 'xianyuOrder', sortOrder: 'asc',
      onSortChange: vi.fn(), onPageChange: vi.fn(), onOpen: vi.fn(), onOpenXianyuDetail: vi.fn(), onOpenKnowledgeBase: vi.fn(),
    }));
    expect(emptyHtml).toContain('data-testid="product-knowledge-base-product-1"');
    expect(emptyHtml).toContain('>—</span>');
    expect(filledHtml).toContain('支持数字资料交付；付款后发送下载说明。');
    expect(filledHtml).toContain('title="支持数字资料交付；付款后发送下载说明。"');
    expect(filledHtml).toContain('>知识库</button>');
  });

  it('constrains the product table to the available page height', () => {
    const css = readFileSync(fileURLToPath(new URL('./products.css', import.meta.url)), 'utf8');
    expect(css).toContain('.products-domain { min-width: 0; min-height: 0; height: 100%; display: flex; flex-direction: column; }');
    expect(css).toContain('.products-table-region { display: flex; flex: 1 1 auto; min-height: 0;');
    expect(css).toContain('.products-table-scroll { flex: 1 1 auto; min-height: 0; overflow: auto;');
  });

  it('reserves a stable two-line automation status slot while configs load', () => {
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
      onOpenKnowledgeBase: vi.fn(),
      selectedIds: [],
      onToggleSelected: vi.fn(),
      onToggleAll: vi.fn(),
      onOpenAutomation: vi.fn(),
    }));
    const css = readFileSync(fileURLToPath(new URL('./products.css', import.meta.url)), 'utf8');
    expect(html).toContain('读取中...');
    expect(html).toContain('正在读取规则');
    expect(css).toContain('min-height: 42px');
  });
});
