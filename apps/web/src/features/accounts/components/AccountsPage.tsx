import { useMemo, useState } from 'react';
import { createAccountsApi, createMockAccountsApi, type AccountsApi } from '../api';
import { useAccountsController } from '../controller';
import type { AccountVM } from '../types';
import { AccountTable } from './AccountTable';
import { AccountStateView } from './AccountStateView';
import { AccountToolbar } from './AccountToolbar';
import { AccountLoginModal } from './AccountLoginModal';
import './accounts.css';

export interface AccountsPageProps {
  api?: AccountsApi;
}

export function AccountsPage({ api: providedApi }: AccountsPageProps) {
  const api = useMemo(() => providedApi ?? createMockAccountsApi(), [providedApi]);
  const controller = useAccountsController({ api });
  const [loginAccountId, setLoginAccountId] = useState<string | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const accounts = controller.state.data?.items ?? [];
  const total = controller.state.data?.total ?? 0;
  const metrics = summarize(accounts);
  const loginAccount = loginAccountId ? accounts.find((account) => account.id === loginAccountId) : undefined;

  function openLogin(account?: AccountVM) {
    setLoginAccountId(account?.id ?? null);
    setLoginOpen(true);
  }

  function closeLogin() {
    setLoginOpen(false);
    setLoginAccountId(null);
  }

  return (
    <section className="page-stack accounts-domain" data-accounts-domain>
      <div className="page-title">
        <div>
          <p className="eyebrow">Account Context</p>
          <h1>店铺 / 账号管理</h1>
          <p>从真实闲鱼登录链路添加账号，登录成功后由服务端保存凭证并同步昵称、备注和头像。</p>
        </div>
        <div className="page-title-actions"><span className="accounts-domain-scope">管理员账号范围</span><button className="btn primary" type="button" onClick={() => openLogin()}>添加闲鱼账号</button></div>
      </div>
      <div className="kpi-grid three accounts-domain-kpis">
        <article className="card kpi-card"><div className="kpi-label">已绑定账号</div><div className="kpi-value">{total}</div><div className="kpi-delta"><span className="tone-ok">{metrics.online} 个在线</span><small>当前可用连接</small></div></article>
        <article className="card kpi-card"><div className="kpi-label">当前账号</div><div className="kpi-value">{accounts.find((account) => account.enabled)?.displayName?.slice(-1) ?? '—'}</div><div className="kpi-delta"><span className="tone-info">账号上下文</span><small>后续接入切换命令</small></div></article>
        <article className="card kpi-card"><div className="kpi-label">需要处理</div><div className="kpi-value">{metrics.needsAttention}</div><div className="kpi-delta"><span className={metrics.needsAttention > 0 ? 'tone-warn' : 'tone-ok'}>{metrics.needsAttention > 0 ? '需刷新或补凭证' : '状态健康'}</span><small>不展示敏感凭证</small></div></article>
      </div>
      <article className="card panel accounts-domain-panel">
        <AccountToolbar filters={controller.filters} phase={controller.state.phase} total={total} onSearchChange={controller.setSearch} onStatusChange={(status) => controller.setFilters((previous) => ({ ...previous, status, page: 1 }))} onRefresh={controller.reload} />
        {controller.state.phase === 'success' && <AccountTable accounts={accounts} onReauthorize={(account) => openLogin(account)} />}
        <AccountStateView phase={controller.state.phase} error={controller.state.error} onRetry={controller.reload} />
      </article>
      {loginOpen && <AccountLoginModal api={api} account={loginAccount} onClose={closeLogin} onCompleted={() => { void controller.reload(); closeLogin(); }} />}
    </section>
  );
}

function summarize(accounts: AccountVM[]) {
  return {
    online: accounts.filter((account) => account.connection.status === 'online').length,
    needsAttention: accounts.filter((account) => ['expired', 'unknown'].includes(account.connection.status) || ['refresh_required', 'missing'].includes(account.credentialState)).length,
  };
}

export { createAccountsApi };
