import { useCallback, useEffect, useState } from 'react';
import type { AdminProfile, AuthApi, AuthSessionView } from './api';

export type AuthPhase = 'checking' | 'authenticated' | 'bootstrap-required' | 'login-required' | 'error';

export interface AuthState {
  phase: AuthPhase;
  session: AuthSessionView | null;
  admin: AdminProfile | null;
  error: string | null;
  busy: boolean;
}

export interface AuthController extends AuthState {
  refresh: () => Promise<void>;
  login: (input: { email: string; password: string }) => Promise<void>;
  bootstrap: (input: { email: string; password: string; displayName: string }) => Promise<void>;
  logout: () => Promise<void>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : '管理员会话请求失败，请重试。';
}

export function loggedOutState(error?: unknown): Pick<AuthState, 'phase' | 'session' | 'admin' | 'error' | 'busy'> {
  return {
    phase: 'login-required',
    session: { authenticated: false, bootstrapRequired: false },
    admin: null,
    error: error ? errorMessage(error) : null,
    busy: false,
  };
}

function stateFromSession(session: AuthSessionView): Pick<AuthState, 'phase' | 'session' | 'admin' | 'error' | 'busy'> {
  if (session.authenticated) return { phase: 'authenticated', session, admin: session.admin ?? null, error: null, busy: false };
  if (session.bootstrapRequired) return { phase: 'bootstrap-required', session, admin: null, error: null, busy: false };
  return { phase: 'login-required', session, admin: null, error: null, busy: false };
}

export function useAuthController(api: AuthApi): AuthController {
  const [state, setState] = useState<AuthState>({ phase: 'checking', session: null, admin: null, error: null, busy: false });

  const refresh = useCallback(async () => {
    setState((previous) => ({ ...previous, phase: 'checking', error: null, busy: false }));
    try {
      const session = await api.getSession();
      setState(stateFromSession(session));
    } catch (error) {
      setState({ phase: 'error', session: null, admin: null, error: errorMessage(error), busy: false });
    }
  }, [api]);

  const login = useCallback(async (input: { email: string; password: string }) => {
    setState((previous) => ({ ...previous, error: null, busy: true }));
    try {
      const session = await api.login(input);
      setState(stateFromSession({ ...session, authenticated: true, bootstrapRequired: false }));
    } catch (error) {
      setState((previous) => ({ ...previous, phase: 'login-required', error: errorMessage(error), busy: false }));
      throw error;
    }
  }, [api]);

  const bootstrap = useCallback(async (input: { email: string; password: string; displayName: string }) => {
    setState((previous) => ({ ...previous, error: null, busy: true }));
    try {
      const session = await api.bootstrap(input);
      setState(stateFromSession({ ...session, authenticated: true, bootstrapRequired: false }));
    } catch (error) {
      setState((previous) => ({ ...previous, phase: 'bootstrap-required', error: errorMessage(error), busy: false }));
      throw error;
    }
  }, [api]);

  const logout = useCallback(async () => {
    setState((previous) => ({ ...previous, error: null, busy: true }));
    try {
      await api.logout();
      setState(loggedOutState());
    } catch (error) {
      // The local shell must disappear even if the server revoke fails.
      setState(loggedOutState(error));
    }
  }, [api]);

  useEffect(() => { void refresh(); }, [refresh]);

  return { ...state, refresh, login, bootstrap, logout };
}
