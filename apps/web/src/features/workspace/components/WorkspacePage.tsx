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
    queued: 'Queued', running: 'Running', waiting_confirmation: 'Waiting for confirmation', executing: 'Executing', retrying: 'Retrying', cancelling: 'Cancelling',
    succeeded: 'Succeeded', partially_succeeded: 'Partially succeeded', failed: 'Failed', cancelled: 'Cancelled', expired: 'Expired', pending: 'Pending', skipped: 'Skipped',
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
        <div><p className="eyebrow">Agent Workspace</p><h1>Workspace</h1><p>Manage sessions and follow each Run as a continuous agent conversation.</p></div>
        <div className="workspace-scope"><span className={`workspace-scope-dot ${currentAccountId ? 'online' : ''}`} /><span>{currentAccount?.displayName ?? (contextMissing ? 'No account selected' : 'Loading account')}</span></div>
      </div>

      {accountsError && <div className="workspace-inline-error" role="alert">Account context failed to load: {accountsError}</div>}
      {state.error && <div className="workspace-inline-error" role="alert">{state.error}</div>}

      {contextMissing ? <WorkspaceState title="Select an account first" message="Every Workspace session is scoped to one available Xianyu account." action={<button className="btn primary" type="button" onClick={chooseAccount}>Open accounts</button>} />
        : state.phase === 'forbidden' ? <WorkspaceState title="Workspace access unavailable" message={state.error ?? 'Your current account scope cannot read Workspace.'} action={<button className="btn ghost" type="button" onClick={() => void controller.reload()}>Retry</button>} />
          : <div className="workspace-layout">
            <aside className="card workspace-sessions-panel">
              <div className="workspace-panel-head"><div><h2>Sessions</h2><p>{state.sessions.length} workspace sessions</p></div><button className="btn primary" type="button" onClick={() => setShowCreate((value) => !value)}>New</button></div>
              {showCreate && <form className="workspace-create-form" onSubmit={submitSession}><label htmlFor="workspace-session-title">Session name</label><div className="workspace-create-row"><input id="workspace-session-title" value={newTitle} onChange={(event) => setNewTitle(event.target.value)} placeholder="Daily shop review" autoFocus /><button className="btn primary" type="submit" disabled={state.submitting || !newTitle.trim()}>Save</button></div></form>}
              <label className="workspace-search"><span aria-hidden="true">⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search sessions" aria-label="Search sessions" /></label>
              <div className="workspace-session-list">
                {state.phase === 'loading' && <div className="workspace-list-state">Loading sessions…</div>}
                {state.phase !== 'loading' && visibleSessions.length === 0 && <div className="workspace-list-state">{state.sessions.length ? 'No matching sessions' : 'No sessions yet — create one to begin'}</div>}
                {visibleSessions.map((session) => <SessionRow key={session.id} session={session} active={session.id === state.activeSessionId} busy={state.submitting} onSwitch={() => { if (session.status === 'active') void controller.switchSession(session.id); }} onArchive={() => { if (window.confirm(`Archive “${session.title}”?`)) void controller.archiveSession(session.id); }} />)}
              </div>
            </aside>

            <section className="card workspace-thread" aria-label="Workspace conversation">
              <header className="workspace-thread-header">
                <div><p className="eyebrow">Live Run Thread</p><h2>{activeSession?.title ?? 'Choose an active session'}</h2><p>{currentRun ? `${messages.length} messages · Run created ${formatTime(currentRun.createdAt)}` : 'Start a Run to see the agent conversation here.'}</p></div>
                <div className="workspace-thread-meta">{currentRun && <span className={`workspace-status workspace-status-${statusTone(currentRun.status)}`}>{statusLabel(currentRun.status)}</span>}<span className={`workspace-connection workspace-connection-${state.connection}`}><span />{state.connection === 'connected' ? 'Live' : state.connection === 'reconnecting' ? 'Reconnecting' : state.connection === 'connecting' ? 'Connecting' : 'Offline'}</span>{currentRun && !terminalStatuses.has(currentRun.status) && state.connection !== 'connected' && <button className="btn ghost workspace-reconnect-button" type="button" onClick={controller.reconnectRun}>Reconnect</button>}</div>
              </header>

              <div className="workspace-message-stream">
                {currentRun ? <MessageStream messages={messages} expandedReasoning={expandedReasoning} onToggleReasoning={(id) => setExpandedReasoning((current) => current === id ? null : id)} /> : <WorkspaceState title="Waiting for the first Run" message={activeSession ? 'Write an instruction below to start a controlled execution.' : 'Choose an active session from the left.'} compact />}
              </div>

              <form className="workspace-composer workspace-composer-docked" onSubmit={submitRun}>
                <div className="workspace-composer-context"><span className={`workspace-composer-dot ${activeSession?.status === 'active' ? 'ready' : ''}`} /><span>{activeSession?.status === 'active' ? 'Ready to run' : 'Read-only session'}</span></div>
                <textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} maxLength={4000} disabled={!activeSession || activeSession.status !== 'active' || state.submitting} placeholder="Ask Agent to inspect, plan, or act…" aria-label="Run instruction" />
                <div className="workspace-composer-foot"><span>{instruction.length}/4000</span><button className="btn primary" type="submit" disabled={!instruction.trim() || !activeSession || activeSession.status !== 'active' || state.submitting}>{state.submitting ? 'Submitting…' : 'Run'}</button></div>
              </form>
            </section>
          </div>}
    </section>
  );
}

function SessionRow({ session, active, busy, onSwitch, onArchive }: { session: WorkspaceSessionVM; active: boolean; busy: boolean; onSwitch: () => void; onArchive: () => void }) {
  return <div className={`workspace-session-row ${active ? 'active' : ''} ${session.status === 'archived' ? 'archived' : ''}`}>
    <button type="button" className="workspace-session-select" onClick={onSwitch} disabled={busy || session.status === 'archived'} aria-pressed={active}><span className="workspace-session-title">{session.title}</span><small>{session.status === 'archived' ? 'Archived' : 'Active'} · {formatTime(session.lastActiveAt)}</small>{session.summary && <small>{session.summary}</small>}</button>
    <button type="button" className="workspace-session-action" onClick={onArchive} disabled={busy || session.status === 'archived'} aria-label={`Archive ${session.title}`}>•••</button>
  </div>;
}

function MessageStream({ messages, expandedReasoning, onToggleReasoning }: { messages: WorkspaceMessageVM[]; expandedReasoning: string | null; onToggleReasoning: (id: string) => void }) {
  return <div className="workspace-message-list">{messages.map((message) => <MessageBubble key={message.id} message={message} expanded={expandedReasoning === message.id} onToggle={() => onToggleReasoning(message.id)} />)}</div>;
}

function MessageBubble({ message, expanded, onToggle }: { message: WorkspaceMessageVM; expanded: boolean; onToggle: () => void }) {
  if (message.type === 'user_message') return <article className="workspace-message workspace-message-user"><div className="workspace-message-avatar">You</div><div className="workspace-message-content"><div className="workspace-message-meta"><strong>You</strong><time>{formatTime(message.createdAt)}</time></div><p>{message.content}</p></div></article>;
  if (message.type === 'reasoning_summary') return <article className="workspace-message workspace-message-reasoning"><button type="button" className="workspace-message-toggle" onClick={onToggle} aria-expanded={expanded}><span className="workspace-message-icon">◌</span><span><strong>Reasoning summary</strong><small>{message.summary ?? 'High-level execution summary'}</small></span><span className="workspace-message-chevron">{expanded ? '⌃' : '⌄'}</span></button>{expanded && <div className="workspace-reasoning-body"><p>{message.content}</p></div>}</article>;
  if (message.type === 'tool_event') return <article className="workspace-message workspace-message-tool"><div className="workspace-message-icon">⚙</div><div className="workspace-message-content"><div className="workspace-message-meta"><strong>{message.title}</strong><time>{formatTime(message.createdAt)}</time></div><p>{message.content}</p>{message.eventType && <small className="workspace-message-code">{message.eventType}{message.sequence ? ` · #${message.sequence}` : ''}</small>}</div></article>;
  return <article className={`workspace-message workspace-message-final ${message.status && statusTone(message.status) === 'danger' ? 'is-error' : ''}`}><div className="workspace-message-icon">✦</div><div className="workspace-message-content"><div className="workspace-message-meta"><strong>{message.title}</strong><time>{formatTime(message.createdAt)}</time></div><p>{message.content}</p></div></article>;
}

function WorkspaceState({ title, message, action, compact = false }: { title: string; message: string; action?: ReactNode; compact?: boolean }) {
  return <div className={`workspace-state ${compact ? 'compact' : ''}`}><strong>{title}</strong><span>{message}</span>{action}</div>;
}
