import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ProductVM } from '../types';
import { ProductKnowledgeBaseModal } from './ProductKnowledgeBaseModal';

const product: ProductVM = {
  id: 'product-1', accountId: 'account-1', title: '测试商品', knowledgeBase: '支持数字资料交付。', attributesJson: {}, configVersion: 3,
  status: 'published', createdAt: '2026-09-23T00:00:00.000Z', updatedAt: '2026-09-23T00:00:00.000Z', skuCount: 0, assetCount: 0,
};

describe('ProductKnowledgeBaseModal', () => {
  it('renders the read-only content view with an explicit edit action', () => {
    const html = renderToStaticMarkup(createElement(ProductKnowledgeBaseModal, { product, saving: false, error: null, onClose: vi.fn(), onSave: vi.fn() }));
    expect(html).toContain('role="dialog"');
    expect(html).toContain('data-testid="product-knowledge-base-modal"');
    expect(html).toContain('支持数字资料交付。');
    expect(html).toContain('编辑知识库');
    expect(html).not.toContain('data-testid="product-knowledge-base-input"');
  });

  it('opens an empty product directly in edit mode', () => {
    const html = renderToStaticMarkup(createElement(ProductKnowledgeBaseModal, { product: { ...product, knowledgeBase: undefined }, saving: false, error: null, onClose: vi.fn(), onSave: vi.fn() }));
    expect(html).toContain('data-testid="product-knowledge-base-input"');
    expect(html).toContain('data-testid="generate-product-knowledge-base"');
    expect(html).toContain('data-testid="optimize-product-knowledge-base"');
    expect(html).toContain('保存知识库');
    expect(html).toContain('0/5000');
  });
});
