import { useEffect, useMemo, useState } from 'react';
import { apiMode } from '../api';
import { createHttpClient } from '../api/http';
import { createAccountsApi } from '../features/accounts/api';
import { AccountsPage } from '../features/accounts/components/AccountsPage';
import { createAuthApi, type AdminProfile } from '../features/auth/api';
import { AuthGate } from '../features/auth/components/AuthGate';
import { createProductsApi } from '../features/products/api';
import { ProductsPage } from '../features/products/components/ProductsPage';
import { createMockProductAutomationApi, createProductAutomationApi } from '../features/product-automation/api';
import { createCouponsApi } from '../features/coupons/api';
import { CouponsPage } from '../features/coupons/components/CouponsPage';
import { createMessagesApi } from '../features/messages/api';
import { MessagesPage } from '../features/messages/components/MessagesPage';
import { createWorkspaceApi } from '../features/workspace/api';
import { WorkspacePage } from '../features/workspace/components/WorkspacePage';
import { createOrdersApi } from '../features/orders/api';
import { OrdersPage } from '../features/orders/components/OrdersPage';
import { createAutoReplyAgentSettingsApi, createCredentialApi, createOpenAISettingsApi } from '../features/settings/api';
import { createModelProviderApi } from '../features/settings/model-provider-api';
import { SettingsPage } from '../features/settings/components/SettingsPage';
import { AccountContextProvider } from './account-context';
import { navItems, pathForPage, type PageKey } from './navigation';
import { createDashboardApi } from '../features/dashboard/api';
import { createMockDashboardApi } from '../features/dashboard/api.mock';
import { DashboardPage } from '../features/dashboard/components/DashboardPage';
import { createAgentDynamicsApi, createMockAgentDynamicsApi, type AgentDynamicsApi } from '../features/agent-dynamics/api';
import { AgentDynamicsPage } from '../features/agent-dynamics/components/AgentDynamicsPage';
import { ControlsPreview } from '../shared/ui/ControlsPreview';
import { Logo } from '../shared/ui/Logo';
import { logoAssetPath, resolveLogoVariant } from '../shared/ui/brand';

const activeLogoVariant = resolveLogoVariant(import.meta.env.VITE_LOGO_VARIANT);

function pageFromPath(pathname: string): PageKey {
  const page = pathname.replace(/^\//, '') as PageKey;
  return navItems.some((item) => item.key === page) ? page : 'dashboard';
}

export function resolveDashboardMode(apiModeValue: typeof apiMode, dashboardModeOverride?: string): typeof apiMode {
  if (import.meta.env.PROD) return 'live';
  if (apiModeValue === 'live' && dashboardModeOverride === undefined) return 'live';
  return dashboardModeOverride === 'live' ? 'live' : 'mock';
}

function iconFor(name: string) {
  const paths: Record<string, string> = {
    grid: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
    message: 'M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v7a2.5 2.5 0 0 1-2.5 2.5H11l-4.5 4v-4h0A2.5 2.5 0 0 1 4 12.5z',
    user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0',
    inbox: 'M4 5h16v14H4zM4 14h4l1.5 2h5L16 14h4',
    box: 'm12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Zm0 9 8-4.5M12 12v9M4 7.5 12 12',
    ticket: 'M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v3a2 2 0 1 0 0 4v3a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-3a2 2 0 1 0 0-4V7Zm8-2v14',
    cart: 'M4 5h2l1.5 10h9.5l2-7H7m2 12h.01M17 20h.01',
    gear: 'M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm0-5v2m0 13v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M3 12h2m14 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42',
  };
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="nav-icon"><path d={paths[name] ?? paths.grid} /></svg>;
}

export default function App() {
  useEffect(() => {
    document.title = 'FishAgent · 运营控制台';
    const icon = document.querySelector<HTMLLinkElement>('link[data-xianyu-brand-icon]') ?? document.createElement('link');
    icon.rel = 'icon';
    icon.type = 'image/svg+xml';
    icon.href = logoAssetPath(activeLogoVariant);
    icon.dataset.xianyuBrandIcon = 'true';
    if (!icon.isConnected) document.head.appendChild(icon);
  }, []);

  if (window.location.pathname === '/controls') return <ControlsPreview />;
  const [page, setPage] = useState<PageKey>(() => pageFromPath(window.location.pathname));
  const dashboardMode = resolveDashboardMode(apiMode, import.meta.env.VITE_DASHBOARD_MODE);
  const transport = useMemo(() => {
    const transport = createHttpClient({ baseUrl: import.meta.env.VITE_API_BASE_URL ?? '', credentials: 'include' });
    return transport;
  }, []);
  const authApi = useMemo(() => createAuthApi({ get: transport.get, post: transport.post }), [transport]);
  const accountsApi = useMemo(() => createAccountsApi({ get: transport.get, post: transport.post, delete: transport.delete }), [transport]);
  const productsApi = useMemo(() => createProductsApi({ get: transport.get, post: transport.post, patch: transport.patch }), [transport]);
  const productAutomationApi = useMemo(() => !import.meta.env.PROD && import.meta.env.VITE_AUTOMATION_MODE === 'mock'
    ? createMockProductAutomationApi()
    : createProductAutomationApi({ get: transport.get, post: transport.post, patch: transport.patch }), [transport]);
  const couponsApi = useMemo(() => createCouponsApi({ get: transport.get, post: transport.post, patch: transport.patch, delete: transport.delete }), [transport]);
  const messagesApi = useMemo(() => createMessagesApi({ get: transport.get, post: transport.post, baseUrl: import.meta.env.VITE_API_BASE_URL ?? undefined }), [transport]);
  const workspaceApi = useMemo(() => createWorkspaceApi({ get: transport.get, post: transport.post }, { baseUrl: import.meta.env.VITE_API_BASE_URL ?? '' }), [transport]);
  const ordersApi = useMemo(() => createOrdersApi({ get: transport.get, post: transport.post }), [transport]);
  const settingsApi = useMemo(() => createCredentialApi({ get: transport.get, post: transport.post, patch: transport.patch }), [transport]);
  const autoReplyAgentSettingsApi = useMemo(() => createAutoReplyAgentSettingsApi({ get: transport.get, patch: transport.patch }), [transport]);
  const openaiSettingsApi = useMemo(() => createOpenAISettingsApi({ get: transport.get, post: transport.post, patch: transport.patch }), [transport]);
  const modelProviderApi = useMemo(() => createModelProviderApi({ get: transport.get }), [transport]);
  const agentDynamicsApi = useMemo<AgentDynamicsApi>(() => apiMode === 'live' ? createAgentDynamicsApi({ get: transport.get }) : createMockAgentDynamicsApi(), [transport]);
  const dashboardApi = useMemo(() => dashboardMode === 'live' ? createDashboardApi({ get: transport.get }) : createMockDashboardApi(), [dashboardMode, transport]);

  useEffect(() => {
    const handlePopState = () => setPage(pageFromPath(window.location.pathname));
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  function navigate(next: PageKey) {
    const path = pathForPage(next);
    window.history.pushState({}, '', path);
    setPage(next);
  }

  return <AuthGate api={authApi}>
    {(admin, auth) => <AccountContextProvider api={accountsApi}>
      <AuthenticatedShell admin={admin} onLogout={auth.logout} logoutBusy={auth.busy} page={page} accountsApi={accountsApi} productsApi={productsApi} productAutomationApi={productAutomationApi} couponsApi={couponsApi} messagesApi={messagesApi} workspaceApi={workspaceApi} ordersApi={ordersApi} settingsApi={settingsApi} autoReplyAgentSettingsApi={autoReplyAgentSettingsApi} openaiSettingsApi={openaiSettingsApi} modelProviderApi={modelProviderApi} agentDynamicsApi={agentDynamicsApi} dashboardApi={dashboardApi} navigate={navigate} />
    </AccountContextProvider>}
  </AuthGate>;
}

export function AuthenticatedShell({ admin, onLogout = async () => undefined, logoutBusy = false, page, accountsApi, productsApi, productAutomationApi, couponsApi, messagesApi, workspaceApi, ordersApi, settingsApi, autoReplyAgentSettingsApi, openaiSettingsApi, modelProviderApi, agentDynamicsApi, dashboardApi, navigate }: { admin?: AdminProfile | null; onLogout?: () => Promise<void>; logoutBusy?: boolean; page: PageKey; accountsApi: ReturnType<typeof createAccountsApi>; productsApi: ReturnType<typeof createProductsApi>; productAutomationApi: ReturnType<typeof createProductAutomationApi>; couponsApi: ReturnType<typeof createCouponsApi>; messagesApi: ReturnType<typeof createMessagesApi>; workspaceApi: ReturnType<typeof createWorkspaceApi>; ordersApi: ReturnType<typeof createOrdersApi>; settingsApi: ReturnType<typeof createCredentialApi>; autoReplyAgentSettingsApi: ReturnType<typeof createAutoReplyAgentSettingsApi>; openaiSettingsApi: ReturnType<typeof createOpenAISettingsApi>; modelProviderApi: ReturnType<typeof createModelProviderApi>; agentDynamicsApi: AgentDynamicsApi; dashboardApi: ReturnType<typeof createDashboardApi>; navigate: (next: PageKey) => void }) {
  const dashboardApiMode = resolveDashboardMode(apiMode, import.meta.env.VITE_DASHBOARD_MODE);
  const candidateAdminName = admin?.displayName?.trim() ?? '';
  const adminName = candidateAdminName && !/^[?？]+$/.test(candidateAdminName) ? candidateAdminName : '管理员';
  const adminEmail = admin?.email ?? '—';
  const adminInitial = Array.from(adminName)[0] ?? '管';
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);

  async function handleLogout() {
    setAccountMenuOpen(false);
    await onLogout();
  }

  const accountMenu = accountMenuOpen ? <AccountMenu adminName={adminName} adminEmail={adminEmail} adminInitial={adminInitial} logoutBusy={logoutBusy} onLogout={handleLogout} /> : null;

  return (
    <div className="app-viewport">
      <div className={`desktop-shell${page === 'workspace' ? ' workspace-shell' : page === 'products' ? ' products-shell' : page === 'accounts' ? ' accounts-shell' : page === 'orders' ? ' orders-shell' : page === 'coupons' ? ' coupons-shell' : page === 'settings' ? ' settings-shell' : page === 'agent-dynamics' ? ' agent-dynamics-shell-host' : ''}`}>
        <aside className="sidebar">
          <div
            className="brand-block"
            data-testid="brand-block"
            role="link"
            tabIndex={0}
            aria-label="返回仪表盘"
            onClick={(event) => {
              const target = event.target;
              if (target instanceof HTMLElement && target.closest('.mobile-account-anchor')) return;
              navigate('dashboard');
            }}
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget) return;
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              navigate('dashboard');
            }}
          >
            <Logo className="brand-mark" variant={activeLogoVariant} label="FishAgent Logo" />
            <div className="brand-copy"><strong>FishAgent</strong><span>运营控制台</span></div>
            <div className="mobile-account-anchor"><button className="mobile-account-trigger" type="button" data-testid="account-menu-trigger" aria-label="打开账户菜单" aria-expanded={accountMenuOpen} aria-haspopup="menu" onClick={() => setAccountMenuOpen((open) => !open)}><span className="avatar">{adminInitial}</span><span className="mobile-account-name">{adminName}</span><ChevronIcon open={accountMenuOpen} /></button>{accountMenu}</div>
          </div>
          <div className="side-section">运营台</div>
          <nav className="side-nav" aria-label="主导航">
            {navItems.map((item) => <button key={item.key} type="button" className={page === item.key ? 'active' : ''} aria-current={page === item.key ? 'page' : undefined} onClick={() => navigate(item.key)}>{iconFor(item.icon)}<span>{item.label}</span></button>)}
          </nav>
          <div className="sidebar-bottom"><div className="agent-card"><span className="online-dot" /> <strong>Agent Runtime</strong><small>独立服务 · 正常</small></div><div className="desktop-account-anchor"><button className="sidebar-user sidebar-account-trigger" type="button" data-testid="account-menu-trigger" aria-label="打开账户菜单" aria-expanded={accountMenuOpen} aria-haspopup="menu" onClick={() => setAccountMenuOpen((open) => !open)}><div className="avatar">{adminInitial}</div><div><strong>{adminName}</strong><span>{adminEmail}</span></div><ChevronIcon open={accountMenuOpen} /></button>{accountMenu}</div></div>
        </aside>
        <div className="desktop-body">
          <main className={page === 'products' ? 'products-main' : page === 'accounts' ? 'accounts-main' : page === 'orders' ? 'orders-main' : page === 'settings' ? 'settings-main' : page === 'agent-dynamics' ? 'agent-dynamics-main-host' : undefined}>
            <div hidden={page !== 'messages'}>
              <MessagesPage api={messagesApi} active={page === 'messages'} />
            </div>
            {page !== 'messages' && renderAuthenticatedPage({ page, accountsApi, productsApi, productAutomationApi, couponsApi, messagesApi, workspaceApi, ordersApi, settingsApi, autoReplyAgentSettingsApi, openaiSettingsApi, modelProviderApi, agentDynamicsApi, dashboardApi, dashboardApiMode, onNavigate: navigate })}
          </main>
        </div>
      </div>
    </div>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return <svg className={`account-menu-chevron${open ? ' open' : ''}`} aria-hidden="true" viewBox="0 0 24 24"><path d="m7 10 5 5 5-5" /></svg>;
}

export function AccountMenu({ adminName, adminEmail, adminInitial, logoutBusy, onLogout }: { adminName: string; adminEmail: string; adminInitial: string; logoutBusy: boolean; onLogout: () => Promise<void> }) {
  return <div className="account-menu" role="menu" aria-label="账户操作"><div className="account-menu-head"><div className="avatar">{adminInitial}</div><div><strong>{adminName}</strong><span>{adminEmail}</span></div></div><div className="account-menu-divider" /><button className="account-menu-logout" type="button" data-testid="account-logout" role="menuitem" onClick={() => void onLogout()} disabled={logoutBusy}><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M10 5H7a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h3m4-4 4-3-4-3m4 3H9" /></svg><span>{logoutBusy ? '退出中…' : '退出登录'}</span></button></div>;
}

type AuthenticatedPageProps = {
  page: PageKey;
  accountsApi: ReturnType<typeof createAccountsApi>;
  productsApi: ReturnType<typeof createProductsApi>;
  productAutomationApi: ReturnType<typeof createProductAutomationApi>;
  couponsApi: ReturnType<typeof createCouponsApi>;
  messagesApi: ReturnType<typeof createMessagesApi>;
  workspaceApi: ReturnType<typeof createWorkspaceApi>;
  ordersApi: ReturnType<typeof createOrdersApi>;
  settingsApi: ReturnType<typeof createCredentialApi>;
  autoReplyAgentSettingsApi: ReturnType<typeof createAutoReplyAgentSettingsApi>;
  openaiSettingsApi: ReturnType<typeof createOpenAISettingsApi>;
  modelProviderApi: ReturnType<typeof createModelProviderApi>;
  agentDynamicsApi: AgentDynamicsApi;
  dashboardApi: ReturnType<typeof createDashboardApi>;
  dashboardApiMode: 'live' | 'mock';
  onNavigate: (page: PageKey) => void;
};

export function renderAuthenticatedPage({ page, accountsApi, productsApi, productAutomationApi, couponsApi, messagesApi, workspaceApi, ordersApi, settingsApi, autoReplyAgentSettingsApi, openaiSettingsApi, modelProviderApi, agentDynamicsApi, dashboardApi, dashboardApiMode, onNavigate }: AuthenticatedPageProps) {
  switch (page) {
    case 'dashboard':
      return <DashboardPage api={dashboardApi} apiMode={dashboardApiMode} onNavigate={onNavigate} />;
    case 'accounts':
      return <AccountsPage api={accountsApi} />;
    case 'products':
      return <ProductsPage api={productsApi} accountsApi={accountsApi} automationApi={productAutomationApi} />;
    case 'coupons':
      return <CouponsPage api={couponsApi} productsApi={productsApi} />;
    case 'messages':
      return <MessagesPage api={messagesApi} />;
    case 'workspace':
      return <WorkspacePage api={workspaceApi} />;
    case 'orders':
      return <OrdersPage api={ordersApi} />;
    case 'settings':
      return <SettingsPage api={settingsApi} agentApi={autoReplyAgentSettingsApi} openaiApi={openaiSettingsApi} modelApi={modelProviderApi} />;
    case 'agent-dynamics':
      return <AgentDynamicsPage api={agentDynamicsApi} onNavigate={onNavigate} />;
    default:
      return <PlaceholderPage page={page} />;
  }
}

function PlaceholderPage({ page }: { page: PageKey }) {
  const item = navItems.find((candidate) => candidate.key === page) ?? navItems[0];
  return <section className="page-stack page-placeholder"><p className="eyebrow">{item.sub}</p><h1>{item.label}</h1><p>该页面将在对应纵向切片中实现。账号管理切片已接入真实 API 适配和二维码授权流程。</p></section>;
}
