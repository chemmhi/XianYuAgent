import { useEffect, useMemo, useState } from 'react';
import { createHttpClient } from '../api/http';
import { createAccountsApi } from '../features/accounts/api';
import { AccountsPage } from '../features/accounts/components/AccountsPage';
import { createAuthApi } from '../features/auth/api';
import { AuthGate } from '../features/auth/components/AuthGate';
import { createProductsApi } from '../features/products/api';
import { ProductsPage } from '../features/products/components/ProductsPage';
import { createCouponsApi } from '../features/coupons/api';
import { CouponsPage } from '../features/coupons/components/CouponsPage';
import { createMessagesApi } from '../features/messages/api';
import { MessagesPage } from '../features/messages/components/MessagesPage';
import { createWorkspaceApi } from '../features/workspace/api';
import { WorkspacePage } from '../features/workspace/components/WorkspacePage';
import { AccountContextProvider } from './account-context';
import { navItems, pathForPage, type PageKey } from './navigation';

function pageFromPath(pathname: string): PageKey {
  const page = pathname.replace(/^\//, '') as PageKey;
  return navItems.some((item) => item.key === page) ? page : 'dashboard';
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
  const [page, setPage] = useState<PageKey>(() => pageFromPath(window.location.pathname));
  const transport = useMemo(() => {
    const transport = createHttpClient({ baseUrl: import.meta.env.VITE_API_BASE_URL ?? '', credentials: 'include' });
    return transport;
  }, []);
  const authApi = useMemo(() => createAuthApi({ get: transport.get, post: transport.post }), [transport]);
  const accountsApi = useMemo(() => createAccountsApi({ get: transport.get, post: transport.post, delete: transport.delete }), [transport]);
  const productsApi = useMemo(() => createProductsApi({ get: transport.get, post: transport.post, patch: transport.patch }), [transport]);
  const couponsApi = useMemo(() => createCouponsApi({ get: transport.get, post: transport.post, patch: transport.patch, delete: transport.delete }), [transport]);
  const messagesApi = useMemo(() => createMessagesApi({ get: transport.get, post: transport.post, baseUrl: import.meta.env.VITE_API_BASE_URL ?? undefined }), [transport]);
  const workspaceApi = useMemo(() => createWorkspaceApi({ get: transport.get, post: transport.post }, { baseUrl: import.meta.env.VITE_API_BASE_URL ?? '' }), [transport]);

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
    <AccountContextProvider api={accountsApi}>
      <AuthenticatedShell page={page} accountsApi={accountsApi} productsApi={productsApi} couponsApi={couponsApi} messagesApi={messagesApi} workspaceApi={workspaceApi} navigate={navigate} />
    </AccountContextProvider>
  </AuthGate>;
}

function AuthenticatedShell({ page, accountsApi, productsApi, couponsApi, messagesApi, workspaceApi, navigate }: { page: PageKey; accountsApi: ReturnType<typeof createAccountsApi>; productsApi: ReturnType<typeof createProductsApi>; couponsApi: ReturnType<typeof createCouponsApi>; messagesApi: ReturnType<typeof createMessagesApi>; workspaceApi: ReturnType<typeof createWorkspaceApi>; navigate: (next: PageKey) => void }) {
  return (
    <div className="app-viewport">
      <div className="desktop-shell">
        <aside className="sidebar">
          <div className="brand-block"><div className="brand-mark">Y</div><div className="brand-copy"><strong>XianyuSellerAgent</strong><span>运营控制台</span></div></div>
          <div className="side-section">运营台</div>
          <nav className="side-nav" aria-label="主导航">
            {navItems.map((item) => <button key={item.key} type="button" className={page === item.key ? 'active' : ''} aria-current={page === item.key ? 'page' : undefined} onClick={() => navigate(item.key)}>{iconFor(item.icon)}<span>{item.label}</span><small>{item.sub}</small></button>)}
          </nav>
          <div className="sidebar-bottom"><div className="agent-card"><span className="online-dot" /> <strong>Agent Runtime</strong><small>独立服务 · 正常</small></div><div className="sidebar-user"><div className="avatar">管</div><div><strong>运营管理员</strong><span>admin@example.com</span></div></div></div>
        </aside>
        <div className="desktop-body">
          <main>{page === 'accounts' ? <AccountsPage api={accountsApi} /> : page === 'products' ? <ProductsPage api={productsApi} accountsApi={accountsApi} /> : page === 'coupons' ? <CouponsPage api={couponsApi} productsApi={productsApi} /> : page === 'messages' ? <MessagesPage api={messagesApi} /> : page === 'workspace' ? <WorkspacePage api={workspaceApi} /> : <PlaceholderPage page={page} />}</main>
        </div>
      </div>
    </div>
  );
}

function PlaceholderPage({ page }: { page: PageKey }) {
  const item = navItems.find((candidate) => candidate.key === page) ?? navItems[0];
  return <section className="page-stack page-placeholder"><p className="eyebrow">{item.sub}</p><h1>{item.label}</h1><p>该页面将在对应纵向切片中实现。账号管理切片已接入真实 API 适配和二维码授权流程。</p></section>;
}
