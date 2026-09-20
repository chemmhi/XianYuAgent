import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ProductListStateView } from './ProductStateView';

describe('ProductListStateView', () => {
  it('renders the empty state in the shared full-height state container', () => {
    const html = renderToStaticMarkup(createElement(ProductListStateView, { phase: 'empty', error: null, onRetry: vi.fn() }));

    expect(html).toContain('class="products-state"');
    expect(html).toContain('<strong>暂无商品</strong>');
    expect(html).toContain('当前账号范围内没有匹配商品');
  });

  it('keeps load failures inside the same centered state container with retry guidance', () => {
    const html = renderToStaticMarkup(createElement(ProductListStateView, {
      phase: 'error',
      error: { code: 'NETWORK_ERROR', message: '商品服务暂时不可用，请检查连接后重试。', retryable: true },
      onRetry: vi.fn(),
    }));

    expect(html).toContain('class="products-state products-error"');
    expect(html).toContain('<strong>商品列表加载失败</strong>');
    expect(html).toContain('重新加载');
  });
});
