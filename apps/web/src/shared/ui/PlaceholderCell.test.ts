import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PlaceholderCell } from './PlaceholderCell';

describe('PlaceholderCell', () => {
  it('renders the standard Chinese empty-state copy and shared hook', () => {
    const html = renderToStaticMarkup(createElement(PlaceholderCell));

    expect(html).toContain('class="ui-placeholder-cell placeholder-cell ui-placeholder-cell-default"');
    expect(html).toContain('>暂无数据</span>');
  });

  it('supports tinted tone, custom content, and class composition', () => {
    const html = renderToStaticMarkup(createElement(PlaceholderCell, {
      tone: 'tinted',
      className: 'orders-empty-cell',
      children: '暂无关联会话',
    }));

    expect(html).toContain('class="ui-placeholder-cell placeholder-cell ui-placeholder-cell-tinted orders-empty-cell"');
    expect(html).toContain('>暂无关联会话</span>');
  });
});
