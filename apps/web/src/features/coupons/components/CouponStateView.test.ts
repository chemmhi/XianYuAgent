import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { CouponListStateView } from './CouponStateView';

describe('CouponListStateView', () => {
  it('keeps the empty-state guidance together and centered by the page state container', () => {
    const html = renderToStaticMarkup(createElement(CouponListStateView, { phase: 'empty', error: null, onRetry: vi.fn() }));

    expect(html).toContain('class="coupons-state"');
    expect(html).toContain('<strong>暂无卡券批次</strong>');
    expect(html).toContain('<span>当前账号范围内没有匹配的批次，可调整筛选或创建新批次。</span>');
  });
});
