import { useCallback, useEffect, useRef, useState } from 'react';
import { createMockAutoReplyAgentSettingsApi, type AutoReplyAgentSettingsApi } from './api';
import type { AutoReplyAgentConfigVM, AutoReplyAgentSettingsState } from './types';

const fallbackApi = createMockAutoReplyAgentSettingsApi();

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message.includes('VERSION')) return '配置已被其他操作更新，请刷新后重试。';
  return error instanceof Error ? error.message : '自动回复 Agent 配置暂时不可用，请重试。';
}

export interface AutoReplyAgentSettingsController {
  state: AutoReplyAgentSettingsState;
  reload: () => Promise<void>;
  update: (input: { expectedVersion: number; patch: Partial<Omit<AutoReplyAgentConfigVM, 'accountId' | 'updatedByAdminId' | 'configVersion' | 'configDigest' | 'createdAt' | 'updatedAt' | 'debounceMs'>> }) => Promise<AutoReplyAgentConfigVM>;
}

export function useAutoReplyAgentSettingsController(api: AutoReplyAgentSettingsApi = fallbackApi, accountId?: string): AutoReplyAgentSettingsController {
  const [snapshot, setSnapshot] = useState<{ accountId?: string; api: AutoReplyAgentSettingsApi; value: AutoReplyAgentSettingsState }>({ accountId, api, value: { phase: 'idle', data: null, error: null } });
  const state = snapshot.value;
  const setState = (next: AutoReplyAgentSettingsState | ((previous: AutoReplyAgentSettingsState) => AutoReplyAgentSettingsState)) => {
    setSnapshot(previous => ({ accountId, api, value: typeof next === 'function' ? next(previous.value) : next }));
  };
  const requestId = useRef(0);
  const scope = useRef({ accountId, api });
  // Invalidate immediately during the account-change render, before effects run.
  if (scope.current.accountId !== accountId || scope.current.api !== api) {
    scope.current = { accountId, api };
    requestId.current += 1;
  }
  const isCurrent = (request: number) => request === requestId.current && scope.current.accountId === accountId && scope.current.api === api;
  const reload = useCallback(async () => {
    const request = ++requestId.current;
    setState((previous) => ({ ...previous, phase: 'loading', error: null }));
    try {
      if (!accountId) { setState({ phase: 'empty', data: null, error: null }); return; }
      const data = await api.get(accountId);
      if (!isCurrent(request)) return;
      setState({ phase: 'success', data, error: null });
    } catch (error) {
      if (!isCurrent(request)) return;
      setState({ phase: 'error', data: null, error: messageOf(error) });
    }
  }, [accountId, api]);

  useEffect(() => { void reload(); return () => { requestId.current += 1; }; }, [reload]);

  async function update(input: { expectedVersion: number; patch: Partial<Omit<AutoReplyAgentConfigVM, 'accountId' | 'updatedByAdminId' | 'configVersion' | 'configDigest' | 'createdAt' | 'updatedAt' | 'debounceMs'>> }): Promise<AutoReplyAgentConfigVM> {
    if (!accountId || scope.current.accountId !== accountId || scope.current.api !== api) throw new Error('ACCOUNT_CONTEXT_REQUIRED');
    const request = ++requestId.current;
    setState((previous) => ({ ...previous, phase: 'submitting', error: null, lastAction: 'updated' }));
    try {
      const data = await api.update({ ...input, accountId });
      if (!isCurrent(request)) return data;
      setState({ phase: 'saved', data, error: null, lastAction: 'updated' });
      return data;
    } catch (error) {
      if (!isCurrent(request)) throw error;
      const message = messageOf(error);
      setState((previous) => ({ ...previous, phase: 'error', error: message, lastAction: 'updated' }));
      throw error;
    }
  }

  const visibleState = snapshot.accountId !== accountId || snapshot.api !== api || (state.data && state.data.accountId !== accountId) ? { phase: 'loading' as const, data: null, error: null } : state;
  return { state: visibleState, reload, update };
}
