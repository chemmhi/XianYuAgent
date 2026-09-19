import { useMemo } from 'react';
import { createAccountsApi, createMockAccountsApi, type AccountsApi } from '../api';
import { useAccountsController } from '../controller';
import type { AccountVM } from '../types';
import { AccountTable } from './AccountTable';
import { AccountStateView } from './AccountStateView';
import { AccountToolbar } from './AccountToolbar';
import './accounts.css';

export interface AccountsPageProps {
  api?: AccountsApi;
}

export function AccountsPage({ api: providedApi }: AccountsPageProps) {
  const api = useMemo(() => providedApi ?? createMockAccountsApi(), [providedApi]);
  const controller = useAccountsController({ api });
  const accounts = controller.state.data?.items ?? [];
  const total = controller.state.data?.total ?? 0;
  const metrics = summarize(accounts);

  return (
    <section className="page-stack accounts-domain" data-accounts-domain>
      <div className="page-title">
        <div>
          <p className="eyebrow">Account Context</p>
          <h1>账号管理</h1>
          <p>查看账号连接状态、凭证引用和当前能力范围。真实账号写操作将在后续切片接入。</p>
        </div>
        <span className="accounts-domain-scope">管理员账号范围</span>
      </div>
      <div className="kpi-grid three accounts-domain-kpis">
        <article className="card kpi-card"><div className="kpi-label">已绑定账号</div><div className="kpi-value">{total}</div><div className="kpi-delta"><span className="tone-ok">{metrics.online} 个在线</span><small>当前可用连接</small></div></article>
        <article className="card kpi-card"><div className="kpi-label">当前账号</div><div className="kpi-value">{accounts.find((account) => account.enabled)?.displayName.slice(-1) ?? '—'}</div><div className="kpi-delta"><span className="tone-info">账号上下文</span><small>后续接入切换命令</small></div></article>
        <article className="card kpi-card"><div className="kpi-label">需要处理</div><div className="kpi-value">{metrics.needsAttention}</div><div className="kpi-delta"><span className={metrics.needsAttention > 0 ? 'tone-warn' : 'tone-ok'}>{metrics.needsAttention > 0 ? '需刷新或补凭证' : '状态健康'}</span><small>只展示摘要，不暴露凭证</small></div></article>
      </div>
      <article className="card panel accounts-domain-panel">
        <AccountToolbar
          filters={controller.filters}
          phase={controller.state.phase}
          total={total}
          onSearchChange={controller.setSearch}
          onStatusChange={(status) => controller.setFilters((previous) => ({ ...previous, status, page: 1 }))}
          onRefresh={controller.reload}
        />
        {controller.state.phase === 'success' && <AccountTable accounts={accounts} />}
        <AccountStateView phase={controller.state.phase} error={controller.state.error} onRetry={controller.reload} />
      </article>
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
