import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccountContextProvider } from './account-context';
import { AccountMenu, AuthenticatedShell, resolveDashboardMode } from './App';

function renderShell(props: Parameters<typeof AuthenticatedShell>[0]) {
  const child = createElement(AuthenticatedShell, props);
  return renderToStaticMarkup(createElement(AccountContextProvider, { api: { list: vi.fn() } as never, children: child }));
}

describe('dashboard API mode resolution', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('inherits live mode when the dashboard override is unset', () => {
    expect(resolveDashboardMode('live')).toBe('live');
  });

  it('keeps mock mode when the dashboard override is explicit', () => {
    expect(resolveDashboardMode('live', 'mock')).toBe('mock');
  });

  it('forces live mode in production even when a mock override is present', () => {
    vi.stubEnv('PROD', true);
    expect(resolveDashboardMode('live', 'mock')).toBe('live');
  });

  it('does not promote a mock API transport to live mode', () => {
    expect(resolveDashboardMode('mock')).toBe('mock');
  });

  it('keeps the dashboard inside the shared application shell', () => {
    const props = {
      admin: { id: 'admin-chen', email: 'chenchen@example.com', displayName: '陈晨', role: 'admin' },
      page: 'dashboard',
      accountsApi: {},
      productsApi: {},
      couponsApi: {},
      messagesApi: {},
      workspaceApi: {},
      ordersApi: {},
      settingsApi: {},
      autoReplyAgentSettingsApi: {},
      openaiSettingsApi: {},
      modelProviderApi: {},
      agentDynamicsApi: {},
      dashboardApi: { getSnapshot: vi.fn() },
      onLogout: vi.fn().mockResolvedValue(undefined),
      logoutBusy: false,
      navigate: vi.fn(),
    } as unknown as Parameters<typeof AuthenticatedShell>[0];

    const html = renderShell(props);

    expect(html).toContain('class="sidebar"');
    expect(html).toContain('FishAgent');
    expect(html).not.toContain('XianyuSellerAgent');
    expect(html).toContain('alt="FishAgent Logo"');
    expect(html).toContain('width="32"');
    expect(html).toContain('height="32"');
    expect(html).toContain('运营控制台');
    expect(html).toContain('Agent Runtime');
    expect(html).toContain('陈晨');
    expect(html).toContain('chenchen@example.com');
    expect(html).toContain('data-testid="account-menu-trigger"');
    expect(html).toContain('aria-haspopup="menu"');
    const menuHtml = renderToStaticMarkup(createElement(AccountMenu, { adminName: '陈晨', adminEmail: 'chenchen@example.com', adminInitial: '陈', logoutBusy: false, onLogout: vi.fn().mockResolvedValue(undefined) }));
    expect(menuHtml).toContain('退出登录');
    const pendingMenuHtml = renderToStaticMarkup(createElement(AccountMenu, { adminName: '陈晨', adminEmail: 'chenchen@example.com', adminInitial: '陈', logoutBusy: true, onLogout: vi.fn().mockResolvedValue(undefined) }));
    expect(pendingMenuHtml).toContain('退出中…');
    expect(html).not.toContain('运营管理员');
    expect(html).not.toContain('admin@example.com');
    expect(html).not.toContain('dashboard-sidebar');
    expect(html).not.toContain('dashboard-desktop-shell');
    expect(html).not.toContain('dashboard-mobile-frame');
    expect(html).toContain('dashboard-desktop-content');
    expect(html).toContain('dashboard-mobile-content');
    expect(html).toContain('hidden=""');
  });

  it('keeps the sidebar navigation focused on primary labels', () => {
    const props = {
      admin: { id: 'admin-nav', email: 'nav@example.com', displayName: '导航测试', role: 'admin' },
      page: 'dashboard',
      accountsApi: {},
      productsApi: {},
      couponsApi: {},
      messagesApi: {},
      workspaceApi: {},
      ordersApi: {},
      settingsApi: {},
      autoReplyAgentSettingsApi: {},
      openaiSettingsApi: {},
      modelProviderApi: {},
      agentDynamicsApi: {},
      dashboardApi: { getSnapshot: vi.fn() },
      navigate: vi.fn(),
    } as unknown as Parameters<typeof AuthenticatedShell>[0];

    const html = renderShell(props);
    const sidebarNav = html.match(/<nav class="side-nav"[\s\S]*?<\/nav>/)?.[0] ?? '';

    expect(sidebarNav).toContain('仪表盘');
    expect(sidebarNav).not.toContain('数据概览');
    expect(sidebarNav).not.toContain('<small>');
  });

  it('makes the brand block an accessible dashboard navigation target', () => {
    const props = {
      admin: { id: 'admin-brand', email: 'brand@example.com', displayName: '品牌测试', role: 'admin' },
      page: 'accounts',
      accountsApi: {},
      productsApi: {},
      couponsApi: {},
      messagesApi: {},
      workspaceApi: {},
      ordersApi: {},
      settingsApi: {},
      autoReplyAgentSettingsApi: {},
      openaiSettingsApi: {},
      modelProviderApi: {},
      agentDynamicsApi: {},
      dashboardApi: { getSnapshot: vi.fn() },
      navigate: vi.fn(),
    } as unknown as Parameters<typeof AuthenticatedShell>[0];

    const html = renderShell(props);

    expect(html).toContain('data-testid="brand-block"');
    expect(html).toContain('role="link"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('aria-label="返回仪表盘"');
  });

  it('falls back to 管理员 when displayName is empty', () => {
    const props = {
      admin: { id: 'admin-empty-name', email: 'empty-name@example.com', displayName: '  ', role: 'admin' },
      page: 'dashboard',
      accountsApi: {},
      productsApi: {},
      couponsApi: {},
      messagesApi: {},
      workspaceApi: {},
      ordersApi: {},
      settingsApi: {},
      autoReplyAgentSettingsApi: {},
      openaiSettingsApi: {},
      modelProviderApi: {},
      agentDynamicsApi: {},
      dashboardApi: { getSnapshot: vi.fn() },
      navigate: vi.fn(),
    } as unknown as Parameters<typeof AuthenticatedShell>[0];

    const html = renderShell(props);

    expect(html).toContain('>管理员</strong>');
    expect(html).toContain('empty-name@example.com');
  });

  it('falls back to 管理员 for placeholder display names', () => {
    const props = {
      admin: { id: 'admin-placeholder-name', email: 'placeholder-name@example.com', displayName: '?????', role: 'admin' },
      page: 'dashboard',
      accountsApi: {},
      productsApi: {},
      couponsApi: {},
      messagesApi: {},
      workspaceApi: {},
      ordersApi: {},
      settingsApi: {},
      autoReplyAgentSettingsApi: {},
      openaiSettingsApi: {},
      modelProviderApi: {},
      agentDynamicsApi: {},
      dashboardApi: { getSnapshot: vi.fn() },
      navigate: vi.fn(),
    } as unknown as Parameters<typeof AuthenticatedShell>[0];

    const html = renderShell(props);

    expect(html).toContain('>管理员</strong>');
    expect(html).not.toContain('>?????</strong>');
    expect(html).toContain('placeholder-name@example.com');
  });
});
