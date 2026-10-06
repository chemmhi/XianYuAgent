import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useAccountContext } from '../../../app/account-context';
import { isWorkspaceRunReconnectable, useWorkspaceController } from '../controller';
import { buildWorkspaceMessages } from '../messages';
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

export function scrollMessageStreamToLatest(stream: Pick<HTMLElement, 'scrollTop' | 'scrollHeight'> | null | undefined): void {
  if (!stream) return;
  stream.scrollTop = stream.scrollHeight;
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
  const { state, search, markSessionViewed } = controller;
  const [instruction, setInstruction] = useState('');
  const [draftMode, setDraftMode] = useState(false);
  const [expandedTrace, setExpandedTrace] = useState<string | null>(null);
  const [errorToast, setErrorToast] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WorkspaceSessionVM | null>(null);
  const instructionRef = useRef<HTMLTextAreaElement>(null);
  const messageStreamRef = useRef<HTMLDivElement>(null);
  const lastMessageStreamKeyRef = useRef('');
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
  const activeSessionDisplayTitle = activeSession?.title;
  useEffect(() => {
    if (draftMode || !activeSession) return;
    markSessionViewed(activeSession.id, currentRun?.runId ?? activeSession.runId);
  }, [activeSession, currentRun?.runId, draftMode, markSessionViewed]);
  useEffect(() => { setExpandedTrace(null); }, [state.activeSessionId, currentRun?.runId]);
  const currentRunMessages = currentRun ? buildWorkspaceMessages(currentRun, state.events) : [];
  const historyMessages = state.messages.filter((message) => !currentRun || message.runId !== currentRun.runId);
  const messages = draftMode ? [] : currentRun ? [...historyMessages, ...currentRunMessages] : state.messages;
  const showConfirmation = !draftMode && Boolean(currentRun?.status === 'waiting_confirmation' && state.confirmation);
  const showOutbox = !draftMode && Boolean(currentRun && state.outbox.length > 0);
  const hasStreamContent = messages.length > 0 || showConfirmation || showOutbox;
  const visibleMessageCount = messages.filter((message) => message.type === 'user_message' || message.type === 'final_answer').length;
  useLayoutEffect(() => {
    const key = [
      ...messages.map((message) => `${message.id}:${message.content}:${message.status ?? ''}`),
      state.confirmation ? `${state.confirmation.confirmationId}:${state.confirmation.status}:${state.confirmation.updatedAt}` : '',
      ...state.outbox.map((item) => `${item.outboxId}:${item.status}:${item.updatedAt}`),
    ].join('\u0001');
    if (key === lastMessageStreamKeyRef.current) return;
    lastMessageStreamKeyRef.current = key;
    scrollMessageStreamToLatest(messageStreamRef.current);
  }, [messages, state.confirmation, state.outbox]);
  const contextMissing = !accountsLoading && !accountsError && !currentAccountId;

  async function submitRun(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = instruction.trim();
    if (!text || state.submitting || !currentAccountId || (!draftMode && activeSession?.status !== 'active')) return;
    let sessionId = activeSession?.id;
    if (draftMode || !sessionId) {
      const created = await controller.createSession('新会话', text);
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
                <section className="card workspace-sessions-panel"><div className="workspace-panel-head"><div><h2>会话</h2><p>{state.sessions.length} 个工作区会话</p></div><Button variant="primary" type="button" onClick={startDraft}>新建会话</Button></div><SearchField className="workspace-search" value={search} onChange={(event) => controller.setSearch(event.target.value)} onClear={() => controller.setSearch('')} clearable placeholder="搜索会话" aria-label="搜索会话" /><div className="workspace-session-list">{state.phase === 'loading' && <div className="workspace-list-state">正在加载会话…</div>}{state.phase !== 'loading' && visibleSessions.length === 0 && <div className="workspace-list-state">{state.sessions.length ? '没有匹配的会话' : '还没有会话，点击“新建会话”开始'}</div>}{visibleSessions.map((session) => { const sessionRunStatus = session.id === state.activeSessionId ? (currentRun?.status ?? session.runStatus) : session.runStatus; return <SessionRow key={session.id} session={session} active={!draftMode && session.id === state.activeSessionId} running={Boolean(sessionRunStatus && !terminalStatuses.has(sessionRunStatus))} unread={state.unreadSessionIds.includes(session.id)} busy={state.submitting} onSwitch={() => { setDraftMode(false); if (session.status === 'active') void controller.switchSession(session.id); }} onDelete={() => setDeleteTarget(session)} />; })}</div></section>
              </aside>
              <section className={`card workspace-thread${currentRun?.status === 'waiting_confirmation' ? ' is-confirmation' : ''}`} aria-label="Workspace 对话"><header className="workspace-thread-header"><div><p className="eyebrow">连续对话</p><h2>{draftMode ? '新会话' : activeSessionDisplayTitle ?? '选择活跃会话'}</h2><p>{currentRun ? `${messages.length} 条消息 · Run 创建于 ${formatTime(currentRun.createdAt)}` : draftMode ? '输入第一条消息后，会自动创建会话并生成标题。' : '提交 Run 后，这里会展示连续的 Agent 消息流。'}</p></div><div className="workspace-thread-meta">{currentRun && <span className={`workspace-status workspace-status-${statusTone(currentRun.status)}`}>{statusLabel(currentRun.status)}</span>}<span className={`workspace-connection workspace-connection-${state.connection}`}><span />{state.connection === 'connected' ? '实时' : state.connection === 'reconnecting' ? '重连中' : state.connection === 'connecting' ? '连接中' : '离线'}</span>{currentRun && isWorkspaceRunReconnectable(currentRun.status) && (state.connection !== 'connected' || currentRun.status === 'failed') && <button className="btn ghost workspace-reconnect-button" type="button" onClick={() => void controller.reconnectRun()}>重连</button>}</div></header><div ref={messageStreamRef} data-testid="workspace-message-stream" className={`workspace-message-stream${hasStreamContent ? '' : ' is-empty'}`}>{messages.length ? <MessageStream messages={messages} expandedTrace={expandedTrace} onToggleTrace={(id) => setExpandedTrace((current) => current === id ? null : id)} /> : <WorkspaceState title={draftMode ? '开始一段新对话' : '等待首条 Run'} message={draftMode ? '在下方输入消息，系统会自动创建会话。' : activeSession ? '在下方输入一条指令，开始受控执行。' : '请从左侧选择一个活跃会话。'} compact />}{showConfirmation && <WorkspaceConfirmationCard run={currentRun!} accountName={currentAccount?.displayName ?? '闲鱼账号 A'} confirmation={state.confirmation!} actionSubmitting={state.actionSubmitting} onConfirm={() => void controller.confirmRun()} onCancel={() => void controller.cancelRun()} />}{showOutbox && <WorkspaceOutboxPanel items={state.outbox} actionSubmitting={state.actionSubmitting} onRetry={() => void controller.retryRun()} />}</div><form className="workspace-composer workspace-composer-docked" onSubmit={submitRun}><textarea ref={instructionRef} value={instruction} onChange={(event) => { setInstruction(event.target.value); resizeComposerTextarea(event.currentTarget); }} maxLength={4000} disabled={(!draftMode && (!activeSession || activeSession.status !== 'active')) || state.submitting} placeholder="给 Agent 发消息…" aria-label="Run 指令" /><div className="workspace-composer-foot"><div className="workspace-composer-tools"><button type="button" aria-label="添加附件"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg></button></div><div className="workspace-composer-meta"><span>{instruction.length}/4000</span><button className="workspace-send-round" type="submit" aria-label={state.submitting ? '提交中' : '发送'} disabled={!instruction.trim() || (!draftMode && (!activeSession || activeSession.status !== 'active')) || state.submitting}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 14-7-4 14-3-6-7-1Z" /><path d="m12 13 3-8" /></svg></button></div></div></form></section>
            </div>
          </div>
          <nav className="workspace-mobile-nav" aria-label="移动端导航"><button type="button">⌂<span>首页</span></button><button className="active" type="button">▣<span>Workspace</span></button><button type="button">✉<span>消息</span></button><button type="button">⚙<span>设置</span></button></nav>
        </div>}
    {deleteTarget && <WorkspaceDeleteSessionModal session={deleteTarget} submitting={state.submitting} onClose={() => { if (!state.submitting) setDeleteTarget(null); }} onConfirm={() => { void controller.deleteSession(deleteTarget.id).then((result) => { if (result) setDeleteTarget(null); }); }} />}
  </section>;
}

export function SessionRow({ session, active, running = false, unread = false, busy, onSwitch, onDelete }: { session: WorkspaceSessionVM; active: boolean; running?: boolean; unread?: boolean; busy: boolean; onSwitch: () => void; onDelete: () => void }) { return <div className={`workspace-session-row ${active ? 'active' : ''} ${session.status === 'archived' ? 'archived' : ''}`}><button type="button" className="workspace-session-select" onClick={onSwitch} disabled={busy || session.status === 'archived'} aria-pressed={active}><span className="workspace-session-title"><span>{session.title}</span>{running && <span className="workspace-session-running-icon" role="img" aria-label="任务进行中" title="任务进行中" />}{unread && <span className="workspace-session-unread-dot" role="img" aria-label="有未读完成任务" title="有未读完成任务" />}</span>{(session.summary || session.status === 'archived') && <small>{session.summary ?? '已归档'}</small>}</button><button type="button" className="workspace-session-action" data-testid="workspace-session-delete" onClick={onDelete} disabled={busy} aria-label={`删除 ${session.title}`} title={`删除 ${session.title}`}><svg className="workspace-session-action-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 5h9M6 5V3.5h4V5m-5.5 0 .6 8h5.8l-.6-8M6.5 7.5v3m3-3v3" /></svg></button></div>; }


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

export function MessageStream({ messages, expandedTrace, onToggleTrace }: { messages: WorkspaceMessageVM[]; expandedTrace: string | null; onToggleTrace: (id: string) => void }) {
  const visibleMessages = messages.filter(isVisibleWorkspaceActivity);
  const duration = formatActivityDuration(visibleMessages);
  return <div className="workspace-message-list">
    {duration && <div className="workspace-activity-duration">已处理 {duration}</div>}
    {visibleMessages.map((message) => message.type === 'reasoning_summary'
      ? <ExecutionSummaryView key={message.id} message={message} />
      : message.type === 'tool_event'
        ? <ToolEventView key={message.id} message={message} expanded={expandedTrace === message.id} onToggle={() => onToggleTrace(message.id)} />
        : <MessageBubble key={message.id} message={message} />)}
  </div>;
}

function isVisibleWorkspaceActivity(message: WorkspaceMessageVM): boolean {
  if (message.type !== 'reasoning_summary') return true;
  if (message.eventType === 'reasoning.delta') return false;
  return !['模型原生推理', '执行 Workspace 任务'].includes(message.summary ?? '');
}

function formatActivityDuration(messages: WorkspaceMessageVM[]): string | undefined {
  const timestamps = messages.map((message) => Date.parse(message.createdAt)).filter(Number.isFinite);
  if (timestamps.length < 2 || !messages.some((message) => message.type === 'reasoning_summary' || message.type === 'tool_event')) return undefined;
  const durationMs = Math.max(0, Math.max(...timestamps) - Math.min(...timestamps));
  const totalSeconds = Math.max(1, Math.round(durationMs / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}小时${minutes ? ` ${minutes}分钟` : ''}${seconds ? ` ${seconds}秒` : ''}`;
  if (minutes > 0) return `${minutes}分钟${seconds ? ` ${seconds}秒` : ''}`;
  return `${seconds}秒`;
}

function ExecutionSummaryView({ message }: { message: WorkspaceMessageVM }) {
  return <article className="workspace-execution-summary">
    <span className="workspace-activity-icon workspace-activity-icon-summary" aria-hidden="true">
      <svg viewBox="0 0 16 16" focusable="false"><path d="m3.25 11.75-.5 1.5 1.5-.5 7.9-7.9-1-1-7.9 7.9Z" /><path d="m10.55 3.15 1-1 1.3 1.3-1 1" /></svg>
    </span>
    <div className="workspace-activity-copy">
      <strong>{message.summary ?? '执行摘要'}</strong>
      <p>{message.content}</p>
    </div>
  </article>;
}

function ToolEventView({ message, expanded, onToggle }: { message: WorkspaceMessageVM; expanded: boolean; onToggle: () => void }) {
  return <article className="workspace-tool-event">
    <button type="button" className="workspace-tool-event-toggle" onClick={onToggle} aria-expanded={expanded}>
      <span className="workspace-activity-icon workspace-activity-icon-tool" aria-hidden="true">
        <svg viewBox="0 0 16 16" focusable="false"><rect x="3.25" y="2.75" width="9.5" height="10.5" rx="1" /><path d="M5.5 5.5h5M5.5 8h5M5.5 10.5h3" /></svg>
      </span>
      <strong>{message.title}</strong>
      <span className="workspace-tool-event-control">
        <span className="workspace-tool-event-action">{expanded ? '收起' : '展开'}</span>
        <span className="workspace-message-chevron" aria-hidden="true"><svg viewBox="0 0 12 12" focusable="false"><path d={expanded ? 'm3 3.5 3 3 3-3' : 'm4 2.5 3.5 3.5L4 9.5'} /></svg></span>
      </span>
    </button>
    {expanded && <div className="workspace-tool-event-details"><p>{message.content}</p></div>}
  </article>;
}
function MessageBubble({ message }: { message: WorkspaceMessageVM }) { if (message.type === 'user_message') return <article className="workspace-message workspace-message-user"><div className="workspace-message-content"><MarkdownContent className="workspace-markdown" content={message.content} /></div></article>; if (message.type === 'final_answer') return <article className={`workspace-message workspace-message-final ${message.status && statusTone(message.status) === 'danger' ? 'is-error' : ''}`}><div className="workspace-message-content"><MarkdownContent className="workspace-markdown" content={message.content} /></div></article>; return <article className="workspace-message workspace-message-assistant"><div className="workspace-message-content"><MarkdownContent className="workspace-markdown" content={message.content} /></div></article>; }
function WorkspaceConfirmationCard({ run, accountName, confirmation, actionSubmitting, onConfirm, onCancel }: { run: WorkspaceRunVM; accountName: string; confirmation: WorkspaceConfirmationVM; actionSubmitting: boolean; onConfirm: () => void; onCancel: () => void }) {
  const manifest = confirmation.manifest;
  const isCouponCreate = confirmation.action === 'coupon_create';
  const isAgentSettingsUpdate = confirmation.action === 'agent_settings_update';
  const title = typeof manifest.title === 'string' ? manifest.title : run.instructionSummary;
  const status = confirmation.status === 'active' ? '待确认' : confirmation.status === 'confirmed' ? '已确认' : confirmation.status === 'cancelled' ? '已取消' : confirmation.status === 'expired' ? '已过期' : '已拒绝';
  const titleText = isAgentSettingsUpdate ? '自动回复 Agent 配置' : title;
  const detailRows = isCouponCreate
    ? [['卡券名称', String(manifest.label ?? manifest.title ?? '未解析')], ['卡券类型', purposeLabel(String(manifest.purpose ?? ''))], ['内容状态', manifest.configured === true ? '已解析，可创建' : '未配置，确认后仍会校验'], ['正文长度', manifest.contentLength !== undefined ? `${String(manifest.contentLength)} 字符` : '—'], ['数据条数', String(manifest.itemCount ?? 0)], ...(manifest.purpose === 'api' ? [['接口地址', String(manifest.apiUrl ?? '未配置')], ['请求方法', String(manifest.apiMethod ?? 'GET')], ['超时', manifest.apiTimeout !== undefined ? `${String(manifest.apiTimeout)} 秒` : '默认'], ['请求头/参数', `${manifest.apiHeadersConfigured === true ? '已配置' : '未配置'} / ${manifest.apiParamsConfigured === true ? '已配置' : '未配置'}`], ['响应字段', String(manifest.responseField ?? '未配置')]] : []), ...(manifest.purpose === 'image' ? [['图片数量', String(manifest.imageCount ?? 0)]] : [])]
    : isAgentSettingsUpdate
      ? [['变更字段', Array.isArray(manifest.changedFields) ? manifest.changedFields.join('、') : '未解析'], ['当前版本', String(manifest.expectedVersion ?? 0)]]
      : Object.entries(manifest).filter(([key]) => !['action', 'redacted', 'requiresLocalExecution', 'requiresExternalExecution'].includes(key)).slice(0, 6).map(([key, value]) => [key, formatManifestValue(value)]);
  return <section className="workspace-confirmation-card" data-testid="workspace-confirmation-card"><div className="workspace-confirmation-head"><div><h3>{isCouponCreate ? '新增卡券 · 需要管理员确认' : isAgentSettingsUpdate ? '修改配置 · 需要管理员确认' : '外部动作 · 需要管理员确认'}</h3><p>{isCouponCreate ? `确认后会在 ${accountName} 下创建卡券批次，预览展示的是接口参数摘要。` : isAgentSettingsUpdate ? `确认后会更新 ${accountName} 的自动回复 Agent 配置，Prompt 原文不会显示。` : `该动作会改变 ${accountName} 的对外状态，确认后由服务端继续执行。`}</p></div><span>{isCouponCreate ? '中风险 · 卡券写入' : isAgentSettingsUpdate ? '中风险 · 配置写入' : '中风险 · 外部写入'}</span></div><div className="workspace-confirmation-params" data-testid="workspace-confirmation-params">{detailRows.map(([key, value]) => <div key={key}><small>{key}</small><strong>{value}</strong></div>)}</div><div className="workspace-confirmation-diff"><div><small>执行前</small><strong>{status}<br />{titleText}</strong></div><div><small>执行后</small><strong>{isCouponCreate ? <>创建卡券批次<br />服务端按以上参数写入</> : isAgentSettingsUpdate ? <>更新 Agent 配置<br />Prompt 原文不会显示在 Workspace</> : <>确认后进入执行队列<br />由服务端回传结果</>}</strong></div></div><div className="workspace-confirmation-meta">policy: {confirmation.policyRef} · version: {confirmation.version} · expires: {formatTime(confirmation.expiresAt)}</div><div className="workspace-confirmation-actions"><button className="btn ghost" type="button" onClick={onCancel} disabled={actionSubmitting || confirmation.status !== 'active'} data-testid="workspace-confirm-cancel">取消动作</button><button className="btn warning" type="button" onClick={onConfirm} disabled={actionSubmitting || confirmation.status !== 'active'} data-testid="workspace-confirm-continue">{actionSubmitting ? '提交中…' : '确认继续'}</button></div></section>;
}
function purposeLabel(value: string): string { const label = ({ text: '固定文字', data: '批量数据', api: 'API 接口', image: '图片' } as Record<string, string>)[value]; return label ?? value ?? '未解析'; }
function formatManifestValue(value: unknown): string { if (Array.isArray(value)) return value.join('、'); if (value && typeof value === 'object') return '[已结构化]'; return String(value ?? '未指定'); }
function WorkspaceOutboxPanel({ items, actionSubmitting, onRetry }: { items: WorkspaceOutboxVM[]; actionSubmitting: boolean; onRetry: () => void }) { const item = items[items.length - 1]; if (!item) return null; const label = item.status === 'pending' ? '已进入执行队列' : item.status === 'processing' ? '执行中' : item.status === 'retryable' ? '等待重试' : item.status === 'dead_lettered' ? '需要人工恢复' : item.status === 'succeeded' ? '已完成' : '结果未知'; const resultSummary = formatOutboxResult(item.result); return <section className="workspace-outbox-panel" data-testid="workspace-outbox-panel"><div><strong>Outbox 结果</strong><span>{label} · attempt {item.attempt}</span>{resultSummary && <small data-testid="workspace-outbox-result">{resultSummary}</small>}</div>{(item.status === 'retryable' || item.status === 'dead_lettered') && <button className="btn ghost" type="button" onClick={onRetry} disabled={actionSubmitting} data-testid="workspace-outbox-retry">重试</button>}{item.externalOutcome === 'unknown' && <small>外部结果未知，请先查询或人工恢复，系统不会盲目重放。</small>}</section>; }
function formatOutboxResult(result?: Record<string, unknown>): string | undefined { if (!result) return undefined; const product = result.product && typeof result.product === 'object' && !Array.isArray(result.product) ? result.product as Record<string, unknown> : undefined; const title = typeof product?.title === 'string' ? product.title : undefined; const version = typeof result.configVersion === 'number' ? `v${result.configVersion}` : undefined; if (title && version) return `落库确认：${title} · 自动化规则 ${version}${result.persisted === true ? ' · 已回读校验' : ''}`; if (version) return `落库确认：配置 ${version}${result.persisted === true ? ' · 已回读校验' : ''}`; return result.persisted === true ? '落库确认：已回读校验' : undefined; }
function WorkspaceState({ title, message, action, compact = false }: { title: string; message: string; action?: ReactNode; compact?: boolean }) { return <div className={`workspace-state ${compact ? 'compact' : ''}`}><strong>{title}</strong><span>{message}</span>{action}</div>; }
