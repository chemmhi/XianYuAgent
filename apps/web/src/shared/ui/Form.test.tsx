import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Form, describedBy } from './Form';
import { InputField } from './InputField';
import { TextAreaField } from './TextAreaField';
import { SelectField } from './SelectField';

describe('shared Form and field feedback', () => {
  it('disables popovers while preserving constraints and reserving an error line', () => {
    const html = renderToStaticMarkup(createElement(Form, { noValidate: false, 'aria-label': '注册' },
      createElement(InputField, { label: '邮箱', type: 'email', required: true }),
      createElement(TextAreaField, { label: '内容', required: true }),
      createElement(SelectField, { label: '类型', required: true, options: [{ value: '', label: '请选择' }] }),
    ));
    expect(html).toContain('noValidate=""');
    expect(html).toContain('type="email"');
    expect(html.match(/required=""/g)).toHaveLength(3);
    expect(html.match(/ui-field-message-placeholder/g)).toHaveLength(3);
  });
  it('connects explicit errors to inputs, textareas and the visible select trigger', () => {
    const html = renderToStaticMarkup(createElement(Form, {},
      createElement(InputField, { label: '邮箱', error: '该邮箱已存在', 'aria-describedby': 'email-help' }),
      createElement(TextAreaField, { error: '内容不能为空' }),
      createElement(SelectField, { label: '类型', error: '请选择类型', options: [{ value: '', label: '请选择' }] }),
    ));
    expect(html.match(/aria-invalid="true"/g)).toHaveLength(4);
    expect(html.match(/class="ui-field-error"/g)).toHaveLength(3);
    expect(html).toMatch(/aria-describedby="email-help field-error-[^"]+"/);
    expect(html).toMatch(/role="combobox"[^>]*aria-describedby="field-error-[^"]+"[^>]*aria-invalid="true"/);
    for (const [, id] of html.matchAll(/id="(field-error-[^"]+)"/g)) expect(html).toContain(id);
  });
  it('combines existing descriptions without duplicates', () => {
    expect(describedBy('help note help', 'error')).toBe('help note error');
    expect(describedBy(undefined, undefined)).toBeUndefined();
  });
  it('keeps unlabeled controls directly under their existing parent before and after errors', () => {
    for (const error of [undefined, '请输入有效内容']) {
      const html = renderToStaticMarkup(createElement(Form, {},
        createElement(InputField, { required: true, error }),
        createElement(TextAreaField, { required: true, error }),
        createElement(SelectField, { required: true, error, options: [{ value: '', label: '请选择' }] }),
      ));
      expect(html).not.toContain('class="ui-field"');
      expect(html).toMatch(/^<form[^>]*><input/);
      expect(html).toContain('<textarea');
      expect(html).toContain('class="ui-select-control"');
    }
  });
});
