import { useEffect, useRef, useState } from 'react';
import { Button } from '../../shared/ui/Button';
import { useVerification } from './VerificationProvider';
import { countdown, panelVisible, stateLabel, terminal, type VerificationSession } from './model';
import { nativeCandidateMessage } from './native-message';
import { VerificationOutcome } from './VerificationOutcome';

interface Presentation { url: string; origin: string; leaseId: string; epoch: number; generation: number }

export function NativeVerificationPanel({ session, onDismiss }: { session: VerificationSession; onDismiss?: () => void }) {
  const context = useVerification(), surface = useRef<HTMLDivElement>(null), iframe = useRef<HTMLIFrameElement>(null);
  const latest = useRef(session); latest.current = session;
  const lease = useRef<string | undefined>(undefined), submitting = useRef(false);
  const lifecycle = useRef(0);
  const [presentation, setPresentation] = useState<Presentation>(), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [scale, setScale] = useState(1);
  const [now, setNow] = useState(session.serverTime), clock = useRef({ local: Date.now(), server: session.serverTime });
  const { api, clientId, update, registerRelease } = context ?? {};
  const active = ['preparing', 'priority_wait', 'human_active'].includes(session.state);
  const clockNow = () => clock.current.server + Date.now() - clock.current.local;
  const live = (current: VerificationSession, at: number) => current.state === 'human_active'
    && current.controller?.clientId === clientId && at < (current.humanDeadline ?? 0) && at < current.expiresAt
    && current.presentation?.clientId === clientId && at < (current.presentation?.until ?? 0);
  useEffect(() => { lifecycle.current++; return () => { lifecycle.current++; }; }, [session.id, session.challengeGeneration]);
  useEffect(() => {
    const element = surface.current; if (!element) return;
    const fit = () => setScale(Math.max(0, Math.min(1, element.clientWidth / 420, element.clientHeight / 320)));
    const observer = new ResizeObserver(fit); observer.observe(element); fit();
    return () => observer.disconnect();
  }, []);
  useEffect(() => { clock.current = { local: Date.now(), server: session.serverTime }; }, [session.serverTime]);
  useEffect(() => { const timer = setInterval(() => setNow(clock.current.server + Date.now() - clock.current.local), 100); return () => clearInterval(timer); }, []);
  useEffect(() => { if (presentation && !live(session, now)) setPresentation(undefined); }, [presentation, session, now]);
  useEffect(() => {
    if (!api || !clientId || !update || !active) return;
    let stopped = false, pending = false;
    lease.current = undefined;
    const renew = async () => {
      if (stopped || pending || !panelVisible(surface.current)) return;
      pending = true;
      try {
        const result = await api.native(session.id, 'presentation', { clientInstanceId: clientId, challengeGeneration: latest.current.challengeGeneration });
        if (!stopped) { lease.current = result.leaseId; update(result.session); }
      } catch { if (!stopped) setError('验证状态正在更新，请稍后重试。'); }
      finally { pending = false; }
    };
    void renew(); const timer = setInterval(() => { void renew(); }, 1_000);
    return () => { stopped = true; clearInterval(timer); lease.current = undefined; };
  }, [api, clientId, update, active, session.id, session.challengeGeneration]);
  useEffect(() => {
    if (!api || !clientId || !registerRelease) return;
    registerRelease(session.id, async () => {
      setPresentation(undefined);
      const current = latest.current;
      if (current.state !== 'human_active' || !lease.current || current.controller?.clientId !== clientId) return;
      const result = await api.native(current.id, 'cancel', { clientInstanceId: clientId, leaseId: lease.current,
        challengeGeneration: current.challengeGeneration, controlEpoch: current.controlEpoch });
      update?.(result.session);
    });
    return () => registerRelease(session.id);
  }, [api, clientId, registerRelease, update, session.id]);
  useEffect(() => {
    if (!presentation || !api || !clientId || !update) return;
    const receive = (event: MessageEvent) => {
      const current = latest.current;
      if (submitting.current || !live(current, clockNow())
        || current.challengeGeneration !== presentation.generation || current.controlEpoch !== presentation.epoch
        || !iframe.current?.isConnected) return;
      const candidate = nativeCandidateMessage(event.data, event.origin, presentation.origin, event.source === iframe.current.contentWindow);
      if (!candidate) return;
      submitting.current = true; setPresentation(undefined); setError('');
      void api.native(current.id, 'result', { clientInstanceId: clientId, leaseId: presentation.leaseId,
        challengeGeneration: presentation.generation, controlEpoch: presentation.epoch, candidate })
        .then(result => update(result.session))
        .catch(() => { setError('验证结果交接未完成，请重新发起人工验证。'); void api.get(current.id).then(update).catch(() => undefined); })
        .finally(() => { submitting.current = false; });
    };
    window.addEventListener('message', receive); return () => window.removeEventListener('message', receive);
  }, [presentation, api, clientId, update]);
  const mine = session.state === 'human_active' && session.controller?.clientId === clientId;
  const visible = live(session, now) && presentation?.generation === session.challengeGeneration && presentation.epoch === session.controlEpoch;
  const finished = terminal(session), seconds = countdown(session, now);
  const claim = async () => {
    if (!api || !clientId || !update || !lease.current || busy || !panelVisible(surface.current)) return;
    setBusy(true); setError('');
    const revision = lifecycle.current;
    try {
      const current = latest.current;
      const result = await api.native(current.id, 'claim', { clientInstanceId: clientId, leaseId: lease.current,
        challengeGeneration: current.challengeGeneration, expectedVersion: current.version });
      if (revision !== lifecycle.current || latest.current.challengeGeneration !== result.session.challengeGeneration
        || latest.current.eventSequence > result.session.eventSequence && (latest.current.state !== 'human_active'
          || latest.current.controlEpoch !== result.session.controlEpoch || latest.current.controller?.clientId !== clientId)
        || !live(result.session, clockNow())) {
        if (result.leaseId) await api.native(current.id, 'cancel', { clientInstanceId: clientId, leaseId: result.leaseId,
          challengeGeneration: result.session.challengeGeneration, controlEpoch: result.session.controlEpoch }).catch(() => undefined);
        return;
      }
      update(result.session);
      if (result.url && result.origin && result.leaseId) setPresentation({ url: result.url, origin: result.origin,
        leaseId: result.leaseId, generation: result.session.challengeGeneration, epoch: result.session.controlEpoch });
    } catch { setError('状态已更新，请再次点击“我来操作”。'); void api.get(session.id).then(update).catch(() => undefined); }
    finally { setBusy(false); }
  };
  if (finished) return <VerificationOutcome session={session} onDismiss={onDismiss} />;
  return <section className="verification-panel" data-testid="verification-panel" data-state={session.state} aria-label="闲鱼验证操作区">
    <div className="verification-summary"><p className="verification-state" role="status"><strong>{['settling', 'handoff', 'rechecking'].includes(session.state)
      ? '正在复验账号连接' : stateLabel(session.state)}</strong>{['priority_wait', 'human_active'].includes(session.state) && <span className="verification-countdown" aria-label={`剩余 ${seconds} 秒`}>{seconds}s</span>}</p>
      {session.state === 'priority_wait' && <p>点击“我来操作”后，请在 30 秒内完成验证。</p>}
    </div>
    <div ref={surface} className="verification-image">
      {visible ? <iframe key={`${session.id}:${presentation.leaseId}:${presentation.generation}:${presentation.epoch}`} ref={iframe}
        src={presentation.url} title="闲鱼原生安全验证" width="420" height="320" className="verification-native-frame"
        style={{ transform: `translate(-50%, -50%) scale(${scale})` }}
        sandbox="allow-scripts allow-forms allow-same-origin" referrerPolicy="strict-origin-when-cross-origin" />
        : <div className="verification-result" role="status">{session.state === 'auto_active' ? '系统正在尝试验证…' : mine ? '正在等待验证结果…' : ['settling', 'handoff', 'rechecking'].includes(session.state)
            ? '正在检查原会话，请勿重复提交。' : '等待你接管验证'}</div>}
    </div>
    {error && <p className="verification-error" role="alert">{error}</p>}
    <footer className="verification-footer">
      <p className="verification-footnote">请在当前窗口完成验证。</p>
      <div className="modal-actions verification-actions">
        {session.state === 'priority_wait' && <Button type="button" variant="primary" disabled={busy || !lease.current || seconds === 0} onClick={() => void claim()}>我来操作</Button>}
      </div>
    </footer>
  </section>;
}
