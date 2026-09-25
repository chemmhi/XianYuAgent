import { useMemo } from 'react';
import { useAccountContext } from '../../../app/account-context';
import type { PageKey } from '../../../app/navigation';
import { createMockAgentDynamicsApi, type AgentDynamicsApi } from '../api';
import { resolveRuntimeApi } from '../../../api/runtime';
import { useAgentDynamicsController } from '../controller';
import { AgentDynamicsDropdown } from './AgentDynamicsDropdown';
import { ErrorBanner, ExceptionPanel, KpiStrip, RunDrawer, RunsTable, RuntimePanel, SkeletonBlocks, StatusPanel } from './AgentDynamicsViews';
import './agent-dynamics.css';

export interface AgentDynamicsPageProps {
  api?: AgentDynamicsApi;
  onNavigate?: (page: PageKey) => void;
}

export function AgentDynamicsPage({ api: providedApi, onNavigate }: AgentDynamicsPageProps) {
  const { accounts, currentAccountId, currentAccount, accountsLoading, accountsError } = useAccountContext();
  const api = useMemo(() => resolveRuntimeApi(providedApi, createMockAgentDynamicsApi, 'AGENT_DYNAMICS_API_NOT_PROVIDED'), [providedApi]);
  const controller = useAgentDynamicsController({ api, accountId: currentAccountId });
  const summary = controller.summary.data;
  const summaryError = controller.summary.error;
  const runsError = controller.runs.error;

  function openRun(runId: string) {
    void controller.openRun(runId);
  }

  function openFirstException() {
    const failed = controller.runs.data?.items.find((item) => item.decision.key === 'failed') ?? controller.runs.data?.items[0];
    if (failed) openRun(failed.runId);
  }

  function navigateToMessages(path?: string) {
    if (!onNavigate) return;
    onNavigate('messages');
    if (path) window.history.replaceState({}, '', path);
  }

  const rangeOptions = [
    { value: '24h' as const, label: '最近 24 小时' },
    { value: '7d' as const, label: '最近 7 天' },
  ];

  if (accountsLoading) return <section className="agent-dynamics-context-state"><div>正在加载账号范围…</div></section>;
  if (accountsError) return <section className="agent-dynamics-context-state error" role="alert"><strong>账号上下文加载失败</strong><span>{accountsError}</span></section>;
  if (accounts.length === 0) return <section className="agent-dynamics-context-state"><strong>请先连接闲鱼账号</strong><span>Agent 动态需要先连接至少一个可用账号。</span><a className="agent-dynamics-btn" href="/accounts">前往账号管理</a></section>;
  if (!currentAccountId || !currentAccount) return <section className="agent-dynamics-context-state"><strong>请先设置当前账号</strong><span>Agent 动态沿用账号管理中的全局账号上下文，不在此处切换账号。</span><a className="agent-dynamics-btn" href="/accounts">前往账号管理</a></section>;

  return <div className="agent-dynamics-app">
    <section className="agent-dynamics-shell">
      <main className="agent-dynamics-main">
        <div className="agent-dynamics-page-head"><div><div className="agent-dynamics-eyebrow">Buyer-facing automation</div><h1>自动回复 Agent</h1><div className="agent-dynamics-page-sub">只关注买家消息进入后的实时处理状态、链路动态和可追溯运行记录。</div></div><div className="agent-dynamics-head-actions"><AgentDynamicsDropdown value={controller.filters.range} options={rangeOptions} ariaLabel="时间范围" triggerClassName="agent-dynamics-head-range" onChange={(range) => controller.setFilters((previous) => ({ ...previous, range, page: 1 }))} /><button type="button" className="agent-dynamics-btn primary" onClick={openFirstException}>查看待处理异常</button></div></div>
        {summaryError && <ErrorBanner error={summaryError} onRetry={() => void controller.reloadSummary()} />}
        {controller.summary.phase === 'loading' && !summary ? <SkeletonBlocks /> : summary ? <>
          <KpiStrip items={summary.kpis} />
          <RuntimePanel summary={summary} onOpenRun={openRun} />
          <section className="agent-dynamics-status-grid"><StatusPanel statusDistribution={summary.statusDistribution} /><ExceptionPanel exceptions={summary.exceptions} onOpenFirst={openFirstException} /></section>
        </> : null}
        <RunsTable filters={controller.filters} data={controller.runs.data} onFilterChange={(patch) => controller.setFilters((previous) => ({ ...previous, ...patch }))} onOpenRun={openRun} onRetry={() => void controller.reloadRuns()} loading={controller.runs.phase === 'loading'} error={runsError} />
      </main>
    </section>
    <RunDrawer detail={controller.detail} onClose={controller.closeRun} onRetry={() => controller.detail.runId && void controller.openRun(controller.detail.runId)} onOpenChat={navigateToMessages} />
  </div>;
}
