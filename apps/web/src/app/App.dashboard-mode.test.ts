import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AuthenticatedShell, resolveDashboardMode } from './App';

describe('dashboard API mode resolution', () => {
  it('inherits live mode when the dashboard override is unset', () => {
    expect(resolveDashboardMode('live')).toBe('live');
  });

  it('keeps mock mode when the dashboard override is explicit', () => {
    expect(resolveDashboardMode('live', 'mock')).toBe('mock');
  });

  it('does not promote a mock API transport to live mode', () => {
    expect(resolveDashboardMode('mock')).toBe('mock');
  });

  it('keeps the dashboard inside the shared application shell', () => {
    const props = {
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

    const html = renderToStaticMarkup(createElement(AuthenticatedShell, props));

    expect(html).toContain('class="sidebar"');
    expect(html).toContain('XianyuSellerAgent');
    expect(html).toContain('运营控制台');
    expect(html).toContain('Agent Runtime');
    expect(html).not.toContain('dashboard-sidebar');
    expect(html).not.toContain('dashboard-desktop-shell');
    expect(html).not.toContain('dashboard-mobile-frame');
    expect(html).toContain('dashboard-desktop-content');
    expect(html).toContain('dashboard-mobile-content');
  });
});
