import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useAccountContext } from '../../../app/account-context';
import { useWorkspaceController } from '../controller';
import type { WorkspaceApi } from '../api';
import type { WorkspaceRunStatus, WorkspaceSessionVM, WorkspaceStepStatus } from '../types';
import './workspace.css';

export interface WorkspacePageProps { api: WorkspaceApi; }

const terminalStatuses = new Set<WorkspaceRunStatus>(['succeeded', 'partially_succeeded', 'failed', 'cancelled', 'expired']);

function statusLabel(status: WorkspaceRunStatus | WorkspaceStepStatus): string {
  const labels: Record<string, string> = {
    queued: '排队中', running: '运行中', waiting_confirmation: '等待确认', executing: '执行中', retrying: '重试中', cancelling: '取消中',
    succeeded: '已完成', partially_succeeded: '部分完成', failed: '失败', cancelled: '已取消', expired: '已过期', pending: '待执行', skipped: '已跳过',
  };
  return labels[status] ?? status;
}

function statusTone(status: WorkspaceRunStatus | WorkspaceStepStatus): string {
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

function sessionMeta(session: WorkspaceSessionVM): string {
  return `${session.status === 'archived' ? '已归档' : '活跃'} · ${formatTime(session.lastActiveAt)}`;
}

export function WorkspacePage({ api }: WorkspacePageProps) {
  const { currentAccountId, currentAccount, accountsLoading, accountsError } = useAccountContext();
  const controller = useWorkspaceController({ api, accountId: currentAccountId });
  const { state } = controller;
  const [search, setSearch] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [instruction, setInstruction] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  const visibleSessions = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return state.sessions;
    return state.sessions.filter((session) => `${session.title} ${session.summary ?? ''}`.toLowerCase().includes(keyword));
  }, [search, state.sessions]);
  const activeSession = state.sessions.find((session) => session.id === state.activeSessionId);
  const currentRun = state.run && activeSession && state.run.sessionId === activeSession.id ? state.run : null;
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
        <div>
          <p className="eyebrow">Agent Workspace</p>
          <h1>Workspace</h1>
          <p>围绕当前闲鱼账号管理会话、提交首条 Run，并实时观察执行步骤。</p>
        </div>
        <div className="workspace-scope">
          <span className={`workspace-scope-dot ${currentAccountId ? 'online' : ''}`} />
          <span>{currentAccount?.displayName ?? (contextMissing ? '未选择账号' : '正在加载账号')}</span>
        </div>
      </div>

      {accountsError && <div className="workspace-inline-error" role="alert">账号上下文加载失败：{accountsError}</div>}
      {state.error && <div className="workspace-inline-error" role="alert">{state.error}</div>}

      {contextMissing ? (
        <WorkspaceState title="需要先选择账号" message="Workspace 会话必须绑定一个可用的闲鱼账号。" action={<button className="btn primary" type="button" onClick={chooseAccount}>前往账号管理</button>} />
      ) : state.phase === 'forbidden' ? (
        <WorkspaceState title="暂无 Workspace 权限" message={state.error ?? '当前账号范围不允许读取 Workspace。'} action={<button className="btn ghost" type="button" onClick={() => void controller.reload()}>重新加载</button>} />
      ) : (
        <div className="workspace-layout">
          <aside className="card workspace-sessions-panel">
            <div className="workspace-panel-head">
              <div><h2>会话</h2><p>{state.sessions.length} 个工作区会话</p></div>
              <button className="btn primary" type="button" onClick={() => setShowCreate((value) => !value)}>新建</button>
            </div>
            {showCreate && <form className="workspace-create-form" onSubmit={submitSession}>
              <label htmlFor="workspace-session-title">会话名称</label>
              <div className="workspace-create-row"><input id="workspace-session-title" value={newTitle} onChange={(event) => setNewTitle(event.target.value)} placeholder="例如：每日店铺巡检" autoFocus /><button className="btn primary" type="submit" disabled={state.submitting || !newTitle.trim()}>保存</button></div>
            </form>}
            <label className="workspace-search"><span aria-hidden="true">⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索会话" aria-label="搜索会话" /></label>
            <div className="workspace-session-list">
              {state.phase === 'loading' && <div className="workspace-list-state">正在加载会话…</div>}
              {state.phase !== 'loading' && visibleSessions.length === 0 && <div className="workspace-list-state">{state.sessions.length ? '没有匹配的会话' : '还没有会话，先新建一个'}</div>}
              {visibleSessions.map((session) => <SessionRow key={session.id} session={session} active={session.id === state.activeSessionId} busy={state.submitting} onSwitch={() => { if (session.status === 'active') void controller.switchSession(session.id); }} onArchive={() => { if (window.confirm(`归档“${session.title}”？`)) void controller.archiveSession(session.id); }} />)}
            </div>
          </aside>

          <div className="workspace-main-column">
            <article className="card workspace-composer-panel">
              <div className="workspace-panel-head">
                <div><p className="eyebrow">Run Composer</p><h2>{activeSession?.title ?? '选择一个活跃会话'}</h2><p>{activeSession ? '提交一条指令，服务端会创建 Run 并通过事件流回放执行进度。' : '从左侧选择一个活跃会话后开始。'}</p></div>
                {activeSession && <span className={`workspace-status workspace-status-${activeSession.status === 'active' ? 'ok' : 'muted'}`}>{activeSession.status === 'active' ? '可写' : '只读'}</span>}
              </div>
              <form className="workspace-composer" onSubmit={submitRun}>
                <textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} maxLength={4000} disabled={!activeSession || activeSession.status !== 'active' || state.submitting} placeholder="告诉 Agent 你要完成什么，例如：检查当前账号的工作区状态" />
                <div className="workspace-composer-foot"><span>{instruction.length}/4000</span><button className="btn primary" type="submit" disabled={!instruction.trim() || !activeSession || activeSession.status !== 'active' || state.submitting}>{state.submitting ? '提交中…' : '运行 Run'}</button></div>
              </form>
            </article>

            <article className="card workspace-run-panel">
              <div className="workspace-panel-head">
                <div><p className="eyebrow">Execution Timeline</p><h2>Run 执行状态</h2><p>{currentRun ? `创建于 ${formatTime(currentRun.createdAt)}` : '提交指令后，这里会展示 Run 与 Step 的实时状态。'}</p></div>
                {currentRun && <span className={`workspace-status workspace-status-${statusTone(currentRun.status)}`}>{statusLabel(currentRun.status)}</span>}
              </div>
              {currentRun ? <RunTimeline run={currentRun} events={state.events} connection={state.connection} onReconnect={controller.reconnectRun} /> : <WorkspaceState title="等待首条 Run" message={activeSession ? '输入一条指令开始受控执行。' : '请先选择活跃会话。'} compact />}
            </article>
          </div>
        </div>
      )}
    </section>
  );
}

function SessionRow({ session, active, busy, onSwitch, onArchive }: { session: WorkspaceSessionVM; active: boolean; busy: boolean; onSwitch: () => void; onArchive: () => void }) {
  return <div className={`workspace-session-row ${active ? 'active' : ''} ${session.status === 'archived' ? 'archived' : ''}`}>
    <button type="button" className="workspace-session-select" onClick={onSwitch} disabled={busy || session.status === 'archived'} aria-pressed={active}>
      <span className="workspace-session-title">{session.title}</span><small>{sessionMeta(session)}</small>{session.summary && <small>{session.summary}</small>}
    </button>
    <button type="button" className="workspace-session-action" onClick={onArchive} disabled={busy || session.status === 'archived'} aria-label={`归档 ${session.title}`}>•••</button>
  </div>;
}

function RunTimeline({ run, events, connection, onReconnect }: { run: NonNullable<ReturnType<typeof useWorkspaceController>['state']['run']>; events: ReturnType<typeof useWorkspaceController>['state']['events']; connection: 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'closed'; onReconnect?: () => void }) {
  const terminal = terminalStatuses.has(run.status);
  return <div className="workspace-run-body">
    <div className="workspace-realtime-banner"><span className={`workspace-realtime-dot ${terminal ? 'terminal' : 'live'}`} /><span>{terminal ? `Run ${statusLabel(run.status)}` : connection === 'connected' ? '实时事件流已连接' : connection === 'reconnecting' ? '实时连接已断开，正在等待重连' : connection === 'connecting' ? '正在连接实时事件流…' : '实时事件流未连接'}</span>{!terminal && onReconnect && connection !== 'connected' && <button className="btn ghost" type="button" onClick={onReconnect}>重连</button>}</div>
    <div className="workspace-instruction"><span>指令摘要</span><p>{run.instructionSummary}</p></div>
    <ol className="workspace-timeline">
      {run.steps.map((step) => <li key={step.stepId} className={`workspace-timeline-item ${step.status}`}><span className={`workspace-step-marker workspace-step-marker-${statusTone(step.status)}`}>{step.status === 'succeeded' ? '✓' : step.status === 'failed' ? '!' : step.sequence}</span><div><div className="workspace-step-head"><strong>{step.label}</strong><span className={`workspace-status workspace-status-${statusTone(step.status)}`}>{statusLabel(step.status)}</span></div><small>{step.inputSummary ?? step.outputSummary ?? '等待服务端更新'}</small>{step.errorCode && <small className="workspace-step-error">错误：{step.errorCode}</small>}</div></li>)}
    </ol>
    {run.resultSummary && <div className="workspace-result workspace-result-ok"><strong>结果</strong><span>{run.resultSummary}</span></div>}
    {run.errorCode && <div className="workspace-result workspace-result-error"><strong>运行失败</strong><span>{run.errorCode}</span></div>}
    {events.length > 0 && <details className="workspace-events"><summary>事件回放 · {events.length} 条</summary>{events.map((event) => <div key={event.sequence} className="workspace-event-row"><span>#{event.sequence}</span><strong>{event.eventType}</strong><small>{formatTime(event.createdAt)}</small></div>)}</details>}
  </div>;
}

function WorkspaceState({ title, message, action, compact = false }: { title: string; message: string; action?: ReactNode; compact?: boolean }) {
  return <div className={`workspace-state ${compact ? 'compact' : ''}`}><strong>{title}</strong><span>{message}</span>{action}</div>;
}
