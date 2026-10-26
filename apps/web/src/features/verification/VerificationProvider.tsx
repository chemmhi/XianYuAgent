import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ApiError } from '../../api/http';
import { createVerificationApi, verificationSocketUrl, type VerificationApi, type VerificationTransport } from './api';
import { controlledVerificationSession, mergeSession, pendingVerificationSelection, projectVerificationSelection, sameVerificationSubject,
  terminal, type PendingVerificationSelection, type VerificationSession } from './model';
import { VerificationPanel } from './VerificationPanel';
import './verification.css';
import { acquireVerificationClient } from './client-identity';
import { VerificationDialog } from './VerificationDialog';
import { Button } from '../../shared/ui/Button';

interface VerificationContextValue {
  enabled: boolean; api: VerificationApi; clientId: string; baseUrl: string; sessions: VerificationSession[];
  update(session: VerificationSession): void; open(id?: string): void;
  retry(subject: VerificationSession['subject']): Promise<void>;
  embedded(loginId: string, mounted: boolean): void; nextSequence(id: string): number;
  registerRelease(id: string, handler?: () => Promise<void>): void;
  releaseSession(id: string): Promise<void>;
}
const Context = createContext<VerificationContextValue | null>(null);
export const useVerification = () => useContext(Context);

export function VerificationProvider({ transport, baseUrl = '', accountLabels = {}, children }: { transport: VerificationTransport; baseUrl?: string; accountLabels?: Record<string, string>; children: ReactNode }) {
  const api = useMemo(() => createVerificationApi(transport), [transport]);
  const [enabled, setEnabled] = useState(false), [sessions, setSessions] = useState<VerificationSession[]>([]);
  const [selected, setSelected] = useState<string>(), [opened, setOpened] = useState(true);
  const [embedded, setEmbedded] = useState<Map<string, number>>(new Map());
  const [notice, setNotice] = useState('');
  const [connectionRevision, setConnectionRevision] = useState(0);
  const [confirmClose, setConfirmClose] = useState(false), [closeBusy, setCloseBusy] = useState(false);
  const releases = useRef(new Map<string, () => Promise<void>>());
  const sequence = useRef(new Map<string, number>());
  const [clientId, setClientId] = useState('');
  const rowsRef = useRef(sessions); rowsRef.current = sessions;
  const selectedRef = useRef(selected); selectedRef.current = selected;
  const clientIdRef = useRef(clientId); clientIdRef.current = clientId;
  const pendingSelection = useRef<PendingVerificationSelection | undefined>(undefined);
  const retainedSelection = useRef<string | undefined>(undefined);
  const select = useCallback((id?: string) => { selectedRef.current = id; setSelected(id); }, []);
  const applySessions = useCallback((rows: VerificationSession[]) => {
    rowsRef.current = rows; setSessions(rows);
    const next = projectVerificationSelection(rows, selectedRef.current, clientIdRef.current, pendingSelection.current, retainedSelection.current);
    pendingSelection.current = next.pending; retainedSelection.current = next.retainedSelection; select(next.selected);
  }, [select]);
  useEffect(() => { let closed = false; let identity: Awaited<ReturnType<typeof acquireVerificationClient>> | undefined;
    void acquireVerificationClient().then(result => { identity = result; if (closed) result.close(); else setClientId(result.id); });
    return () => { closed = true; identity?.close(); };
  }, []);
  const update = useCallback((session: VerificationSession) => {
    const isNew = !rowsRef.current.some(row => row.id === session.id);
    const targeted = pendingSelection.current && sameVerificationSubject(pendingSelection.current.subject, session.subject)
      && !pendingSelection.current.knownTerminalIds.includes(session.id);
    applySessions(mergeSession(rowsRef.current, session));
    if (!terminal(session)) {
      setNotice('');
    }
    if ((isNew && !terminal(session)) || targeted) setOpened(true);
  }, [applySessions]);
  useEffect(() => {
    if (!clientId) return;
    let stopped = false, socket: WebSocket | undefined, reconnect: ReturnType<typeof setTimeout> | undefined;
    let focused = document.hasFocus();
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    const presence = () => { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'presence', clientInstanceId: clientId, visible: focused && document.visibilityState === 'visible' && document.hasFocus() })); };
    const blur = () => { focused = false; presence(); };
    const focus = () => { focused = true; presence(); };
    const connect = () => {
      if (stopped) return;
      socket = new WebSocket(verificationSocketUrl(`/api/v1/verification-events?clientInstanceId=${encodeURIComponent(clientId)}`, baseUrl));
      socket.onopen = () => { presence(); if (heartbeat) clearInterval(heartbeat); heartbeat = setInterval(presence, 2_000); };
      socket.onmessage = event => {
        if (typeof event.data !== 'string') return;
        try {
          const payload = JSON.parse(event.data);
          if (Array.isArray(payload.sessions)) {
            applySessions([...rowsRef.current.filter(terminal), ...payload.sessions.filter((s: VerificationSession) => !terminal(s))]);
          }
          if (payload.session) {
            const next = payload.session as VerificationSession;
            const previous = rowsRef.current.find(row => row.id === next.id);
            if (previous && next.eventSequence > previous.eventSequence + 1) void api.get(next.id).then(update).catch(() => undefined);
            else update(next);
          }
        } catch { /* Malformed frames do not grant control. */ }
      };
      socket.onclose = event => {
        if (heartbeat) clearInterval(heartbeat);
        if (!stopped && event.code === 1008) void api.list().catch(() => { if (!stopped) { setSessions([]); setEnabled(false); } });
        if (!stopped) reconnect = setTimeout(connect, 1_000);
      };
    };
    void api.list().then(result => {
      if (stopped) return;
      setEnabled(true); setNotice(''); applySessions(result.sessions); connect();
    }).catch(error => {
      if (!stopped && !(error instanceof ApiError && error.status === 404)) setNotice('验证状态暂不可用，请刷新后重试。');
    });
    document.addEventListener('visibilitychange', presence);
    window.addEventListener('blur', blur); window.addEventListener('focus', focus);
    return () => { stopped = true; socket?.close(); if (reconnect) clearTimeout(reconnect); if (heartbeat) clearInterval(heartbeat); document.removeEventListener('visibilitychange', presence); window.removeEventListener('blur', blur); window.removeEventListener('focus', focus); };
  }, [api, baseUrl, clientId, update, applySessions, connectionRevision]);
  const open = useCallback((id?: string) => {
    const controlled = controlledVerificationSession(rowsRef.current, clientId);
    if (controlled && id && controlled.id !== id) {
      select(controlled.id); setOpened(true); setNotice('请先交接当前人工验证，再切换其他账号。'); return;
    }
    pendingSelection.current = undefined;
    retainedSelection.current = id;
    if (id) select(id); setOpened(true); setNotice('');
  }, [clientId, select]);
  const retry = useCallback(async (subject: VerificationSession['subject']) => {
    const controlled = controlledVerificationSession(rowsRef.current, clientId);
    if (controlled && !sameVerificationSubject(controlled.subject, subject)) {
      select(controlled.id); setOpened(true); setNotice('请先交接当前人工验证，再切换其他账号。'); return;
    }
    const requested = pendingVerificationSelection(rowsRef.current, subject);
    pendingSelection.current = requested;
    setNotice('正在获取新的验证画面…'); setOpened(true);
    try { const result = await api.retry(subject); if (result.session) update(result.session); }
    catch (error) {
      if (pendingSelection.current === requested) pendingSelection.current = undefined;
      setNotice(error instanceof Error ? error.message : '无法发起验证，请重试。'); throw error;
    }
  }, [api, clientId, select, update]);
  const registerEmbedded = useCallback((id: string, mounted: boolean) => setEmbedded(previous => {
    const next = new Map(previous), count = (next.get(id) ?? 0) + (mounted ? 1 : -1);
    if (count > 0) next.set(id, count); else next.delete(id); return next;
  }), []);
  const nextSequence = useCallback((id: string) => {
    let last = sequence.current.get(id);
    try { last ??= Number(sessionStorage.getItem(`verification-sequence:${id}`)) || 0; } catch { last ??= 0; }
    const next = last + 1; sequence.current.set(id, next);
    try { sessionStorage.setItem(`verification-sequence:${id}`, String(next)); } catch { /* Current page still preserves ordering. */ }
    return next;
  }, []);
  const registerRelease = useCallback((id: string, handler?: () => Promise<void>) => { if (handler) releases.current.set(id, handler); else releases.current.delete(id); }, []);
  const releaseSession = useCallback(async (id: string) => { const release = releases.current.get(id); if (!release) throw new Error('验证连接正在恢复'); await release(); }, []);
  const value = useMemo(() => ({ enabled, api, clientId, baseUrl, sessions, update, open, retry, embedded: registerEmbedded, nextSequence, registerRelease, releaseSession }), [enabled, api, clientId, baseUrl, sessions, update, open, retry, registerEmbedded, nextSequence, registerRelease, releaseSession]);
  const active = sessions.filter(row => !terminal(row));
  const current = sessions.find(row => row.id === selected) ?? active[0];
  const isEmbedded = Boolean(current?.subject.loginSessionId && embedded.has(current.subject.loginSessionId));
  const closeHandsToSystem = current?.autoAllowed === true && current.presentationKind !== 'native_iframe';
  const label = (row: VerificationSession) => row.subject.accountId ? accountLabels[row.subject.accountId] || '闲鱼账号' : '扫码登录的闲鱼账号';
  return <Context.Provider value={value}>{children}
    {(enabled && active.length > 0 || notice) && <div className="verification-entry card" role="status"><span>{notice || `${active.length} 个验证处理中`}</span><Button type="button" onClick={() => enabled ? open(active[0]?.id) : setConnectionRevision(value => value + 1)}>{enabled ? '查看验证' : '重试连接'}</Button></div>}
    {enabled && opened && current && !isEmbedded && <VerificationDialog title={label(current)} onClose={() => current.state === 'human_active' && current.controller?.clientId === clientId ? setConfirmClose(true) : setOpened(false)}>
      {confirmClose && <div className="verification-close-confirm" role="alertdialog" aria-label="交接人工验证"><p>{closeHandsToSystem ? '交给系统后再关闭验证窗口？' : '结束本次人工验证并关闭窗口？本轮将停止。'}</p><div className="modal-actions verification-actions"><Button variant="ghost" type="button" disabled={closeBusy} onClick={() => setConfirmClose(false)}>继续人工操作</Button><Button variant="primary" type="button" disabled={closeBusy} onClick={() => {
        const release = releases.current.get(current.id); if (!release) { setNotice('正在重连，请等待控制状态更新后再交接。'); return; }
        setCloseBusy(true); void release().then(() => { setConfirmClose(false); setOpened(false); }).catch(() => setNotice('交接未完成，请等待状态更新。')).finally(() => setCloseBusy(false));
      }}>{closeBusy ? '正在结束…' : closeHandsToSystem ? '交给系统并关闭' : '结束人工并关闭'}</Button></div></div>}
      {active.some(row => row.id !== current.id) && <nav className="verification-queue" aria-label="待验证账号">{active.map(row => <Button type="button" key={row.id} disabled={row.id !== current.id && current.state === 'human_active'} aria-current={row.id === current.id ? 'true' : undefined} onClick={() => open(row.id)}>{label(row)}</Button>)}</nav>}
      <VerificationPanel key={current.id} session={current} onDismiss={() => setOpened(false)} />
    </VerificationDialog>}
  </Context.Provider>;
}

export function VerificationAccountActions({ accountId }: { accountId: string }) {
  const verification = useVerification(); const [busy, setBusy] = useState(false), [error, setError] = useState('');
  if (!verification?.enabled) return null;
  const active = verification.sessions.find(row => row.subject.accountId === accountId && !terminal(row));
  return <><button type="button" className="btn ghost" disabled={busy} onClick={() => {
    if (active) { verification.open(active.id); return; }
    setBusy(true); setError(''); void verification.retry({ accountId }).catch(() => setError('验证发起失败，请重试。')).finally(() => setBusy(false));
  }}>{busy ? '准备中…' : active ? '查看验证' : '我来重试'}</button>{error && <small role="alert">{error}</small>}</>;
}

export function VerificationQrPanel({ loginSessionId }: { loginSessionId: string }) {
  const verification = useVerification();
  const register = verification?.embedded;
  useEffect(() => { register?.(loginSessionId, true); return () => register?.(loginSessionId, false); }, [loginSessionId, register]);
  const session = verification?.sessions.find(row => row.subject.loginSessionId === loginSessionId && !terminal(row))
    ?? verification?.sessions.filter(row => row.subject.loginSessionId === loginSessionId).at(-1);
  return session ? <VerificationPanel key={session.id} session={session} /> : <p role="status">正在准备验证画面，登录流程会在后台继续。</p>;
}

export function useVerificationQrHost(loginSessionId?: string) {
  const register = useVerification()?.embedded;
  useEffect(() => {
    if (!loginSessionId) return;
    register?.(loginSessionId, true);
    return () => register?.(loginSessionId, false);
  }, [loginSessionId, register]);
}
