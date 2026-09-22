import { useEffect, useMemo, useState } from 'react';
import { useAccountContext } from '../../../app/account-context';
import { createAccountsApi, createMockAccountsApi, type AccountsApi } from '../api';
import { useAccountsController } from '../controller';
import type { AccountVM } from '../types';
import { AccountTable } from './AccountTable';
import { AccountStateView } from './AccountStateView';
import { AccountToolbar } from './AccountToolbar';
import { AccountLoginModal } from './AccountLoginModal';
import { AccountDeleteModal } from './AccountDeleteModal';
import type { AccountLoginMethod } from './LoginMethodSelector';
import { findReauthorizeAccount, readReauthorizeAccountId } from '../reauthorize-intent';
import './accounts.css';

export interface AccountsPageProps { api?: AccountsApi; }

export function AccountsPage({ api: providedApi }: AccountsPageProps) {
  const api = useMemo(() => providedApi ?? createMockAccountsApi(), [providedApi]);
  const controller = useAccountsController({ api });
  const { accounts: contextAccounts, accountsLoading, currentAccountId, currentAccount, setCurrentAccountId, removeAccount, refreshAccounts } = useAccountContext();
  const [loginAccountId, setLoginAccountId] = useState<string | null>(null);
  const [loginMethod, setLoginMethod] = useState<AccountLoginMethod>('qr');
  const [loginOpen, setLoginOpen] = useState(false);
  const [handledReauthorizeAccountId, setHandledReauthorizeAccountId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deleteAccountTarget, setDeleteAccountTarget] = useState<AccountVM | null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const accounts = controller.state.data?.items ?? [];
  const total = controller.state.data?.total ?? 0;
  const page = controller.state.data?.page ?? controller.filters.page ?? 1;
  const totalPages = controller.state.data?.totalPages ?? 1;
  const metrics = summarize(accounts);
  const loginAccount = loginAccountId ? accounts.find((account) => account.id === loginAccountId) ?? contextAccounts.find((account) => account.id === loginAccountId) : undefined;
  const requestedReauthorizeAccountId = useMemo(() => readReauthorizeAccountId(typeof window === 'undefined' ? '' : window.location.search), []);

  useEffect(() => {
    if (!requestedReauthorizeAccountId || handledReauthorizeAccountId === requestedReauthorizeAccountId || accountsLoading) return;
    const account = findReauthorizeAccount(contextAccounts, requestedReauthorizeAccountId) ?? findReauthorizeAccount(accounts, requestedReauthorizeAccountId);
    if (!account) return;
    setLoginAccountId(account.id);
    setLoginMethod('cookie');
    setLoginOpen(true);
    setHandledReauthorizeAccountId(requestedReauthorizeAccountId);
    const url = new URL(window.location.href);
    url.searchParams.delete('reauthorize');
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  }, [accounts, accountsLoading, contextAccounts, handledReauthorizeAccountId, requestedReauthorizeAccountId]);

  function openLogin(account?: AccountVM, method: AccountLoginMethod = 'qr') {
    setLoginAccountId(account?.id ?? null);
    setLoginMethod(method);
    setLoginOpen(true);
  }

  function closeLogin() {
    setLoginOpen(false);
    setLoginAccountId(null);
    setLoginMethod('qr');
  }

  async function switchAccount(account: AccountVM) {
    setActionError(null);
    try {
      await setCurrentAccountId(account.id);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '账号切换失败');
    }
  }

  function requestDeleteAccount(account: AccountVM) {
    setDeleteError(null);
    setDeleteAccountTarget(account);
  }

  function closeDeleteAccount() {
    if (deleteSubmitting) return;
    setDeleteError(null);
    setDeleteAccountTarget(null);
  }

  async function confirmDeleteAccount() {
    if (!deleteAccountTarget || deleteSubmitting) return;
    const account = deleteAccountTarget;
    setDeleteSubmitting(true);
    setDeleteError(null);
    try {
      await removeAccount(account.id);
      setDeleteAccountTarget(null);
      await controller.reload();
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : '账号删除失败');
    } finally {
      setDeleteSubmitting(false);
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
        <AccountToolbar filters={controller.filters} phase={controller.state.phase} onSearchChange={controller.setSearch} onStatusChange={(status) => controller.setFilters((previous) => ({ ...previous, status, page: 1 }))} onConnectionStatusChange={(connectionStatus) => controller.setFilters((previous) => ({ ...previous, connectionStatus, page: 1 }))} onRefresh={controller.reload} onAddAccount={() => openLogin()} />
        {actionError && <div className="accounts-inline-error" role="alert">{actionError}</div>}
        {controller.state.phase === 'success' && <AccountTable accounts={accounts} activeAccountId={currentAccountId} page={page} total={total} totalPages={totalPages} onPageChange={(nextPage) => controller.setFilters((previous) => ({ ...previous, page: Math.max(1, Math.min(nextPage, totalPages)) }))} onReauthorize={openLogin} onSwitch={switchAccount} onDelete={requestDeleteAccount} />}
        <AccountStateView phase={controller.state.phase} error={controller.state.error} onRetry={controller.reload} />
      </article>
      {loginOpen && <AccountLoginModal api={api} account={loginAccount} initialMethod={loginMethod} onClose={closeLogin} onCompleted={() => { void controller.reload(); void refreshAccounts(); closeLogin(); }} />}
      {deleteAccountTarget && <AccountDeleteModal account={deleteAccountTarget} submitting={deleteSubmitting} error={deleteError} onClose={closeDeleteAccount} onConfirm={() => { void confirmDeleteAccount(); }} />}
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
