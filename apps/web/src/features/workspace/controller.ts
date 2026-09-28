import { useCallback, useEffect, useRef, useState } from 'react';
import { createWorkspaceApi, type WorkspaceApi } from './api';
import type { WorkspaceConfirmationVM, WorkspaceOutboxVM, WorkspaceRunEventVM, WorkspaceRunVM, WorkspaceSessionVM, WorkspaceState } from './types';

const defaultApi = createWorkspaceApi({ get: async () => { throw new Error('WORKSPACE_API_UNAVAILABLE'); } });

function normalizeError(error: unknown): { message: string; forbidden: boolean } {
  const status = typeof error === 'object' && error && 'status' in error ? Number((error as { status?: unknown }).status) : undefined;
  return { message: error instanceof Error ? error.message : 'Workspace 请求失败', forbidden: status === 403 };
}

export function listWorkspaceSessions(api: WorkspaceApi, accountId: string, search: string): Promise<WorkspaceSessionVM[]> {
  return api.listSessions(accountId, search);
}

export function useWorkspaceController(options: { api?: WorkspaceApi; accountId?: string }): WorkspaceController {
  const api = options.api ?? defaultApi;
  const [state, setState] = useState<WorkspaceState>({ phase: 'idle', sessions: [], run: null, messages: [], events: [], connection: 'idle', error: null, submitting: false, confirmation: null, outbox: [], actionSubmitting: false });
  const [search, setSearchState] = useState('');
  const socketRef = useRef<WebSocket | null>(null);
  const runRef = useRef<WorkspaceRunVM | null>(null);
  const eventCursorRef = useRef(0);
  const requestRef = useRef(0);
  const activeSessionIdRef = useRef<string | undefined>(undefined);

  const reload = useCallback(async () => {
    const requestId = ++requestRef.current;
    if (!options.accountId) {
      socketRef.current?.close();
      runRef.current = null;
      eventCursorRef.current = 0;
      activeSessionIdRef.current = undefined;
      setState((previous) => ({ ...previous, phase: 'empty', sessions: [], activeSessionId: undefined, run: null, messages: [], events: [], connection: 'idle', error: null, confirmation: null, outbox: [] }));
      return;
    }
    setState((previous) => ({ ...previous, phase: 'loading', error: null }));
    try {
      const sessions = await listWorkspaceSessions(api, options.accountId, search);
      if (requestId !== requestRef.current) return;
      const firstActive = sessions.find((session) => session.status === 'active');
      const activeSessionId = activeSessionIdRef.current && sessions.some((session) => session.id === activeSessionIdRef.current && session.status === 'active') ? activeSessionIdRef.current : firstActive?.id;
      const messages = activeSessionId ? await api.listMessages(activeSessionId).catch(() => []) : [];
      if (requestId !== requestRef.current) return;
      activeSessionIdRef.current = activeSessionId;
      setState((previous) => ({ ...previous, phase: sessions.length ? 'success' : 'empty', sessions, activeSessionId, messages: activeSessionId ? messages : [], run: null, events: [], connection: 'idle', error: null, confirmation: null, outbox: [] }));
    } catch (error) {
      if (requestId !== requestRef.current) return;
      const normalized = normalizeError(error);
      setState((previous) => ({ ...previous, phase: normalized.forbidden ? 'forbidden' : 'error', error: normalized.message }));
    }
  }, [api, options.accountId, search]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void reload(); }, search.trim() ? 220 : 0);
    return () => window.clearTimeout(timer);
  }, [reload, search]);

  useEffect(() => () => { socketRef.current?.close(); }, []);

  const setSearch = useCallback((value: string) => {
    setSearchState(value);
  }, []);

  const createSession = useCallback(async (title: string) => {
    if (!options.accountId) throw new Error('ACCOUNT_CONTEXT_REQUIRED');
    setState((previous) => ({ ...previous, submitting: true, error: null }));
    try {
      const session = await api.createSession({ accountId: options.accountId, title });
      activeSessionIdRef.current = session.id;
      setState((previous) => ({ ...previous, sessions: [session, ...previous.sessions], activeSessionId: session.id, phase: 'success', messages: [], run: null, events: [], connection: 'idle', submitting: false, confirmation: null, outbox: [] }));
      return session;
    } catch (error) { const normalized = normalizeError(error); setState((previous) => ({ ...previous, submitting: false, error: normalized.message })); return null; }
  }, [api, options.accountId]);

  const switchSession = useCallback(async (sessionId: string) => {
    setState((previous) => ({ ...previous, submitting: true, error: null }));
    try { const session = await api.switchSession(sessionId); const messages = await api.listMessages(session.id).catch(() => []); activeSessionIdRef.current = session.id; setState((previous) => ({ ...previous, activeSessionId: session.id, messages, run: null, events: [], connection: 'idle', submitting: false, confirmation: null, outbox: [] })); return session; }
    catch (error) { const normalized = normalizeError(error); setState((previous) => ({ ...previous, submitting: false, error: normalized.message })); return null; }
  }, [api]);

  const archiveSession = useCallback(async (sessionId: string) => {
    setState((previous) => ({ ...previous, submitting: true, error: null }));
    try { const session = await api.archiveSession(sessionId); if (activeSessionIdRef.current === session.id) activeSessionIdRef.current = undefined; setState((previous) => ({ ...previous, sessions: previous.sessions.map((item) => item.id === session.id ? session : item), activeSessionId: previous.activeSessionId === session.id ? undefined : previous.activeSessionId, submitting: false })); return session; }
    catch (error) { const normalized = normalizeError(error); setState((previous) => ({ ...previous, submitting: false, error: normalized.message })); return null; }
  }, [api]);

  const refreshRunExecution = useCallback(async (run: WorkspaceRunVM) => {
    const [confirmation, outbox] = await Promise.all([
      run.status === 'waiting_confirmation' ? api.getConfirmation(run.runId).catch(() => null) : Promise.resolve<WorkspaceConfirmationVM | null>(null),
      api.listOutbox(run.runId).catch(() => [] as WorkspaceOutboxVM[]),
    ]);
    setState((previous) => ({ ...previous, run, confirmation, outbox }));
  }, [api]);

  const appendEvent = useCallback((event: WorkspaceRunEventVM) => {
    setState((previous) => {
      if (previous.events.some((item) => item.sequence === event.sequence)) return previous;
      const events = [...previous.events, event].sort((left, right) => left.sequence - right.sequence);
      return { ...previous, events };
    });
    eventCursorRef.current = Math.max(eventCursorRef.current, event.sequence);
    const currentRun = runRef.current;
    if (currentRun) void api.getRun(currentRun.runId).then((run) => { runRef.current = run; return refreshRunExecution(run); }).catch(() => undefined);
  }, [api, refreshRunExecution]);

  const connectRun = useCallback(async (runId: string, afterSequence = eventCursorRef.current) => {
    socketRef.current?.close();
    setState((previous) => ({ ...previous, connection: 'reconnecting', error: null }));
    try {
      const replay = await api.listEvents(runId, afterSequence);
      replay.forEach((event) => appendEvent(event));
      const cursor = replay.reduce((max, event) => Math.max(max, event.sequence), afterSequence);
      eventCursorRef.current = Math.max(eventCursorRef.current, cursor);
      const socket = api.openRunEvents(runId, eventCursorRef.current, {
        onOpen: () => setState((previous) => ({ ...previous, connection: 'connected', error: null })),
        onError: () => setState((previous) => ({ ...previous, connection: 'reconnecting' })),
        onClose: () => setState((previous) => ({ ...previous, connection: 'closed' })),
        onEvent: appendEvent,
      });
      socketRef.current = socket;
    } catch (error) {
      const normalized = normalizeError(error);
      setState((previous) => ({ ...previous, connection: 'reconnecting', error: normalized.message }));
    }
  }, [api, appendEvent]);

  const startRun = useCallback(async (instruction: string, sessionIdOverride?: string) => {
    const sessionId = sessionIdOverride ?? state.activeSessionId;
    if (!options.accountId || !sessionId) throw new Error('WORKSPACE_SESSION_REQUIRED');
    setState((previous) => ({ ...previous, submitting: true, error: null }));
    try {
      const run = await api.startRun({ accountId: options.accountId, sessionId, instruction, clientRunRef: `web-${Date.now()}-${Math.random().toString(16).slice(2)}` });
      runRef.current = run;
      eventCursorRef.current = 0;
      setState((previous) => ({ ...previous, run, events: [], connection: 'connecting', submitting: false, confirmation: null, outbox: [] }));
      void connectRun(run.runId, 0);
      return run;
    } catch (error) { const normalized = normalizeError(error); setState((previous) => ({ ...previous, submitting: false, error: normalized.message })); return null; }
  }, [api, connectRun, options.accountId, state.activeSessionId]);

  const reconnectRun = useCallback(() => {
    const currentRun = runRef.current;
    if (currentRun) void connectRun(currentRun.runId, eventCursorRef.current);
  }, [connectRun]);

  const confirmRun = useCallback(async () => {
    const currentRun = runRef.current;
    if (!currentRun) return null;
    setState((previous) => ({ ...previous, actionSubmitting: true, error: null }));
    try {
      const confirmation = state.confirmation ?? await api.getConfirmation(currentRun.runId);
      const result = await api.confirmRun(currentRun.runId, confirmation.version);
      runRef.current = result.run;
      setState((previous) => ({ ...previous, run: result.run, confirmation: result.confirmation, outbox: [result.outbox], actionSubmitting: false }));
      return result;
    } catch (error) { const normalized = normalizeError(error); setState((previous) => ({ ...previous, actionSubmitting: false, error: normalized.message })); return null; }
  }, [api, state.confirmation]);

  const cancelRun = useCallback(async () => {
    const currentRun = runRef.current;
    if (!currentRun) return null;
    setState((previous) => ({ ...previous, actionSubmitting: true, error: null }));
    try {
      const confirmation = state.confirmation ?? await api.getConfirmation(currentRun.runId);
      const result = await api.cancelRun(currentRun.runId, confirmation.version);
      runRef.current = result.run;
      setState((previous) => ({ ...previous, run: result.run, confirmation: result.confirmation, outbox: [], actionSubmitting: false }));
      return result;
    } catch (error) { const normalized = normalizeError(error); setState((previous) => ({ ...previous, actionSubmitting: false, error: normalized.message })); return null; }
  }, [api, state.confirmation]);

  const retryRun = useCallback(async () => {
    const currentRun = runRef.current;
    if (!currentRun) return null;
    setState((previous) => ({ ...previous, actionSubmitting: true, error: null }));
    try {
      const result = await api.retryRun(currentRun.runId);
      runRef.current = result.run;
      setState((previous) => ({ ...previous, run: result.run, outbox: [result.outbox], actionSubmitting: false }));
      return result;
    } catch (error) { const normalized = normalizeError(error); setState((previous) => ({ ...previous, actionSubmitting: false, error: normalized.message })); return null; }
  }, [api]);

  return { state, search, setSearch, reload, createSession, switchSession, archiveSession, startRun, reconnectRun, confirmRun, cancelRun, retryRun };
}

export interface WorkspaceController {
  state: WorkspaceState;
  search: string;
  setSearch: (value: string) => void;
  reload: () => Promise<void>;
  createSession: (title: string) => Promise<WorkspaceState['sessions'][number] | null>;
  switchSession: (sessionId: string) => Promise<WorkspaceState['sessions'][number] | null>;
  archiveSession: (sessionId: string) => Promise<WorkspaceState['sessions'][number] | null>;
  startRun: (instruction: string, sessionIdOverride?: string) => Promise<WorkspaceState['run']>;
  reconnectRun: () => void;
  confirmRun: () => Promise<unknown>;
  cancelRun: () => Promise<unknown>;
  retryRun: () => Promise<unknown>;
}
