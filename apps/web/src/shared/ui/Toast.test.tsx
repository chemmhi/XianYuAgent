import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { Toast } from './Toast';

describe('Toast', () => {
  it('renders an accessible error alert with a dismiss action', () => {
    const html = renderToStaticMarkup(createElement(Toast, { message: '同步失败', tone: 'error', onDismiss: vi.fn() }));
    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-live="assertive"');
    expect(html).toContain('同步失败');
    expect(html).toContain('aria-label="关闭提示"');
  });
});
