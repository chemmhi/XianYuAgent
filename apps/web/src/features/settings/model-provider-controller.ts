import { useCallback, useRef, useState } from 'react';
import type { ModelProviderApi, ProviderModelsVM } from './model-provider-api';

export type ModelOptionsPhase = 'idle' | 'loading' | 'empty' | 'success' | 'error';

export interface ModelOptionsState {
  phase: ModelOptionsPhase;
  data: ProviderModelsVM | null;
  error: string | null;
}

export interface ModelProviderController {
  state: ModelOptionsState;
  load: (configId: string, options?: { force?: boolean }) => Promise<void>;
  reset: () => void;
}

function messageOf(error: unknown): string {
  const status = typeof error === 'object' && error && 'status' in error ? Number((error as { status?: unknown }).status) : undefined;
  if (status === 403) return '当前管理员没有读取该模型配置的权限。';
  if (status === 404) return '模型配置不存在，请刷新设置。';
  return error instanceof Error ? error.message : '模型列表暂时不可用，请重试。';
}

/** Lazy model-list controller. The provider is queried only when load() is called. */
export function useModelProviderController(api: ModelProviderApi, accountId?: string): ModelProviderController {
  const [state, setState] = useState<ModelOptionsState>({ phase: 'idle', data: null, error: null });
  const requestId = useRef(0);
  const loadedKey = useRef<string | undefined>(undefined);

  const reset = useCallback(() => {
    requestId.current += 1;
    loadedKey.current = undefined;
    setState({ phase: 'idle', data: null, error: null });
  }, []);

  const load = useCallback(async (configId: string, options: { force?: boolean } = {}) => {
    const normalizedConfigId = configId.trim();
    if (!accountId || !normalizedConfigId) {
      setState({ phase: 'empty', data: null, error: null });
      return;
    }
    const key = `${accountId}:${normalizedConfigId}`;
    if (!options.force && loadedKey.current === key && state.data?.configId === normalizedConfigId) return;
    const request = ++requestId.current;
    loadedKey.current = key;
    setState({ phase: 'loading', data: null, error: null });
    try {
      const data = await api.list({ accountId, configId: normalizedConfigId });
      if (request !== requestId.current) return;
      setState({ phase: data.models.length > 0 ? 'success' : 'empty', data, error: null });
    } catch (error) {
      if (request !== requestId.current) return;
      loadedKey.current = undefined;
      setState({ phase: 'error', data: null, error: messageOf(error) });
    }
  }, [accountId, api, state.data?.configId]);

  return { state, load, reset };
}
