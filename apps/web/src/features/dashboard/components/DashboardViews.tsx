import { useEffect, useId, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import type { DashboardKpiVM, DashboardQuery, DashboardRange, DashboardRiskTodoVM, DashboardState } from '../types';
import { Button } from '../../../shared/ui/Button';
import { InputField } from '../../../shared/ui/InputField';
import { SelectField } from '../../../shared/ui/SelectField';

function Icon({ name }: { name: string }) {
  const paths: Record<string, ReactNode> = {
    bell: <><path d="M7 10a5 5 0 0 1 10 0v4l2 3H5l2-3z"/><path d="M10 19a2 2 0 0 0 4 0"/></>,
    refresh: <><path d="M20 11a8 8 0 0 0-14.7-3L4 10"/><path d="M4 5v5h5"/><path d="M4 13a8 8 0 0 0 14.7 3L20 14"/><path d="M20 19v-5h-5"/></>,
  };
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="dashboard-icon"><g>{paths[name] ?? paths.grid}</g></svg>;
}

export function Badge({ tone = 'gray', children }: { tone?: string; children: ReactNode }) { return <span className={`dashboard-badge dashboard-badge-${tone}`}>{children}</span>; }

function toneClass(tone: string) { return `tone-${tone}`; }

const CHART_LEFT = 20;
const CHART_RIGHT = 500;
const CHART_TOP = 16;
const CHART_BOTTOM = 214;

type ChartScale = { min: number; max: number; ticks: number[] };

function niceStep(rawStep: number) {
  if (!Number.isFinite(rawStep) || rawStep <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;
  const factor = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return factor * magnitude;
}

function createChartScale(values: number[], kind: 'currency' | 'percent'): ChartScale {
  const safeValues = values.filter((value) => Number.isFinite(value));
  if (kind === 'percent') return { min: 0, max: 100, ticks: [0, 25, 50, 75, 100] };
  const maxValue = Math.max(0, ...(safeValues.length ? safeValues : [0]));
  const step = niceStep(maxValue / 4 || 1);
  const max = Math.max(step * 4, Math.ceil(maxValue / step) * step);
  return { min: 0, max, ticks: Array.from({ length: 5 }, (_, index) => index * (max / 4)) };
}

function chartY(value: number, scale: ChartScale) {
  return CHART_TOP + (CHART_BOTTOM - CHART_TOP) * (1 - (value - scale.min) / Math.max(1, scale.max - scale.min));
}

function formatAxisTick(value: number, kind: 'currency' | 'percent') {
  if (kind === 'percent') return `${Math.round(value)}%`;
  if (value >= 10000) return `¥${(value / 10000).toFixed(value % 10000 === 0 ? 0 : 1)}万`;
  return `¥${Math.round(value).toLocaleString('zh-CN')}`;
}

export function MiniAreaChart({ state, compact = false }: { state: DashboardState; compact?: boolean }) {
  const points = state.data?.trend.length ? state.data.trend : [
    { label: '周一', primary: 58, secondary: 82 }, { label: '周二', primary: 64, secondary: 85 }, { label: '周三', primary: 61, secondary: 84 }, { label: '周四', primary: 75, secondary: 88 }, { label: '周五', primary: 72, secondary: 90 }, { label: '周六', primary: 84, secondary: 93 },
  ];
  const primaryScale = createChartScale(points.map((point) => point.primary), 'currency');
  const secondaryScale = createChartScale(points.map((point) => point.secondary), 'percent');
  const makePath = (values: number[], scale: ChartScale) => values.map((value, index) => {
    const x = CHART_LEFT + (index * (CHART_RIGHT - CHART_LEFT)) / Math.max(1, values.length - 1);
    return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${chartY(value, scale).toFixed(1)}`;
  }).join(' ');
  const primaryValues = points.map((point) => point.primary);
  const secondaryValues = points.map((point) => point.secondary);
  const primary = makePath(primaryValues, primaryScale);
  const secondary = makePath(secondaryValues, secondaryScale);
  const labels = points.map((point) => point.label);
  const labelStep = Math.max(1, Math.ceil(labels.length / 6));
  const gradientSuffix = compact ? 'mobile' : 'desktop';
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const activeIndex = hoveredIndex === null ? null : Math.min(hoveredIndex, Math.max(0, points.length - 1));
  const hoverX = activeIndex === null ? 0 : CHART_LEFT + (activeIndex * (CHART_RIGHT - CHART_LEFT)) / Math.max(1, points.length - 1);
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
    <svg viewBox="0 0 520 232" preserveAspectRatio="none" onMouseMove={handleMouseMove} onMouseLeave={() => setHoveredIndex(null)}>
      <defs>
        <linearGradient id={`dashboard-primary-${gradientSuffix}`} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#245A8D" stopOpacity="0.12"/><stop offset="100%" stopColor="#245A8D" stopOpacity="0.01"/></linearGradient>
        <linearGradient id={`dashboard-secondary-${gradientSuffix}`} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#2E7D5B" stopOpacity="0.10"/><stop offset="100%" stopColor="#2E7D5B" stopOpacity="0.01"/></linearGradient>
      </defs>
      {primaryScale.ticks.map((tick) => <line key={tick} x1={CHART_LEFT} x2={CHART_RIGHT} y1={chartY(tick, primaryScale)} y2={chartY(tick, primaryScale)} className="dashboard-chart-grid"/>)}
      <path d={`${secondary} L ${CHART_RIGHT} ${CHART_BOTTOM} L ${CHART_LEFT} ${CHART_BOTTOM} Z`} fill={`url(#dashboard-secondary-${gradientSuffix})`}/>
      <path d={`${primary} L ${CHART_RIGHT} ${CHART_BOTTOM} L ${CHART_LEFT} ${CHART_BOTTOM} Z`} fill={`url(#dashboard-primary-${gradientSuffix})`}/>
      <path d={secondary} className="dashboard-chart-line dashboard-chart-line-secondary"/>
      <path d={primary} className="dashboard-chart-line"/>
      {activeIndex !== null ? <line x1={hoverX} x2={hoverX} y1={CHART_TOP} y2={CHART_BOTTOM} className="dashboard-chart-hover-line"/> : null}
      {activeIndex !== null ? <circle cx={hoverX} cy={chartY(points[activeIndex]!.primary, primaryScale)} r="3.5" className="dashboard-chart-dot dashboard-chart-dot-primary"/> : null}
      {activeIndex !== null ? <circle cx={hoverX} cy={chartY(points[activeIndex]!.secondary, secondaryScale)} r="3.5" className="dashboard-chart-dot dashboard-chart-dot-secondary"/> : null}
    </svg>
    <div className="dashboard-chart-y-axis dashboard-y-axis-primary" aria-hidden="true">{primaryScale.ticks.slice().reverse().map((tick) => <span key={tick}>{formatAxisTick(tick, 'currency')}</span>)}</div>
    <div className="dashboard-chart-y-axis dashboard-y-axis-secondary" aria-hidden="true">{secondaryScale.ticks.slice().reverse().map((tick) => <span key={tick}>{formatAxisTick(tick, 'percent')}</span>)}</div>
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

function PendingManualKpiCard({ kpi, riskTodos, onOpenTodo, surface }: { kpi: DashboardKpiVM; riskTodos: DashboardRiskTodoVM[]; onOpenTodo: (id: string) => void; surface: 'desktop' | 'mobile' }) {
  const [open, setOpen] = useState(false);
  const cardRef = useRef<HTMLElement | null>(null);
  const popoverId = `dashboard-risk-popover-${useId()}`;
  const visibleTodos = riskTodos.slice(0, 3);

  useEffect(() => {
    if (!open) return undefined;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const handleOutsidePointer = (event: PointerEvent) => {
      if (cardRef.current && !cardRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', handleEscape);
    document.addEventListener('pointerdown', handleOutsidePointer);
    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.removeEventListener('pointerdown', handleOutsidePointer);
    };
  }, [open]);

  return <article ref={cardRef} className="dashboard-card dashboard-kpi-card dashboard-pending-manual-card" data-testid={`pending-manual-card-${surface}`}>
    <div className="dashboard-kpi-card-head">
      <div className="dashboard-kpi-label">{kpi.label}</div>
      <button type="button" className="dashboard-icon-button dashboard-kpi-bell" data-testid={`pending-manual-bell-${surface}`} aria-label={open ? '收起待人工处理' : '展开待人工处理'} aria-haspopup="dialog" aria-controls={popoverId} aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        <Icon name="bell"/>
        <b>{riskTodos.length}</b>
      </button>
    </div>
    <div className="dashboard-kpi-value">{kpi.value}</div>
    <div className="dashboard-kpi-delta"><span className={toneClass(kpi.tone)}>{kpi.delta}</span><small>{kpi.context}</small></div>
    {open ? <div id={popoverId} className="dashboard-risk-popover" data-testid="risk-popover" role="dialog" aria-modal="false" aria-label="待人工处理风险待办">
      <div className="dashboard-risk-popover-head"><div><strong>待处理风险</strong><span>{riskTodos.length} 个动作需要关注</span></div><span className="dashboard-risk-popover-count">{riskTodos.length}</span></div>
      {visibleTodos.length ? <div className="dashboard-risk-popover-list">{visibleTodos.map((todo) => <button type="button" key={todo.id} className={`dashboard-risk-popover-item dashboard-risk-${todo.severity}`} onClick={() => { setOpen(false); onOpenTodo(todo.id); }}><span className="dashboard-risk-popover-dot"/><span className="dashboard-risk-popover-copy"><strong>{todo.title}</strong><small>{todo.detail}</small></span><span className="dashboard-risk-popover-action">查看</span></button>)}</div> : <p className="dashboard-risk-popover-empty">当前没有待人工处理事项</p>}
    </div> : null}
  </article>;
}

export function DashboardDesktopContent({ state, query, onOpenTodo, onRefresh, onTrendQueryChange }: { state: DashboardState; query: DashboardQuery; onOpenTodo: (id: string) => void; onRefresh: () => void; onTrendQueryChange: (query: DashboardQuery) => void }) {
  const data = state.data;
  if (!data || state.phase !== 'success') return <DashboardStateViewBlock state={state} onRefresh={onRefresh}/>;
  return <section className="dashboard-page-stack" data-dashboard-surface="desktop">
    <div className="dashboard-kpi-grid">{data.kpis.map((kpi) => kpi.key === 'pendingManual' ? <PendingManualKpiCard key={kpi.key} kpi={kpi} riskTodos={data.riskTodos} onOpenTodo={onOpenTodo} surface="desktop"/> : <article className="dashboard-card dashboard-kpi-card" key={kpi.key}><div className="dashboard-kpi-label">{kpi.label}</div><div className="dashboard-kpi-value">{kpi.value}</div><div className="dashboard-kpi-delta"><span className={toneClass(kpi.tone)}>{kpi.delta}</span><small>{kpi.context}</small></div></article>)}</div>
    <div className="dashboard-main-grid"><article className="dashboard-card dashboard-panel"><div className="dashboard-panel-head"><div><h2>订单与 AI 闭环趋势</h2><p>按所选时间范围查看订单金额、自动回复成功率和人工接管变化。</p></div><div className="dashboard-trend-head-actions"><TrendRangeControl query={query} onChange={onTrendQueryChange}/></div></div><MiniAreaChart state={state}/></article></div>
    <div className="dashboard-two-grid"><article className="dashboard-card dashboard-panel"><div className="dashboard-panel-head"><div><h2>商品排行</h2><p>按当前账号订单与库存表现排序。</p></div><Badge tone="info">4 个商品</Badge></div><div className="dashboard-data-table dashboard-products-table"><div className="dashboard-table-head"><span>商品</span><span>订单</span><span>库存</span><span>状态</span></div>{data.productRank.length ? data.productRank.map((row) => <div className="dashboard-table-row" key={row.title}><span><b>{row.title}</b><small>{row.subtitle}</small></span><span>{row.orders}</span><span>{row.stock}</span><Badge tone={row.tone}>{row.status}</Badge></div>) : <div className="dashboard-empty-row">暂无商品排行</div>}</div></article><article className="dashboard-card dashboard-panel"><div className="dashboard-panel-head"><div><h2>最近处理记录</h2><p>最近 24 小时的 AI、订单与风险动作。</p></div><Badge tone="ok">自动刷新</Badge></div><div className="dashboard-timeline">{data.recentActivity.length ? data.recentActivity.map((item) => <button className="dashboard-timeline-row" key={`${item.time}-${item.text}`} type="button" onClick={() => item.href && onOpenTodo(item.href)}><strong>{item.time}</strong><span>{item.text}</span><Badge tone={item.tone}>{item.status}</Badge></button>) : <div className="dashboard-empty-row">暂无最近处理记录</div>}</div></article></div>
  </section>;
}

function DashboardStateViewBlock({ state, onRefresh }: { state: DashboardState; onRefresh: () => void }) {
  return <section className="dashboard-page-stack dashboard-state-stack" data-dashboard-surface="desktop"><DashboardStateView state={state} onRetry={onRefresh}/></section>;
}

function DashboardStateView({ state, onRetry }: { state: DashboardState; onRetry: () => void }) {
  if (state.phase === 'loading' || state.phase === 'idle') return <section className="dashboard-state-card" aria-live="polite"><div className="dashboard-skeleton-title"/><div className="dashboard-skeleton-copy"/><div className="dashboard-skeleton-grid">{[1, 2, 3, 4].map((key) => <span key={key}/>)}</div></section>;
  if (state.phase === 'empty') {
    const accountRequired = state.error?.code === 'ACCOUNT_CONTEXT_REQUIRED';
    return <section className="dashboard-state-card"><strong>{accountRequired ? '请先选择当前账号' : '暂无今日数据'}</strong><p>{state.error?.message ?? '当前账号范围内还没有可展示的经营数据。'}</p><button type="button" className="dashboard-btn dashboard-btn-primary" onClick={onRetry}>{accountRequired ? '前往账号管理' : '重新加载'}</button></section>;
  }
  if (state.phase === 'forbidden') return <section className="dashboard-state-card dashboard-state-forbidden"><strong>暂无仪表盘权限</strong><p>{state.error?.message}</p></section>;
  if (state.phase === 'timeout') return <section className="dashboard-state-card dashboard-state-timeout"><strong>指标可能滞后</strong><p>{state.error?.message}</p><button type="button" className="dashboard-btn dashboard-btn-primary" onClick={onRetry}>重新刷新</button></section>;
  return <section className="dashboard-state-card dashboard-state-error"><strong>仪表盘加载失败</strong><p>{state.error?.message ?? '请检查连接后重试。'}</p><button type="button" className="dashboard-btn dashboard-btn-primary" onClick={onRetry}>重新加载</button></section>;
}

export function DashboardMobileContent({ state, accountLabel = '当前账号', onOpenTodo, onRefresh = () => undefined }: { state: DashboardState; accountLabel?: string; onOpenTodo: (id: string) => void; onRefresh?: () => void }) {
  const data = state.data;
  if (!data || state.phase !== 'success') return <div className="dashboard-mobile-state"><DashboardStateViewBlock state={state} onRefresh={onRefresh}/></div>;
  return <div className="dashboard-mobile-page" data-dashboard-surface="mobile">
    <section className="dashboard-mobile-status-summary dashboard-card"><div className="dashboard-mobile-section-head"><div><h2>Agent 在线 · {accountLabel}</h2><p>180 秒托管策略 · 立即发货已启用 · 心跳 14:24:08</p></div><Badge tone="ok">正常</Badge></div><div className="dashboard-mobile-health-grid"><span><b>凭证边界</b><small>仅 buyer_deliverable</small></span><span><b>Outbox</b><small>7 pending / 128 done</small></span></div></section>
    <section className="dashboard-mobile-quick-grid" aria-label="移动端快捷动作">{[['补交付凭证', '考研英语资料', 'warn'], ['确认风险', '跨商品资源请求', 'danger'], ['查看发货', '7 单已执行', 'ok'], ['补充知识', '2 条新问题', 'info']].map(([title, meta, tone]) => <button type="button" className={`dashboard-mobile-quick-card dashboard-tone-card-${tone}`} key={title} onClick={() => onOpenTodo(title)}><span>{title}</span><small>{meta}</small></button>)}</section>
    <div className="dashboard-mobile-kpis">{data.kpis.map((kpi) => kpi.key === 'pendingManual' ? <PendingManualKpiCard key={kpi.key} kpi={kpi} riskTodos={data.riskTodos} onOpenTodo={onOpenTodo} surface="mobile"/> : <article className="dashboard-card dashboard-kpi-card" key={kpi.key}><div className="dashboard-kpi-label">{kpi.label}</div><div className="dashboard-kpi-value">{kpi.value}</div><div className="dashboard-kpi-delta"><span className={toneClass(kpi.tone)}>{kpi.delta}</span><small>{kpi.context}</small></div></article>)}</div>
    <section className="dashboard-card dashboard-mobile-task-card"><div className="dashboard-mobile-section-head"><div><h2>今天优先处理</h2><p>按风险和时效排序，不展示桌面大表格。</p></div><Badge tone="warn">{data.riskTodos.length} 待办</Badge></div><div className="dashboard-mobile-task-list">{data.riskTodos.slice(0, 3).map((todo) => <button type="button" className={`dashboard-mobile-task-row ${todo.severity === 'high' ? 'urgent' : ''}`} key={todo.id} onClick={() => onOpenTodo(todo.id)}><i/><div><strong>{todo.title}</strong><span>{todo.detail}</span></div><Badge tone={todo.tone}>{todo.severity === 'high' ? '补凭证' : todo.severity === 'medium' ? '确认' : '补知识'}</Badge></button>)}</div></section>
    <section className="dashboard-card dashboard-mobile-pulse-card"><div className="dashboard-mobile-section-head"><div><h2>经营快照</h2><p>只保留移动端可扫读指标。</p></div><button type="button" className="dashboard-text-button">详情</button></div><MiniAreaChart state={state} compact/></section>
  </div>;
}

export { Icon };

