import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TextAreaField } from './TextAreaField';

describe('TextAreaField', () => {
  it('renders a labeled textarea with the shared text-area classes', () => {
    const html = renderToStaticMarkup(createElement(TextAreaField, {
      label: '商品描述',
      required: true,
      rows: 6,
      maxLength: 5000,
      placeholder: '请输入商品描述',
      hint: '支持换行',
    }));

    expect(html).toContain('class="ui-field"');
    expect(html).toContain('class="ui-field-label">商品描述<span class="ui-field-required"');
    expect(html).toContain('class="ui-textarea-control ui-textarea"');
    expect(html).toContain('rows="6"');
    expect(html).toMatch(/maxLength="5000"|maxlength="5000"/);
    expect(html).toContain('required=""');
    expect(html).toContain('class="ui-field-hint">支持换行</span>');
  });

  it('renders an error instead of the hint and preserves custom classes', () => {
    const html = renderToStaticMarkup(createElement(TextAreaField, {
      className: 'coupon-notes',
      value: '备注内容',
      onChange: () => undefined,
      error: '内容不能为空',
      hint: '最多 5000 个字符',
      'aria-label': '备注信息',
    }));

    expect(html).toContain('class="ui-textarea-control ui-textarea coupon-notes"');
    expect(html).toContain('aria-label="备注信息"');
    expect(html).toContain('>备注内容</textarea>');
    expect(html).toContain('class="ui-field-error">内容不能为空</span>');
    expect(html).not.toContain('class="ui-field-hint">最多 5000 个字符</span>');
  });

  it('supports a standalone disabled textarea', () => {
    const html = renderToStaticMarkup(createElement(TextAreaField, {
      className: 'cookie-header',
      disabled: true,
      placeholder: '粘贴完整 Cookie',
    }));

    expect(html).toContain('class="ui-textarea-control ui-textarea cookie-header"');
    expect(html).toContain('disabled=""');
    expect(html).not.toContain('class="ui-field"');
  });
});
