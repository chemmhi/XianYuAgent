import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SearchField } from './SearchField';

const searchFieldCss = readFileSync(fileURLToPath(new URL('./search-field.css', import.meta.url)), 'utf8');

describe('SearchField', () => {
  it('renders an accessible native search input with the shared control classes', () => {
    const html = renderToStaticMarkup(createElement(SearchField, {
      id: 'account-search',
      'aria-label': '搜索账号',
      placeholder: '搜索账号名称或备注',
      name: 'keyword',
    }));

    expect(html).toContain('class="ui-search-control"');
    expect(html).toContain('class="ui-search-icon"');
    expect(html).toContain('type="search"');
    expect(html).toContain('id="account-search"');
    expect(html).toContain('aria-label="搜索账号"');
    expect(html).toContain('placeholder="搜索账号名称或备注"');
  });

  it('supports a labeled field wrapper without changing search semantics', () => {
    const html = renderToStaticMarkup(createElement(SearchField, {
      label: '搜索会话',
      value: '买家昵称',
      onChange: vi.fn(),
    }));

    expect(html).toContain('class="ui-field ui-search-field"');
    expect(html).toContain('class="ui-field-label">搜索会话</span>');
    expect(html).toContain('value="买家昵称"');
    expect(html).toContain('type="search"');
  });

  it('only renders the clear affordance when the field has a value and handler', () => {
    const withClear = renderToStaticMarkup(createElement(SearchField, {
      value: '订单 20260921',
      clearable: true,
      onClear: vi.fn(),
      'aria-label': '搜索订单',
    }));
    const withoutClear = renderToStaticMarkup(createElement(SearchField, {
      clearable: true,
      onClear: vi.fn(),
      'aria-label': '搜索订单',
    }));

    expect(withClear).toContain('class="ui-search-clear"');
    expect(withClear).toContain('aria-label="清空搜索"');
    expect(withoutClear).not.toContain('class="ui-search-clear"');
  });

  it('preserves custom classes and disabled state', () => {
    const html = renderToStaticMarkup(createElement(SearchField, {
      className: 'orders-search is-focus',
      disabled: true,
      'aria-label': '搜索订单',
    }));

    expect(html).toContain('class="ui-search-control orders-search is-focus"');
    expect(html).toContain('disabled=""');
  });

  it('keeps the design focus-within ring and placeholder token in the shared stylesheet', () => {
    expect(searchFieldCss).toContain('.ui-search-control:focus-within');
    expect(searchFieldCss).toContain('box-shadow: 0 0 0 3px rgba(36,90,141,.09)');
    expect(searchFieldCss).toContain('border-radius: 7px');
    expect(searchFieldCss).toContain('input::placeholder { color: #9CA3AF; }');
  });
});
