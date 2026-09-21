import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { SelectField } from './SelectField';

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
    expect(html).toContain('class="ui-select-chevron"');
    expect(html).toContain('class="ui-field-required"');
    expect(html).toContain('required');
    expect(html).toContain('aria-required="true"');
    expect(html).toContain('value="text"');
    expect(html).toContain('value="image"');
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
});
