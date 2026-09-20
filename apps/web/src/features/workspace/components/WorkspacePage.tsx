import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useAccountContext } from '../../../app/account-context';
import { useWorkspaceController } from '../controller';
import { buildWorkspaceMessages } from '../messages';
import type { WorkspaceApi } from '../api';
import type { WorkspaceMessageVM, WorkspaceRunStatus, WorkspaceSessionVM } from '../types';
import './workspace.css';

export interface WorkspacePageProps { api: WorkspaceApi; }

const terminalStatuses = new Set<WorkspaceRunStatus>(['succeeded', 'partially_succeeded', 'failed', 'cancelled', 'expired']);

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    queued: '排队中', running: '运行中', waiting_confirmation: '等待确认', executing: '执行中', retrying: '重试中', cancelling: '取消中',
    succeeded: '已完成', partially_succeeded: '部分完成', failed: '失败', cancelled: '已取消', expired: '已过期', pending: '待执行', skipped: '已跳过',
  };
  return labels[status] ?? status;
}

function statusTone(status: string): string {
  if (status === 'succeeded') return 'ok';
  if (status === 'failed' || status === 'expired') return 'danger';
  if (status === 'cancelled' || status === 'skipped') return 'muted';
  return 'info';
}

function formatTime(value?: string): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function WorkspacePage({ api }: WorkspacePageProps) {
  const { currentAccountId, currentAccount, accountsLoading, accountsError } = useAccountContext();
  const controller = useWorkspaceController({ api, accountId: currentAccountId });
  const { state } = controller;
  const [search, setSearch] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [instruction, setInstruction] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [expandedReasoning, setExpandedReasoning] = useState<string | null>(null);

  const visibleSessions = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return state.sessions;
    return state.sessions.filter((session) => `${session.title} ${session.summary ?? ''}`.toLowerCase().includes(keyword));
  }, [search, state.sessions]);
  const activeSession = state.sessions.find((session) => session.id === state.activeSessionId);
  const currentRun = state.run && activeSession && state.run.sessionId === activeSession.id ? state.run : null;
  const messages = currentRun ? buildWorkspaceMessages(currentRun, state.events) : [];
  const contextMissing = !accountsLoading && !accountsError && !currentAccountId;

  async function submitSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = newTitle.trim();
    if (!title) return;
    const created = await controller.createSession(title);
    if (created) { setNewTitle(''); setShowCreate(false); }
  }

  async function submitRun(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = instruction.trim();
    if (!text || !activeSession || activeSession.status !== 'active' || state.submitting) return;
    const run = await controller.startRun(text);
    if (run) setInstruction('');
  }

  function chooseAccount() {
    window.history.pushState({}, '', '/accounts');
    window.dispatchEvent(new PopStateEvent('popstate'));
  }

  return (
    <section className="page-stack workspace-domain" data-workspace-domain>
      <div className="page-title workspace-page-title">
        <div><p className="eyebrow">Agent 工作区</p><h1>工作区</h1><p>管理工作区会话，连续跟踪每次 Run 的 Agent 对话。</p></div>
        <div className="workspace-scope"><span className={`workspace-scope-dot ${currentAccountId ? 'online' : ''}`} /><span>{currentAccount?.displayName ?? (contextMissing ? '未选择账号' : '账号加载中')}</span></div>
      </div>

      {accountsError && <div className="workspace-inline-error" role="alert">账号上下文加载失败：{accountsError}</div>}
      {state.error && <div className="workspace-inline-error" role="alert">{state.error}</div>}

      {contextMissing ? <WorkspaceState title="请先选择账号" message="每个工作区会话都绑定一个可用的闲鱼账号。" action={<button className="btn primary" type="button" onClick={chooseAccount}>前往账号管理</button>} />
        : state.phase === 'forbidden' ? <WorkspaceState title="暂无工作区权限" message={state.error ?? '当前账号范围无法读取工作区。'} action={<button className="btn ghost" type="button" onClick={() => void controller.reload()}>重新加载</button>} />
          : <div className="workspace-layout">
            <aside className="card workspace-sessions-panel">
              <div className="workspace-panel-head"><div><h2>会话</h2><p>{state.sessions.length} 个工作区会话</p></div><button className="btn primary" type="button" onClick={() => setShowCreate((value) => !value)}>新建</button></div>
              {showCreate && <form className="workspace-create-form" onSubmit={submitSession}><label htmlFor="workspace-session-title">会话名称</label><div className="workspace-create-row"><input id="workspace-session-title" value={newTitle} onChange={(event) => setNewTitle(event.target.value)} placeholder="例如：每日店铺巡检" autoFocus /><button className="btn primary" type="submit" disabled={state.submitting || !newTitle.trim()}>保存</button></div></form>}
              <label className="workspace-search"><span aria-hidden="true">⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索会话" aria-label="搜索会话" /></label>
              <div className="workspace-session-list">
                {state.phase === 'loading' && <div className="workspace-list-state">正在加载会话…</div>}
                {state.phase !== 'loading' && visibleSessions.length === 0 && <div className="workspace-list-state">{state.sessions.length ? '没有匹配的会话' : '还没有会话，先新建一个'}</div>}
                {visibleSessions.map((session) => <SessionRow key={session.id} session={session} active={session.id === state.activeSessionId} busy={state.submitting} onSwitch={() => { if (session.status === 'active') void controller.switchSession(session.id); }} onArchive={() => { if (window.confirm(`归档“${session.title}”？`)) void controller.archiveSession(session.id); }} />)}
              </div>
            </aside>

            <section className="card workspace-thread" aria-label="Workspace conversation">
              <header className="workspace-thread-header">
                <div><p className="eyebrow">实时运行线程</p><h2>{activeSession?.title ?? '选择活跃会话'}</h2><p>{currentRun ? `${messages.length} 条消息 · Run 创建于 ${formatTime(currentRun.createdAt)}` : '提交 Run 后，这里会展示连续的 Agent 消息流。'}</p></div>
                <div className="workspace-thread-meta">{currentRun && <span className={`workspace-status workspace-status-${statusTone(currentRun.status)}`}>{statusLabel(currentRun.status)}</span>}<span className={`workspace-connection workspace-connection-${state.connection}`}><span />{state.connection === 'connected' ? '实时' : state.connection === 'reconnecting' ? '重连中' : state.connection === 'connecting' ? '连接中' : '离线'}</span>{currentRun && !terminalStatuses.has(currentRun.status) && state.connection !== 'connected' && <button className="btn ghost workspace-reconnect-button" type="button" onClick={controller.reconnectRun}>重连</button>}</div>
              </header>

              <div className="workspace-message-stream">
                {currentRun ? <MessageStream messages={messages} expandedReasoning={expandedReasoning} onToggleReasoning={(id) => setExpandedReasoning((current) => current === id ? null : id)} /> : <WorkspaceState title="等待首条 Run" message={activeSession ? '在下方输入一条指令，开始受控执行。' : '请从左侧选择一个活跃会话。'} compact />}
              </div>

              <form className="workspace-composer workspace-composer-docked" onSubmit={submitRun}>
                <div className="workspace-composer-context"><span className={`workspace-composer-dot ${activeSession?.status === 'active' ? 'ready' : ''}`} /><span>{activeSession?.status === 'active' ? '准备运行' : '只读会话'}</span></div>
                <textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} maxLength={4000} disabled={!activeSession || activeSession.status !== 'active' || state.submitting} placeholder="请告诉 Agent 要检查、规划或执行什么…" aria-label="Run 指令" />
                <div className="workspace-composer-foot"><span>{instruction.length}/4000</span><button className="btn primary" type="submit" disabled={!instruction.trim() || !activeSession || activeSession.status !== 'active' || state.submitting}>{state.submitting ? '提交中…' : '运行'}</button></div>
              </form>
            </section>
          </div>}
    </section>
  );
}

function SessionRow({ session, active, busy, onSwitch, onArchive }: { session: WorkspaceSessionVM; active: boolean; busy: boolean; onSwitch: () => void; onArchive: () => void }) {
  return <div className={`workspace-session-row ${active ? 'active' : ''} ${session.status === 'archived' ? 'archived' : ''}`}>
    <button type="button" className="workspace-session-select" onClick={onSwitch} disabled={busy || session.status === 'archived'} aria-pressed={active}><span className="workspace-session-title">{session.title}</span><small>{session.status === 'archived' ? '已归档' : '活跃'} · {formatTime(session.lastActiveAt)}</small>{session.summary && <small>{session.summary}</small>}</button>
    <button type="button" className="workspace-session-action" onClick={onArchive} disabled={busy || session.status === 'archived'} aria-label={`归档 ${session.title}`}>•••</button>
  </div>;
}

function MessageStream({ messages, expandedReasoning, onToggleReasoning }: { messages: WorkspaceMessageVM[]; expandedReasoning: string | null; onToggleReasoning: (id: string) => void }) {
  return <div className="workspace-message-list">{messages.map((message) => <MessageBubble key={message.id} message={message} expanded={expandedReasoning === message.id} onToggle={() => onToggleReasoning(message.id)} />)}</div>;
}

function MessageBubble({ message, expanded, onToggle }: { message: WorkspaceMessageVM; expanded: boolean; onToggle: () => void }) {
  if (message.type === 'user_message') return <article className="workspace-message workspace-message-user"><div className="workspace-message-avatar">我</div><div className="workspace-message-content"><div className="workspace-message-meta"><strong>用户</strong><time>{formatTime(message.createdAt)}</time></div><p>{message.content}</p></div></article>;
  if (message.type === 'reasoning_summary') return <article className="workspace-message workspace-message-reasoning"><button type="button" className="workspace-message-toggle" onClick={onToggle} aria-expanded={expanded}><span className="workspace-message-icon">◌</span><span><strong>推理摘要</strong><small>{message.summary ?? '高层执行摘要'}</small></span><span className="workspace-message-chevron">{expanded ? '⌃' : '⌄'}</span></button>{expanded && <div className="workspace-reasoning-body"><p>{message.content}</p></div>}</article>;
  if (message.type === 'tool_event') return <article className="workspace-message workspace-message-tool"><div className="workspace-message-icon">⚙</div><div className="workspace-message-content"><div className="workspace-message-meta"><strong>{message.title}</strong><time>{formatTime(message.createdAt)}</time></div><p>{message.content}</p>{message.eventType && <small className="workspace-message-code">{message.eventType}{message.sequence ? ` · #${message.sequence}` : ''}</small>}</div></article>;
  return <article className={`workspace-message workspace-message-final ${message.status && statusTone(message.status) === 'danger' ? 'is-error' : ''}`}><div className="workspace-message-icon">✦</div><div className="workspace-message-content"><div className="workspace-message-meta"><strong>{message.title}</strong><time>{formatTime(message.createdAt)}</time></div><p>{message.content}</p></div></article>;
}

function WorkspaceState({ title, message, action, compact = false }: { title: string; message: string; action?: ReactNode; compact?: boolean }) {
  return <div className={`workspace-state ${compact ? 'compact' : ''}`}><strong>{title}</strong><span>{message}</span>{action}</div>;
}
