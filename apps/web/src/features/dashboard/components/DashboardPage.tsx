import { useState } from 'react';
import type { PageKey } from '../../../app/navigation';
import { navItems } from '../../../app/navigation';
import type { DashboardApi } from '../api';
import { useDashboardController } from '../controller';
import { DashboardDesktopContent, DashboardMobileContent, Icon, Logo } from './DashboardViews';
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
    <div className="dashboard-desktop-shell">
      <DashboardSidebar page="dashboard" onNavigate={onNavigate}/>
      <div className="dashboard-desktop-body"><main><DashboardDesktopContent state={controller.state} apiMode={apiMode} onOpenSettings={() => onNavigate('settings')} onOpenTodo={openTodo} onRefresh={controller.reload}/></main></div>
    </div>
    <div className="dashboard-mobile-frame">
      <div className="dashboard-mobile-status"><span>9:41</span><span>5G 100%</span></div>
      <header className="dashboard-mobile-head"><div><strong>今日总览</strong></div><div className="dashboard-mobile-head-actions"><button type="button" className="dashboard-mobile-account-chip" onClick={() => onNavigate('accounts')}>账号 A</button><button type="button" className="dashboard-icon-button" aria-label="通知" onClick={() => openTodo('todo_001')}><Icon name="bell"/><b>3</b></button></div></header>
      <main className="dashboard-mobile-main"><DashboardMobileContent state={controller.state} onOpenTodo={openTodo}/></main>
      <nav className="dashboard-mobile-tabs" aria-label="移动端主导航">{navItems.map((item) => <button type="button" key={item.key} className={item.key === 'dashboard' ? 'active' : ''} onClick={() => onNavigate(item.key)}><Icon name={item.icon}/><span>{item.key === 'dashboard' ? '总览' : item.label.replace('管理', '').replace('在线', '')}</span></button>)}</nav>
    </div>
    {activeTodo ? <aside className="dashboard-risk-drawer" role="dialog" aria-modal="true" aria-label="风险待办详情"><div className="dashboard-risk-drawer-card"><div className="dashboard-risk-drawer-head"><div><p className="dashboard-eyebrow">Risk Todo</p><h2>{activeTodo.title}</h2></div><button type="button" className="dashboard-icon-button" aria-label="关闭" onClick={() => setRiskDrawer(null)}>×</button></div><p>{activeTodo.detail}</p><div className="dashboard-risk-drawer-meta"><span>严重级别</span><strong className={`tone-${activeTodo.tone}`}>{activeTodo.severity}</strong></div><div className="dashboard-risk-drawer-actions"><button type="button" className="dashboard-btn dashboard-btn-ghost" onClick={() => setRiskDrawer(null)}>稍后处理</button><button type="button" className="dashboard-btn dashboard-btn-primary" onClick={() => { setRiskDrawer(null); onNavigate(activeTodo.href.slice(1) as PageKey); }}>去处理</button></div></div></aside> : null}
  </div>;
}

function DashboardSidebar({ page, onNavigate }: { page: PageKey; onNavigate: (page: PageKey) => void }) {
  return <aside className="dashboard-sidebar">
    <div className="dashboard-brand-block"><Logo/><div className="dashboard-brand-copy"><strong>Xianyu Agent</strong><span>Agent OS Console</span></div></div>
    <div className="dashboard-side-section">Operations</div>
    <nav className="dashboard-side-nav" aria-label="主导航">{navItems.map((item) => <button type="button" key={item.key} className={page === item.key ? 'active' : ''} aria-current={page === item.key ? 'page' : undefined} onClick={() => onNavigate(item.key)}><Icon name={item.icon}/><span>{item.label}</span><small>{item.sub}</small></button>)}</nav>
    <div className="dashboard-sidebar-bottom"><div className="dashboard-side-card"><span className="dashboard-online-dot"/><b>Agent 运行中</b><small>当前账号：闲鱼账号 A<br/>外部写动作经 Policy Gateway 与 Outbox。</small></div><button type="button" className="dashboard-sidebar-alert" aria-label="待确认动作" onClick={() => undefined}><Icon name="bell"/><b>3</b><span>待确认动作</span></button><div className="dashboard-sidebar-user"><div className="dashboard-avatar">陈</div><div><strong>运营管理员</strong><span>资料自动发货店</span></div></div></div>
  </aside>;
}

