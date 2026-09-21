import type { ReactNode } from 'react';
import type {
  AgentDynamicsExceptionVM,
  AgentDynamicsDetailState,
  AgentDynamicsFilters,
  AgentDynamicsHealthStatVM,
  AgentDynamicsHealthVM,
  AgentDynamicsKpiVM,
  AgentDynamicsLoadError,
  AgentDynamicsPipelineStageVM,
  AgentDynamicsRunDetailVM,
  AgentDynamicsRunRowVM,
  AgentDynamicsRunsPageVM,
  AgentDynamicsStatusDistributionVM,
  AgentDynamicsSummaryVM,
  AgentDynamicsTimelineItemVM,
  AgentDynamicsTone,
} from '../types';

function classTone(tone: AgentDynamicsTone): string {
  return tone === 'success' ? 'success' : tone === 'warn' ? 'warn' : tone === 'danger' ? 'danger' : tone === 'info' ? 'info' : 'gray';
}

export function StatusTag({ tone, children }: { tone: AgentDynamicsTone; children: ReactNode }) {
  return <span className={`agent-dynamics-tag ${classTone(tone)}`}>{children}</span>;
}

export function Panel({ title, description, action, children, className = '' }: { title: string; description?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return <article className={`agent-dynamics-card agent-dynamics-panel ${className}`}>
    <div className="agent-dynamics-panel-head"><div><div className="agent-dynamics-panel-title">{title}</div>{description && <div className="agent-dynamics-panel-desc">{description}</div>}</div>{action}</div>
    {children}
  </article>;
}

export function KpiStrip({ items, loading }: { items: AgentDynamicsKpiVM[]; loading?: boolean }) {
  return <section className="agent-dynamics-kpis" aria-label="Agent 动态指标">
    {items.map((item) => <article className="agent-dynamics-card agent-dynamics-kpi" key={item.key}>
      <div className="agent-dynamics-kpi-label">{item.label}</div>
      <div className={`agent-dynamics-kpi-value ${loading ? 'skeleton' : ''}`} style={item.key === 'gateway' ? { color: 'var(--agent-success)', fontSize: 20 } : undefined}>{loading ? ' ' : item.value}</div>
      <div className="agent-dynamics-kpi-foot"><span className={`agent-dynamics-delta ${classTone(item.tone)}`}>{item.foot.split(' · ')[0]}</span>{item.foot.includes(' · ') && <span>{item.foot.split(' · ').slice(1).join(' · ')}</span>}</div>
    </article>)}
  </section>;
}

function stageStatusClass(status: AgentDynamicsPipelineStageVM['status']): string {
  return status === 'error' ? 'danger' : status === 'warning' ? 'warn' : 'success';
}

export function RuntimePanel({ summary, onOpenRun }: { summary: AgentDynamicsSummaryVM; onOpenRun: (runId: string) => void }) {
  return <section className="agent-dynamics-runtime-grid">
    <Panel title="实时运行动态" description="从闲鱼网关 push 到回复提交、状态跟踪和落库的当前处理情况。" action={<StatusTag tone="success">实时刷新</StatusTag>}>
      <div className="agent-dynamics-pipeline">
        {summary.pipeline.map((stage, index) => <div className="agent-dynamics-stage" key={stage.key}>
          <div className="agent-dynamics-stage-top"><span className="agent-dynamics-stage-index">{stage.index}</span><span className={`agent-dynamics-stage-status ${stageStatusClass(stage.status)}`} /></div>
          <div className="agent-dynamics-stage-name">{stage.label}</div>
          <div className="agent-dynamics-stage-meta"><strong>{stage.count.toLocaleString('zh-CN')}</strong><br />{stage.meta}</div>
          {index < summary.pipeline.length - 1 && <span className="agent-dynamics-stage-arrow" aria-hidden="true">→</span>}
        </div>)}
      </div>
      <div className="agent-dynamics-event-stream">
        {summary.events.map((event) => <button type="button" className="agent-dynamics-event-row" key={event.id} onClick={() => event.runId && onOpenRun(event.runId)}>
          <span className="agent-dynamics-event-time">{event.time}</span><span className={`agent-dynamics-event-dot ${classTone(event.tone)}`} />
          <span className="agent-dynamics-event-title"><strong>{event.title}</strong><span className="agent-dynamics-event-meta">{event.meta}</span></span>
          <StatusTag tone={event.tone}>{event.label}</StatusTag>
        </button>)}
      </div>
    </Panel>
    <HealthPanel health={summary.health} stats={summary.healthSummary} />
  </section>;
}

export function HealthPanel({ health, stats }: { health: AgentDynamicsHealthVM[]; stats: AgentDynamicsHealthStatVM[] }) {
  const healthy = health.every((item) => item.tone === 'success');
  return <Panel title="链路健康" description="基础设施状态和当前吞吐。" action={<StatusTag tone={healthy ? 'success' : 'warn'}>{health.filter((item) => item.tone === 'success').length}/{health.length} 正常</StatusTag>}>
    <div className="agent-dynamics-health-list">{health.map((item) => <div className="agent-dynamics-health-row" key={item.key}><span className={`agent-dynamics-health-mark ${classTone(item.tone)}`} /><div className="agent-dynamics-health-main"><div className="agent-dynamics-health-name">{item.name}</div><div className="agent-dynamics-health-meta">{item.meta}</div></div><span className="agent-dynamics-health-value">{item.value}</span></div>)}</div>
    <div className="agent-dynamics-health-summary">{stats.map((stat) => <div className="agent-dynamics-health-stat" key={stat.label}><div className="agent-dynamics-health-stat-label">{stat.label}</div><div className="agent-dynamics-health-stat-value">{stat.value}</div><div className="agent-dynamics-health-stat-note">{stat.note}</div></div>)}</div>
  </Panel>;
}

export function StatusPanel({ statusDistribution }: { statusDistribution: AgentDynamicsStatusDistributionVM[] }) {
  return <Panel title="执行状态分布" description="仅反映本次运行是否完成、是否需要人工介入以及发送/落库结果。" action={<button type="button" className="agent-dynamics-link-btn">查看状态说明 →</button>}>
    <div className="agent-dynamics-status-bars">{statusDistribution.map((item) => <div className="agent-dynamics-status-line" key={item.key}><span className="agent-dynamics-status-line-label">{item.label}</span><div className="agent-dynamics-status-track"><div className={`agent-dynamics-status-fill ${classTone(item.tone)}`} style={{ width: `${Math.max(0, Math.min(100, item.percent))}%` }} /></div><span className="agent-dynamics-status-percent">{item.percent.toFixed(1)}%</span></div>)}</div>
  </Panel>;
}

export function ExceptionPanel({ exceptions, onOpenFirst }: { exceptions: AgentDynamicsExceptionVM[]; onOpenFirst: () => void }) {
  return <Panel title="异常与待处理" description="只展示当前需要管理员动作的问题。" action={<StatusTag tone="danger">{exceptions.reduce((total, item) => total + item.count, 0)} 条待处理</StatusTag>}>
    <div className="agent-dynamics-exception-list">{exceptions.map((item) => <div className="agent-dynamics-exception" key={item.key}><span className={`agent-dynamics-exception-mark ${classTone(item.tone)}`} /><div><div className="agent-dynamics-exception-title">{item.title}</div><div className="agent-dynamics-exception-meta">{item.meta}</div></div><div className="agent-dynamics-exception-count">{item.count}</div></div>)}</div>
    <div className="agent-dynamics-exception-link"><button type="button" className="agent-dynamics-link-btn" onClick={onOpenFirst}>查看全部异常 →</button></div>
  </Panel>;
}

export function RunsTable({ filters, data, onFilterChange, onOpenRun, onRetry, loading, error, onRangeChange }: { filters: AgentDynamicsFilters; data: AgentDynamicsRunsPageVM | null; onFilterChange: (patch: Partial<AgentDynamicsFilters>) => void; onOpenRun: (runId: string) => void; onRetry: () => void; loading: boolean; error: AgentDynamicsLoadError | null; onRangeChange: (range: AgentDynamicsFilters['range']) => void }) {
  return <section className="agent-dynamics-card agent-dynamics-runs">
    <div className="agent-dynamics-runs-toolbar"><div><div className="agent-dynamics-panel-title">运行记录</div><div className="agent-dynamics-panel-desc">每条买家消息对应一条 Agent Run；点击记录查看完整输入、阶段和结果。</div></div><div className="agent-dynamics-filters"><select aria-label="时间范围" className="agent-dynamics-range" value={filters.range} onChange={(event) => onRangeChange(event.target.value as AgentDynamicsFilters['range'])}><option value="24h">最近 24 小时</option><option value="7d">最近 7 天</option></select><select aria-label="运行状态" className="agent-dynamics-filter" value={filters.status} onChange={(event) => onFilterChange({ status: event.target.value as AgentDynamicsFilters['status'], page: 1 })}><option value="all">全部状态</option><option value="replied">自动回复</option><option value="handoff">待人工</option><option value="failed">执行失败</option><option value="processing">处理中</option></select><select aria-label="运行阶段" className="agent-dynamics-filter" value={filters.stage} onChange={(event) => onFilterChange({ stage: event.target.value as AgentDynamicsFilters['stage'], page: 1 })}><option value="all">全部阶段</option><option value="gateway">网关接收</option><option value="intent">意图识别</option><option value="context">上下文读取</option><option value="generation">回复生成</option><option value="persistence">提交并落库</option></select><input className="agent-dynamics-search" value={filters.keyword} onChange={(event) => onFilterChange({ keyword: event.target.value, page: 1 })} placeholder="搜索买家、商品或消息" /></div></div>
    {error && <div className="agent-dynamics-inline-error" role="alert"><span>{error.message}</span>{error.retryable && <button type="button" className="agent-dynamics-link-btn" onClick={onRetry}>重试</button>}</div>}
    {loading && !data ? <div className="agent-dynamics-table-state"><span className="agent-dynamics-spinner" />正在读取运行记录…</div> : data && data.items.length > 0 ? <>
      <div className="agent-dynamics-table-scroll"><table className="agent-dynamics-run-table"><thead><tr><th>时间 / 买家</th><th>商品</th><th>意图</th><th>当前阶段</th><th>执行状态</th><th>发送 / 落库</th><th>耗时</th></tr></thead><tbody>{data.items.map((row) => <RunTableRow row={row} key={row.runId} onOpen={() => onOpenRun(row.runId)} />)}</tbody></table></div>
      <div className="agent-dynamics-run-footer"><span>显示 {data.total === 0 ? 0 : (data.page - 1) * data.pageSize + 1}-{Math.min(data.page * data.pageSize, data.total)} 条，共 {data.total.toLocaleString('zh-CN')} 条运行记录</span><div className="agent-dynamics-pagination"><button type="button" className="agent-dynamics-page-btn" disabled={data.page <= 1} onClick={() => onFilterChange({ page: Math.max(1, data.page - 1) })}>‹</button>{[1, 2, 3].map((page) => <button type="button" key={page} className={`agent-dynamics-page-btn ${data.page === page ? 'active' : ''}`} onClick={() => onFilterChange({ page })}>{page}</button>)}<span className="agent-dynamics-page-ellipsis">…</span><button type="button" className={`agent-dynamics-page-btn ${data.page === data.totalPages ? 'active' : ''}`} onClick={() => onFilterChange({ page: data.totalPages })}>{data.totalPages}</button><button type="button" className="agent-dynamics-page-btn" disabled={data.page >= data.totalPages} onClick={() => onFilterChange({ page: Math.min(data.totalPages, data.page + 1) })}>›</button></div></div>
    </> : <div className="agent-dynamics-table-state"><strong>暂无运行记录</strong><span>当前筛选范围没有可展示的 Agent Run。</span></div>}
  </section>;
}

function RunTableRow({ row, onOpen }: { row: AgentDynamicsRunRowVM; onOpen: () => void }) {
  return <tr onClick={onOpen} tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpen(); } }}>
    <td><div className="agent-dynamics-buyer-cell"><span className="agent-dynamics-buyer-avatar">{row.buyer.avatar ?? row.buyer.name.slice(0, 1)}</span><div><div className="agent-dynamics-buyer-name">{row.buyer.name}</div><div className="agent-dynamics-buyer-msg">{row.inboundPreview}</div></div></div></td>
    <td>{row.product.name}</td><td>{row.intent}</td><td><StatusTag tone={row.stage.tone}>{row.stage.label}</StatusTag></td><td><StatusTag tone={row.decision.tone}>{row.decision.label}</StatusTag></td><td><StatusTag tone={row.senderOutcome.tone}>{row.senderOutcome.label}</StatusTag></td><td className="agent-dynamics-muted">{(row.durationMs / 1000).toFixed(1)}s</td>
  </tr>;
}

export function RunDrawer({ detail, onClose, onRetry, onOpenChat }: { detail: { phase: AgentDynamicsDetailState['phase']; data: AgentDynamicsRunDetailVM | null; error: AgentDynamicsLoadError | null; }; onClose: () => void; onRetry: () => void; onOpenChat: (path?: string) => void }) {
  return <div className={`agent-dynamics-drawer-backdrop ${detail.phase !== 'idle' ? 'open' : ''}`} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <aside className="agent-dynamics-drawer" role="dialog" aria-modal="true" aria-label="运行详情">
      {detail.phase === 'loading' ? <div className="agent-dynamics-drawer-state"><span className="agent-dynamics-spinner" />正在读取运行详情…</div> : detail.error ? <div className="agent-dynamics-drawer-state"><strong>{detail.error.message}</strong>{detail.error.retryable && <button type="button" className="agent-dynamics-btn primary" onClick={onRetry}>重试</button>}</div> : detail.data ? <RunDrawerContent detail={detail.data} onClose={onClose} onOpenChat={onOpenChat} /> : null}
    </aside>
  </div>;
}

function RunDrawerContent({ detail, onClose, onOpenChat }: { detail: AgentDynamicsRunDetailVM; onClose: () => void; onOpenChat: (path?: string) => void }) {
  return <>
    <div className="agent-dynamics-drawer-head"><div><div className="agent-dynamics-drawer-kicker">Auto Reply Run</div><div className="agent-dynamics-drawer-title">{detail.decision.label === '执行失败' ? '回复失败 · 模型请求超时' : detail.decision.label === '待人工' ? '待人工 · 发货时间确认' : detail.decision.label === '处理中' ? '处理中 · 跨商品咨询' : '运行详情'}</div></div><button type="button" className="agent-dynamics-close" onClick={onClose} aria-label="关闭">×</button></div>
    <div className="agent-dynamics-detail-grid"><DetailItem label="买家" value={detail.buyer.name} /><DetailItem label="商品" value={detail.product.name} /><DetailItem label="执行状态" value={<StatusTag tone={detail.decision.tone}>{detail.decision.label === '自动回复' ? '已完成' : detail.decision.label}</StatusTag>} /><DetailItem label="发送 / 落库" value={<StatusTag tone={detail.senderOutcome.tone}>{detail.outcomeLabel}</StatusTag>} /></div>
    <div className="agent-dynamics-drawer-section"><div className="agent-dynamics-drawer-section-title">买家输入</div><div className="agent-dynamics-message-box">{detail.message}</div></div>
    <div className="agent-dynamics-drawer-section"><div className="agent-dynamics-drawer-section-title">处理时间线</div><Timeline items={detail.timeline} /></div>
    <div className="agent-dynamics-drawer-section"><div className="agent-dynamics-drawer-section-title">最终回复</div><div className="agent-dynamics-reply-box">{detail.reply ?? '本次没有可展示的最终回复。'}</div></div>
    <div className="agent-dynamics-drawer-actions"><button type="button" className="agent-dynamics-btn primary" onClick={() => onOpenChat(detail.chatPath)}>打开在线聊天</button><button type="button" className="agent-dynamics-btn">标记已处理</button></div>
  </>;
}

function Timeline({ items }: { items: AgentDynamicsTimelineItemVM[] }) {
  return <div className="agent-dynamics-timeline">{items.map((item) => <div className="agent-dynamics-timeline-item" key={item.id}><span className={`agent-dynamics-timeline-dot ${classTone(item.tone)}`} /><div><div className="agent-dynamics-timeline-title">{item.title}</div><div className="agent-dynamics-timeline-meta">{item.meta}</div></div></div>)}</div>;
}

function DetailItem({ label, value }: { label: string; value: ReactNode }) {
  return <div className="agent-dynamics-detail-item"><div className="agent-dynamics-detail-label">{label}</div><div className="agent-dynamics-detail-value">{value}</div></div>;
}

export function ErrorBanner({ error, onRetry }: { error: AgentDynamicsLoadError; onRetry: () => void }) {
  return <div className="agent-dynamics-error-banner" role="alert"><div><strong>{error.code === 'FORBIDDEN' ? '暂无访问权限' : 'Agent 动态暂时不可用'}</strong><span>{error.message}</span></div>{error.retryable && <button type="button" className="agent-dynamics-btn" onClick={onRetry}>重试</button>}</div>;
}

export function SkeletonBlocks() {
  return <div className="agent-dynamics-skeleton-blocks" aria-label="正在加载 Agent 动态"><div className="agent-dynamics-skeleton-wide" /><div className="agent-dynamics-skeleton-wide" /><div className="agent-dynamics-skeleton-wide" /></div>;
}
