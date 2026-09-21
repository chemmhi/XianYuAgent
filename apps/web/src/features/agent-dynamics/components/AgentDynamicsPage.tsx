import { useMemo, useState } from 'react';
import { useAccountContext } from '../../../app/account-context';
import type { PageKey } from '../../../app/navigation';
import { createMockAgentDynamicsApi, type AgentDynamicsApi } from '../api';
import { useAgentDynamicsController } from '../controller';
import { ErrorBanner, ExceptionPanel, KpiStrip, RunDrawer, RunsTable, RuntimePanel, SkeletonBlocks, StatusPanel } from './AgentDynamicsViews';
import './agent-dynamics.css';

type AgentSection = 'overview' | 'realtime' | 'runs' | 'exceptions' | 'config';

const localNav: Array<{ key: AgentSection; label: string; icon: string }> = [
  { key: 'overview', label: '运行总览', icon: '▦' },
  { key: 'realtime', label: '实时动态', icon: '◌' },
  { key: 'runs', label: '运行记录', icon: '≡' },
  { key: 'exceptions', label: '异常追踪', icon: '!' },
  { key: 'config', label: '配置', icon: '＋' },
];

export interface AgentDynamicsPageProps {
  api?: AgentDynamicsApi;
  onNavigate?: (page: PageKey) => void;
}

export function AgentDynamicsPage({ api: providedApi, onNavigate }: AgentDynamicsPageProps) {
  const { currentAccountId } = useAccountContext();
  const api = useMemo(() => providedApi ?? createMockAgentDynamicsApi(), [providedApi]);
  const controller = useAgentDynamicsController({ api, accountId: currentAccountId });
  const [section, setSection] = useState<AgentSection>('overview');
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

  return <div className="agent-dynamics-app">
    <aside className="agent-dynamics-sidebar">
      <div className="agent-dynamics-brand"><div className="agent-dynamics-brand-mark" aria-hidden="true"><i /><i /><i /><i /></div><div><div className="agent-dynamics-brand-title">Xianyu SellerAgent</div><div className="agent-dynamics-brand-sub">intelligent operations</div></div></div>
      <div className="agent-dynamics-nav-label">Agent Console</div>
      <nav className="agent-dynamics-nav" aria-label="Agent 动态分区">{localNav.map((item) => <button type="button" key={item.key} className={section === item.key ? 'active' : ''} onClick={() => setSection(item.key)}><span className="agent-dynamics-nav-icon">{item.icon}</span>{item.label}</button>)}</nav>
      <div className="agent-dynamics-sidebar-spacer" />
      <div className="agent-dynamics-listener-card"><div className="agent-dynamics-listener-head"><span>闲鱼网关监听</span><span className="agent-dynamics-live-dot" /></div><div className="agent-dynamics-listener-title">正在监听买家消息</div><div className="agent-dynamics-listener-meta">最近事件 2 秒前 · 连接稳定<br />消息队列 6 条处理中</div></div>
    </aside>
    <section className="agent-dynamics-shell">
      <header className="agent-dynamics-topbar"><div className="agent-dynamics-crumb"><span>智能运营</span><span>/</span><strong>{localNav.find((item) => item.key === section)?.label ?? '自动回复 Agent'}</strong></div><div className="agent-dynamics-top-actions"><div className="agent-dynamics-account-chip"><span className="agent-dynamics-avatar">陈</span><span className="agent-dynamics-account-name">陈陈cc · 当前账号</span><span>⌄</span></div><button type="button" className="agent-dynamics-notif" aria-label="通知"><span>♧</span><span className="agent-dynamics-notif-badge">3</span></button></div></header>
      <main className="agent-dynamics-main">
        <div className="agent-dynamics-page-head"><div><div className="agent-dynamics-eyebrow">Buyer-facing automation</div><h1>自动回复 Agent</h1><div className="agent-dynamics-page-sub">只关注买家消息进入后的实时处理状态、链路动态和可追溯运行记录。</div></div><div className="agent-dynamics-head-actions"><select className="agent-dynamics-head-range" aria-label="时间范围" value={controller.filters.range} onChange={(event) => controller.setFilters((previous) => ({ ...previous, range: event.target.value as typeof previous.range, page: 1 }))}><option value="24h">最近 24 小时⌄</option><option value="7d">最近 7 天⌄</option></select><button type="button" className="agent-dynamics-btn primary" onClick={openFirstException}>查看待处理异常</button></div></div>
        {summaryError && <ErrorBanner error={summaryError} onRetry={() => void controller.reloadSummary()} />}
        {controller.summary.phase === 'loading' && !summary ? <SkeletonBlocks /> : summary ? <>
          <KpiStrip items={summary.kpis} loading={controller.summary.refreshing} />
          <RuntimePanel summary={summary} onOpenRun={openRun} />
          <section className="agent-dynamics-status-grid"><StatusPanel statusDistribution={summary.statusDistribution} /><ExceptionPanel exceptions={summary.exceptions} onOpenFirst={openFirstException} /></section>
        </> : null}
        <RunsTable filters={controller.filters} data={controller.runs.data} onFilterChange={(patch) => controller.setFilters((previous) => ({ ...previous, ...patch }))} onRangeChange={(range) => controller.setFilters((previous) => ({ ...previous, range, page: 1 }))} onOpenRun={openRun} onRetry={() => void controller.reloadRuns()} loading={controller.runs.phase === 'loading'} error={runsError} />
      </main>
    </section>
    <RunDrawer detail={controller.detail} onClose={controller.closeRun} onRetry={() => controller.detail.runId && void controller.openRun(controller.detail.runId)} onOpenChat={navigateToMessages} />
  </div>;
}
