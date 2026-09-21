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
});
