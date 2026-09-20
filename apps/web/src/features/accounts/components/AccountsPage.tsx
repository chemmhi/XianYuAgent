import { useMemo, useState } from 'react';
import { useAccountContext } from '../../../app/account-context';
import { createAccountsApi, createMockAccountsApi, type AccountsApi } from '../api';
import { useAccountsController } from '../controller';
import type { AccountVM } from '../types';
import { AccountTable } from './AccountTable';
import { AccountStateView } from './AccountStateView';
import { AccountToolbar } from './AccountToolbar';
import { AccountLoginModal } from './AccountLoginModal';
import './accounts.css';

export interface AccountsPageProps { api?: AccountsApi; }

export function AccountsPage({ api: providedApi }: AccountsPageProps) {
  const api = useMemo(() => providedApi ?? createMockAccountsApi(), [providedApi]);
  const controller = useAccountsController({ api });
  const { currentAccountId, currentAccount, setCurrentAccountId, removeAccount, refreshAccounts } = useAccountContext();
  const [loginAccountId, setLoginAccountId] = useState<string | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
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

  async function switchAccount(account: AccountVM) {
    setActionError(null);
    try {
      await setCurrentAccountId(account.id);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '账号切换失败');
    }
  }

  async function deleteAccount(account: AccountVM) {
    if (!window.confirm(`确认删除账号“${account.displayName}”？删除后会撤销登录凭证，但会保留历史商品记录。`)) return;
    setActionError(null);
    try {
      await removeAccount(account.id);
      await controller.reload();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '账号删除失败');
    }
  }

  return (
    <section className="page-stack accounts-domain" data-accounts-domain>
      <div className="kpi-grid three accounts-domain-kpis">
        <article className="card kpi-card"><div className="kpi-label">已绑定账号</div><div className="kpi-value">{total}</div><div className="kpi-delta"><span className="tone-ok">{metrics.online} 个在线</span><small>当前可用连接</small></div></article>
        <article className="card kpi-card"><div className="kpi-label">当前账号</div><div className="kpi-value">{currentAccount?.displayName?.slice(-1) ?? '—'}</div><div className="kpi-delta"><span className="tone-info">账号上下文</span><small>{currentAccount?.displayName ?? '请先选择账号'}</small></div></article>
        <article className="card kpi-card"><div className="kpi-label">需要处理</div><div className="kpi-value">{metrics.needsAttention}</div><div className="kpi-delta"><span className={metrics.needsAttention > 0 ? 'tone-warn' : 'tone-ok'}>{metrics.needsAttention > 0 ? '需要刷新或补凭证' : '状态健康'}</span><small>不展示敏感凭证</small></div></article>
      </div>
      <article className="card panel accounts-domain-panel">
        <AccountToolbar filters={controller.filters} phase={controller.state.phase} total={total} onSearchChange={controller.setSearch} onStatusChange={(status) => controller.setFilters((previous) => ({ ...previous, status, page: 1 }))} onRefresh={controller.reload} onAddAccount={() => openLogin()} />
        {actionError && <div className="accounts-inline-error" role="alert">{actionError}</div>}
        {controller.state.phase === 'success' && <AccountTable accounts={accounts} activeAccountId={currentAccountId} onReauthorize={openLogin} onSwitch={switchAccount} onDelete={deleteAccount} />}
        <AccountStateView phase={controller.state.phase} error={controller.state.error} onRetry={controller.reload} />
      </article>
      {loginOpen && <AccountLoginModal api={api} account={loginAccount} onClose={closeLogin} onCompleted={() => { void controller.reload(); void refreshAccounts(); closeLogin(); }} />}
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
