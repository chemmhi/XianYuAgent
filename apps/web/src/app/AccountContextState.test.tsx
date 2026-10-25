import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountContextState } from './AccountContextState';
import { DashboardPage } from '../features/dashboard/components/DashboardPage';
import { ProductsPage } from '../features/products/components/ProductsPage';
import { CouponsPage } from '../features/coupons/components/CouponsPage';
import { OrdersPage } from '../features/orders/components/OrdersPage';
import { MessagesPage } from '../features/messages/components/MessagesPage';
import { WorkspacePage } from '../features/workspace/components/WorkspacePage';
import { AgentDynamicsPage } from '../features/agent-dynamics/components/AgentDynamicsPage';
import { SettingsPage } from '../features/settings/components/SettingsPage';
import type { WorkspaceApi } from '../features/workspace/api';
import type { InviteApi } from '../features/settings/api';
import { createMockCredentialApi } from '../features/settings/api';

const context = vi.hoisted(() => ({
  accounts: [], accountsLoading: false, accountsError: null as string | null,
  currentAccountId: undefined, currentAccount: undefined,
  refreshAccounts: vi.fn(), setCurrentAccountId: vi.fn(),
}));
vi.mock('./account-context', async (importOriginal) => ({
  ...await importOriginal<typeof import('./account-context')>(),
  useAccountContext: () => context,
}));

const pages = [
  ['仪表盘', () => <DashboardPage apiMode="mock" onNavigate={() => undefined} />],
  ['Workspace', () => <WorkspacePage api={{} as WorkspaceApi} />],
  ['在线聊天', () => <MessagesPage />],
  ['商品管理', () => <ProductsPage />],
  ['卡券管理', () => <CouponsPage />],
  ['订单管理', () => <OrdersPage />],
  ['Agent 动态', () => <AgentDynamicsPage />],
  ['设置', () => <SettingsPage api={createMockCredentialApi()} inviteApi={{} as InviteApi} />],
] as const;

beforeEach(() => { context.accountsLoading = false; context.accountsError = null; });

describe('account guidance across page entry points', () => {
  it.each(pages)('%s shows the same guidance and primary action without an account', (_name, page) => {
    const html = renderToStaticMarkup(page());
    expect(html).toContain('class="account-context-state"');
    expect(html).toContain('请先连接或选择闲鱼账号');
    expect(html).toContain('请在账号管理中添加闲鱼账号，或选择一个可用账号后继续。');
    expect(html).toContain('ui-button-primary');
    expect(html).toContain('前往账号管理');
    expect(html).not.toContain('同步闲鱼');
  });

  it.each(pages)('%s preserves loading instead of prompting to connect prematurely', (_name, page) => {
    context.accountsLoading = true;
    const html = renderToStaticMarkup(page());
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('正在加载账号…');
    expect(html).not.toContain('前往账号管理');
  });

  it.each(pages)('%s offers recovery when account loading fails', (_name, page) => {
    context.accountsError = 'unavailable';
    const html = renderToStaticMarkup(page());
    expect(html).toContain('role="alert"');
    expect(html).toContain('账号加载失败');
    expect(html).toContain('重新加载');
    expect(html).not.toContain('前往账号管理');
  });

  it('gives loading priority over a previous error', () => {
    context.accountsLoading = true;
    context.accountsError = 'previous error';
    const html = renderToStaticMarkup(<AccountContextState />);
    expect(html).toContain('正在加载账号…');
    expect(html).not.toContain('role="alert"');
  });
});
