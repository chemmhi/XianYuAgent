import { useMemo, useState } from 'react';
import { apiMode } from '../api';
import { createHttpClient } from '../api/http';
import { createAccountsApi } from '../features/accounts/api';
import { AccountsPage } from '../features/accounts/components/AccountsPage';

type Route = '/dashboard' | '/accounts' | '/products' | '/coupons' | '/orders';

const routes: Array<{ path: Route; label: string }> = [
  { path: '/dashboard', label: '仪表盘' },
  { path: '/accounts', label: '账号管理' },
  { path: '/products', label: '商品管理' },
  { path: '/coupons', label: '卡券管理' },
  { path: '/orders', label: '订单管理' },
];

function normalizeRoute(pathname: string): Route {
  return routes.some((route) => route.path === pathname) ? pathname as Route : '/dashboard';
}

export default function App() {
  const [route, setRoute] = useState<Route>(() => normalizeRoute(window.location.pathname));
  const accountsApi = useMemo(() => {
    if (apiMode !== 'live') return undefined;
    const transport = createHttpClient({
      baseUrl: import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080',
      getToken: () => window.localStorage.getItem('auth_token'),
    });
    return createAccountsApi({ get: transport.get, post: transport.post });
  }, []);

  const navigate = (nextRoute: Route) => {
    window.history.pushState({}, '', nextRoute);
    setRoute(nextRoute);
  };

  return (
    <div className="web-shell">
      <header className="web-header">
        <div>
          <strong>XianyuSellerAgent Admin</strong>
          <span>正式前端应用 · {apiMode === 'live' ? 'Live API' : 'Mock API'}</span>
        </div>
        <span className="env-badge">{apiMode}</span>
      </header>
      <div className="web-layout">
        <nav className="web-nav" aria-label="主导航">
          {routes.map((item) => (
            <button key={item.path} className={route === item.path ? 'active' : ''} onClick={() => navigate(item.path)}>
              {item.label}
            </button>
          ))}
        </nav>
        <main className="web-main">
          {route === '/accounts' ? <AccountsPage api={accountsApi} /> : <PlaceholderPage route={route} />}
        </main>
      </div>
    </div>
  );
}

function PlaceholderPage({ route }: { route: Route }) {
  const item = routes.find((candidate) => candidate.path === route)!;
  return (
    <section className="page-placeholder">
      <p className="eyebrow">正式前端路由</p>
      <h1>{item.label}</h1>
      <p>该页面将在对应纵向切片中实现。当前已接入账号管理切片。</p>
    </section>
  );
}
