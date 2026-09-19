import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createMockAccountsApi, type AccountsApi } from './api';
import type { AccountListFilters, AccountsLoadError, AccountsState } from './types';

const defaultAccountsApi = createMockAccountsApi();

function toLoadError(error: unknown): AccountsLoadError {
  const status = typeof error === 'object' && error && 'status' in error ? Number((error as { status?: unknown }).status) : undefined;
  if (status === 403) return { code: 'FORBIDDEN', message: '当前管理员没有读取账号列表的权限。', retryable: false };
  if (error instanceof TypeError) return { code: 'NETWORK_ERROR', message: '账号服务暂时不可用，请检查连接后重试。', retryable: true };
  return { code: 'UNKNOWN', message: error instanceof Error ? error.message : '账号列表加载失败，请重试。', retryable: true };
}

export interface AccountsController {
  state: AccountsState;
  filters: AccountListFilters;
  setFilters: (filters: AccountListFilters | ((previous: AccountListFilters) => AccountListFilters)) => void;
  setSearch: (search: string) => void;
  reload: () => Promise<void>;
}

export function useAccountsController(options: { api?: AccountsApi; initialFilters?: AccountListFilters } = {}): AccountsController {
  const accountsApi = options.api ?? defaultAccountsApi;
  const [filters, setFilters] = useState<AccountListFilters>({ page: 1, pageSize: 20, ...options.initialFilters });
  const [state, setState] = useState<AccountsState>({ phase: 'idle', data: null, error: null });
  const requestId = useRef(0);
  const filtersKey = useMemo(() => JSON.stringify(filters), [filters]);

  const reload = useCallback(async () => {
    const currentRequest = ++requestId.current;
    setState((previous) => ({ ...previous, phase: 'loading', error: null }));
    try {
      const data = await accountsApi.list(filters);
      if (currentRequest !== requestId.current) return;
      setState({ phase: data.items.length === 0 ? 'empty' : 'success', data, error: null });
    } catch (error) {
      if (currentRequest !== requestId.current) return;
      setState({ phase: 'error', data: null, error: toLoadError(error) });
    }
  }, [accountsApi, filters]);

  useEffect(() => {
    void reload();
  }, [filtersKey, reload]);

  const setSearch = useCallback((search: string) => {
    setFilters((previous) => ({ ...previous, search, page: 1 }));
  }, []);

  return { state, filters, setFilters, setSearch, reload };
}
