import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { countdown, normalizedPoint, panelVisible, stateLabel, terminal, type VerificationSession } from './model';
import { useVerification } from './VerificationProvider';
import { useVerificationStream } from './useVerificationStream';
import { Button } from '../../shared/ui/Button';
import { ApiError } from '../../api/http';
import { NativeVerificationPanel } from './NativeVerificationPanel';
import { VerificationOutcome, VerificationSourceResults } from './VerificationOutcome';
import { VerificationProgress } from './VerificationProgress';

export function VerificationPanel({ session, onDismiss }: { session: VerificationSession; onDismiss?: () => void }) {
  return session.presentationKind === 'native_iframe' ? <NativeVerificationPanel session={session} onDismiss={onDismiss} /> : <RemoteVerificationPanel session={session} onDismiss={onDismiss} />;
}
function RemoteVerificationPanel({ session, onDismiss }: { session: VerificationSession; onDismiss?: () => void }) {
  const context = useVerification(), image = useRef<HTMLImageElement>(null), surface = useRef<HTMLDivElement>(null);
  const stream = useVerificationStream(session, image, surface);
  const [now, setNow] = useState(Date.now()), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const clock = useRef({ local: Date.now(), server: session.serverTime });
  useEffect(() => { clock.current = { local: Date.now(), server: session.serverTime }; }, [session.serverTime]);
  useEffect(() => { const tick = setInterval(() => setNow(clock.current.server + Date.now() - clock.current.local), 100); return () => clearInterval(tick); }, []);
  const pressed = useRef<number | undefined>(undefined), lastMove = useRef(0), lastPoint = useRef<{ x: number; y: number } | undefined>(undefined);
  const candidate = useRef<{ pointerId: number; at: number; x: number; y: number; clientX: number; clientY: number; scale: number; distance: number; active: boolean; streamEpoch: number; geometryRevision: number } | undefined>(undefined);
  const currentFrame = useRef(stream.frame); currentFrame.current = stream.frame;
  const currentConnection = useRef(stream.connectionId); currentConnection.current = stream.connectionId;
  const latestSession = useRef(session); latestSession.current = session;
  const registerRelease = context?.registerRelease;
  useEffect(() => {
    if (!context || !stream.connectionId) return;
    registerRelease?.(session.id, async () => {
      const next = await context.api.command(session.id, 'release', { clientInstanceId: context.clientId, connectionId: stream.connectionId, expectedVersion: latestSession.current.version, toAuto: latestSession.current.autoAllowed === true });
      context.update(next);
    });
    return () => registerRelease?.(session.id);
  }, [context?.api, context?.clientId, context?.update, registerRelease, session.id, stream.connectionId]);
  useEffect(() => {
    const cancel = () => { if (candidate.current) candidate.current.active = false; };
    window.addEventListener('blur', cancel);
    return () => { candidate.current = undefined; window.removeEventListener('blur', cancel); };
  }, []);
  const mine = session.state === 'human_active' && session.controller?.clientId === context?.clientId;
  const rejection = session.platformResult?.status === 'rejected' && session.platformResult.challengeGeneration === session.challengeGeneration ? session.platformResult : undefined;
  const autoAllowed = session.autoAllowed === true;
  const fresh = stream.frame && now - stream.frame.capturedAt < 2_000;
  const controllable = mine && stream.ready && fresh && !session.reconnectDeadline && now < (session.humanDeadline ?? 0);
  const seconds = countdown(session, now);
  async function command(action: string, body: Record<string, unknown> = {}) {
    if (!context || busy) return;
    setBusy(true); setError('');
    try {
      const request = { clientInstanceId: context.clientId, connectionId: stream.connectionId, expectedVersion: session.version, ...body };
      let next: VerificationSession;
      try { next = await context.api.command(session.id, action, request); }
      catch (cause) {
        const code = cause instanceof ApiError && (cause.payload as { error?: { code?: string } } | undefined)?.error?.code;
        if (action !== 'claim' || body.action !== 'claim' || !(cause instanceof ApiError) || cause.status !== 409 || code !== 'VERIFICATION_VERSION_CHANGED') throw cause;
        // A presentation lease renewal can race the explicit claim. Refresh
        // once, then repeat this same intent only while its frame, connection,
        // presentation owner and original priority window are still valid.
        const fresh = await context.api.get(session.id); context.update(fresh);
        const picture = currentFrame.current;
        if (fresh.id !== session.id || fresh.state !== 'priority_wait' || fresh.controller
          || fresh.presentation?.clientId !== context.clientId || fresh.presentation.until <= fresh.serverTime || (fresh.priorityDeadline ?? 0) <= fresh.serverTime
          || !stream.connectionId || stream.connectionId !== currentConnection.current || !picture || !stream.frame
          || picture.streamEpoch !== stream.frame.streamEpoch || picture.geometryRevision !== stream.frame.geometryRevision
          || fresh.serverTime - picture.capturedAt >= 2_000 || !panelVisible(image.current)) throw cause;
        next = await context.api.command(session.id, action, { ...request, expectedVersion: fresh.version, frameId: picture.frameId });
      }
      context.update(next); stream.adopt(next); return next;
    }
    catch { setError('状态已变化或请求未完成，请等待刷新后再操作。'); void context.api.get(session.id).then(context.update).catch(() => undefined); }
    finally { setBusy(false); }
  }
  function point(event: PointerEvent<HTMLImageElement>) { return normalizedPoint(event.currentTarget.getBoundingClientRect(), event.clientX, event.clientY); }
  function down(event: PointerEvent<HTMLImageElement>) {
    if (pressed.current !== undefined || candidate.current || event.button !== 0) return;
    if (session.state === 'priority_wait' && stream.ready && fresh && stream.frame && !busy) {
      const p = point(event); if (!p || !panelVisible(image.current)) return;
      event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
      const c = { pointerId: event.pointerId, at: performance.now(), ...p, clientX: event.clientX, clientY: event.clientY,
        scale: stream.frame.width / event.currentTarget.getBoundingClientRect().width, distance: 0, active: true, streamEpoch: stream.frame.streamEpoch, geometryRevision: stream.frame.geometryRevision };
      candidate.current = c;
      void command('claim', { action: 'claim', frameId: stream.frame.frameId }).then(next => {
        if (candidate.current !== c) return;
        candidate.current = undefined;
        if (!next) return;
        const latest = currentFrame.current;
        if (c.active && performance.now() - c.at <= 300 && c.distance <= 4 && panelVisible(image.current)
          && latest?.streamEpoch === c.streamEpoch && latest.geometryRevision === c.geometryRevision && stream.send('down', c.x, c.y)) {
          pressed.current = c.pointerId; lastPoint.current = { x: c.x, y: c.y };
        } else setError('接管成功，请松开后重新拖动。');
      });
      return;
    }
    if (!controllable) return;
    const p = point(event); if (!p || !stream.send('down', p.x, p.y)) return;
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); pressed.current = event.pointerId; lastPoint.current = p;
  }
  function move(event: PointerEvent<HTMLImageElement>) {
    const c = candidate.current;
    if (c?.pointerId === event.pointerId) { c.distance = Math.max(c.distance, Math.hypot(event.clientX - c.clientX, event.clientY - c.clientY) * c.scale); return; }
    if (pressed.current !== event.pointerId) return;
    const p = point(event); if (!p) return; lastPoint.current = p;
    if (performance.now() - lastMove.current < 33) return;
    lastMove.current = performance.now(); stream.send('move', p.x, p.y);
  }
  function up(event: PointerEvent<HTMLImageElement>) {
    if (candidate.current?.pointerId === event.pointerId) candidate.current.active = false;
    if (pressed.current !== event.pointerId) return;
    const p = point(event) ?? lastPoint.current;
    if (p) { stream.send('move', p.x, p.y); stream.send('up', p.x, p.y); }
    pressed.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  useEffect(() => { if (!mine || !stream.connectionId) pressed.current = undefined; }, [mine, stream.connectionId]);
  const finished = terminal(session);
  if (finished) return <VerificationOutcome session={session} onDismiss={onDismiss} />;
  return <section className="verification-panel" data-testid="verification-panel" data-state={session.state} aria-label="闲鱼验证操作区">
    <div className="verification-summary">
      <p className="verification-state" role="status"><strong>{stateLabel(session.state)}</strong>{['priority_wait', 'human_active'].includes(session.state) && <span className="verification-countdown" aria-label={`剩余 ${seconds} 秒`}>{seconds}s</span>}</p>
      {session.state === 'priority_wait' && <p>{session.mode === 'manual_only' || !autoAllowed ? '仅人工操作，接管后有 30 秒。' : '接管后有 30 秒；倒计时结束将交给系统。'}</p>}
      {session.state === 'human_active' && !mine && !rejection && <p>其他页面正在操作，请等待其完成。</p>}
      {session.state === 'human_active' && rejection && <p className="verification-error" role="alert">上次平台未通过（{rejection.code}），{mine ? '可刷新后重试。' : '等待当前页面重试。'}</p>}
      {session.state === 'settling' && <p>已停止输入，正在等待平台结果，请勿重复提交。</p>}
    </div>
    <div ref={surface} className={`verification-image${controllable ? ' is-controlling' : ''}`}>
      {stream.frame ? <img ref={image} src={stream.frame.url} alt="闲鱼原会话验证画面" draggable={false} onLoad={stream.displayed}
        width={stream.frame.width} height={stream.frame.height}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onLostPointerCapture={up}
        style={{ width: `min(${stream.frame.width}px, 100%, calc(var(--verification-image-height) * ${stream.frame.width / stream.frame.height}))`,
          aspectRatio: `${stream.frame.width}/${stream.frame.height}`, touchAction: controllable ? 'none' : 'auto' }} />
        : <VerificationProgress title={['auto_active', 'handoff', 'rechecking', 'settling'].includes(session.state) ? '正在处理验证结果…' : '正在连接原会话画面…'} description="页面就绪后会自动更新，请稍候。" />}
      {!finished && stream.frame && !fresh && <span className="verification-stale">画面更新中，暂不可操作</span>}
    </div>
    {(error || stream.error) && !finished && <p className="verification-error" role="alert">{error || stream.error}</p>}
    <div className="modal-actions verification-actions">
      {session.state === 'priority_wait' && <>{autoAllowed && <Button type="button" disabled={busy || !stream.connectionId} onClick={() => void command('auto')}>交给系统</Button>}
        <Button variant="primary" type="button" disabled={busy || !stream.ready || !fresh || !stream.connectionId || seconds === 0} onClick={() => void command('claim', { action: 'claim', frameId: stream.frame?.frameId })}>我来操作</Button></>}
      {mine && <Button type="button" disabled={busy} onClick={() => void command('release', { toAuto: autoAllowed })}>{autoAllowed ? '交给系统' : '结束人工'}</Button>}
      {session.state === 'auto_active' && <Button type="button" disabled={busy} onClick={() => void command('request-human')}>下一次由我操作</Button>}
    </div>
    <VerificationSourceResults results={session.sourceResults} />
  </section>;
}
