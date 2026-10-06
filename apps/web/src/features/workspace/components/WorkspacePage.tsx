import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useAccountContext } from '../../../app/account-context';
import { useWorkspaceController } from '../controller';
import { buildWorkspaceMessages, deriveSessionTitle, groupWorkspaceMessages, type WorkspaceAgentTraceGroup } from '../messages';
import type { WorkspaceApi } from '../api';
import type { WorkspaceConfirmationVM, WorkspaceMessageVM, WorkspaceOutboxVM, WorkspaceRunStatus, WorkspaceRunVM, WorkspaceSessionVM } from '../types';
import { SearchField } from '../../../shared/ui/SearchField';
import { Button } from '../../../shared/ui/Button';
import { Toast } from '../../../shared/ui/Toast';
import { MarkdownContent } from '../../../shared/ui/MarkdownContent';
import './workspace.css';

export interface WorkspacePageProps { api: WorkspaceApi; }
const terminalStatuses = new Set<WorkspaceRunStatus>(['succeeded', 'partially_succeeded', 'failed', 'cancelled', 'expired']);
const COMPOSER_MIN_HEIGHT = 48;
const COMPOSER_MAX_HEIGHT = 120;

export function getComposerTextareaMetrics(scrollHeight: number, minHeight = COMPOSER_MIN_HEIGHT, maxHeight = COMPOSER_MAX_HEIGHT) {
  const safeScrollHeight = Number.isFinite(scrollHeight) ? Math.max(0, scrollHeight) : 0;
  const safeMaxHeight = Math.max(minHeight, maxHeight);
  return {
    height: Math.min(Math.max(safeScrollHeight, minHeight), safeMaxHeight),
    overflowY: safeScrollHeight > safeMaxHeight ? 'auto' as const : 'hidden' as const,
  };
}

function resizeComposerTextarea(textarea: HTMLTextAreaElement | null) {
  if (!textarea) return;
  textarea.style.height = 'auto';
  const metrics = getComposerTextareaMetrics(textarea.scrollHeight);
  textarea.style.height = `${metrics.height}px`;
  textarea.style.overflowY = metrics.overflowY;
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = { queued: '排队中', running: '运行中', waiting_confirmation: '需要人工确认', executing: '执行中', retrying: '重试中', cancelling: '取消中', succeeded: '已完成', partially_succeeded: '部分完成', failed: '失败', cancelled: '已取消', expired: '已过期', pending: '待执行', skipped: '已跳过' };
  return labels[status] ?? status;
}
function statusTone(status: string): string { if (status === 'succeeded') return 'ok'; if (status === 'failed' || status === 'expired') return 'danger'; if (status === 'cancelled' || status === 'skipped') return 'muted'; return 'info'; }
function formatTime(value?: string): string { if (!value) return '—'; const date = new Date(value); if (Number.isNaN(date.getTime())) return value; return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); }

export function WorkspacePage({ api }: WorkspacePageProps) {
  const { currentAccountId, currentAccount, accountsLoading, accountsError } = useAccountContext();
  const controller = useWorkspaceController({ api, accountId: currentAccountId });
  const { state, search } = controller;
  const [instruction, setInstruction] = useState('');
  const [draftMode, setDraftMode] = useState(false);
  const [expandedTrace, setExpandedTrace] = useState<string | null>(null);
  const [errorToast, setErrorToast] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WorkspaceSessionVM | null>(null);
  const instructionRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (draftMode) instructionRef.current?.focus(); }, [draftMode]);
  useLayoutEffect(() => { resizeComposerTextarea(instructionRef.current); }, [instruction]);
  useEffect(() => {
    if (!state.error || state.phase === 'forbidden') { setErrorToast(null); return; }
    setErrorToast(state.error);
    const timer = window.setTimeout(() => setErrorToast(null), 5000);
    return () => window.clearTimeout(timer);
  }, [state.error, state.phase]);

  const visibleSessions = useMemo(() => state.sessions, [state.sessions]);
  const activeSession = draftMode ? undefined : state.sessions.find((session) => session.id === state.activeSessionId);
  const currentRun = state.run && activeSession && state.run.sessionId === activeSession.id ? state.run : null;
  useEffect(() => { setExpandedTrace(null); }, [state.activeSessionId, currentRun?.runId]);
  const currentRunMessages = currentRun ? buildWorkspaceMessages(currentRun, state.events) : [];
  const historyMessages = state.messages.filter((message) => !currentRun || message.runId !== currentRun.runId);
  const messages = draftMode ? [] : currentRun ? [...historyMessages, ...currentRunMessages] : state.messages;
  const contextMissing = !accountsLoading && !accountsError && !currentAccountId;

  async function submitRun(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = instruction.trim();
    if (!text || state.submitting || !currentAccountId || (!draftMode && activeSession?.status !== 'active')) return;
    let sessionId = activeSession?.id;
    if (draftMode || !sessionId) {
      const created = await controller.createSession(deriveSessionTitle(text));
      if (!created) return;
      sessionId = created.id;
      setDraftMode(false);
    }
    const run = await controller.startRun(text, sessionId);
    if (run) setInstruction('');
  }
  function startDraft() { setDraftMode(true); setInstruction(''); setExpandedTrace(null); }
  function chooseAccount() { window.history.pushState({}, '', '/accounts'); window.dispatchEvent(new PopStateEvent('popstate')); }

  return <section className="page-stack workspace-domain" data-workspace-domain>
    {accountsError && <div className="workspace-inline-error" role="alert">账号上下文加载失败：{accountsError}</div>}
    {errorToast && <Toast message={errorToast} tone="error" onDismiss={() => setErrorToast(null)} />}
    {contextMissing ? <WorkspaceState title="请先选择账号" message="每个工作区会话都绑定一个可用的闲鱼账号。" action={<button className="btn primary" type="button" onClick={chooseAccount}>前往账号管理</button>} />
      : state.phase === 'forbidden' ? <WorkspaceState title="暂无工作区权限" message={state.error ?? '当前账号范围无法读取工作区。'} action={<button className="btn ghost" type="button" onClick={() => void controller.reload()}>重新加载</button>} />
        : <div className="workspace-surface">
          <div className="workspace-mobile-compact-header"><strong>Workspace</strong><span>{currentAccount?.displayName ?? '账号 A'} · 在线</span></div>
          <div className="workspace-page-body">
            <div className="workspace-layout">
              <aside className="workspace-sidebar">
                <section className="card workspace-sessions-panel"><div className="workspace-panel-head"><div><h2>会话</h2><p>{state.sessions.length} 个工作区会话</p></div><Button variant="primary" type="button" onClick={startDraft}>新建会话</Button></div><SearchField className="workspace-search" value={search} onChange={(event) => controller.setSearch(event.target.value)} onClear={() => controller.setSearch('')} clearable placeholder="搜索会话" aria-label="搜索会话" /><div className="workspace-session-list">{state.phase === 'loading' && <div className="workspace-list-state">正在加载会话…</div>}{state.phase !== 'loading' && visibleSessions.length === 0 && <div className="workspace-list-state">{state.sessions.length ? '没有匹配的会话' : '还没有会话，点击“新建会话”开始'}</div>}{visibleSessions.map((session) => <SessionRow key={session.id} session={session} active={!draftMode && session.id === state.activeSessionId} running={session.id === state.activeSessionId && Boolean(currentRun && !terminalStatuses.has(currentRun.status))} busy={state.submitting} onSwitch={() => { setDraftMode(false); if (session.status === 'active') void controller.switchSession(session.id); }} onDelete={() => setDeleteTarget(session)} />)}</div></section>
                <WorkspaceContextPanel account={currentAccount} />
              </aside>
              <section className={`card workspace-thread${currentRun?.status === 'waiting_confirmation' ? ' is-confirmation' : ''}`} aria-label="Workspace 对话"><header className="workspace-thread-header"><div><p className="eyebrow">连续对话</p><h2>{draftMode ? '新会话' : activeSession?.title ?? '选择活跃会话'}</h2><p>{currentRun ? `${messages.length} 条消息 · Run 创建于 ${formatTime(currentRun.createdAt)}` : draftMode ? '输入第一条消息后，会自动创建会话并生成标题。' : '提交 Run 后，这里会展示连续的 Agent 消息流。'}</p></div><div className="workspace-thread-meta">{currentRun && <span className={`workspace-status workspace-status-${statusTone(currentRun.status)}`}>{statusLabel(currentRun.status)}</span>}<span className={`workspace-connection workspace-connection-${state.connection}`}><span />{state.connection === 'connected' ? '实时' : state.connection === 'reconnecting' ? '重连中' : state.connection === 'connecting' ? '连接中' : '离线'}</span>{currentRun && !terminalStatuses.has(currentRun.status) && state.connection !== 'connected' && <button className="btn ghost workspace-reconnect-button" type="button" onClick={() => void controller.reconnectRun()}>重连</button>}</div></header><div className={`workspace-message-stream${messages.length ? '' : ' is-empty'}`}>{messages.length ? <MessageStream messages={messages} expandedTrace={expandedTrace} onToggleTrace={(id) => setExpandedTrace((current) => current === id ? null : id)} /> : <WorkspaceState title={draftMode ? '开始一段新对话' : '等待首条 Run'} message={draftMode ? '在下方输入消息，系统会自动创建会话。' : activeSession ? '在下方输入一条指令，开始受控执行。' : '请从左侧选择一个活跃会话。'} compact />}{currentRun?.status === 'waiting_confirmation' && state.confirmation && <WorkspaceConfirmationCard run={currentRun} accountName={currentAccount?.displayName ?? '闲鱼账号 A'} confirmation={state.confirmation} actionSubmitting={state.actionSubmitting} onConfirm={() => void controller.confirmRun()} onCancel={() => void controller.cancelRun()} />}{state.outbox.length > 0 && <WorkspaceOutboxPanel items={state.outbox} actionSubmitting={state.actionSubmitting} onRetry={() => void controller.retryRun()} />}</div><form className="workspace-composer workspace-composer-docked" onSubmit={submitRun}><textarea ref={instructionRef} value={instruction} onChange={(event) => { setInstruction(event.target.value); resizeComposerTextarea(event.currentTarget); }} maxLength={4000} disabled={(!draftMode && (!activeSession || activeSession.status !== 'active')) || state.submitting} placeholder="给 Agent 发消息…" aria-label="Run 指令" /><div className="workspace-composer-foot"><div className="workspace-composer-tools"><button type="button" aria-label="添加附件"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg></button></div><div className="workspace-composer-meta"><span>{instruction.length}/4000</span><button className="workspace-send-round" type="submit" aria-label={state.submitting ? '提交中' : '发送'} disabled={!instruction.trim() || (!draftMode && (!activeSession || activeSession.status !== 'active')) || state.submitting}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 14-7-4 14-3-6-7-1Z" /><path d="m12 13 3-8" /></svg></button></div></div></form></section>
            </div>
          </div>
          <nav className="workspace-mobile-nav" aria-label="移动端导航"><button type="button">⌂<span>首页</span></button><button className="active" type="button">▣<span>Workspace</span></button><button type="button">✉<span>消息</span></button><button type="button">⚙<span>设置</span></button></nav>
        </div>}
    {deleteTarget && <WorkspaceDeleteSessionModal session={deleteTarget} submitting={state.submitting} onClose={() => { if (!state.submitting) setDeleteTarget(null); }} onConfirm={() => { void controller.deleteSession(deleteTarget.id).then((result) => { if (result) setDeleteTarget(null); }); }} />}
  </section>;
}

function sessionTimeLabel(value: string): string {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return '—';
  const delta = Math.max(0, Date.now() - timestamp);
  if (delta < 60_000) return '刚刚';
  if (delta < 3_600_000) return `${Math.max(1, Math.floor(delta / 60_000))}分钟前`;
  const date = new Date(timestamp);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return '昨天';
  if (delta < 7 * 86_400_000) return `周${'日一二三四五六'[date.getDay()]}`;
  return `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`;
}

export function SessionRow({ session, active, running = false, busy, onSwitch, onDelete }: { session: WorkspaceSessionVM; active: boolean; running?: boolean; busy: boolean; onSwitch: () => void; onDelete: () => void }) { return <div className={`workspace-session-row ${active ? 'active' : ''} ${session.status === 'archived' ? 'archived' : ''}`}><button type="button" className="workspace-session-select" onClick={onSwitch} disabled={busy || session.status === 'archived'} aria-pressed={active}><span className="workspace-session-title">{running && <span className="workspace-session-running-icon" role="img" aria-label="任务进行中" title="任务进行中" />}<span>{session.title}</span></span><time className="workspace-session-time">{sessionTimeLabel(session.lastActiveAt)}</time><small>{session.summary ?? (session.status === 'archived' ? '已归档' : '活跃')}</small></button><button type="button" className="workspace-session-action" data-testid="workspace-session-delete" onClick={onDelete} disabled={busy} aria-label={`删除 ${session.title}`} title={`删除 ${session.title}`}><svg className="workspace-session-action-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 5h9M6 5V3.5h4V5m-5.5 0 .6 8h5.8l.6-8M6.5 7.5v3m3-3v3" /></svg></button></div>; }


export function WorkspaceDeleteSessionModal({ session, submitting = false, onClose, onConfirm }: { session: WorkspaceSessionVM; submitting?: boolean; onClose: () => void; onConfirm: () => void }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (!submitting && event.target === event.currentTarget) onClose(); }}>
    <section className="modal-card workspace-delete-modal card" role="dialog" aria-modal="true" aria-labelledby="workspace-delete-title" aria-describedby="workspace-delete-description" data-testid="workspace-delete-confirm-modal">
      <header className="modal-head">
        <div><p className="eyebrow">Workspace</p><h2 id="workspace-delete-title">删除会话</h2><p id="workspace-delete-description">请确认是否删除“{session.title}”。删除后不可恢复。</p></div>
        <button className="icon-button" type="button" aria-label="关闭删除会话弹窗" onClick={onClose} disabled={submitting}>×</button>
      </header>
      <div className="workspace-delete-summary"><strong>{session.title}</strong><span>{session.summary ?? '会话消息、执行记录和确认记录将一并删除。'}</span></div>
      <footer className="modal-actions"><button className="btn ghost" type="button" data-testid="workspace-delete-cancel" onClick={onClose} disabled={submitting}>取消</button><button className="btn danger" type="button" data-testid="workspace-delete-confirm" onClick={onConfirm} disabled={submitting}>{submitting ? '删除中…' : '确认删除'}</button></footer>
    </section>
  </div>;
}

export function MessageStream({ messages, expandedTrace, onToggleTrace }: { messages: WorkspaceMessageVM[]; expandedTrace: string | null; onToggleTrace: (id: string) => void }) { return <div className="workspace-message-list">{groupWorkspaceMessages(messages).map((block) => block.type === 'agent_trace' ? <AgentTraceView key={block.id} group={block} expanded={expandedTrace === block.id} onToggle={() => onToggleTrace(block.id)} /> : <MessageBubble key={block.id} message={block} />)}</div>; }
function traceSummary(group: WorkspaceAgentTraceGroup): string {
  const stepCount = group.messages.filter((message) => message.type === 'reasoning_summary').length;
  const toolCount = group.messages.filter((message) => message.type === 'tool_event').length;
  const start = Date.parse(group.createdAt);
  const latest = group.messages[group.messages.length - 1];
  const end = Date.parse(latest?.createdAt ?? group.createdAt);
  const durationMs = Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : 0;
  const parts = [
    stepCount ? `${stepCount} 个步骤` : '',
    toolCount ? `${toolCount} 次工具调用` : '',
    durationMs ? `${durationMs}ms` : '',
  ].filter(Boolean);
  return `已完成${parts.length ? ` ${parts.join(' · ')}` : ''}`;
}

function AgentTraceView({ group, expanded, onToggle }: { group: WorkspaceAgentTraceGroup; expanded: boolean; onToggle: () => void }) { const latest = group.messages[group.messages.length - 1]; const active = latest?.status ? statusTone(latest.status) === 'info' : false; return <article className="workspace-agent-trace"><button type="button" className="workspace-trace-toggle" onClick={onToggle} aria-expanded={expanded}><span className="workspace-trace-copy"><strong>{active ? '正在处理' : traceSummary(group)}</strong></span><span className="workspace-trace-action">{expanded ? '收起' : '可展开'}</span><span className="workspace-message-chevron" aria-hidden="true">{expanded ? '⌃' : '⌄'}</span></button>{expanded && <div className="workspace-trace-details">{group.messages.map((message) => <div className="workspace-trace-row" key={message.id}><span className="workspace-trace-row-dot" aria-hidden="true" /><div><strong>{message.type === 'reasoning_summary' ? (message.summary ?? '执行步骤') : message.title}</strong><p>{message.content}</p>{message.eventType && <small>{message.eventType}{message.sequence ? ` · #${message.sequence}` : ''}</small>}</div></div>)}</div>}</article>; }
function MessageBubble({ message }: { message: WorkspaceMessageVM }) { if (message.type === 'user_message') return <article className="workspace-message workspace-message-user"><div className="workspace-message-content"><MarkdownContent className="workspace-markdown" content={message.content} /></div></article>; if (message.type === 'final_answer') return <article className={`workspace-message workspace-message-final ${message.status && statusTone(message.status) === 'danger' ? 'is-error' : ''}`}><div className="workspace-message-content"><MarkdownContent className="workspace-markdown" content={message.content} /></div></article>; return <article className="workspace-message workspace-message-assistant"><div className="workspace-message-content"><MarkdownContent className="workspace-markdown" content={message.content} /></div></article>; }
function WorkspaceContextPanel({ account }: { account?: { displayName?: string } }) { return <section className="card workspace-context-panel"><div className="workspace-context-head"><div><p className="eyebrow">Current context</p><h3>当前上下文</h3></div><button className="icon-button" type="button" aria-label="编辑上下文">✎</button></div><div className="workspace-context-account"><strong>{account?.displayName ?? '闲鱼账号 A'}</strong><span>已连接 · 消息监听正常</span></div><div className="workspace-context-list"><div><b>商品</b><span>未指定</span></div><div><b>订单</b><span>未指定</span></div><div><b>权限范围</b><span>workspace.run / audit.read</span></div></div><div className="workspace-capability-grid"><span>read.products</span><span>write.products</span><span>audit.run</span></div><div className="workspace-context-footer">Credential ref：cred_••••</div></section>; }
function WorkspaceConfirmationCard({ run, accountName, confirmation, actionSubmitting, onConfirm, onCancel }: { run: WorkspaceRunVM; accountName: string; confirmation: WorkspaceConfirmationVM; actionSubmitting: boolean; onConfirm: () => void; onCancel: () => void }) {
  const manifest = confirmation.manifest;
  const isCouponCreate = confirmation.action === 'coupon_create';
  const isAgentSettingsUpdate = confirmation.action === 'agent_settings_update';
  const title = typeof manifest.title === 'string' ? manifest.title : run.instructionSummary;
  const status = confirmation.status === 'active' ? '待确认' : confirmation.status === 'confirmed' ? '已确认' : confirmation.status === 'cancelled' ? '已取消' : confirmation.status === 'expired' ? '已过期' : '已拒绝';
  const titleText = isAgentSettingsUpdate ? '自动回复 Agent 配置' : title;
  return <section className="workspace-confirmation-card" data-testid="workspace-confirmation-card"><div className="workspace-confirmation-head"><div><h3>{isCouponCreate ? '新增卡券 · 需要管理员确认' : isAgentSettingsUpdate ? '修改配置 · 需要管理员确认' : '外部动作 · 需要管理员确认'}</h3><p>{isCouponCreate ? `确认后会在 ${accountName} 下创建卡券批次，正文只在服务端处理。` : isAgentSettingsUpdate ? `确认后会更新 ${accountName} 的自动回复 Agent 配置，Prompt 原文不会显示。` : `该动作会改变 ${accountName} 的对外状态，确认后由服务端继续执行。`}</p></div><span>{isCouponCreate ? '中风险 · 卡券写入' : isAgentSettingsUpdate ? '中风险 · 配置写入' : '中风险 · 外部写入'}</span></div><div className="workspace-confirmation-diff"><div><small>执行前</small><strong>{status}<br />{titleText}</strong></div><div><small>执行后</small><strong>{isCouponCreate ? <>创建卡券批次<br />正文不会显示在 Workspace</> : isAgentSettingsUpdate ? <>更新 Agent 配置<br />Prompt 原文不会显示在 Workspace</> : <>确认后进入执行队列<br />由服务端回传结果</>}</strong></div></div><div className="workspace-confirmation-meta">policy: {confirmation.policyRef} · version: {confirmation.version} · expires: {formatTime(confirmation.expiresAt)}</div><div className="workspace-confirmation-actions"><button className="btn ghost" type="button" onClick={onCancel} disabled={actionSubmitting || confirmation.status !== 'active'} data-testid="workspace-confirm-cancel">取消动作</button><button className="btn warning" type="button" onClick={onConfirm} disabled={actionSubmitting || confirmation.status !== 'active'} data-testid="workspace-confirm-continue">{actionSubmitting ? '提交中…' : '确认继续'}</button></div></section>;
}
function WorkspaceOutboxPanel({ items, actionSubmitting, onRetry }: { items: WorkspaceOutboxVM[]; actionSubmitting: boolean; onRetry: () => void }) { const item = items[items.length - 1]; if (!item) return null; const label = item.status === 'pending' ? '已进入执行队列' : item.status === 'processing' ? '执行中' : item.status === 'retryable' ? '等待重试' : item.status === 'dead_lettered' ? '需要人工恢复' : item.status === 'succeeded' ? '已完成' : '结果未知'; return <section className="workspace-outbox-panel" data-testid="workspace-outbox-panel"><div><strong>Outbox 结果</strong><span>{label} · attempt {item.attempt}</span></div>{(item.status === 'retryable' || item.status === 'dead_lettered') && <button className="btn ghost" type="button" onClick={onRetry} disabled={actionSubmitting} data-testid="workspace-outbox-retry">重试</button>}{item.externalOutcome === 'unknown' && <small>外部结果未知，请先查询或人工恢复，系统不会盲目重放。</small>}</section>; }
function WorkspaceState({ title, message, action, compact = false }: { title: string; message: string; action?: ReactNode; compact?: boolean }) { return <div className={`workspace-state ${compact ? 'compact' : ''}`}><strong>{title}</strong><span>{message}</span>{action}</div>; }
