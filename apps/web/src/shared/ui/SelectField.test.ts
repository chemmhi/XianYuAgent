import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SelectField } from './SelectField';

const selectFieldCss = readFileSync(fileURLToPath(new URL('./select-field.css', import.meta.url)), 'utf8');

describe('SelectField', () => {
  it('renders a reusable styled native select with an inline required marker', () => {
    const html = renderToStaticMarkup(createElement(SelectField, {
      id: 'coupon-type',
      label: '卡券类型',
      required: true,
      value: 'text',
      onChange: vi.fn(),
      options: [{ value: 'text', label: '固定文字' }, { value: 'image', label: '图片' }],
    }));

    expect(html).toContain('class="ui-field"');
    expect(html).toContain('class="ui-select-control"');
    expect(html).toContain('class="ui-select-native"');
    expect(html).toContain('class="ui-select-trigger"');
    expect(html).toContain('role="combobox"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('class="ui-select-chevron"');
    expect(html).toContain('class="ui-field-required"');
    expect(html).toContain('required');
    expect(html).toContain('aria-required="true"');
    expect(html).toContain('value="text"');
    expect(html).toContain('value="image"');
  });

  it('renders option disabled state and preserves field hint content', () => {
    const html = renderToStaticMarkup(createElement(SelectField, {
      label: '状态',
      hint: '请选择当前同步状态',
      value: 'pending',
      onChange: vi.fn(),
      options: [
        { value: 'pending', label: '待人工' },
        { value: 'disabled', label: '不可用', disabled: true },
      ],
    }));

    expect(html).toContain('请选择当前同步状态');
    expect(html).toContain('value="disabled" disabled');
    expect(html).toContain('class="ui-field-hint"');
  });

  it('keeps field classes on the documented wrapper and passes native attributes through', () => {
    const html = renderToStaticMarkup(createElement(SelectField, {
      id: 'account-status',
      label: '账号状态',
      className: 'accounts-domain-status-select',
      'aria-label': '账号状态筛选',
      value: 'active',
      disabled: true,
      onChange: vi.fn(),
      options: [
        { value: 'all', label: '全部状态' },
        { value: 'active', label: '已连接' },
        { value: 'disabled', label: '已停用', disabled: true },
      ],
    }));

    expect(html).toContain('class="ui-field accounts-domain-status-select"');
    expect(html).toContain('id="account-status"');
    expect(html).toContain('aria-label="账号状态筛选"');
    expect(html).toContain('disabled');
    expect(html).toContain('value="disabled" disabled');
    expect(html).toContain('class="ui-select-chevron"');
  });

  it('applies a standalone class to the control wrapper when no label is provided', () => {
    const html = renderToStaticMarkup(createElement(SelectField, {
      className: 'orders-status-select',
      value: 'all',
      onChange: vi.fn(),
      options: [{ value: 'all', label: '全部' }],
    }));

    expect(html).toContain('class="ui-select-control orders-status-select"');
    expect(html).not.toContain('class="ui-field orders-status-select"');
  });

  it('supports design-state classes without replacing native select semantics', () => {
    const html = renderToStaticMarkup(createElement(SelectField, {
      className: 'is-focus is-open',
      value: 'all',
      onChange: vi.fn(),
      options: [{ value: 'all', label: '全部' }],
    }));

    expect(html).toContain('class="ui-select-control is-focus is-open"');
    expect(html).toContain('<select');
    expect(html).toContain('value="all"');
    expect(html).toContain('class="ui-select-chevron"');
  });

  it('keeps preview menu opt-in and gated behind the explicit open state', () => {
    const closed = renderToStaticMarkup(createElement(SelectField, {
      className: 'orders-status-select',
      value: 'risk',
      onChange: vi.fn(),
      options: [{ value: 'risk', label: '风险待确认' }],
      previewMenuOptions: [{ value: 'risk', label: '风险待确认' }],
      previewSelectedValue: 'risk',
    }));
    const open = renderToStaticMarkup(createElement(SelectField, {
      className: 'is-open',
      value: 'risk',
      onChange: vi.fn(),
      options: [{ value: 'risk', label: '风险待确认' }, { value: 'manual', label: '待人工' }],
      previewMenuOptions: [{ value: 'risk', label: '风险待确认' }, { value: 'manual', label: '待人工' }],
      previewSelectedValue: 'risk',
    }));

    expect(closed).not.toContain('ui-select-menu');
    expect(open).toContain('class="ui-select-menu"');
    expect(open).toContain('aria-expanded="true"');
    expect(open).toContain('role="listbox"');
    expect(open).toContain('data-preview-only="true"');
    expect(open).toContain('class="ui-select-menu-option is-selected"');
    expect(open).toContain('role="option"');
    expect(open).toContain('aria-selected="true"');
    expect(open).toContain('<button');
    expect(selectFieldCss).toContain('.ui-select-menu');
    expect(selectFieldCss).toContain('box-shadow: var(--shadow-float, 0 18px 40px rgba(17, 24, 39, .12));');
    expect(selectFieldCss).toContain('min-height: 31px;');
    expect(selectFieldCss).toContain('.ui-select-menu-option.is-selected');
  });
});
