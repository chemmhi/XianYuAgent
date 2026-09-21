import { useCallback, useEffect, useRef, useState } from 'react';
import type { OpenAISettingsApi } from './api';
import type { OpenAIConfigVM, OpenAISettingsState } from './types';

function messageOf(error: unknown): string {
  const status = typeof error === 'object' && error && 'status' in error ? Number((error as { status?: unknown }).status) : undefined;
  if (status === 403) return '当前管理员没有读取该账号模型配置的权限。';
  if (status === 409) return '模型配置已被其他操作更新，请刷新后重试。';
  return error instanceof Error ? error.message : '模型配置服务暂时不可用，请重试。';
}

export interface OpenAISettingsController {
  state: OpenAISettingsState;
  reload: () => Promise<void>;
  save: (input: Parameters<OpenAISettingsApi['save']>[0]) => Promise<OpenAIConfigVM>;
  test: (input: Parameters<OpenAISettingsApi['test']>[0]) => ReturnType<OpenAISettingsApi['test']>;
}

export function useOpenAISettingsController(api: OpenAISettingsApi, accountId?: string): OpenAISettingsController {
  const [state, setState] = useState<OpenAISettingsState>({ phase: 'idle', data: null, error: null });
  const requestId = useRef(0);

  const reload = useCallback(async () => {
    if (!accountId) { setState({ phase: 'empty', data: null, error: null }); return; }
    const request = ++requestId.current;
    setState((previous) => ({ ...previous, phase: 'loading', error: null }));
    try {
      const data = await api.list(accountId);
      if (request !== requestId.current) return;
      setState({ phase: data.items.length > 0 ? 'success' : 'empty', data, error: null });
    } catch (error) {
      if (request !== requestId.current) return;
      setState({ phase: 'error', data: null, error: messageOf(error) });
    }
  }, [accountId, api]);

  useEffect(() => { void reload(); }, [reload]);

  const save = useCallback(async (input: Parameters<OpenAISettingsApi['save']>[0]) => {
    setState((previous) => ({ ...previous, phase: 'submitting', error: null, lastAction: input.role }));
    try {
      const saved = await api.save(input);
      await reload();
      setState((previous) => ({ ...previous, phase: 'saved', lastAction: input.role }));
      return saved;
    } catch (error) {
      setState((previous) => ({ ...previous, phase: 'error', error: messageOf(error), lastAction: input.role }));
      throw error;
    }
  }, [api, reload]);

  const test = useCallback((input: Parameters<OpenAISettingsApi['test']>[0]) => api.test(input), [api]);

  return { state, reload, save, test };
}
