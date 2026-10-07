import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useAccountContext } from '../../../app/account-context';
import { isWorkspaceRunActive, isWorkspaceRunReconnectable, useWorkspaceController } from '../controller';
import { buildWorkspaceMessages } from '../messages';
import { extractLatestWorkspacePlan } from '../plan';
import type { WorkspaceApi } from '../api';
import type { WorkspaceConfirmationVM, WorkspaceMessageVM, WorkspaceOutboxVM, WorkspaceRunStatus, WorkspaceRunVM, WorkspaceSessionVM, WorkspaceState } from '../types';
import { appendWorkspaceAttachments, buildWorkspaceAttachmentPayloads, buildWorkspaceInstruction, clipboardImageFiles, formatWorkspaceFileSize, type WorkspaceAttachment } from '../attachments';
import { SearchField } from '../../../shared/ui/SearchField';
import { Button } from '../../../shared/ui/Button';
import { Toast } from '../../../shared/ui/Toast';
import { MarkdownContent } from '../../../shared/ui/MarkdownContent';
import { buildWorkspaceActivityItems, isLowSignalSummary, isMeaningfulToolDetail, shouldDisplayToolActionLabel, workspaceToolActionIcon, type WorkspaceActivityItem } from './workspaceActivity';
import { WorkspacePlanCard } from './WorkspacePlanCard';
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

export function shouldUseWorkspaceDraftMode(draftMode: boolean, phase: WorkspaceState['phase'], sessionCount: number, search: string): boolean {
  return draftMode || (phase === 'empty' && sessionCount === 0 && !search.trim());
}

export function WorkspacePage({ api }: WorkspacePageProps) {
  const { currentAccountId, currentAccount, accountsLoading, accountsError } = useAccountContext();
  const controller = useWorkspaceController({ api, accountId: currentAccountId });
  const { state, search, markSessionViewed } = controller;
  const [instruction, setInstruction] = useState('');
  const [draftMode, setDraftMode] = useState(false);
  const [expandedTrace, setExpandedTrace] = useState<string | null>(null);
  const [errorToast, setErrorToast] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WorkspaceSessionVM | null>(null);
  const [pendingAttachments, setPendingAttachments] = useState<WorkspaceAttachment[]>([]);
  const [attachmentPreviewUrl, setAttachmentPreviewUrl] = useState<string | null>(null);
  const instructionRef = useRef<HTMLTextAreaElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const pendingAttachmentsRef = useRef<WorkspaceAttachment[]>([]);
  const messageStreamRef = useRef<HTMLDivElement>(null);
  const lastMessageStreamKeyRef = useRef('');
  // An empty Workspace is already a valid new-conversation state. Keep the
  // composer open so the first instruction can create the session inline.
  const isDraftMode = shouldUseWorkspaceDraftMode(draftMode, state.phase, state.sessions.length, search);
  useEffect(() => { if (isDraftMode) instructionRef.current?.focus(); }, [isDraftMode]);
  useLayoutEffect(() => { resizeComposerTextarea(instructionRef.current); }, [instruction]);
  useEffect(() => { pendingAttachmentsRef.current = pendingAttachments; }, [pendingAttachments]);
  useEffect(() => () => { pendingAttachmentsRef.current.forEach((attachment) => URL.revokeObjectURL(attachment.url)); }, []);
  useEffect(() => {
    setPendingAttachments((previous) => {
      previous.forEach((attachment) => URL.revokeObjectURL(attachment.url));
      return [];
    });
    setAttachmentPreviewUrl(null);
  }, [state.activeSessionId, currentAccountId]);
  useEffect(() => {
    if (!state.error || state.phase === 'forbidden') { setErrorToast(null); return; }
    setErrorToast(state.error);
    const timer = window.setTimeout(() => setErrorToast(null), 5000);
    return () => window.clearTimeout(timer);
  }, [state.error, state.phase]);

  const visibleSessions = useMemo(() => state.sessions, [state.sessions]);
  const activeSession = isDraftMode ? undefined : state.sessions.find((session) => session.id === state.activeSessionId);
  const currentRun = state.run && activeSession && state.run.sessionId === activeSession.id ? state.run : null;
  const activeSessionDisplayTitle = activeSession?.title;
  useEffect(() => {
    if (isDraftMode || !activeSession) return;
    markSessionViewed(activeSession.id, currentRun?.runId ?? activeSession.runId);
  }, [activeSession, currentRun?.runId, isDraftMode, markSessionViewed]);
  useEffect(() => { setExpandedTrace(null); }, [state.activeSessionId, currentRun?.runId]);
  const currentRunMessages = currentRun ? buildWorkspaceMessages(currentRun, state.events) : [];
  const currentPlan = currentRun ? extractLatestWorkspacePlan(state.events, currentRun.runId) : undefined;
  const historyMessages = state.messages.filter((message) => !currentRun || message.runId !== currentRun.runId);
  const messages = isDraftMode ? [] : currentRun ? [...historyMessages, ...currentRunMessages] : state.messages;
  const showConfirmation = !isDraftMode && Boolean(currentRun?.status === 'waiting_confirmation' && state.confirmation);
  const showOutbox = !isDraftMode && Boolean(currentRun && state.outbox.length > 0);
  const taskRunning = Boolean(currentRun && isWorkspaceRunActive(currentRun.status));
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

  function addAttachments(files: readonly (File | null | undefined)[]) {
    setPendingAttachments((previous) => appendWorkspaceAttachments(previous, files));
    setAttachmentPreviewUrl(null);
  }

  function removeAttachment(id: string) {
    setPendingAttachments((previous) => {
      const removed = previous.find((attachment) => attachment.id === id);
      if (removed) URL.revokeObjectURL(removed.url);
      if (attachmentPreviewUrl === removed?.url) setAttachmentPreviewUrl(null);
      return previous.filter((attachment) => attachment.id !== id);
    });
  }

  async function submitRun(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = instruction.trim();
    if ((!text && pendingAttachments.length === 0) || state.submitting || state.conversationLoading || taskRunning || !currentAccountId || (!isDraftMode && activeSession?.status !== 'active')) return;
    const composedInstruction = await buildWorkspaceInstruction(text, pendingAttachments);
    const attachmentPayloads = await buildWorkspaceAttachmentPayloads(pendingAttachments);
    let sessionId = activeSession?.id;
    if (isDraftMode || !sessionId) {
      const created = await controller.createSession('新会话', composedInstruction);
      if (!created) return;
      sessionId = created.id;
      setDraftMode(false);
    }
    const run = await controller.startRun(composedInstruction, sessionId, attachmentPayloads);
    if (run) {
      setInstruction('');
      setPendingAttachments((previous) => { previous.forEach((attachment) => URL.revokeObjectURL(attachment.url)); return []; });
      setAttachmentPreviewUrl(null);
    }
  }
  function startDraft() { setDraftMode(true); setInstruction(''); setExpandedTrace(null); setPendingAttachments((previous) => { previous.forEach((attachment) => URL.revokeObjectURL(attachment.url)); return []; }); setAttachmentPreviewUrl(null); }
  function cancelCurrentRun() {
    if (!currentRun) return;
    if (currentRun.status === 'waiting_confirmation' && state.confirmation) void controller.cancelRun();
    else void controller.cancelActiveRun();
  }
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
                <section className="card workspace-sessions-panel"><div className="workspace-panel-head"><div><h2>会话</h2><p>{state.sessions.length} 个工作区会话</p></div><Button variant="primary" type="button" onClick={startDraft}>新建会话</Button></div><SearchField className="workspace-search" value={search} onChange={(event) => controller.setSearch(event.target.value)} onClear={() => controller.setSearch('')} clearable placeholder="搜索会话" aria-label="搜索会话" /><div className="workspace-session-list">{state.phase === 'loading' && visibleSessions.length === 0 && <div className="workspace-list-state">正在加载会话…</div>}{state.phase !== 'loading' && visibleSessions.length === 0 && <div className="workspace-list-state">{state.sessions.length ? '没有匹配的会话' : '还没有会话，输入指令即可自动创建'}</div>}{visibleSessions.map((session) => { const sessionRunStatus = session.id === state.activeSessionId ? (currentRun?.status ?? session.runStatus) : session.runStatus; return <SessionRow key={session.id} session={session} active={!isDraftMode && session.id === state.activeSessionId} running={Boolean(sessionRunStatus && !terminalStatuses.has(sessionRunStatus))} unread={state.unreadSessionIds.includes(session.id)} busy={state.submitting} onSwitch={() => { setDraftMode(false); if (session.status === 'active') void controller.switchSession(session.id); }} onDelete={() => setDeleteTarget(session)} />; })}</div></section>
              </aside>
              <section className={`card workspace-thread${currentRun?.status === 'waiting_confirmation' ? ' is-confirmation' : ''}`} aria-label="Workspace 对话"><header className="workspace-thread-header"><div><p className="eyebrow">连续对话</p><h2>{isDraftMode ? '新会话' : activeSessionDisplayTitle ?? '选择活跃会话'}</h2><p>{currentRun ? `${messages.length} 条消息 · Run 创建于 ${formatTime(currentRun.createdAt)}` : isDraftMode ? '输入第一条消息后，会自动创建会话并生成标题。' : '提交 Run 后，这里会展示连续的 Agent 消息流。'}</p></div><div className="workspace-thread-meta">{currentRun && <span className={`workspace-status workspace-status-${statusTone(currentRun.status)}`}>{statusLabel(currentRun.status)}</span>}<span className={`workspace-connection workspace-connection-${state.connection}`}><span />{state.connection === 'connected' ? '实时' : state.connection === 'reconnecting' ? '重连中' : state.connection === 'connecting' ? '连接中' : '离线'}</span>{currentRun && isWorkspaceRunReconnectable(currentRun.status) && (state.connection !== 'connected' || currentRun.status === 'failed') && <button className="btn ghost workspace-reconnect-button" type="button" onClick={() => void controller.reconnectRun()}>重连</button>}</div></header>{currentPlan && <WorkspacePlanCard plan={currentPlan} />}<div ref={messageStreamRef} data-testid="workspace-message-stream" className={`workspace-message-stream${hasStreamContent ? '' : ' is-empty'}`}>{!isDraftMode && state.conversationLoading ? <WorkspaceConversationLoading /> : messages.length ? <MessageStream messages={messages} expandedTrace={expandedTrace} onToggleTrace={(id) => setExpandedTrace((current) => current === id ? null : id)} /> : <WorkspaceState title={isDraftMode ? '开始一段新对话' : '等待首条 Run'} message={isDraftMode ? '在下方输入消息，系统会自动创建会话。' : activeSession ? '在下方输入一条指令，开始受控执行。' : '请从左侧选择一个活跃会话。'} compact />}{showConfirmation && <WorkspaceConfirmationCard run={currentRun!} accountName={currentAccount?.displayName ?? '闲鱼账号 A'} confirmation={state.confirmation!} actionSubmitting={state.actionSubmitting} onConfirm={() => void controller.confirmRun()} onCancel={() => void controller.cancelRun()} />}{showOutbox && <WorkspaceOutboxPanel items={state.outbox} actionSubmitting={state.actionSubmitting} onRetry={() => void controller.retryRun()} />}</div><form className="workspace-composer workspace-composer-docked" onSubmit={submitRun}>
                {pendingAttachments.length > 0 && <div className="workspace-inline-attachments" aria-label="待发送附件">
                  {pendingAttachments.map((attachment, index) => <div key={attachment.id} className={`workspace-inline-attachment workspace-inline-attachment-${attachment.kind}`}>
                    {attachment.kind === 'image'
                      ? <button className="workspace-inline-attachment-preview" type="button" aria-label={`预览待发送图片 ${index + 1}`} onClick={() => setAttachmentPreviewUrl(attachment.url)}><img src={attachment.url} alt="待发送图片缩略图" /></button>
                      : <div className="workspace-inline-document" title={attachment.file.name}><span aria-hidden="true">文档</span><strong>{attachment.file.name}</strong><small>{formatWorkspaceFileSize(attachment.file.size)}</small></div>}
                    <button className="workspace-attachment-remove" type="button" aria-label={`移除附件 ${index + 1}`} onClick={() => removeAttachment(attachment.id)}>×</button>
                  </div>)}
                </div>}
                <div className="workspace-composer-editor">
                  <textarea ref={instructionRef} value={instruction} onChange={(event) => { setInstruction(event.target.value); resizeComposerTextarea(event.currentTarget); }} onPaste={(event) => { const images = clipboardImageFiles(event.clipboardData); if (images.length === 0) return; event.preventDefault(); addAttachments(images); }} onKeyDown={(event) => { if (event.nativeEvent.isComposing) return; if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} maxLength={4000} disabled={(!isDraftMode && (!activeSession || activeSession.status !== 'active')) || state.submitting || state.conversationLoading || taskRunning} placeholder="给 Agent 发消息…" aria-label="Run 指令" />
                </div>
                <div className="workspace-composer-foot"><div className="workspace-composer-tools"><button type="button" aria-label="上传文档和图片" onClick={() => attachmentInputRef.current?.click()}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg></button><input ref={attachmentInputRef} className="workspace-file-input" type="file" accept="image/*,.pdf,.doc,.docx,.ppt,.pptx,.txt,.md,.csv,.json,.xls,.xlsx,.xml,.yaml,.yml" multiple onChange={(event) => { addAttachments(Array.from(event.target.files ?? [])); event.currentTarget.value = ''; }} /></div><div className="workspace-composer-meta"><WorkspaceSendButton submitting={state.submitting || taskRunning} cancellable={taskRunning} onCancel={cancelCurrentRun} disabled={(!instruction.trim() && pendingAttachments.length === 0) || (!isDraftMode && (!activeSession || activeSession.status !== 'active')) || state.submitting || state.conversationLoading} /></div></div>
              </form>{attachmentPreviewUrl && <div className="workspace-image-lightbox" role="dialog" aria-modal="true" aria-label="图片预览" onClick={() => setAttachmentPreviewUrl(null)}><div className="workspace-lightbox-content" onClick={(event) => event.stopPropagation()}><button className="workspace-lightbox-close" type="button" aria-label="关闭图片预览" onClick={() => setAttachmentPreviewUrl(null)}>×</button><img src={attachmentPreviewUrl} alt="待发送图片大图预览" /></div></div>}</section>
            </div>
          </div>
          <nav className="workspace-mobile-nav" aria-label="移动端导航"><button type="button">⌂<span>首页</span></button><button className="active" type="button">▣<span>Workspace</span></button><button type="button">✉<span>消息</span></button><button type="button">⚙<span>设置</span></button></nav>
        </div>}
    {deleteTarget && <WorkspaceDeleteSessionModal session={deleteTarget} submitting={state.submitting} onClose={() => { if (!state.submitting) setDeleteTarget(null); }} onConfirm={() => { void controller.deleteSession(deleteTarget.id).then((result) => { if (result) setDeleteTarget(null); }); }} />}
  </section>;
}

export function WorkspaceSendButton({ submitting, disabled, cancellable = false, onCancel }: { submitting: boolean; disabled: boolean; cancellable?: boolean; onCancel?: () => void }) {
  return <button className={`workspace-send-round${submitting ? ' is-submitting' : ''}`} type={cancellable ? 'button' : 'submit'} aria-label={cancellable ? '取消当前任务' : submitting ? '提交中' : '发送'} disabled={cancellable ? false : disabled} onClick={cancellable ? onCancel : undefined}>
    {submitting
      ? <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="1.5" /></svg>
      : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 14-7-4 14-3-6-7-1Z" /><path d="m12 13 3-8" /></svg>}
  </button>;
}

export function SessionRow({ session, active, running = false, unread = false, busy, onSwitch, onDelete }: { session: WorkspaceSessionVM; active: boolean; running?: boolean; unread?: boolean; busy: boolean; onSwitch: () => void; onDelete: () => void }) { const loadingLabel = session.titlePending && running ? '会话标题和任务处理中' : session.titlePending ? '正在生成会话标题' : '任务进行中'; const loadingClass = session.titlePending ? 'workspace-session-title-loading' : 'workspace-session-running-icon'; return <div className={`workspace-session-row ${active ? 'active' : ''} ${session.status === 'archived' ? 'archived' : ''}`}><button type="button" className="workspace-session-select" onClick={onSwitch} disabled={busy || session.status === 'archived'} aria-pressed={active}><span className="workspace-session-title"><span className="workspace-session-title-text">{session.title}</span><span className="workspace-session-title-status">{(session.titlePending || running) && <span className={loadingClass} role="img" aria-label={loadingLabel} title={loadingLabel} />}{unread && <span className="workspace-session-unread-dot" role="img" aria-label="有未读完成任务" title="有未读完成任务" />}</span></span>{(session.summary || session.status === 'archived') && <small>{session.summary ?? '已归档'}</small>}</button><button type="button" className="workspace-session-action" data-testid="workspace-session-delete" onClick={onDelete} disabled={busy} aria-label={`删除 ${session.title}`} title={`删除 ${session.title}`}><svg className="workspace-session-action-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 5h9M6 5V3.5h4V5m-5.5 0 .6 8h5.8l-.6-8M6.5 7.5v3m3-3v3" /></svg></button></div>; }


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

export function MessageStream({ messages, expandedTrace, onToggleTrace }: { messages: WorkspaceMessageVM[]; expandedTrace?: string | null; onToggleTrace?: (id: string) => void }) {
  const visibleMessages = messages.filter(isVisibleWorkspaceActivity);
  const activityItems = buildWorkspaceActivityItems(visibleMessages);
  return <div className="workspace-message-list">
    {activityItems.map((item) => item.kind === 'summary'
      ? <ExecutionSummaryView key={item.id} item={item} />
      : item.kind === 'tool'
        ? <ToolEventView key={item.id} item={item} expanded={expandedTrace === item.id} onToggle={() => onToggleTrace?.(item.id)} />
        : <MessageBubble key={item.message.id} message={item.message} />)}
  </div>;
}

function isVisibleWorkspaceActivity(message: WorkspaceMessageVM): boolean {
  if (message.type !== 'reasoning_summary') return true;
  if (message.eventType === 'reasoning.delta') return false;
  return !['模型原生推理', '执行 Workspace 任务'].includes(message.summary ?? '') && !isLowSignalSummary(message);
}

function ExecutionSummaryView({ item }: { item: Extract<WorkspaceActivityItem, { kind: 'summary' }> }) {
  return <article className="workspace-activity-summary" data-testid="workspace-activity-summary">
    <p>{item.text}</p>
  </article>;
}

function ToolEventView({ item, expanded, onToggle }: { item: Extract<WorkspaceActivityItem, { kind: 'tool' }>; expanded: boolean; onToggle: () => void }) {
  const icon = workspaceToolActionIcon(item.message);
  const detailMessages = item.messages.filter(isMeaningfulToolDetail);
  const canExpand = detailMessages.length > 0;
  const showLabel = shouldDisplayToolActionLabel(item.label, canExpand);
  const accessibleLabel = showLabel ? item.label : '工具动作';
  if (!showLabel && !canExpand) return null;
  return <article className="workspace-activity-action" data-testid="workspace-activity-action" data-tool-name={item.message.title}>
    <button type="button" className="workspace-activity-action-toggle" onClick={canExpand ? onToggle : undefined} aria-expanded={canExpand ? expanded : undefined} aria-label={`${accessibleLabel}${canExpand ? (expanded ? '，收起工具详情' : '，展开工具详情') : ''}`}>
      <span className={`workspace-activity-action-icon workspace-activity-action-icon-${icon}`} aria-hidden="true">
        {icon === 'edit'
          ? <svg viewBox="0 0 16 16" focusable="false"><path d="m3.25 11.75-.5 1.5 1.5-.5 7.9-7.9-1-1-7.9 7.9Z" /><path d="m10.55 3.15 1-1 1.3 1.3-1 1" /></svg>
          : icon === 'search'
            ? <svg viewBox="0 0 16 16" focusable="false"><circle cx="6.75" cy="6.75" r="3.5" /><path d="m9.4 9.4 3.1 3.1" /></svg>
            : icon === 'read'
              ? <svg viewBox="0 0 16 16" focusable="false"><rect x="3" y="2.75" width="10" height="10.5" rx="1" /><path d="M5.25 5.5h5.5M5.25 8h5.5M5.25 10.5h3.5" /></svg>
              : <svg viewBox="0 0 16 16" focusable="false"><path d="m4 4.5 3 3-3 3" /><path d="M8.5 10.5h3.5" /></svg>}
      </span>
      {showLabel && <span className="workspace-activity-action-label">{item.label}</span>}
      {canExpand && <span className="workspace-activity-action-control">
        <span>{expanded ? '收起' : '展开'}</span>
        <svg className={`workspace-activity-action-chevron${expanded ? ' is-expanded' : ''}`} viewBox="0 0 12 12" focusable="false" aria-hidden="true">
          <path d={expanded ? 'M2.5 4 6 7.5 9.5 4' : 'M4 2.5 7.5 6 4 9.5'} vectorEffect="non-scaling-stroke" />
        </svg>
      </span>}
    </button>
    {expanded && canExpand && <div className="workspace-activity-action-details" data-testid="workspace-activity-action-details">
      {detailMessages.map((message) => <div className="workspace-activity-action-detail" key={message.id}>
        <strong>{message.title}</strong>
        <pre>{formatToolEventContent(message.content)}</pre>
      </div>)}
    </div>}
  </article>;
}
export function formatToolEventContent(content: string): string {
  const chunks = extractJsonChunks(content);
  if (!chunks.length) {
    try { return JSON.stringify(JSON.parse(content.trim()), null, 2); } catch { return content; }
  }
  let cursor = 0;
  const parts: string[] = [];
  for (const chunk of chunks) {
    const prefix = content.slice(cursor, chunk.start).trim();
    if (prefix) parts.push(prefix);
    parts.push(JSON.stringify(chunk.value, null, 2));
    cursor = chunk.end;
  }
  const suffix = content.slice(cursor).trim();
  if (suffix) parts.push(suffix);
  return parts.join('\n\n');
}
function extractJsonChunks(content: string): Array<{ start: number; end: number; value: unknown }> {
  const chunks: Array<{ start: number; end: number; value: unknown }> = [];
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] !== '{' && content[index] !== '[') continue;
    const end = findJsonEnd(content, index);
    if (end === -1) continue;
    const candidate = content.slice(index, end);
    try {
      const value = JSON.parse(candidate) as unknown;
      chunks.push({ start: index, end, value });
      index = end - 1;
    } catch {
      // Keep scanning; a brace in plain text is not necessarily JSON.
    }
  }
  return chunks;
}
function findJsonEnd(content: string, start: number): number {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (let index = start; index < content.length; index += 1) {
    const character = content[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') { inString = true; continue; }
    if (character === '{' || character === '[') stack.push(character);
    else if (character === '}' || character === ']') {
      const opening = stack.at(-1);
      if ((character === '}' && opening !== '{') || (character === ']' && opening !== '[')) return -1;
      stack.pop();
      if (!stack.length) return index + 1;
    }
  }
  return -1;
}
function MessageBubble({ message }: { message: WorkspaceMessageVM }) {
  if (message.type === 'user_message') return <article className="workspace-message workspace-message-user"><div className="workspace-message-content"><MarkdownContent className="workspace-markdown" content={message.content} /></div></article>;
  if (message.type === 'final_answer') {
    const streaming = message.eventType === 'assistant.delta' && message.status === 'running';
    return <article className={`workspace-message workspace-message-final ${streaming ? 'is-streaming' : ''} ${message.status && statusTone(message.status) === 'danger' ? 'is-error' : ''}`}><div className="workspace-message-content"><MarkdownContent className="workspace-markdown" content={message.content} /></div></article>;
  }
  return <article className="workspace-message workspace-message-assistant"><div className="workspace-message-content"><MarkdownContent className="workspace-markdown" content={message.content} /></div></article>;
}
export function WorkspaceConfirmationCard({ run, accountName, confirmation, actionSubmitting, onConfirm, onCancel }: { run: WorkspaceRunVM; accountName: string; confirmation: WorkspaceConfirmationVM; actionSubmitting: boolean; onConfirm: () => void; onCancel: () => void }) {
  const manifest = confirmation.manifest;
  const isCouponCreate = confirmation.action === 'coupon_create';
  const isAgentSettingsUpdate = confirmation.action === 'agent_settings_update';
  const isAutomationUpdate = confirmation.action === 'product_automation_update';
  const title = textValue(manifest.title) ?? run.instructionSummary;
  const displayTitle = textValue(manifest.displayTitle);
  const displaySummary = textValue(manifest.displaySummary);
  const productTitle = textValue(manifest.productTitle) ?? inferProductTitleFromInstruction(run.instructionSummary);
  const automationChanges = readAutomationChanges(manifest.automationChanges);
  const automationPreviewReady = !isAutomationUpdate || (Boolean(productTitle) && automationChanges.length > 0);
  const status = confirmation.status === 'active' ? '待确认' : confirmation.status === 'confirmed' ? '已确认' : confirmation.status === 'cancelled' ? '已取消' : confirmation.status === 'expired' ? '已过期' : '已拒绝';
  const titleText = isAutomationUpdate ? productTitle ?? '商品标题获取失败' : isAgentSettingsUpdate ? '自动回复 Agent 配置' : title;
  const detailRows = isCouponCreate
    ? [['卡券名称', String(manifest.label ?? manifest.title ?? '未解析')], ['卡券类型', purposeLabel(String(manifest.purpose ?? ''))], ['内容状态', manifest.configured === true ? '已解析，可创建' : '未配置，确认后仍会校验'], ['正文长度', manifest.contentLength !== undefined ? `${String(manifest.contentLength)} 字符` : '—'], ['数据条数', String(manifest.itemCount ?? 0)], ...(manifest.purpose === 'api' ? [['接口地址', String(manifest.apiUrl ?? '未配置')], ['请求方法', String(manifest.apiMethod ?? 'GET')], ['超时', manifest.apiTimeout !== undefined ? `${String(manifest.apiTimeout)} 秒` : '默认'], ['请求头/参数', `${manifest.apiHeadersConfigured === true ? '已配置' : '未配置'} / ${manifest.apiParamsConfigured === true ? '已配置' : '未配置'}`], ['响应字段', String(manifest.responseField ?? '未配置')]] : []), ...(manifest.purpose === 'image' ? [['图片数量', String(manifest.imageCount ?? 0)]] : [])]
    : isAgentSettingsUpdate
      ? [['变更字段', Array.isArray(manifest.changedFields) ? manifest.changedFields.map((value) => agentFieldLabel(String(value))).join('、') : '未解析'], ['当前版本', `v${String(manifest.expectedVersion ?? 0)}`]]
      : isAutomationUpdate
        ? [['商品', productTitle ?? '商品标题获取失败'], ['变更规则', automationChanges.length ? automationChanges.map((change) => change.label).join('、') : humanizeRuleFields(manifest.fields)], ['变更内容', automationChanges.length ? automationChanges.map((change) => `${change.label}：${change.before} → ${change.after}`).join('\n') : '未生成可确认的前后状态预览'], ['当前版本', manifest.expectedConfigVersion !== undefined ? `v${String(manifest.expectedConfigVersion)}` : '版本信息获取失败']]
        : buildReadableConfirmationRows(confirmation.action, manifest, displaySummary);
  const beforeText = isAutomationUpdate
    ? automationChanges.length ? automationChanges.map((change) => `${change.label}：${change.before}`).join('\n') : '未生成当前配置预览，暂不能确认'
    : `${status}\n${titleText}`;
  const afterText = isAutomationUpdate
    ? automationChanges.length ? automationChanges.map((change) => `${change.label}：${change.after}`).join('\n') : '未生成目标配置预览，暂不能确认'
    : isCouponCreate ? '创建卡券批次\n服务端按以上参数写入' : isAgentSettingsUpdate ? '更新 Agent 配置\nPrompt 原文不会显示在 Workspace' : '确认后进入执行队列\n由服务端回传结果';
  const heading = isAutomationUpdate ? '商品自动化规则变更 · 需要管理员确认' : isCouponCreate ? '新增卡券 · 需要管理员确认' : isAgentSettingsUpdate ? '修改配置 · 需要管理员确认' : `${displayTitle ?? '外部动作'} · 需要管理员确认`;
  const description = isAutomationUpdate
    ? automationPreviewReady ? `${displaySummary ?? `将在 ${accountName} 下更新商品“${productTitle}”的自动化规则`}。确认后会立即保存并生效。` : `系统未获取到商品“${productTitle ?? '当前请求中的商品'}”的完整自动化配置，暂不能确认，避免误改。请重新生成审核预览。`
    : isCouponCreate ? `确认后会在 ${accountName} 下创建卡券批次，卡券正文不会显示在审核卡片中。` : isAgentSettingsUpdate ? `确认后会更新 ${accountName} 的自动回复 Agent 配置，Prompt 原文和凭证不会显示。` : `${displaySummary ?? '该动作会改变当前账号的对外状态'}。确认后由服务端继续执行。`;
  const riskLabel = isAutomationUpdate ? '中风险 · 商品设置' : isCouponCreate ? '中风险 · 卡券写入' : isAgentSettingsUpdate ? '中风险 · 配置写入' : '中风险 · 外部写入';
  return <section className="workspace-confirmation-card" data-testid="workspace-confirmation-card"><div className="workspace-confirmation-head"><div><h3>{heading}</h3><p>{description}</p></div><span>{riskLabel}</span></div><div className="workspace-confirmation-params" data-testid="workspace-confirmation-params">{detailRows.map(([key, value]) => <div key={key}><small>{key}</small><strong>{value}</strong></div>)}</div><div className="workspace-confirmation-diff"><div><small>当前状态</small><strong>{beforeText}</strong></div><div><small>确认后</small><strong>{afterText}</strong></div></div><div className="workspace-confirmation-meta">确认有效期至 {formatTime(confirmation.expiresAt)}</div><div className="workspace-confirmation-actions"><button className="btn ghost" type="button" onClick={onCancel} disabled={actionSubmitting || confirmation.status !== 'active'} data-testid="workspace-confirm-cancel">取消动作</button><button className="btn warning" type="button" onClick={onConfirm} disabled={actionSubmitting || confirmation.status !== 'active' || !automationPreviewReady} data-testid="workspace-confirm-continue">{actionSubmitting ? '提交中…' : '确认继续'}</button></div></section>;
}
function purposeLabel(value: string): string { const label = ({ text: '固定文字', data: '批量数据', api: 'API 接口', image: '图片' } as Record<string, string>)[value]; return label ?? value ?? '未解析'; }
function textValue(value: unknown): string | undefined { return typeof value === 'string' && value.trim() ? value.trim() : undefined; }
function readAutomationChanges(value: unknown): Array<{ key: string; label: string; before: string; after: string }> {
  const explicit = Array.isArray(value)
    ? value.filter(isRecord).map((item) => ({ key: textValue(item.key), label: textValue(item.label) ?? textValue(item.key), before: textValue(item.before), after: textValue(item.after) })).filter((item): item is { key: string; label: string; before: string; after: string } => Boolean(item.key && item.label && item.before && item.after))
    : [];
  return explicit;
}
function inferProductTitleFromInstruction(instruction: string): string | undefined {
  const match = instruction.match(/(?:为|给)\s*[“"']?(.+?)[”"']?\s*(?:设置|配置|更新|修改|开启|启用|启动|关闭|停用|禁用)/i);
  const value = match?.[1]?.replace(/[，,；;:：]+$/g, '').trim();
  return value && !/^(?:商品|当前商品|自动化规则|自动发货)$/i.test(value) ? value : undefined;
}
function humanizeRuleFields(value: unknown): string { if (!Array.isArray(value)) return '未解析'; const labels: Record<string, string> = { paidAutoDelivery: '付费自动发货', unpaidAutoReprice: '未付款自动改价', reviewGift: '评价赠品', reviewReminder: '好评提醒' }; return value.map((item) => labels[String(item)] ?? String(item)).join('、') || '未解析'; }
function agentFieldLabel(value: string): string { const labels: Record<string, string> = { enabled: '自动回复开关', maxLoops: '最大循环次数', maxToolCalls: '工具调用上限', toolTimeoutMs: '工具超时', totalTimeoutMs: '总超时', maxHistory: '上下文历史条数', maxReplyLength: '最大回复长度', replySegmentDelayMs: '分段发送间隔', sendDelaySeconds: '接管等待时间', sendMode: '发送模式' }; return labels[value] ?? value; }
function buildReadableConfirmationRows(action: WorkspaceConfirmationVM['action'], manifest: Record<string, unknown>, displaySummary?: string): Array<[string, string]> {
  const fields = Array.isArray(manifest.fields) ? manifest.fields : Array.isArray(manifest.changedFields) ? manifest.changedFields : undefined;
  if (action === 'product_publish') return [['商品', textValue(manifest.title) ?? '当前商品'], ['当前状态', productStatusLabel(String(manifest.status ?? '未知'))], ['售价', typeof manifest.priceMinor === 'number' ? formatMinorMoney(manifest.priceMinor) : '未设置']];
  if (action === 'product_update') return [['商品', textValue(manifest.productTitle) ?? textValue(manifest.title) ?? '当前商品'], ['变更字段', fields?.map((value) => productFieldLabel(String(value))).join('、') || '按确认内容更新']];
  if (action === 'product_knowledge_update') return [['商品', textValue(manifest.productTitle) ?? '当前商品'], ['更新方式', textValue(manifest.mode) === 'optimize' ? '优化现有知识库' : textValue(manifest.mode) === 'append' ? '追加知识内容' : '替换知识库']];
  if (action === 'order_deliver' || action === 'order_retry' || action === 'order_cancel') {
    const rows: Array<[string, string]> = [['订单号', textValue(manifest.orderNo) ?? '未解析'], ['动作', action === 'order_deliver' ? '执行发货' : action === 'order_retry' ? '重试发货' : '取消发货']];
    const deliveryType = textValue(manifest.deliveryType);
    if (deliveryType) rows.push(['交付方式', deliveryTypeLabel(deliveryType)]);
    return rows;
  }
  if (action.startsWith('coupon_')) {
    const rows: Array<[string, string]> = [['卡券批次', textValue(manifest.batchId) ?? '当前卡券批次'], ['动作', couponActionLabel(action)]];
    const productId = textValue(manifest.productId);
    if (productId) rows.push(['关联商品', productId]);
    return rows;
  }
  if (action === 'model_settings_update') return [['服务商', textValue(manifest.provider) ?? '当前配置'], ['模型', textValue(manifest.model) ?? '未指定'], ['角色', textValue(manifest.role) ?? 'primary']];
  return [['变更内容', displaySummary ?? '已准备一项受控变更']];
}
function productFieldLabel(value: string): string { return ({ title: '商品标题', description: '商品描述', categoryCode: '商品分类', defaultReplyTemplate: '默认回复', priceMinor: '商品价格' } as Record<string, string>)[value] ?? value; }
function productStatusLabel(value: string): string { return ({ draft: '草稿', ready: '待发布', publishing: '发布中', published: '已发布', failed: '发布失败', archived: '已归档' } as Record<string, string>)[value] ?? value; }
function deliveryTypeLabel(value: string): string { return ({ manual: '人工发货', no_logistics: '免物流', coupon_only: '仅发卡券', mixed: '混合交付' } as Record<string, string>)[value] ?? value; }
function couponActionLabel(action: string): string { return ({ coupon_create: '新建卡券', coupon_update: '更新卡券', coupon_enable: '启用卡券', coupon_disable: '停用卡券', coupon_bind: '绑定商品', coupon_unbind: '解除商品绑定', coupon_void: '作废卡券', coupon_copy: '复制卡券' } as Record<string, string>)[action] ?? '更新卡券'; }
function formatMinorMoney(value: number): string { return `¥${(value / 100).toFixed(2)}`; }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function formatManifestValue(value: unknown): string { if (Array.isArray(value)) return value.join('、'); if (value && typeof value === 'object') return '[已结构化]'; return String(value ?? '未指定'); }
function WorkspaceOutboxPanel({ items, actionSubmitting, onRetry }: { items: WorkspaceOutboxVM[]; actionSubmitting: boolean; onRetry: () => void }) { const item = items[items.length - 1]; if (!item) return null; const label = item.status === 'pending' ? '已进入执行队列' : item.status === 'processing' ? '执行中' : item.status === 'retryable' ? '等待重试' : item.status === 'dead_lettered' ? '需要人工恢复' : item.status === 'succeeded' ? '已完成' : '结果未知'; const resultSummary = formatOutboxResult(item.result); return <section className="workspace-outbox-panel" data-testid="workspace-outbox-panel"><div><strong>Outbox 结果</strong><span>{label} · attempt {item.attempt}</span>{resultSummary && <small data-testid="workspace-outbox-result">{resultSummary}</small>}</div>{(item.status === 'retryable' || item.status === 'dead_lettered') && <button className="btn ghost" type="button" onClick={onRetry} disabled={actionSubmitting} data-testid="workspace-outbox-retry">重试</button>}{item.externalOutcome === 'unknown' && <small>外部结果未知，请先查询或人工恢复，系统不会盲目重放。</small>}</section>; }
function formatOutboxResult(result?: Record<string, unknown>): string | undefined { if (!result) return undefined; const product = result.product && typeof result.product === 'object' && !Array.isArray(result.product) ? result.product as Record<string, unknown> : undefined; const title = typeof product?.title === 'string' ? product.title : undefined; const version = typeof result.configVersion === 'number' ? `v${result.configVersion}` : undefined; if (title && version) return `落库确认：${title} · 自动化规则 ${version}${result.persisted === true ? ' · 已回读校验' : ''}`; if (version) return `落库确认：配置 ${version}${result.persisted === true ? ' · 已回读校验' : ''}`; return result.persisted === true ? '落库确认：已回读校验' : undefined; }
function WorkspaceState({ title, message, action, compact = false }: { title: string; message: string; action?: ReactNode; compact?: boolean }) { return <div className={`workspace-state ${compact ? 'compact' : ''}`}><strong>{title}</strong><span>{message}</span>{action}</div>; }

function WorkspaceConversationLoading() {
  return <div className="workspace-state workspace-conversation-loading compact" role="status" aria-live="polite"><span className="workspace-detail-spinner" aria-hidden="true" /><strong>正在加载会话详情</strong><span>正在读取会话消息和执行记录…</span></div>;
}
