import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Button } from './Button';

describe('Button', () => {
  it('renders the default shared button surface and children', () => {
    const html = renderToStaticMarkup(createElement(Button, { type: 'button', 'aria-label': '刷新' }, '刷新'));

    expect(html).toContain('class="btn ui-button ui-button-default"');
    expect(html).toContain('type="button"');
    expect(html).toContain('aria-label="刷新"');
    expect(html).toContain('>刷新</button>');
  });

  it('maps variant and size props to stable styling classes', () => {
    const html = renderToStaticMarkup(createElement(Button, {
      variant: 'primary',
      size: 'small',
      className: 'workspace-new-session',
      type: 'submit',
    }, '新建会话'));

    expect(html).toContain('class="btn ui-button ui-button-primary ui-button-small workspace-new-session"');
    expect(html).toContain('type="submit"');
    expect(html).toContain('>新建会话</button>');
  });

  it('passes through disabled and native button attributes', () => {
    const html = renderToStaticMarkup(createElement(Button, {
      variant: 'danger',
      disabled: true,
      name: 'delete',
      value: 'coupon-1',
    }, '删除'));

    expect(html).toContain('class="btn ui-button ui-button-danger"');
    expect(html).toContain('disabled=""');
    expect(html).toContain('name="delete"');
    expect(html).toContain('value="coupon-1"');
  });
});
