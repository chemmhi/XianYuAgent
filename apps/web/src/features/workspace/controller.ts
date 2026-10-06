import { useCallback, useEffect, useRef, useState } from 'react';
import { createWorkspaceApi, type WorkspaceApi } from './api';
import type { WorkspaceAttachmentPayload } from './attachments';
import { deriveWorkspaceSessionTitle } from './messages';
import type { WorkspaceConfirmationVM, WorkspaceMessageVM, WorkspaceOutboxVM, WorkspaceRunEventVM, WorkspaceRunVM, WorkspaceSessionVM, WorkspaceState } from './types';

const defaultApi = createWorkspaceApi({ get: async () => { throw new Error('WORKSPACE_API_UNAVAILABLE'); } });
const terminalRunStatuses = new Set<WorkspaceRunVM['status']>(['succeeded', 'partially_succeeded', 'failed', 'cancelled', 'expired']);

export function isWorkspaceRunActive(status?: WorkspaceRunVM['status']): boolean {
  return Boolean(status && !terminalRunStatuses.has(status));
}

export function isWorkspaceRunReconnectable(status?: WorkspaceRunVM['status']): boolean {
  return Boolean(status && status !== 'waiting_confirmation' && status !== 'cancelling' && (isWorkspaceRunActive(status) || status === 'failed'));
}

export function shouldAutoReconnectWorkspaceRun(status: WorkspaceRunVM['status'] | undefined, connection: WorkspaceState['connection']): boolean {
  return connection === 'reconnecting' && isWorkspaceRunActive(status);
}

const fallbackSessionTitles = new Set(['新会话', '新工作区会话']);

function isFallbackSessionTitle(title: string): boolean {
  return fallbackSessionTitles.has(title.trim());
}

export function mergeWorkspaceSessionTitles(previous: WorkspaceSessionVM[], next: WorkspaceSessionVM[]): WorkspaceSessionVM[] {
  const previousById = new Map(previous.map((session) => [session.id, session]));
  return next.map((session) => {
    const previousSession = previousById.get(session.id);
    if (!previousSession || !isFallbackSessionTitle(session.title) || isFallbackSessionTitle(previousSession.title)) return session;
    return { ...session, title: previousSession.title };
  });
}

export function getWorkspaceRunCandidates(messages: WorkspaceMessageVM[]): string[] {
  const seen = new Set<string>();
  const candidates: string[] = [];
  for (const message of [...messages].reverse()) {
    const runId = message.runId?.trim();
    if (!runId || seen.has(runId)) continue;
    seen.add(runId);
    candidates.push(runId);
  }
  return candidates;
}

export function pickWorkspaceRun(runs: WorkspaceRunVM[]): WorkspaceRunVM | null {
  return runs.find((run) => run.status === 'waiting_confirmation')
    ?? runs.find((run) => !terminalRunStatuses.has(run.status))
    ?? runs[0]
    ?? null;
}

function normalizeError(error: unknown): { message: string; forbidden: boolean } {
  const status = typeof error === 'object' && error && 'status' in error ? Number((error as { status?: unknown }).status) : undefined;
  return { message: error instanceof Error ? error.message : 'Workspace 请求失败', forbidden: status === 403 };
}

function isTerminalRun(status?: WorkspaceRunVM['status']): boolean {
  return Boolean(status && terminalRunStatuses.has(status));
}

export function listWorkspaceSessions(api: WorkspaceApi, accountId: string, search: string): Promise<WorkspaceSessionVM[]> {
  return api.listSessions(accountId, search);
}

export function useWorkspaceController(options: { api?: WorkspaceApi; accountId?: string }): WorkspaceController {
  const api = options.api ?? defaultApi;
  const [state, setState] = useState<WorkspaceState>({ phase: 'idle', sessions: [], unreadSessionIds: [], run: null, messages: [], events: [], connection: 'idle', error: null, submitting: false, confirmation: null, outbox: [], actionSubmitting: false });
  const [search, setSearchState] = useState('');
  const socketRef = useRef<WebSocket | null>(null);
  const connectionAttemptRef = useRef(0);
  const runRef = useRef<WorkspaceRunVM | null>(null);
  const eventCursorRef = useRef(0);
  const requestRef = useRef(0);
  const runRefreshRequestRef = useRef(0);
  const sessionSyncRequestRef = useRef(0);
  const sessionSyncInFlightRef = useRef(false);
  const actionInFlightRef = useRef(false);
  const activeSessionIdRef = useRef<string | undefined>(undefined);
  const reconnectOnHydrateRunRef = useRef<string | undefined>(undefined);
  const sessionStorageKey = options.accountId ? `workspace:active-session:${options.accountId}` : undefined;

  const viewedRunStorageKey = useCallback((sessionId: string) => sessionStorageKey ? `${sessionStorageKey}:viewed-run:${sessionId}` : undefined, [sessionStorageKey]);
  const getViewedRunId = useCallback((sessionId: string) => {
    const key = viewedRunStorageKey(sessionId);
    return typeof window !== 'undefined' && key ? window.sessionStorage.getItem(key) ?? undefined : undefined;
  }, [viewedRunStorageKey]);
  const persistSessionViewed = useCallback((sessionId: string, runId?: string) => {
    const key = viewedRunStorageKey(sessionId);
    if (typeof window !== 'undefined' && key && runId) window.sessionStorage.setItem(key, runId);
  }, [viewedRunStorageKey]);
  const unreadSessionIdsFor = useCallback((sessions: WorkspaceSessionVM[], activeSessionId?: string) => sessions
    .filter((session) => session.id !== activeSessionId && Boolean(session.runId) && isTerminalRun(session.runStatus) && getViewedRunId(session.id) !== session.runId)
    .map((session) => session.id), [getViewedRunId]);

  const markSessionViewed = useCallback((sessionId: string, runId?: string) => {
    persistSessionViewed(sessionId, runId);
    setState((previous) => previous.unreadSessionIds.includes(sessionId)
      ? { ...previous, unreadSessionIds: previous.unreadSessionIds.filter((id) => id !== sessionId) }
      : previous);
  }, [persistSessionViewed]);

  const rememberActiveSession = useCallback((sessionId?: string) => {
    activeSessionIdRef.current = sessionId;
    if (typeof window === 'undefined' || !sessionStorageKey) return;
    if (sessionId) window.sessionStorage.setItem(sessionStorageKey, sessionId);
    else window.sessionStorage.removeItem(sessionStorageKey);
  }, [sessionStorageKey]);

  const recoverRun = useCallback(async (messages: WorkspaceMessageVM[]) => {
    const candidateRunIds = getWorkspaceRunCandidates(messages).slice(0, 12);
    if (!candidateRunIds.length) return { run: null, events: [], confirmation: null, outbox: [] as WorkspaceOutboxVM[] };
    const runs = (await Promise.all(candidateRunIds.map(async (runId) => api.getRun(runId).catch(() => null)))).filter((run): run is WorkspaceRunVM => Boolean(run));
    const run = pickWorkspaceRun(runs);
    if (!run) return { run: null, events: [], confirmation: null, outbox: [] as WorkspaceOutboxVM[] };
    const [events, confirmation, outbox] = await Promise.all([
      api.listEvents(run.runId, 0).catch(() => [] as WorkspaceRunEventVM[]),
      run.status === 'waiting_confirmation' ? api.getConfirmation(run.runId).catch(() => null) : Promise.resolve<WorkspaceConfirmationVM | null>(null),
      api.listOutbox(run.runId).catch(() => [] as WorkspaceOutboxVM[]),
    ]);
    return { run, events, confirmation, outbox };
  }, [api, getViewedRunId]);

  const reload = useCallback(async () => {
    const requestId = ++requestRef.current;
    if (!options.accountId) {
      connectionAttemptRef.current += 1;
      socketRef.current?.close();
      socketRef.current = null;
      reconnectOnHydrateRunRef.current = undefined;
      sessionSyncRequestRef.current += 1;
      runRef.current = null;
      eventCursorRef.current = 0;
      runRefreshRequestRef.current += 1;
      // Keep the per-account session cache while account context is loading.
      // The provider can briefly render without an account during tab remounts.
      setState((previous) => ({ ...previous, phase: 'empty', sessions: [], unreadSessionIds: [], activeSessionId: undefined, run: null, messages: [], events: [], connection: 'idle', error: null, confirmation: null, outbox: [] }));
      return;
    }
    connectionAttemptRef.current += 1;
    socketRef.current?.close();
    socketRef.current = null;
    reconnectOnHydrateRunRef.current = undefined;
    sessionSyncRequestRef.current += 1;
    runRef.current = null;
    eventCursorRef.current = 0;
    runRefreshRequestRef.current += 1;
    setState((previous) => ({ ...previous, phase: 'loading', error: null }));
    try {
      const sessions = await listWorkspaceSessions(api, options.accountId, search);
      if (requestId !== requestRef.current) return;
      const firstActive = sessions.find((session) => session.status === 'active');
      const rememberedSessionId = activeSessionIdRef.current ?? (sessionStorageKey && typeof window !== 'undefined' ? window.sessionStorage.getItem(sessionStorageKey) ?? undefined : undefined);
      const activeSessionId = rememberedSessionId && sessions.some((session) => session.id === rememberedSessionId && session.status === 'active') ? rememberedSessionId : firstActive?.id;
      const messages = activeSessionId ? await api.listMessages(activeSessionId, 500).catch(() => []) : [];
      if (requestId !== requestRef.current) return;
      const recovered = activeSessionId ? await recoverRun(messages) : { run: null, events: [], confirmation: null, outbox: [] as WorkspaceOutboxVM[] };
      if (requestId !== requestRef.current) return;
      const titleMessage = messages.find((message) => message.type === 'user_message' && message.content.trim());
      const hydratedSessions = sessions.map((session) => session.id === activeSessionId && isFallbackSessionTitle(session.title) && titleMessage
        ? { ...session, title: deriveWorkspaceSessionTitle(titleMessage.content) }
        : session);
      const activeSession = activeSessionId ? hydratedSessions.find((session) => session.id === activeSessionId) : undefined;
      reconnectOnHydrateRunRef.current = recovered.run && isWorkspaceRunActive(recovered.run.status) ? recovered.run.runId : undefined;
      if (activeSessionId) persistSessionViewed(activeSessionId, recovered.run?.runId ?? activeSession?.runId);
      rememberActiveSession(activeSessionId);
      runRef.current = recovered.run;
      eventCursorRef.current = recovered.events.reduce((max, event) => Math.max(max, event.sequence), 0);
      setState((previous) => ({ ...previous, phase: hydratedSessions.length ? 'success' : 'empty', sessions: mergeWorkspaceSessionTitles(previous.sessions, hydratedSessions), unreadSessionIds: unreadSessionIdsFor(hydratedSessions, activeSessionId), activeSessionId, messages: activeSessionId ? messages : [], run: recovered.run, events: recovered.events, connection: reconnectOnHydrateRunRef.current ? 'reconnecting' : 'idle', error: null, confirmation: recovered.confirmation, outbox: recovered.outbox }));
    } catch (error) {
      if (requestId !== requestRef.current) return;
      const normalized = normalizeError(error);
      setState((previous) => ({ ...previous, phase: normalized.forbidden ? 'forbidden' : 'error', error: normalized.message }));
    }
  }, [api, options.accountId, persistSessionViewed, recoverRun, rememberActiveSession, search, sessionStorageKey, unreadSessionIdsFor]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void reload(); }, search.trim() ? 220 : 0);
    return () => window.clearTimeout(timer);
  }, [reload, search]);

  useEffect(() => () => { connectionAttemptRef.current += 1; socketRef.current?.close(); socketRef.current = null; }, []);

  const setSearch = useCallback((value: string) => {
    setSearchState(value);
  }, []);

  const createSession = useCallback(async (title: string, instruction?: string) => {
    if (!options.accountId) throw new Error('ACCOUNT_CONTEXT_REQUIRED');
    connectionAttemptRef.current += 1;
    socketRef.current?.close();
    socketRef.current = null;
    setState((previous) => ({ ...previous, submitting: true, error: null }));
    try {
      const session = await api.createSession({ accountId: options.accountId, title, instruction });
      const optimisticTitle = instruction?.trim() && isFallbackSessionTitle(session.title) ? deriveWorkspaceSessionTitle(instruction) : session.title;
      const hydratedSession = optimisticTitle === session.title ? session : { ...session, title: optimisticTitle };
      rememberActiveSession(session.id);
      setState((previous) => ({ ...previous, sessions: [hydratedSession, ...previous.sessions], activeSessionId: session.id, phase: 'success', messages: [], run: null, events: [], connection: 'idle', submitting: false, confirmation: null, outbox: [] }));
      return hydratedSession;
    } catch (error) { const normalized = normalizeError(error); setState((previous) => ({ ...previous, submitting: false, error: normalized.message })); return null; }
  }, [api, options.accountId, rememberActiveSession]);

  const switchSession = useCallback(async (sessionId: string) => {
    const requestId = ++requestRef.current;
    connectionAttemptRef.current += 1;
    socketRef.current?.close();
    socketRef.current = null;
    runRef.current = null;
    eventCursorRef.current = 0;
    runRefreshRequestRef.current += 1;
    setState((previous) => ({ ...previous, submitting: true, error: null }));
    try { const session = await api.switchSession(sessionId); if (requestId !== requestRef.current) return null; const messages = await api.listMessages(session.id, 500).catch(() => []); if (requestId !== requestRef.current) return null; const recovered = await recoverRun(messages); if (requestId !== requestRef.current) return null; persistSessionViewed(session.id, recovered.run?.runId ?? session.runId); rememberActiveSession(session.id); runRef.current = recovered.run; eventCursorRef.current = recovered.events.reduce((max, event) => Math.max(max, event.sequence), 0); setState((previous) => ({ ...previous, activeSessionId: session.id, unreadSessionIds: previous.unreadSessionIds.filter((id) => id !== session.id), messages, run: recovered.run, events: recovered.events, connection: 'idle', submitting: false, confirmation: recovered.confirmation, outbox: recovered.outbox })); return session; }
    catch (error) { const normalized = normalizeError(error); setState((previous) => ({ ...previous, submitting: false, error: normalized.message })); return null; }
  }, [api, persistSessionViewed, recoverRun, rememberActiveSession]);

  const archiveSession = useCallback(async (sessionId: string) => {
    setState((previous) => ({ ...previous, submitting: true, error: null }));
    try { const session = await api.archiveSession(sessionId); if (activeSessionIdRef.current === session.id) rememberActiveSession(undefined); setState((previous) => ({ ...previous, sessions: previous.sessions.map((item) => item.id === session.id ? session : item), activeSessionId: previous.activeSessionId === session.id ? undefined : previous.activeSessionId, submitting: false })); return session; }
    catch (error) { const normalized = normalizeError(error); setState((previous) => ({ ...previous, submitting: false, error: normalized.message })); return null; }
  }, [api, rememberActiveSession]);

  const deleteSession = useCallback(async (sessionId: string) => {
    const deletingActive = activeSessionIdRef.current === sessionId;
    setState((previous) => ({ ...previous, submitting: true, error: null }));
    try {
      const result = await api.deleteSession(sessionId);
      if (deletingActive) {
        connectionAttemptRef.current += 1;
        socketRef.current?.close();
        socketRef.current = null;
        reconnectOnHydrateRunRef.current = undefined;
        runRef.current = null;
        eventCursorRef.current = 0;
        runRefreshRequestRef.current += 1;
        rememberActiveSession(undefined);
      }
      setState((previous) => ({
        ...previous,
        sessions: previous.sessions.filter((item) => item.id !== sessionId),
        activeSessionId: previous.activeSessionId === sessionId ? undefined : previous.activeSessionId,
        messages: deletingActive ? [] : previous.messages,
        run: deletingActive ? null : previous.run,
        events: deletingActive ? [] : previous.events,
        confirmation: deletingActive ? null : previous.confirmation,
        outbox: deletingActive ? [] : previous.outbox,
        connection: deletingActive ? 'idle' : previous.connection,
        submitting: false,
      }));
      if (deletingActive) await reload();
      return result;
    } catch (error) {
      const normalized = normalizeError(error);
      setState((previous) => ({ ...previous, submitting: false, error: normalized.message }));
      return null;
    }
  }, [api, rememberActiveSession, reload]);

  const refreshRunExecution = useCallback(async (run: WorkspaceRunVM) => {
    const expectedRunId = run.runId;
    if (runRef.current && runRef.current.runId !== expectedRunId) return;
    const refreshRequestId = runRefreshRequestRef.current;
    const [confirmation, outbox] = await Promise.all([
      run.status === 'waiting_confirmation' ? api.getConfirmation(run.runId).catch(() => null) : Promise.resolve<WorkspaceConfirmationVM | null>(null),
      api.listOutbox(run.runId).catch(() => [] as WorkspaceOutboxVM[]),
    ]);
    if (refreshRequestId !== runRefreshRequestRef.current || runRef.current?.runId !== expectedRunId || activeSessionIdRef.current !== run.sessionId) return;
    runRef.current = run;
    setState((previous) => ({ ...previous, run, confirmation, outbox, sessions: previous.sessions.map((session) => session.id === run.sessionId ? { ...session, runId: run.runId, runStatus: run.status } : session), unreadSessionIds: isTerminalRun(run.status) && getViewedRunId(run.sessionId) !== run.runId ? [...new Set([...previous.unreadSessionIds, run.sessionId])] : previous.unreadSessionIds.filter((id) => id !== run.sessionId) }));
  }, [api]);

  const syncSessionStatuses = useCallback(async () => {
    if (!options.accountId) return;
    if (sessionSyncInFlightRef.current) return;
    sessionSyncInFlightRef.current = true;
    const requestId = requestRef.current;
    const syncId = ++sessionSyncRequestRef.current;
    try {
      const sessions = await api.listSessions(options.accountId, search).catch(() => null);
      if (!sessions || requestId !== requestRef.current || syncId !== sessionSyncRequestRef.current) return;
      const activeSessionId = activeSessionIdRef.current;
      const activeSession = activeSessionId ? sessions.find((session) => session.id === activeSessionId) : undefined;
      const currentRun = runRef.current;
      if (currentRun && activeSession?.runId === currentRun.runId && activeSession.runStatus && activeSession.runStatus !== currentRun.status) {
        const latest = await api.getRun(currentRun.runId).catch(() => null);
        if (latest && requestId === requestRef.current && syncId === sessionSyncRequestRef.current) await refreshRunExecution(latest);
      }
      if (requestId !== requestRef.current || syncId !== sessionSyncRequestRef.current) return;
      setState((previous) => {
        const mergedSessions = mergeWorkspaceSessionTitles(previous.sessions, sessions);
        return { ...previous, sessions: mergedSessions, unreadSessionIds: unreadSessionIdsFor(mergedSessions, activeSessionId) };
      });
    } finally {
      sessionSyncInFlightRef.current = false;
    }
  }, [api, options.accountId, refreshRunExecution, search, unreadSessionIdsFor]);

  useEffect(() => {
    if (!options.accountId) return;
    const timer = window.setInterval(() => { void syncSessionStatuses(); }, 1_500);
    return () => window.clearInterval(timer);
  }, [options.accountId, syncSessionStatuses]);

  const appendEvent = useCallback((event: WorkspaceRunEventVM) => {
    setState((previous) => {
      if (previous.events.some((item) => item.sequence === event.sequence)) return previous;
      const events = [...previous.events, event].sort((left, right) => left.sequence - right.sequence);
      return { ...previous, events };
    });
    eventCursorRef.current = Math.max(eventCursorRef.current, event.sequence);
    if (event.eventType === 'reasoning.delta' || event.eventType === 'assistant.delta' || event.eventType === 'tool.call.delta') return;
    const currentRun = runRef.current;
    if (currentRun) {
      const refreshRequestId = ++runRefreshRequestRef.current;
      void api.getRun(currentRun.runId).then((run) => {
        if (refreshRequestId !== runRefreshRequestRef.current) return;
        return refreshRunExecution(run);
      }).catch(() => undefined);
    }
  }, [api, refreshRunExecution]);

  const connectRun = useCallback(async (runId: string, afterSequence = eventCursorRef.current) => {
    const attempt = ++connectionAttemptRef.current;
    socketRef.current?.close();
    socketRef.current = null;
    setState((previous) => ({ ...previous, connection: 'reconnecting', error: null }));
    try {
      const replay = await api.listEvents(runId, afterSequence);
      if (attempt !== connectionAttemptRef.current) return;
      replay.forEach((event) => appendEvent(event));
      const cursor = replay.reduce((max, event) => Math.max(max, event.sequence), afterSequence);
      eventCursorRef.current = Math.max(eventCursorRef.current, cursor);
      const socket = api.openRunEvents(runId, eventCursorRef.current, {
        onOpen: () => { if (attempt !== connectionAttemptRef.current) return; setState((previous) => ({ ...previous, connection: 'connected', error: null })); },
        onError: () => { if (attempt !== connectionAttemptRef.current) return; setState((previous) => ({ ...previous, connection: 'reconnecting' })); },
        onClose: () => { if (attempt !== connectionAttemptRef.current) return; setState((previous) => ({ ...previous, connection: 'closed' })); },
        onEvent: (event) => { if (attempt !== connectionAttemptRef.current) return; appendEvent(event); },
      });
      if (attempt !== connectionAttemptRef.current) { socket.close(); return; }
      socketRef.current = socket;
    } catch (error) {
      if (attempt !== connectionAttemptRef.current) return;
      const normalized = normalizeError(error);
      setState((previous) => ({ ...previous, connection: 'reconnecting', error: normalized.message }));
    }
  }, [api, appendEvent]);

  useEffect(() => {
    const runId = reconnectOnHydrateRunRef.current;
    const hydratedRun = state.run;
    if (!runId || !hydratedRun || !shouldAutoReconnectWorkspaceRun(hydratedRun.status, state.connection) || hydratedRun.runId !== runId || state.activeSessionId !== hydratedRun.sessionId) return;
    reconnectOnHydrateRunRef.current = undefined;
    void connectRun(runId, eventCursorRef.current);
  }, [connectRun, state.activeSessionId, state.connection, state.run?.runId, state.run?.sessionId, state.run?.status]);

  const startRun = useCallback(async (instruction: string, sessionIdOverride?: string, attachments?: WorkspaceAttachmentPayload[]) => {
    const sessionId = sessionIdOverride ?? state.activeSessionId;
    if (!options.accountId || !sessionId) throw new Error('WORKSPACE_SESSION_REQUIRED');
    runRefreshRequestRef.current += 1;
    setState((previous) => ({ ...previous, submitting: true, error: null }));
    try {
      // Read the persisted session history in parallel with starting the next run.
      // This keeps earlier turns visible even if the local message state was
      // refreshed while the previous run was completing.
      const persistedMessagesPromise = api.listMessages(sessionId, 500).catch(() => undefined);
      const run = await api.startRun({ accountId: options.accountId, sessionId, instruction, ...(attachments?.length ? { attachments } : {}), clientRunRef: `web-${Date.now()}-${Math.random().toString(16).slice(2)}` });
      const persistedMessages = await persistedMessagesPromise;
      runRef.current = run;
      eventCursorRef.current = 0;
      setState((previous) => ({ ...previous, run, messages: persistedMessages ?? previous.messages, events: [], connection: 'connecting', submitting: false, confirmation: null, outbox: [], unreadSessionIds: previous.unreadSessionIds.filter((id) => id !== run.sessionId), sessions: previous.sessions.map((session) => session.id === run.sessionId ? { ...session, runId: run.runId, runStatus: run.status } : session) }));
      void connectRun(run.runId, 0);
      return run;
    } catch (error) { const normalized = normalizeError(error); setState((previous) => ({ ...previous, submitting: false, error: normalized.message })); return null; }
  }, [api, connectRun, options.accountId, state.activeSessionId]);

  const cancelActiveRun = useCallback(async () => {
    const currentRun = runRef.current;
    if (!currentRun || !isWorkspaceRunActive(currentRun.status) || actionInFlightRef.current) return null;
    actionInFlightRef.current = true;
    runRefreshRequestRef.current += 1;
    setState((previous) => ({ ...previous, actionSubmitting: true, error: null }));
    try {
      const run = await api.cancelActiveRun(currentRun.runId);
      connectionAttemptRef.current += 1;
      socketRef.current?.close();
      socketRef.current = null;
      runRef.current = run;
      setState((previous) => ({ ...previous, run, confirmation: null, outbox: [], actionSubmitting: false, connection: 'closed', sessions: previous.sessions.map((session) => session.id === run.sessionId ? { ...session, runId: run.runId, runStatus: run.status } : session) }));
      return run;
    } catch (error) {
      const normalized = normalizeError(error);
      setState((previous) => ({ ...previous, actionSubmitting: false, error: normalized.message }));
      return null;
    } finally { actionInFlightRef.current = false; }
  }, [api]);

  const reconnectRun = useCallback(async () => {
    const currentRun = runRef.current;
    if (!currentRun) return;
    const requestId = ++runRefreshRequestRef.current;
    setState((previous) => ({ ...previous, connection: 'reconnecting', error: null }));
    try {
      let latestRun = await api.getRun(currentRun.runId);
      if (requestId !== runRefreshRequestRef.current) return;
      if (isWorkspaceRunReconnectable(latestRun.status)) {
        latestRun = await api.reconnectRun(latestRun.runId);
      }
      const [confirmation, outbox] = await Promise.all([
        latestRun.status === 'waiting_confirmation' ? api.getConfirmation(latestRun.runId).catch(() => null) : Promise.resolve<WorkspaceConfirmationVM | null>(null),
        api.listOutbox(latestRun.runId).catch(() => [] as WorkspaceOutboxVM[]),
      ]);
      if (requestId !== runRefreshRequestRef.current) return;
      runRef.current = latestRun;
      if (terminalRunStatuses.has(latestRun.status)) {
        connectionAttemptRef.current += 1;
        socketRef.current?.close();
        socketRef.current = null;
        setState((previous) => ({ ...previous, run: latestRun, confirmation, outbox, connection: 'closed', sessions: previous.sessions.map((session) => session.id === latestRun.sessionId ? { ...session, runId: latestRun.runId, runStatus: latestRun.status } : session), unreadSessionIds: isTerminalRun(latestRun.status) && getViewedRunId(latestRun.sessionId) !== latestRun.runId ? [...new Set([...previous.unreadSessionIds, latestRun.sessionId])] : previous.unreadSessionIds.filter((id) => id !== latestRun.sessionId) }));
        return;
      }
      setState((previous) => ({ ...previous, run: latestRun, confirmation, outbox, sessions: previous.sessions.map((session) => session.id === latestRun.sessionId ? { ...session, runId: latestRun.runId, runStatus: latestRun.status } : session), unreadSessionIds: isTerminalRun(latestRun.status) && getViewedRunId(latestRun.sessionId) !== latestRun.runId ? [...new Set([...previous.unreadSessionIds, latestRun.sessionId])] : previous.unreadSessionIds.filter((id) => id !== latestRun.sessionId) }));
      await connectRun(latestRun.runId, eventCursorRef.current);
    } catch (error) {
      if (requestId !== runRefreshRequestRef.current) return;
      const normalized = normalizeError(error);
      setState((previous) => ({ ...previous, connection: 'closed', error: normalized.message }));
    }
  }, [api, connectRun, getViewedRunId]);

  const confirmRun = useCallback(async () => {
    const currentRun = runRef.current;
    if (!currentRun || actionInFlightRef.current) return null;
    actionInFlightRef.current = true;
    runRefreshRequestRef.current += 1;
    setState((previous) => ({ ...previous, actionSubmitting: true, error: null }));
    try {
      const latestRun = await api.getRun(currentRun.runId);
      runRef.current = latestRun;
      const confirmation = await api.getConfirmation(latestRun.runId);
      const result = await api.confirmRun(latestRun.runId, confirmation.version);
      runRef.current = result.run;
      setState((previous) => ({ ...previous, run: result.run, confirmation: result.confirmation, outbox: [result.outbox], actionSubmitting: false, sessions: previous.sessions.map((session) => session.id === result.run.sessionId ? { ...session, runId: result.run.runId, runStatus: result.run.status } : session) }));
      return result;
    } catch (error) { const normalized = normalizeError(error); setState((previous) => ({ ...previous, actionSubmitting: false, error: normalized.message })); return null; }
    finally { actionInFlightRef.current = false; }
  }, [api]);

  const cancelRun = useCallback(async () => {
    const currentRun = runRef.current;
    if (!currentRun || actionInFlightRef.current) return null;
    actionInFlightRef.current = true;
    runRefreshRequestRef.current += 1;
    setState((previous) => ({ ...previous, actionSubmitting: true, error: null }));
    try {
      const latestRun = await api.getRun(currentRun.runId);
      runRef.current = latestRun;
      const confirmation = await api.getConfirmation(latestRun.runId);
      const result = await api.cancelRun(latestRun.runId, confirmation.version);
      runRef.current = result.run;
      setState((previous) => ({ ...previous, run: result.run, confirmation: result.confirmation, outbox: [], actionSubmitting: false, sessions: previous.sessions.map((session) => session.id === result.run.sessionId ? { ...session, runId: result.run.runId, runStatus: result.run.status } : session) }));
      return result;
    } catch (error) { const normalized = normalizeError(error); setState((previous) => ({ ...previous, actionSubmitting: false, error: normalized.message })); return null; }
    finally { actionInFlightRef.current = false; }
  }, [api]);

  const retryRun = useCallback(async () => {
    const currentRun = runRef.current;
    if (!currentRun || actionInFlightRef.current) return null;
    actionInFlightRef.current = true;
    runRefreshRequestRef.current += 1;
    setState((previous) => ({ ...previous, actionSubmitting: true, error: null }));
    try {
      const result = await api.retryRun(currentRun.runId);
      runRef.current = result.run;
      setState((previous) => ({ ...previous, run: result.run, outbox: [result.outbox], actionSubmitting: false, sessions: previous.sessions.map((session) => session.id === result.run.sessionId ? { ...session, runId: result.run.runId, runStatus: result.run.status } : session) }));
      return result;
    } catch (error) { const normalized = normalizeError(error); setState((previous) => ({ ...previous, actionSubmitting: false, error: normalized.message })); return null; }
    finally { actionInFlightRef.current = false; }
  }, [api]);

  return { state, search, setSearch, reload, createSession, switchSession, archiveSession, deleteSession, startRun, reconnectRun, confirmRun, cancelRun, cancelActiveRun, retryRun, markSessionViewed };
}

export interface WorkspaceController {
  state: WorkspaceState;
  search: string;
  setSearch: (value: string) => void;
  reload: () => Promise<void>;
  createSession: (title: string, instruction?: string) => Promise<WorkspaceState['sessions'][number] | null>;
  switchSession: (sessionId: string) => Promise<WorkspaceState['sessions'][number] | null>;
  archiveSession: (sessionId: string) => Promise<WorkspaceState['sessions'][number] | null>;
  deleteSession: (sessionId: string) => Promise<{ deleted: boolean; sessionId: string } | null>;
  startRun: (instruction: string, sessionIdOverride?: string, attachments?: WorkspaceAttachmentPayload[]) => Promise<WorkspaceState['run']>;
  reconnectRun: () => Promise<void>;
  confirmRun: () => Promise<unknown>;
  cancelRun: () => Promise<unknown>;
  cancelActiveRun: () => Promise<WorkspaceRunVM | null>;
  retryRun: () => Promise<unknown>;
  markSessionViewed: (sessionId: string, runId?: string) => void;
}
