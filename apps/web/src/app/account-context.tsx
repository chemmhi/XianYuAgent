import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AccountsApi } from '../features/accounts/api';
import type { AccountVM } from '../features/accounts/types';

const STORAGE_KEY = 'xianyu.activeAccountId';

export interface AccountContextValue {
  accounts: AccountVM[];
  accountsLoading: boolean;
  accountsError: string | null;
  currentAccountId?: string;
  currentAccount?: AccountVM;
  setCurrentAccountId: (accountId?: string) => Promise<void>;
  refreshAccounts: () => Promise<void>;
  removeAccount: (accountId: string) => Promise<void>;
}

const AccountContext = createContext<AccountContextValue | null>(null);

function readCachedAccountId(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    return window.localStorage.getItem(STORAGE_KEY) || undefined;
  } catch {
    return undefined;
  }
}

function writeCachedAccountId(accountId?: string): void {
  if (typeof window === 'undefined') return;
  try {
    if (accountId) window.localStorage.setItem(STORAGE_KEY, accountId);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Local storage is a convenience cache; the in-memory provider remains usable.
  }
}

/**
 * Choose a safe initial account without silently selecting a disabled account.
 * A single usable account may be initialized; multiple accounts require an explicit switch.
 */
export function chooseInitialAccountId(accounts: AccountVM[], preferredAccountId?: string): string | undefined {
  const available = accounts.filter((account) => account.status !== 'disabled' && account.enabled !== false);
  if (preferredAccountId && available.some((account) => account.id === preferredAccountId)) return preferredAccountId;
  return available.length === 1 ? available[0]?.id : undefined;
}

/** Settings has an explicit account scope and should open on the first usable account. */
export function chooseFirstAvailableAccountId(accounts: AccountVM[], preferredAccountId?: string): string | undefined {
  const available = accounts.filter((account) => account.status !== 'disabled' && account.enabled !== false);
  if (preferredAccountId && available.some((account) => account.id === preferredAccountId)) return preferredAccountId;
  return available[0]?.id;
}

export function AccountContextProvider({ api, children }: { api: AccountsApi; children: ReactNode }) {
  const [accounts, setAccounts] = useState<AccountVM[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const [currentAccountId, setCurrentAccountIdState] = useState<string | undefined>(() => readCachedAccountId());
  const currentAccountIdRef = useRef(currentAccountId);
  const requestId = useRef(0);

  const setCurrent = useCallback((accountId?: string) => {
    currentAccountIdRef.current = accountId;
    setCurrentAccountIdState(accountId);
    writeCachedAccountId(accountId);
  }, []);

  const refreshAccounts = useCallback(async () => {
    const currentRequest = ++requestId.current;
    setAccountsLoading(true);
    setAccountsError(null);
    try {
      const page = await api.list({ page: 1, pageSize: 100 });
      if (currentRequest !== requestId.current) return;
      setAccounts(page.items);
      const nextAccountId = chooseInitialAccountId(page.items, currentAccountIdRef.current);
      setCurrent(nextAccountId);
    } catch (error) {
      if (currentRequest !== requestId.current) return;
      setAccountsError(error instanceof Error ? error.message : '账号加载失败，请稍后重试。');
    } finally {
      if (currentRequest === requestId.current) setAccountsLoading(false);
    }
  }, [api, setCurrent]);

  useEffect(() => { void refreshAccounts(); }, [refreshAccounts]);

  const setCurrentAccountId = useCallback(async (accountId?: string) => {
    const previous = currentAccountIdRef.current;
    if (accountId) {
      const account = accounts.find((item) => item.id === accountId);
      if (!account || account.status === 'disabled' || account.enabled === false) throw new Error('ACCOUNT_CONTEXT_INVALID');
      setCurrent(accountId);
      return;
    }

    setCurrent(undefined);
    void previous;
  }, [accounts, setCurrent]);

  const removeAccount = useCallback(async (accountId: string) => {
    if (!api.deleteAccount) throw new Error('ACCOUNT_DELETE_UNAVAILABLE');
    await api.deleteAccount(accountId);
    const remaining = accounts.filter((account) => account.id !== accountId);
    setAccounts(remaining);
    if (currentAccountIdRef.current === accountId) {
      const nextAccountId = chooseInitialAccountId(remaining);
      setCurrent(nextAccountId);
    }
  }, [accounts, api, setCurrent]);

  const value = useMemo<AccountContextValue>(() => ({
    accounts,
    accountsLoading,
    accountsError,
    currentAccountId,
    currentAccount: accounts.find((account) => account.id === currentAccountId),
    setCurrentAccountId,
    refreshAccounts,
    removeAccount,
  }), [accounts, accountsError, accountsLoading, currentAccountId, refreshAccounts, removeAccount, setCurrentAccountId]);

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

export function useAccountContext(): AccountContextValue {
  const value = useContext(AccountContext);
  if (!value) throw new Error('useAccountContext must be used inside AccountContextProvider');
  return value;
}
