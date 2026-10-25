import { useCallback, useEffect, useState } from 'react';
import type { AdminProfile, AuthApi, AuthSessionView } from './api';
import type { SessionBoundary } from './session-boundary';

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
  register: (input: { inviteCode: string; email: string; password: string; displayName: string }) => Promise<void>;
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

export function useAuthController(api: AuthApi, sessionBoundary?: SessionBoundary): AuthController {
  const [state, setState] = useState<AuthState>({ phase: 'checking', session: null, admin: null, error: null, busy: false });
  useEffect(() => sessionBoundary?.subscribe(() => setState(loggedOutState(new Error('登录已失效，请重新登录；若账号已禁用或到期，请联系管理员。')))), [sessionBoundary]);

  const refresh = useCallback(async () => {
    const request = sessionBoundary?.advance();
    setState((previous) => ({ ...previous, phase: 'checking', error: null, busy: false }));
    try {
      const session = await api.getSession();
      if (request !== sessionBoundary?.current()) return;
      setState(stateFromSession(session));
    } catch (error) {
      if (request !== sessionBoundary?.current()) return;
      setState({ phase: 'error', session: null, admin: null, error: errorMessage(error), busy: false });
    }
  }, [api, sessionBoundary]);

  const login = useCallback(async (input: { email: string; password: string }) => {
    const request = sessionBoundary?.advance();
    setState((previous) => ({ ...previous, error: null, busy: true }));
    try {
      const session = await api.login(input);
      if (request !== sessionBoundary?.current()) return;
      setState(stateFromSession({ ...session, authenticated: true, bootstrapRequired: false }));
    } catch (error) {
      if (request !== sessionBoundary?.current()) return;
      setState((previous) => ({ ...previous, phase: 'login-required', error: errorMessage(error), busy: false }));
      throw error;
    }
  }, [api, sessionBoundary]);

  const register = useCallback(async (input: { inviteCode: string; email: string; password: string; displayName: string }) => { const request = sessionBoundary?.advance(); setState((previous) => ({ ...previous, error: null, busy: true })); try { const session = await api.register(input); if (request !== sessionBoundary?.current()) return; setState(stateFromSession({ ...session, authenticated: true, bootstrapRequired: false })); } catch (error) { if (request !== sessionBoundary?.current()) return; setState((previous) => ({ ...previous, phase: 'login-required', error: errorMessage(error), busy: false })); throw error; } }, [api, sessionBoundary]);

  const bootstrap = useCallback(async (input: { email: string; password: string; displayName: string }) => {
    const request = sessionBoundary?.advance();
    setState((previous) => ({ ...previous, error: null, busy: true }));
    try {
      const session = await api.bootstrap(input);
      if (request !== sessionBoundary?.current()) return;
      setState(stateFromSession({ ...session, authenticated: true, bootstrapRequired: false }));
    } catch (error) {
      if (request !== sessionBoundary?.current()) return;
      setState((previous) => ({ ...previous, phase: 'bootstrap-required', error: errorMessage(error), busy: false }));
      throw error;
    }
  }, [api, sessionBoundary]);

  const logout = useCallback(async () => {
    const request = sessionBoundary?.advance();
    setState((previous) => ({ ...previous, error: null, busy: true }));
    try {
      await api.logout();
      if (request !== sessionBoundary?.current()) return;
      setState(loggedOutState());
    } catch (error) {
      if (request !== sessionBoundary?.current()) return;
      // The local shell must disappear even if the server revoke fails.
      setState(loggedOutState(error));
    }
  }, [api, sessionBoundary]);

  useEffect(() => { void refresh(); }, [refresh]);

  return { ...state, refresh, login, register, bootstrap, logout };
}
