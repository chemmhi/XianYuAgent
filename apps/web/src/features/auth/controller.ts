import { useCallback, useEffect, useState } from 'react';
import type { AdminProfile, AuthApi, AuthSessionView } from './api';

export type AuthPhase = 'checking' | 'authenticated' | 'bootstrap-required' | 'login-required' | 'error';

export interface AuthState {
  phase: AuthPhase;
  session: AuthSessionView | null;
  admin: AdminProfile | null;
  error: string | null;
}

export interface AuthController extends AuthState {
  refresh: () => Promise<void>;
  login: (input: { email: string; password: string }) => Promise<void>;
  bootstrap: (input: { email: string; password: string; displayName: string }) => Promise<void>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : '管理员会话请求失败，请重试。';
}

function stateFromSession(session: AuthSessionView): Pick<AuthState, 'phase' | 'session' | 'admin' | 'error'> {
  if (session.authenticated) return { phase: 'authenticated', session, admin: session.admin ?? null, error: null };
  if (session.bootstrapRequired) return { phase: 'bootstrap-required', session, admin: null, error: null };
  return { phase: 'login-required', session, admin: null, error: null };
}

export function useAuthController(api: AuthApi): AuthController {
  const [state, setState] = useState<AuthState>({ phase: 'checking', session: null, admin: null, error: null });

  const refresh = useCallback(async () => {
    setState((previous) => ({ ...previous, phase: 'checking', error: null }));
    try {
      const session = await api.getSession();
      setState(stateFromSession(session));
    } catch (error) {
      setState({ phase: 'error', session: null, admin: null, error: errorMessage(error) });
    }
  }, [api]);

  const login = useCallback(async (input: { email: string; password: string }) => {
    setState((previous) => ({ ...previous, phase: 'checking', error: null }));
    try {
      const session = await api.login(input);
      setState(stateFromSession({ ...session, authenticated: true, bootstrapRequired: false }));
    } catch (error) {
      setState((previous) => ({ ...previous, phase: 'login-required', error: errorMessage(error) }));
      throw error;
    }
  }, [api]);

  const bootstrap = useCallback(async (input: { email: string; password: string; displayName: string }) => {
    setState((previous) => ({ ...previous, phase: 'checking', error: null }));
    try {
      const session = await api.bootstrap(input);
      setState(stateFromSession({ ...session, authenticated: true, bootstrapRequired: false }));
    } catch (error) {
      setState((previous) => ({ ...previous, phase: 'bootstrap-required', error: errorMessage(error) }));
      throw error;
    }
  }, [api]);

  useEffect(() => { void refresh(); }, [refresh]);

  return { ...state, refresh, login, bootstrap };
}
