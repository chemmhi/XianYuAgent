import { useState, type MouseEvent, type ReactNode } from 'react';
import type { DashboardQuery, DashboardRange, DashboardState } from '../types';
import { Button } from '../../../shared/ui/Button';
import { InputField } from '../../../shared/ui/InputField';
import { SelectField } from '../../../shared/ui/SelectField';

function Icon({ name }: { name: string }) {
  const paths: Record<string, ReactNode> = {
    grid: <><rect x="4" y="4" width="6" height="6" rx="1.5"/><rect x="14" y="4" width="6" height="6" rx="1.5"/><rect x="4" y="14" width="6" height="6" rx="1.5"/><rect x="14" y="14" width="6" height="6" rx="1.5"/></>,
    message: <><path d="M5 6.5h14M5 11.5h10M5 16.5h7"/><path d="M4 4h16v13H9l-4 3v-3H4z"/></>,
    user: <><circle cx="12" cy="8" r="3.5"/><path d="M5.5 20c1.1-3.6 3.2-5.4 6.5-5.4s5.4 1.8 6.5 5.4"/></>,
    inbox: <><path d="M4.5 13 7 5h10l2.5 8"/><path d="M4.5 13h4l1.5 3h4l1.5-3h4v6H4.5z"/></>,
    box: <><path d="m12 4 8 4-8 4-8-4 8-4Z"/><path d="m4 8v8l8 4 8-4V8M12 12v8"/></>,
    ticket: <><path d="M4 7.5A2.5 2.5 0 0 0 6.5 5h11A2.5 2.5 0 0 0 20 7.5V9a2 2 0 0 0 0 4v1.5A2.5 2.5 0 0 0 17.5 17h-11A2.5 2.5 0 0 0 4 14.5V13a2 2 0 0 0 0-4V7.5Z"/><path d="M12 7v10"/></>,
    cart: <><path d="M4 5h2l2.1 10.2a2 2 0 0 0 2 1.6h6.8a2 2 0 0 0 1.9-1.4L20 9H7"/><circle cx="10" cy="19" r="1.2"/><circle cx="17" cy="19" r="1.2"/></>,
    gear: <><circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M4.2 7.5l2.6 1.5M17.2 15l2.6 1.5M19.8 7.5 17.2 9M6.8 15l-2.6 1.5"/></>,
    bell: <><path d="M7 10a5 5 0 0 1 10 0v4l2 3H5l2-3z"/><path d="M10 19a2 2 0 0 0 4 0"/></>,
    refresh: <><path d="M20 11a8 8 0 0 0-14.7-3L4 10"/><path d="M4 5v5h5"/><path d="M4 13a8 8 0 0 0 14.7 3L20 14"/><path d="M20 19v-5h-5"/></>,
  };
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="dashboard-icon"><g>{paths[name] ?? paths.grid}</g></svg>;
}

export function Logo() { return <div className="dashboard-logo" aria-label="XianyuSellerAgent"><span/><span/><span/><span/></div>; }

export function Badge({ tone = 'gray', children }: { tone?: string; children: ReactNode }) { return <span className={`dashboard-badge dashboard-badge-${tone}`}>{children}</span>; }

function toneClass(tone: string) { return `tone-${tone}`; }

export function MiniAreaChart({ state, compact = false }: { state: DashboardState; compact?: boolean }) {
  const points = state.data?.trend.length ? state.data.trend : [
    { label: '周一', primary: 58, secondary: 82 }, { label: '周二', primary: 64, secondary: 85 }, { label: '周三', primary: 61, secondary: 84 }, { label: '周四', primary: 75, secondary: 88 }, { label: '周五', primary: 72, secondary: 90 }, { label: '周六', primary: 84, secondary: 93 },
  ];
  const makePath = (values: number[]) => {
    const max = Math.max(...values); const min = Math.min(...values); const w = 520; const h = 170;
    return values.map((value, index) => { const x = 18 + (index * (w - 36)) / Math.max(1, values.length - 1); const y = 14 + (h - 34) * (1 - (value - min) / Math.max(1, max - min)); return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`; }).join(' ');
  };
  const primary = makePath(points.map((point) => point.primary));
  const secondary = makePath(points.map((point) => point.secondary));
  const labels = points.map((point) => point.label);
  const labelStep = Math.max(1, Math.ceil(labels.length / 6));
  const gradientSuffix = compact ? 'mobile' : 'desktop';
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const activeIndex = hoveredIndex === null ? null : Math.min(hoveredIndex, Math.max(0, points.length - 1));
  const hoverX = activeIndex === null ? 0 : 18 + (activeIndex * (520 - 36)) / Math.max(1, points.length - 1);
  const tooltipLeft = Math.min(86, Math.max(14, (hoverX / 520) * 100));
  const handleMouseMove = (event: MouseEvent<SVGSVGElement>) => {
    if (points.length < 2) {
      setHoveredIndex(0);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / Math.max(1, rect.width)));
    setHoveredIndex(Math.round(ratio * (points.length - 1)));
  };
  return <div className={`dashboard-chart-wrap${compact ? ' dashboard-chart-compact' : ''}`} role="img" aria-label="订单金额与自动处理趋势图">
    <svg viewBox="0 0 520 188" preserveAspectRatio="none" onMouseMove={handleMouseMove} onMouseLeave={() => setHoveredIndex(null)}>
      <defs>
        <linearGradient id={`dashboard-primary-${gradientSuffix}`} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#245A8D" stopOpacity="0.12"/><stop offset="100%" stopColor="#245A8D" stopOpacity="0.01"/></linearGradient>
        <linearGradient id={`dashboard-secondary-${gradientSuffix}`} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#2E7D5B" stopOpacity="0.10"/><stop offset="100%" stopColor="#2E7D5B" stopOpacity="0.01"/></linearGradient>
      </defs>
      {[40, 78, 116, 154].map((y) => <line key={y} x1="20" x2="500" y1={y} y2={y} className="dashboard-chart-grid"/>)}
      <path d={`${secondary} L 502 176 L 18 176 Z`} fill={`url(#dashboard-secondary-${gradientSuffix})`}/>
      <path d={`${primary} L 502 176 L 18 176 Z`} fill={`url(#dashboard-primary-${gradientSuffix})`}/>
      <path d={secondary} className="dashboard-chart-line dashboard-chart-line-secondary"/>
      <path d={primary} className="dashboard-chart-line"/>
      {activeIndex !== null ? <line x1={hoverX} x2={hoverX} y1="14" y2="176" className="dashboard-chart-hover-line"/> : null}
      {activeIndex !== null ? <circle cx={hoverX} cy={14 + (170 - 34) * (1 - (points[activeIndex]!.primary - Math.min(...points.map((point) => point.primary))) / Math.max(1, Math.max(...points.map((point) => point.primary)) - Math.min(...points.map((point) => point.primary))))} r="3.5" className="dashboard-chart-dot dashboard-chart-dot-primary"/> : null}
      {activeIndex !== null ? <circle cx={hoverX} cy={14 + (170 - 34) * (1 - (points[activeIndex]!.secondary - Math.min(...points.map((point) => point.secondary))) / Math.max(1, Math.max(...points.map((point) => point.secondary)) - Math.min(...points.map((point) => point.secondary))))} r="3.5" className="dashboard-chart-dot dashboard-chart-dot-secondary"/> : null}
    </svg>
    <div className="dashboard-chart-axis" aria-hidden="true">{labels.map((label, index) => <span key={`${label}-${index}`}>{labels.length <= 7 || index === 0 || index === labels.length - 1 || index % labelStep === 0 ? label : ''}</span>)}</div>
    {activeIndex !== null ? <div className="dashboard-chart-tooltip" style={{ left: `${tooltipLeft}%` }}><strong>{points[activeIndex]!.label}</strong><span>订单金额 ¥{points[activeIndex]!.primary.toLocaleString('zh-CN')}</span><span>AI 闭环率 {points[activeIndex]!.secondary}%</span></div> : null}
    <div className="dashboard-chart-legend"><span><i className="dashboard-legend-line primary"/>订单金额</span><span><i className="dashboard-legend-line secondary"/>AI 闭环率</span></div>
  </div>;
}

function TrendRangeControl({ query, onChange }: { query: DashboardQuery; onChange: (query: DashboardQuery) => void }) {
  const [customFrom, setCustomFrom] = useState(query.from ?? '');
  const [customTo, setCustomTo] = useState(query.to ?? '');
  const [customOpen, setCustomOpen] = useState(query.range === 'custom');
  const [monthValue, setMonthValue] = useState('');
  const quickRanges: Array<{ value: Exclude<DashboardRange, 'custom'>; label: string }> = [
    { value: 'today', label: '今天' },
    { value: '3d', label: '三天' },
    { value: '7d', label: '7天内' },
    { value: '1m', label: '一个月内' },
  ];
  const currentDate = new Date();
  const currentYear = currentDate.getFullYear();
  const currentMonth = currentDate.getMonth() + 1;
  const monthOptions = Array.from({ length: currentMonth }, (_, index) => {
    const month = currentMonth - index;
    return { value: `${currentYear}-${String(month).padStart(2, '0')}`, label: `${month}月` };
  });
  const setQuickRange = (range: Exclude<DashboardRange, 'custom'>) => {
    setCustomOpen(false);
    setMonthValue('');
    onChange({ range });
  };
  const selectMonth = (value: string) => {
    if (!value) return;
    const [yearText, monthText] = value.split('-');
    const year = Number(yearText);
    const month = Number(monthText);
    const from = `${yearText}-${monthText}-01`;
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const to = `${yearText}-${monthText}-${String(lastDay).padStart(2, '0')}`;
    setMonthValue(value);
    setCustomOpen(false);
    onChange({ range: 'custom', from, to });
  };
  return <div className="dashboard-trend-controls" aria-label="趋势时间范围">
    <div className="dashboard-trend-quick-ranges">{quickRanges.map((option) => <Button key={option.value} type="button" size="small" variant={query.range === option.value ? 'primary' : 'default'} className="dashboard-trend-range-btn" onClick={() => setQuickRange(option.value)}>{option.label}</Button>)}</div>
    <SelectField className="dashboard-trend-month-select" aria-label="月份选择" value={monthValue} options={[{ value: '', label: '月份选择' }, ...monthOptions]} onChange={(event) => selectMonth(event.target.value)}/>
    <Button type="button" size="small" variant={customOpen ? 'primary' : 'default'} className="dashboard-trend-custom-toggle" onClick={() => { setCustomOpen(true); setMonthValue(''); }}>自定义时间区间</Button>
    {customOpen ? <div className="dashboard-trend-custom-panel">
      <InputField className="dashboard-trend-date" aria-label="趋势开始日期" type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)}/>
      <span className="dashboard-trend-date-separator">至</span>
      <InputField className="dashboard-trend-date" aria-label="趋势结束日期" type="date" value={customTo} onChange={(event) => setCustomTo(event.target.value)}/>
      <Button type="button" size="small" variant="ghost" className="dashboard-trend-apply" disabled={!customFrom || !customTo} onClick={() => onChange({ range: 'custom', from: customFrom, to: customTo })}>应用</Button>
    </div> : null}
  </div>;
}

export function DashboardDesktopContent({ state, query, apiMode, onOpenTodo, onRefresh, onTrendQueryChange }: { state: DashboardState; query: DashboardQuery; apiMode: 'live' | 'mock'; onOpenTodo: (id: string) => void; onRefresh: () => void; onTrendQueryChange: (query: DashboardQuery) => void }) {
  const data = state.data;
  if (!data || state.phase !== 'success') return <DashboardStateViewBlock state={state} onRefresh={onRefresh}/>;
  return <section className="dashboard-page-stack" data-dashboard-surface="desktop">
    <div className="dashboard-kpi-grid">{data.kpis.map((kpi) => <article className="dashboard-card dashboard-kpi-card" key={kpi.key}><div className="dashboard-kpi-label">{kpi.label}</div><div className="dashboard-kpi-value">{kpi.value}</div><div className="dashboard-kpi-delta"><span className={toneClass(kpi.tone)}>{kpi.delta}</span><small>{kpi.context}</small></div></article>)}</div>
    <div className="dashboard-main-grid"><article className="dashboard-card dashboard-panel"><div className="dashboard-panel-head"><div><h2>订单与 AI 闭环趋势</h2><p>按所选时间范围查看订单金额、自动回复成功率和人工接管变化。</p></div><div className="dashboard-trend-head-actions"><TrendRangeControl query={query} onChange={onTrendQueryChange}/><Badge tone={apiMode === 'live' ? 'ok' : 'info'}>{apiMode === 'live' ? 'Live API' : 'Mock API'}</Badge></div></div><MiniAreaChart state={state}/></article></div>
    <div className="dashboard-two-grid"><article className="dashboard-card dashboard-panel"><div className="dashboard-panel-head"><div><h2>商品排行</h2><p>按当前账号订单与库存表现排序。</p></div><Badge tone="info">4 个商品</Badge></div><div className="dashboard-data-table dashboard-products-table"><div className="dashboard-table-head"><span>商品</span><span>订单</span><span>库存</span><span>状态</span></div>{data.productRank.length ? data.productRank.map((row) => <div className="dashboard-table-row" key={row.title}><span><b>{row.title}</b><small>{row.subtitle}</small></span><span>{row.orders}</span><span>{row.stock}</span><Badge tone={row.tone}>{row.status}</Badge></div>) : <div className="dashboard-empty-row">暂无商品排行</div>}</div></article><article className="dashboard-card dashboard-panel"><div className="dashboard-panel-head"><div><h2>最近处理记录</h2><p>最近 24 小时的 AI、订单与风险动作。</p></div><Badge tone="ok">自动刷新</Badge></div><div className="dashboard-timeline">{data.recentActivity.length ? data.recentActivity.map((item) => <button className="dashboard-timeline-row" key={`${item.time}-${item.text}`} type="button" onClick={() => item.href && onOpenTodo(item.href)}><strong>{item.time}</strong><span>{item.text}</span><Badge tone={item.tone}>{item.status}</Badge></button>) : <div className="dashboard-empty-row">暂无最近处理记录</div>}</div></article></div>
    <div className="dashboard-risk-strip"><div><strong>待处理风险</strong><span>{data.riskTodos.length} 个动作需要关注</span></div><div className="dashboard-risk-inline-list">{data.riskTodos.slice(0, 3).map((todo) => <button type="button" key={todo.id} className={`dashboard-risk-chip dashboard-risk-${todo.severity}`} onClick={() => onOpenTodo(todo.id)}><span>{todo.title}</span><small>查看</small></button>)}</div></div>
  </section>;
}

function DashboardStateViewBlock({ state, onRefresh }: { state: DashboardState; onRefresh: () => void }) {
  return <section className="dashboard-page-stack dashboard-state-stack" data-dashboard-surface="desktop"><DashboardStateView state={state} onRetry={onRefresh}/></section>;
}

function DashboardStateView({ state, onRetry }: { state: DashboardState; onRetry: () => void }) {
  if (state.phase === 'loading' || state.phase === 'idle') return <section className="dashboard-state-card" aria-live="polite"><div className="dashboard-skeleton-title"/><div className="dashboard-skeleton-copy"/><div className="dashboard-skeleton-grid">{[1, 2, 3, 4].map((key) => <span key={key}/>)}</div></section>;
  if (state.phase === 'empty') return <section className="dashboard-state-card"><strong>暂无今日数据</strong><p>当前账号范围内还没有可展示的经营数据。</p><button type="button" className="dashboard-btn dashboard-btn-primary" onClick={onRetry}>重新加载</button></section>;
  if (state.phase === 'forbidden') return <section className="dashboard-state-card dashboard-state-forbidden"><strong>暂无仪表盘权限</strong><p>{state.error?.message}</p></section>;
  if (state.phase === 'timeout') return <section className="dashboard-state-card dashboard-state-timeout"><strong>指标可能滞后</strong><p>{state.error?.message}</p><button type="button" className="dashboard-btn dashboard-btn-primary" onClick={onRetry}>重新刷新</button></section>;
  return <section className="dashboard-state-card dashboard-state-error"><strong>仪表盘加载失败</strong><p>{state.error?.message ?? '请检查连接后重试。'}</p><button type="button" className="dashboard-btn dashboard-btn-primary" onClick={onRetry}>重新加载</button></section>;
}

export function DashboardMobileContent({ state, onOpenTodo }: { state: DashboardState; onOpenTodo: (id: string) => void }) {
  const data = state.data;
  if (!data || state.phase !== 'success') return <div className="dashboard-mobile-state"><DashboardStateViewBlock state={state} onRefresh={() => undefined}/></div>;
  return <div className="dashboard-mobile-page" data-dashboard-surface="mobile">
    <section className="dashboard-mobile-status-summary dashboard-card"><div className="dashboard-mobile-section-head"><div><h2>Agent 在线 · 闲鱼账号 A</h2><p>180 秒托管策略 · 立即发货已启用 · 心跳 14:24:08</p></div><Badge tone="ok">正常</Badge></div><div className="dashboard-mobile-health-grid"><span><b>凭证边界</b><small>仅 buyer_deliverable</small></span><span><b>Outbox</b><small>7 pending / 128 done</small></span></div></section>
    <section className="dashboard-mobile-quick-grid" aria-label="移动端快捷动作">{[['补交付凭证', '考研英语资料', 'warn'], ['确认风险', '跨商品资源请求', 'danger'], ['查看发货', '7 单已执行', 'ok'], ['补充知识', '2 条新问题', 'info']].map(([title, meta, tone]) => <button type="button" className={`dashboard-mobile-quick-card dashboard-tone-card-${tone}`} key={title} onClick={() => onOpenTodo(title)}><span>{title}</span><small>{meta}</small></button>)}</section>
    <div className="dashboard-mobile-kpis">{data.kpis.map((kpi) => <article className="dashboard-card dashboard-kpi-card" key={kpi.key}><div className="dashboard-kpi-label">{kpi.label}</div><div className="dashboard-kpi-value">{kpi.value}</div><div className="dashboard-kpi-delta"><span className={toneClass(kpi.tone)}>{kpi.delta}</span><small>{kpi.context}</small></div></article>)}</div>
    <section className="dashboard-card dashboard-mobile-task-card"><div className="dashboard-mobile-section-head"><div><h2>今天优先处理</h2><p>按风险和时效排序，不展示桌面大表格。</p></div><Badge tone="warn">{data.riskTodos.length} 待办</Badge></div><div className="dashboard-mobile-task-list">{data.riskTodos.slice(0, 3).map((todo) => <button type="button" className={`dashboard-mobile-task-row ${todo.severity === 'high' ? 'urgent' : ''}`} key={todo.id} onClick={() => onOpenTodo(todo.id)}><i/><div><strong>{todo.title}</strong><span>{todo.detail}</span></div><Badge tone={todo.tone}>{todo.severity === 'high' ? '补凭证' : todo.severity === 'medium' ? '确认' : '补知识'}</Badge></button>)}</div></section>
    <section className="dashboard-card dashboard-mobile-pulse-card"><div className="dashboard-mobile-section-head"><div><h2>经营快照</h2><p>只保留移动端可扫读指标。</p></div><button type="button" className="dashboard-text-button">详情</button></div><MiniAreaChart state={state} compact/></section>
  </div>;
}

export { Icon };

