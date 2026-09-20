import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createMessagesApi, type MessagesApi } from './api';
import { applyRealtimeEvent } from './model';
import type { MessagesError, MessagesState, RealtimeEvent } from './types';

const defaultApi = createMessagesApi({ get: async () => { throw new Error('messages api unavailable'); } });

function normalizeError(error: unknown): MessagesError {
  const status = typeof error === 'object' && error && 'status' in error ? Number((error as { status?: unknown }).status) : undefined;
  if (status === 403) return { code: 'FORBIDDEN', message: '当前管理员没有读取该账号或会话的权限。', retryable: false };
  if (status === 404) return { code: 'NOT_FOUND', message: '会话不存在或已被归档。', retryable: false };
  if (error instanceof TypeError) return { code: 'NETWORK_ERROR', message: '消息服务暂时不可用，请检查连接后重试。', retryable: true };
  return { code: 'UNKNOWN', message: error instanceof Error ? error.message : '消息加载失败，请重试。', retryable: true };
}

export interface MessagesController { state: MessagesState; setActiveConversation: (conversationId?: string) => void; reload: () => Promise<void>; retryRealtime: () => void; }

/**
 * A socket can emit `close` after a replacement socket has already opened.
 * Keep a monotonically increasing generation so delayed callbacks from the
 * previous connection cannot schedule a second reconnect or mutate state.
 */
export interface SocketGenerationGuard {
  begin: () => number;
  isCurrent: (generation: number) => boolean;
}

export function createSocketGenerationGuard(): SocketGenerationGuard {
  let current = 0;
  return {
    begin: () => { current += 1; return current; },
    isCurrent: (generation) => generation === current,
  };
}

export function useMessagesController(options: { api?: MessagesApi; accountId?: string }): MessagesController {
  const api = options.api ?? defaultApi;
  const accountId = options.accountId;
  const [state, setState] = useState<MessagesState>({ accountId, listPhase: 'idle', timelinePhase: 'idle', realtimePhase: 'closed', conversations: [], messages: [], cursor: 0, error: null });
  const socketRef = useRef<{ close: () => void } | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestId = useRef(0);
  const activeIdRef = useRef<string | undefined>(undefined);
  const cursorRef = useRef(0);
  const seenEventIdsRef = useRef<Set<string>>(new Set());
  const intentionalCloseRef = useRef(false);
  const reconnectAttempt = useRef(0);
  const socketGenerationRef = useRef<SocketGenerationGuard | null>(null);
  if (!socketGenerationRef.current) socketGenerationRef.current = createSocketGenerationGuard();
  const accountKey = useMemo(() => accountId ?? '', [accountId]);

  const closeRealtime = useCallback(() => {
    intentionalCloseRef.current = true;
    socketGenerationRef.current!.begin();
    socketRef.current?.close();
    socketRef.current = null;
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    retryTimerRef.current = null;
  }, []);

  const connectRealtime = useCallback((conversationId: string, cursor: number) => {
    closeRealtime();
    if (!accountId) return;
    intentionalCloseRef.current = false;
    const generation = socketGenerationRef.current!.begin();
    cursorRef.current = cursor;
    setState((previous) => ({ ...previous, realtimePhase: reconnectAttempt.current > 0 ? 'reconnecting' : 'connecting' }));
    socketRef.current = api.openRealtime({
      accountId, conversationId, cursor,
      onOpen: () => {
        if (!socketGenerationRef.current!.isCurrent(generation)) return;
        reconnectAttempt.current = 0;
        setState((previous) => ({ ...previous, realtimePhase: 'connecting' }));
      },
      onEvent: (event: RealtimeEvent) => {
        if (!socketGenerationRef.current!.isCurrent(generation)) return;
        if (event.accountId !== accountId || event.conversationId !== conversationId) return;
        if (seenEventIdsRef.current.has(event.eventId)) return;
        seenEventIdsRef.current = new Set(seenEventIdsRef.current).add(event.eventId);
        setState((previous) => {
          const merged = applyRealtimeEvent({ conversations: previous.conversations, messages: previous.messages, cursor: previous.cursor, seenEventIds: new Set<string>() }, event);
          cursorRef.current = merged.cursor;
          return { ...previous, conversations: merged.conversations, messages: merged.messages, cursor: merged.cursor, realtimePhase: event.type === 'chat.connection.changed' && event.payload.status === 'connected' ? 'connected' : previous.realtimePhase, error: null };
        });
      },
      onError: () => {
        if (!socketGenerationRef.current!.isCurrent(generation)) return;
        setState((previous) => ({ ...previous, realtimePhase: 'reconnecting' }));
      },
      onClose: () => {
        if (!socketGenerationRef.current!.isCurrent(generation)) return;
        if (intentionalCloseRef.current) { intentionalCloseRef.current = false; return; }
        if (activeIdRef.current !== conversationId) return;
        const attempt = ++reconnectAttempt.current;
        if (attempt > 5) { setState((previous) => ({ ...previous, realtimePhase: 'timeout', error: { code: 'REALTIME_TIMEOUT', message: '实时连接多次失败，请稍后重试。', retryable: true } })); return; }
        setState((previous) => ({ ...previous, realtimePhase: 'reconnecting' }));
        retryTimerRef.current = setTimeout(() => connectRealtime(conversationId, cursorRef.current), Math.min(1000 * attempt, 5000));
      },
    });
  }, [accountId, api, closeRealtime]);

  const loadTimeline = useCallback(async (conversationId: string) => {
    if (!accountId) return;
    const currentRequest = ++requestId.current;
    closeRealtime();
    setState((previous) => ({ ...previous, timelinePhase: 'loading', realtimePhase: 'connecting', error: null, messages: [], cursor: 0 }));
    seenEventIdsRef.current = new Set();
    cursorRef.current = 0;
    try {
      const result = await api.listMessages({ accountId, conversationId, limit: 100 });
      if (currentRequest !== requestId.current) return;
      cursorRef.current = result.latestCursor;
      setState((previous) => ({ ...previous, timelinePhase: result.items.length === 0 ? 'empty' : 'success', messages: result.items, cursor: result.latestCursor, realtimePhase: 'connecting', error: null }));
      connectRealtime(conversationId, result.latestCursor);
    } catch (error) {
      if (currentRequest !== requestId.current) return;
      const normalized = normalizeError(error);
      setState((previous) => ({ ...previous, timelinePhase: normalized.code === 'FORBIDDEN' ? 'forbidden' : 'error', realtimePhase: normalized.code === 'FORBIDDEN' ? 'forbidden' : 'closed', error: normalized }));
    }
  }, [accountId, api, closeRealtime, connectRealtime]);

  const reload = useCallback(async () => {
    const currentRequest = ++requestId.current;
    closeRealtime();
    if (!accountId) { setState({ accountId, listPhase: 'empty', timelinePhase: 'idle', realtimePhase: 'closed', conversations: [], activeConversationId: undefined, messages: [], cursor: 0, error: null }); return; }
    seenEventIdsRef.current = new Set();
    cursorRef.current = 0;
    setState((previous) => ({ ...previous, accountId, listPhase: 'loading', timelinePhase: 'idle', realtimePhase: 'closed', conversations: [], messages: [], cursor: 0, error: null }));
    try {
      const result = await api.listConversations({ accountId, limit: 50 });
      if (currentRequest !== requestId.current) return;
      const activeConversationId = activeIdRef.current && result.items.some((item) => item.conversationId === activeIdRef.current) ? activeIdRef.current : result.items[0]?.conversationId;
      activeIdRef.current = activeConversationId;
      setState((previous) => ({ ...previous, accountId, listPhase: result.items.length === 0 ? 'empty' : 'success', conversations: result.items, activeConversationId, error: null }));
      if (activeConversationId) await loadTimeline(activeConversationId);
    } catch (error) {
      if (currentRequest !== requestId.current) return;
      const normalized = normalizeError(error);
      setState((previous) => ({ ...previous, accountId, listPhase: normalized.code === 'FORBIDDEN' ? 'forbidden' : 'error', realtimePhase: 'closed', error: normalized }));
    }
  }, [accountId, api, closeRealtime, loadTimeline]);

  useEffect(() => { activeIdRef.current = undefined; reconnectAttempt.current = 0; void reload(); return closeRealtime; }, [accountKey, reload, closeRealtime]);

  const setActiveConversation = useCallback((conversationId?: string) => { activeIdRef.current = conversationId; setState((previous) => ({ ...previous, activeConversationId: conversationId, messages: [], cursor: 0, timelinePhase: conversationId ? 'loading' : 'idle', realtimePhase: 'closed', error: null })); if (conversationId) void loadTimeline(conversationId); else closeRealtime(); }, [closeRealtime, loadTimeline]);
  const retryRealtime = useCallback(() => { if (state.activeConversationId) { reconnectAttempt.current = 0; connectRealtime(state.activeConversationId, cursorRef.current); } }, [connectRealtime, state.activeConversationId]);

  return { state, setActiveConversation, reload, retryRealtime };
}

export { createMessagesApi };
