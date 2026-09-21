import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { InputField } from './InputField';

describe('InputField', () => {
  it('renders a labeled input using the shared visual hooks', () => {
    const html = renderToStaticMarkup(createElement(InputField, {
      id: 'product-title',
      label: '商品标题',
      required: true,
      placeholder: '请输入商品标题',
      hint: '建议控制在 30 个字以内',
    }));

    expect(html).toContain('class="ui-field"');
    expect(html).toContain('class="ui-field-label">商品标题<span class="ui-field-required"');
    expect(html).toContain('class="ui-input-control ui-input"');
    expect(html).toContain('id="product-title"');
    expect(html).toContain('required=""');
    expect(html).toContain('aria-required="true"');
    expect(html).toContain('class="ui-field-hint">建议控制在 30 个字以内</span>');
  });

  it('renders an error in preference to a hint', () => {
    const html = renderToStaticMarkup(createElement(InputField, {
      label: 'API Key',
      hint: '请妥善保管',
      error: '请输入有效的 API Key',
    }));

    expect(html).toContain('class="ui-field-error">请输入有效的 API Key</span>');
    expect(html).not.toContain('class="ui-field-hint">请妥善保管</span>');
  });

  it('supports standalone inputs and preserves native attributes', () => {
    const html = renderToStaticMarkup(createElement(InputField, {
      className: 'settings-api-key',
      type: 'password',
      autoComplete: 'new-password',
      disabled: true,
      'aria-label': 'API Key',
    }));

    expect(html).toContain('class="ui-input-control ui-input settings-api-key"');
    expect(html).toContain('type="password"');
    expect(html).toMatch(/autoComplete="new-password"|autocomplete="new-password"/);
    expect(html).toContain('disabled=""');
    expect(html).not.toContain('class="ui-field"');
  });
});
