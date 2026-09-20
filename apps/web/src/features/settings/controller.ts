import { useCallback, useEffect, useRef, useState } from 'react';
import { createMockCredentialApi, type CredentialApi } from './api';
import type { CredentialStatus, SettingsState } from './types';

const fallbackApi = createMockCredentialApi();

function messageOf(error: unknown): string {
  const status = typeof error === 'object' && error && 'status' in error ? Number((error as { status?: unknown }).status) : undefined;
  if (status === 403) return '当前管理员没有读取该账号凭证的权限。';
  if (status === 409) return '凭证已被其他操作更新，请刷新后重试。';
  return error instanceof Error ? error.message : '凭证服务暂时不可用，请重试。';
}

export interface CredentialController {
  state: SettingsState;
  reload: () => Promise<void>;
  create: (input: { accountId: string; provider: string; alias: string; label?: string; apiKey: string }) => Promise<void>;
  update: (input: { credentialId: string; expectedVersion: number; provider?: string; alias?: string; label?: string }) => Promise<void>;
  rotate: (input: { credentialId: string; expectedVersion: number; apiKey: string }) => Promise<void>;
  setStatus: (input: { credentialId: string; expectedVersion: number; status: Exclude<CredentialStatus, 'rotating'> }) => Promise<void>;
}

export function useCredentialController(options: { api?: CredentialApi; accountId?: string }): CredentialController {
  const api = options.api ?? fallbackApi;
  const [state, setState] = useState<SettingsState>({ phase: 'idle', data: null, error: null });
  const requestId = useRef(0);
  const accountId = options.accountId;

  const reload = useCallback(async () => {
    if (!accountId) { setState({ phase: 'empty', data: null, error: null }); return; }
    const request = ++requestId.current;
    setState((previous) => ({ ...previous, phase: 'loading', error: null }));
    try {
      const data = await api.list(accountId);
      if (request !== requestId.current) return;
      setState({ phase: data.items.length ? 'success' : 'empty', data, error: null });
    } catch (error) {
      if (request !== requestId.current) return;
      setState({ phase: 'error', data: null, error: messageOf(error) });
    }
  }, [accountId, api]);

  useEffect(() => { void reload(); }, [reload]);

  async function mutate(lastAction: string, action: () => Promise<void>) {
    setState((previous) => ({ ...previous, phase: 'submitting', error: null, lastAction }));
    try { await action(); await reload(); setState((previous) => ({ ...previous, phase: 'saved', lastAction })); }
    catch (error) { setState((previous) => ({ ...previous, phase: 'error', error: messageOf(error), lastAction })); }
  }

  return {
    state,
    reload,
    create: (input) => mutate('created', () => api.create(input).then(() => undefined)),
    update: (input) => mutate('updated', () => api.update(input).then(() => undefined)),
    rotate: (input) => mutate('rotated', () => api.rotate(input).then(() => undefined)),
    setStatus: (input) => mutate(input.status === 'revoked' ? 'revoked' : input.status === 'active' ? 'enabled' : 'disabled', () => api.setStatus(input).then(() => undefined)),
  };
}
