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

    expect(emptyHtml).toContain('class="page-state"');
    expect(errorHtml).toContain('accounts-domain-state-error');
    expect(errorHtml).not.toContain('role="alert"');
    expect(errorHtml).not.toContain('网络不可用');
    expect(errorHtml).toContain('重新加载');
  });
});

describe('account empty state', () => {
  it('guides a new user to add an account with the shared primary button', () => {
    const html = renderToStaticMarkup(<AccountStateView phase="empty" error={null} onRetry={() => undefined} hasAccounts={false} onAddAccount={() => undefined} />);
    expect(html).toContain('尚未添加闲鱼账号');
    expect(html).toContain('ui-button-primary');
    expect(html).toContain('添加闲鱼账号');
    expect(html).not.toContain('调整搜索');
  });

  it('preserves search guidance when existing accounts do not match filters', () => {
    const html = renderToStaticMarkup(<AccountStateView phase="empty" error={null} onRetry={() => undefined} hasAccounts onAddAccount={() => undefined} />);
    expect(html).toContain('暂无匹配账号');
    expect(html).toContain('调整搜索或筛选条件后重试。');
    expect(html).not.toContain('添加闲鱼账号');
  });
});
