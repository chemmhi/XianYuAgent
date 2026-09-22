import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AccountStateView } from './AccountStateView';

describe('AccountStateView', () => {
  it('renders a single centered loading state instead of scattered skeleton rows', () => {
    const html = renderToStaticMarkup(createElement(AccountStateView, { phase: 'loading', error: null, onRetry: vi.fn() }));

    expect(html).toContain('accounts-domain-state-loading');
    expect(html).toContain('accounts-domain-spinner');
    expect(html).toContain('正在加载账号列表…');
    expect(html).not.toContain('accounts-domain-skeleton');
  });

  it('keeps empty and retryable error states inside the shared state container', () => {
    const emptyHtml = renderToStaticMarkup(createElement(AccountStateView, { phase: 'empty', error: null, onRetry: vi.fn() }));
    const errorHtml = renderToStaticMarkup(createElement(AccountStateView, {
      phase: 'error',
      error: { code: 'NETWORK_ERROR', message: '网络不可用', retryable: true },
      onRetry: vi.fn(),
    }));

    expect(emptyHtml).toContain('accounts-domain-state-empty');
    expect(errorHtml).toContain('accounts-domain-state-error');
    expect(errorHtml).toContain('role="alert"');
    expect(errorHtml).toContain('重新加载');
  });
});
