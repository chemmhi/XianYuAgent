import { useCallback, useEffect, useRef, useState } from 'react';
import type { AccountsApi } from '../api';
import {
  createInitialQrLoginModel,
  isTerminalQrStatus,
  phaseForQrStatus,
  type QrLoginError,
  type QrLoginModel,
} from './model';

export interface QrLoginController {
  model: QrLoginModel;
  start: () => Promise<void>;
  refresh: () => Promise<void>;
  retry: () => Promise<void>;
  cancel: () => Promise<void>;
}

/**
 * Runs one async action at a time and shares the in-flight promise with
 * concurrent callers. This protects QR creation from React StrictMode
 * re-running mount effects and from accidental double clicks.
 */
export function createInFlightDedupe() {
  let active: Promise<void> | null = null;
  return (run: () => Promise<void>): Promise<void> => {
    if (active) return active;
    let current: Promise<void>;
    current = run().finally(() => {
      if (active === current) active = null;
    });
    active = current;
    return current;
  };
}

function toQrLoginError(error: unknown): QrLoginError {
  const code = error instanceof Error && error.message ? error.message : 'QR_LOGIN_FAILED';
  return {
    code,
    message: code === 'QR_LOGIN_UNAVAILABLE' ? '当前账号暂未接入二维码登录服务。' : '二维码登录请求失败，请重试。',
    retryable: code !== 'FORBIDDEN',
  };
}

export function useQrLoginController(options: { api: AccountsApi; accountId?: string; enabled: boolean }): QrLoginController {
  const { api, accountId, enabled } = options;
  const [activeAccountId, setActiveAccountId] = useState(accountId ?? '');
  const [model, setModel] = useState<QrLoginModel>(createInitialQrLoginModel);
  const requestId = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startDedupeRef = useRef<ReturnType<typeof createInFlightDedupe> | null>(null);
  if (!startDedupeRef.current) startDedupeRef.current = createInFlightDedupe();

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const applySession = useCallback((session: NonNullable<QrLoginModel['session']>) => {
    setModel({
      phase: phaseForQrStatus(session.status),
      session,
      error: session.errorCode ? { code: session.errorCode, message: session.errorCode, retryable: true } : null,
    });
  }, []);

  const start = useCallback(() => {
    if (!enabled) return Promise.resolve();
    return startDedupeRef.current!(async () => {
      clearTimer();
      const currentRequest = ++requestId.current;
      setModel({ phase: 'creating', session: null, error: null });
      try {
        const session = await api.createQrSession(accountId || undefined);
        if (currentRequest !== requestId.current) return;
        setActiveAccountId(session.accountId ?? '');
        applySession(session);
      } catch (error) {
        if (currentRequest !== requestId.current) return;
        setModel({ phase: 'failed', session: null, error: toQrLoginError(error) });
      }
    });
  }, [accountId, api, applySession, clearTimer, enabled]);

  const refresh = useCallback(async () => {
    const session = model.session;
    if (!enabled || !session || isTerminalQrStatus(session.status)) return;
    const currentRequest = ++requestId.current;
    try {
      const next = await api.getQrSession(activeAccountId || session.accountId, session.qrSessionId);
      if (currentRequest !== requestId.current) return;
      if (next.accountId) setActiveAccountId(next.accountId);
      applySession(next);
    } catch (error) {
      if (currentRequest !== requestId.current) return;
      setModel((previous) => ({ ...previous, error: toQrLoginError(error) }));
    }
  }, [activeAccountId, api, applySession, enabled, model.session]);

  const retry = useCallback(async () => {
    const session = model.session;
    if (!enabled) return;
    clearTimer();
    if (!session || !api.renewQrSession) {
      await start();
      return;
    }
    const currentRequest = ++requestId.current;
    setModel((previous) => ({ ...previous, phase: 'creating', error: null }));
    try {
      const next = await api.renewQrSession(activeAccountId || session.accountId, session.qrSessionId);
      if (currentRequest !== requestId.current) return;
      if (next.accountId) setActiveAccountId(next.accountId);
      applySession(next);
    } catch (error) {
      if (currentRequest !== requestId.current) return;
      setModel((previous) => ({ ...previous, phase: 'failed', error: toQrLoginError(error) }));
    }
  }, [activeAccountId, api, applySession, clearTimer, enabled, model.session, start]);

  const cancel = useCallback(async () => {
    const session = model.session;
    if (!enabled || !session || !api.cancelQrSession) return;
    clearTimer();
    const currentRequest = ++requestId.current;
    try {
      await api.cancelQrSession(activeAccountId || session.accountId, session.qrSessionId);
      if (currentRequest !== requestId.current) return;
      setModel((previous) => previous.session ? {
        phase: 'cancelled',
        session: { ...previous.session, status: 'cancelled' },
        error: null,
      } : previous);
    } catch (error) {
      if (currentRequest !== requestId.current) return;
      setModel((previous) => ({ ...previous, error: toQrLoginError(error) }));
    }
  }, [activeAccountId, api, clearTimer, enabled, model.session]);

  useEffect(() => {
    if (!enabled) {
      clearTimer();
      setModel(createInitialQrLoginModel());
      setActiveAccountId(accountId ?? '');
      requestId.current += 1;
      return;
    }
    const session = model.session;
    if (!session || isTerminalQrStatus(session.status)) {
      clearTimer();
      return;
    }
    clearTimer();
    timerRef.current = setTimeout(() => { void refresh(); }, Math.max(500, session.pollAfterMs));
    return clearTimer;
  }, [clearTimer, enabled, model.session, refresh]);

  useEffect(() => () => {
    clearTimer();
    requestId.current += 1;
  }, [clearTimer]);

  return { model, start, refresh, retry, cancel };
}
