import { useState } from 'react';
import type { PageKey } from '../../../app/navigation';
import type { DashboardApi } from '../api';
import { useDashboardController } from '../controller';
import { DashboardDesktopContent, DashboardMobileContent, Icon } from './DashboardViews';
import './dashboard.css';

export function DashboardPage({ api, apiMode, onNavigate }: { api?: DashboardApi; apiMode: 'live' | 'mock'; onNavigate: (page: PageKey) => void }) {
  const controller = useDashboardController({ api });
  const [riskDrawer, setRiskDrawer] = useState<string | null>(null);

  function openTodo(target: string) {
    const todo = controller.state.data?.riskTodos.find((item) => item.id === target);
    if (!todo && target.startsWith('/')) {
      onNavigate(target.slice(1) as PageKey);
      return;
    }
    setRiskDrawer(target);
  }

  const activeTodo = controller.state.data?.riskTodos.find((item) => item.id === riskDrawer);
  return <div className="dashboard-experience">
    <div className="dashboard-desktop-content"><DashboardDesktopContent state={controller.state} query={controller.query} apiMode={apiMode} onOpenTodo={openTodo} onRefresh={controller.reload} onTrendQueryChange={controller.setQuery}/></div>
    <div className="dashboard-mobile-content">
      <div className="dashboard-mobile-status"><span>9:41</span><span>5G 100%</span></div>
      <header className="dashboard-mobile-head"><div><strong>今日总览</strong></div><div className="dashboard-mobile-head-actions"><button type="button" className="dashboard-mobile-account-chip" onClick={() => onNavigate('accounts')}>账号 A</button><button type="button" className="dashboard-icon-button" aria-label="通知" onClick={() => openTodo('todo_001')}><Icon name="bell"/><b>3</b></button></div></header>
      <main className="dashboard-mobile-main"><DashboardMobileContent state={controller.state} onOpenTodo={openTodo}/></main>
    </div>
    {activeTodo ? <aside className="dashboard-risk-drawer" role="dialog" aria-modal="true" aria-label="风险待办详情"><div className="dashboard-risk-drawer-card"><div className="dashboard-risk-drawer-head"><div><p className="dashboard-eyebrow">Risk Todo</p><h2>{activeTodo.title}</h2></div><button type="button" className="dashboard-icon-button" aria-label="关闭" onClick={() => setRiskDrawer(null)}>×</button></div><p>{activeTodo.detail}</p><div className="dashboard-risk-drawer-meta"><span>严重级别</span><strong className={`tone-${activeTodo.tone}`}>{activeTodo.severity}</strong></div><div className="dashboard-risk-drawer-actions"><button type="button" className="dashboard-btn dashboard-btn-ghost" onClick={() => setRiskDrawer(null)}>稍后处理</button><button type="button" className="dashboard-btn dashboard-btn-primary" onClick={() => { setRiskDrawer(null); onNavigate(activeTodo.href.slice(1) as PageKey); }}>去处理</button></div></div></aside> : null}
  </div>;
}


