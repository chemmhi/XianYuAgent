import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useAccountContext } from '../../../app/account-context';
import { useWorkspaceController } from '../controller';
import { buildWorkspaceMessages, deriveSessionTitle, groupWorkspaceMessages, type WorkspaceAgentTraceGroup } from '../messages';
import type { WorkspaceApi } from '../api';
import type { WorkspaceMessageVM, WorkspaceRunStatus, WorkspaceSessionVM } from '../types';
import { SearchField } from '../../../shared/ui/SearchField';
import { Button } from '../../../shared/ui/Button';
import './workspace.css';

export interface WorkspacePageProps { api: WorkspaceApi; }
const terminalStatuses = new Set<WorkspaceRunStatus>(['succeeded', 'partially_succeeded', 'failed', 'cancelled', 'expired']);

function statusLabel(status: string): string {
  const labels: Record<string, string> = { queued: '排队中', running: '运行中', waiting_confirmation: '等待确认', executing: '执行中', retrying: '重试中', cancelling: '取消中', succeeded: '已完成', partially_succeeded: '部分完成', failed: '失败', cancelled: '已取消', expired: '已过期', pending: '待执行', skipped: '已跳过' };
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
  const instructionRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (draftMode) instructionRef.current?.focus(); }, [draftMode]);

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
    {state.error && <div className="workspace-inline-error" role="alert">{state.error}</div>}
    {contextMissing ? <WorkspaceState title="请先选择账号" message="每个工作区会话都绑定一个可用的闲鱼账号。" action={<button className="btn primary" type="button" onClick={chooseAccount}>前往账号管理</button>} />
      : state.phase === 'forbidden' ? <WorkspaceState title="暂无工作区权限" message={state.error ?? '当前账号范围无法读取工作区。'} action={<button className="btn ghost" type="button" onClick={() => void controller.reload()}>重新加载</button>} />
        : <div className="workspace-layout">
          <aside className="card workspace-sessions-panel"><div className="workspace-panel-head"><div><h2>会话</h2><p>{state.sessions.length} 个工作区会话</p></div><Button variant="primary" type="button" onClick={startDraft}>新建会话</Button></div><SearchField className="workspace-search" value={search} onChange={(event) => controller.setSearch(event.target.value)} onClear={() => controller.setSearch('')} clearable placeholder="搜索会话" aria-label="搜索会话" /><div className="workspace-session-list">{state.phase === 'loading' && <div className="workspace-list-state">正在加载会话…</div>}{state.phase !== 'loading' && visibleSessions.length === 0 && <div className="workspace-list-state">{state.sessions.length ? '没有匹配的会话' : '还没有会话，点击“新建会话”开始'}</div>}{visibleSessions.map((session) => <SessionRow key={session.id} session={session} active={!draftMode && session.id === state.activeSessionId} busy={state.submitting} onSwitch={() => { setDraftMode(false); if (session.status === 'active') void controller.switchSession(session.id); }} onArchive={() => { if (window.confirm(`归档“${session.title}”？`)) void controller.archiveSession(session.id); }} />)}</div></aside>
          <section className="card workspace-thread" aria-label="Workspace 对话"><header className="workspace-thread-header"><div><p className="eyebrow">连续对话</p><h2>{draftMode ? '新会话' : activeSession?.title ?? '选择活跃会话'}</h2><p>{currentRun ? `${messages.length} 条消息 · Run 创建于 ${formatTime(currentRun.createdAt)}` : draftMode ? '输入第一条消息后，会自动创建会话并生成标题。' : '提交 Run 后，这里会展示连续的 Agent 消息流。'}</p></div><div className="workspace-thread-meta">{currentRun && <span className={`workspace-status workspace-status-${statusTone(currentRun.status)}`}>{statusLabel(currentRun.status)}</span>}<span className={`workspace-connection workspace-connection-${state.connection}`}><span />{state.connection === 'connected' ? '实时' : state.connection === 'reconnecting' ? '重连中' : state.connection === 'connecting' ? '连接中' : '离线'}</span>{currentRun && !terminalStatuses.has(currentRun.status) && state.connection !== 'connected' && <button className="btn ghost workspace-reconnect-button" type="button" onClick={controller.reconnectRun}>重连</button>}</div></header><div className="workspace-message-stream">{messages.length ? <MessageStream messages={messages} expandedTrace={expandedTrace} onToggleTrace={(id) => setExpandedTrace((current) => current === id ? null : id)} /> : <WorkspaceState title={draftMode ? '开始一段新对话' : '等待首条 Run'} message={draftMode ? '在下方输入消息，系统会自动创建会话。' : activeSession ? '在下方输入一条指令，开始受控执行。' : '请从左侧选择一个活跃会话。'} compact />}</div><form className="workspace-composer workspace-composer-docked" onSubmit={submitRun}><div className="workspace-composer-context"><span className={`workspace-composer-dot ${draftMode || activeSession?.status === 'active' ? 'ready' : ''}`} /><span>{draftMode ? '新会话' : activeSession?.status === 'active' ? '准备运行' : '只读会话'}</span></div><textarea ref={instructionRef} value={instruction} onChange={(event) => setInstruction(event.target.value)} maxLength={4000} disabled={(!draftMode && (!activeSession || activeSession.status !== 'active')) || state.submitting} placeholder="给 Agent 发消息…" aria-label="Run 指令" /><div className="workspace-composer-foot"><span>{instruction.length}/4000</span><button className="btn primary" type="submit" disabled={!instruction.trim() || (!draftMode && (!activeSession || activeSession.status !== 'active')) || state.submitting}>{state.submitting ? '提交中…' : '发送'}</button></div></form></section>
        </div>}
  </section>;
}

export function SessionRow({ session, active, busy, onSwitch, onArchive }: { session: WorkspaceSessionVM; active: boolean; busy: boolean; onSwitch: () => void; onArchive: () => void }) { return <div className={`workspace-session-row ${active ? 'active' : ''} ${session.status === 'archived' ? 'archived' : ''}`}><button type="button" className="workspace-session-select" onClick={onSwitch} disabled={busy || session.status === 'archived'} aria-pressed={active}><span className="workspace-session-title">{session.title}</span><small>{session.status === 'archived' ? '已归档' : '活跃'} · {formatTime(session.lastActiveAt)}</small>{session.summary && <small>{session.summary}</small>}</button><button type="button" className="workspace-session-action" data-testid="workspace-session-archive" onClick={onArchive} disabled={busy || session.status === 'archived'} aria-label={`归档 ${session.title}`} title={`归档 ${session.title}`}><svg className="workspace-session-action-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 5.5h10v7.5H3zM4.5 3.5h7" /><path d="M8 7v3m0 0-1.5-1.5M8 10l1.5-1.5" /></svg></button></div>; }

export function MessageStream({ messages, expandedTrace, onToggleTrace }: { messages: WorkspaceMessageVM[]; expandedTrace: string | null; onToggleTrace: (id: string) => void }) { return <div className="workspace-message-list">{groupWorkspaceMessages(messages).map((block) => block.type === 'agent_trace' ? <AgentTraceView key={block.id} group={block} expanded={expandedTrace === block.id} onToggle={() => onToggleTrace(block.id)} /> : <MessageBubble key={block.id} message={block} />)}</div>; }
function AgentTraceView({ group, expanded, onToggle }: { group: WorkspaceAgentTraceGroup; expanded: boolean; onToggle: () => void }) { const latest = group.messages[group.messages.length - 1]; const active = latest?.status ? statusTone(latest.status) === 'info' : false; const start = Date.parse(group.createdAt); const end = Date.parse(latest?.createdAt ?? group.createdAt); const elapsedSeconds = Number.isFinite(start) && Number.isFinite(end) ? Math.max(1, Math.round((end - start) / 1000)) : 0; const elapsed = elapsedSeconds >= 60 ? `${Math.floor(elapsedSeconds / 60)} 分钟${elapsedSeconds % 60 ? ` ${elapsedSeconds % 60} 秒` : ''}` : `${elapsedSeconds || 1} 秒`; return <article className="workspace-agent-trace"><button type="button" className="workspace-trace-toggle" onClick={onToggle} aria-expanded={expanded}><span className="workspace-trace-copy"><strong>{active ? '正在处理' : `用时 ${elapsed}`}</strong></span><span className="workspace-trace-action">{expanded ? '收起' : '可展开'}</span><span className="workspace-message-chevron" aria-hidden="true">{expanded ? '⌃' : '⌄'}</span></button>{expanded && <div className="workspace-trace-details">{group.messages.map((message) => <div className="workspace-trace-row" key={message.id}><span className="workspace-trace-row-dot" aria-hidden="true" /><div><strong>{message.type === 'reasoning_summary' ? (message.summary ?? '执行步骤') : message.title}</strong><p>{message.content}</p>{message.eventType && <small>{message.eventType}{message.sequence ? ` · #${message.sequence}` : ''}</small>}</div></div>)}</div>}</article>; }
function MessageBubble({ message }: { message: WorkspaceMessageVM }) { if (message.type === 'user_message') return <article className="workspace-message workspace-message-user"><div className="workspace-message-content"><p>{message.content}</p></div></article>; if (message.type === 'final_answer') return <article className={`workspace-message workspace-message-final ${message.status && statusTone(message.status) === 'danger' ? 'is-error' : ''}`}><div className="workspace-message-content"><p>{message.content}</p></div></article>; return <article className="workspace-message workspace-message-assistant"><div className="workspace-message-content"><p>{message.content}</p></div></article>; }
function WorkspaceState({ title, message, action, compact = false }: { title: string; message: string; action?: ReactNode; compact?: boolean }) { return <div className={`workspace-state ${compact ? 'compact' : ''}`}><strong>{title}</strong><span>{message}</span>{action}</div>; }
