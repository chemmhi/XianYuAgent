import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { XianyuDetailDrawer } from './XianyuDetailDrawer';

describe('XianyuDetailDrawer states', () => {
  it('keeps loading feedback in the centered detail state container', () => {
    const html = renderToStaticMarkup(createElement(XianyuDetailDrawer, {
      state: { phase: 'loading', loadingMode: 'sync', productId: 'product-1', data: null, error: null },
      onClose: vi.fn(),
      onRetry: vi.fn(),
      onSync: vi.fn(),
      onChooseAccount: vi.fn(),
    }));

    expect(html).toContain('class="products-detail-state"');
    expect(html).toContain('正在同步并保存闲鱼商品详情');
  });

  it('guides slider verification from a centered validation error', () => {
    const html = renderToStaticMarkup(createElement(XianyuDetailDrawer, {
      state: { phase: 'error', productId: 'product-1', data: null, error: { code: 'ACCOUNT_REAUTH_REQUIRED', reason: 'SLIDER_VALIDATION', message: '闲鱼触发安全验证，请打开闲鱼商品详情页完成滑块验证，验证完成后再回到这里重新同步。', retryable: false } },
      onClose: vi.fn(),
      onRetry: vi.fn(),
      onSync: vi.fn(),
      onChooseAccount: vi.fn(),
    }));

    expect(html).toContain('class="products-detail-state products-error"');
    expect(html).toContain('请先完成闲鱼滑块验证');
    expect(html).toContain('打开闲鱼商品详情页完成滑块验证');
    expect(html).toContain('验证后重新同步');
    expect(html).toContain('去账号管理更新 Cookie');
  });
});
