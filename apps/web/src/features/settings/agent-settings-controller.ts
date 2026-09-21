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
  update: (input: { expectedVersion: number; patch: Partial<Omit<AutoReplyAgentConfigVM, 'adminId' | 'configVersion' | 'configDigest' | 'createdAt' | 'updatedAt'>> }) => Promise<AutoReplyAgentConfigVM>;
}

export function useAutoReplyAgentSettingsController(api: AutoReplyAgentSettingsApi = fallbackApi): AutoReplyAgentSettingsController {
  const [state, setState] = useState<AutoReplyAgentSettingsState>({ phase: 'idle', data: null, error: null });
  const requestId = useRef(0);
  const reload = useCallback(async () => {
    const request = ++requestId.current;
    setState((previous) => ({ ...previous, phase: 'loading', error: null }));
    try {
      const data = await api.get();
      if (request !== requestId.current) return;
      setState({ phase: 'success', data, error: null });
    } catch (error) {
      if (request !== requestId.current) return;
      setState({ phase: 'error', data: null, error: messageOf(error) });
    }
  }, [api]);

  useEffect(() => { void reload(); }, [reload]);

  async function update(input: { expectedVersion: number; patch: Partial<Omit<AutoReplyAgentConfigVM, 'adminId' | 'configVersion' | 'configDigest' | 'createdAt' | 'updatedAt'>> }): Promise<AutoReplyAgentConfigVM> {
    setState((previous) => ({ ...previous, phase: 'submitting', error: null, lastAction: 'updated' }));
    try {
      const data = await api.update(input);
      setState({ phase: 'saved', data, error: null, lastAction: 'updated' });
      return data;
    } catch (error) {
      const message = messageOf(error);
      setState((previous) => ({ ...previous, phase: 'error', error: message, lastAction: 'updated' }));
      throw error;
    }
  }

  return { state, reload, update };
}
