import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { verificationSocketUrl } from './api';
import { panelVisible, terminal, type VerificationFrame, type VerificationSession } from './model';
import { useVerification } from './VerificationProvider';

export function useVerificationStream(session: VerificationSession, image: RefObject<HTMLImageElement | null>, surface: RefObject<HTMLDivElement | null>) {
  const context = useVerification();
  const [frame, setFrame] = useState<(VerificationFrame & { url: string })>();
  const [connectionId, setConnectionId] = useState<string>(), [error, setError] = useState('');
  const socket = useRef<WebSocket | undefined>(undefined), latest = useRef(session); latest.current = session;
  const control = useRef({ connectionId: '', sessionId: '', ready: false });
  const acknowledge = useRef<(frame: VerificationFrame) => void>(() => undefined);
  const { api, clientId, baseUrl, update } = context ?? {};
  const streamable = ['preparing', 'priority_wait', 'human_active', 'auto_active'].includes(session.state);
  useEffect(() => {
    if (!api || !clientId || !update || !streamable) return;
    setError('');
    let stopped = false, connecting = false, reconnect: ReturnType<typeof setTimeout> | undefined;
    let focused = document.hasFocus();
    let metadata: VerificationFrame | undefined, currentUrl: string | undefined, decoding = 0, acking = false, acknowledged = false;
    let presentationGeneration = 0, displayedFrame: VerificationFrame | undefined;
    const id = session.id;
    const clearImage = () => { decoding++; presentationGeneration++; displayedFrame = undefined; if (currentUrl) URL.revokeObjectURL(currentUrl); currentUrl = undefined; setFrame(undefined); };
    const fail = (connection?: WebSocket) => {
      if (stopped || connection && socket.current !== connection) return;
      setError('验证画面连接中断，正在尝试重新连接。'); control.current.ready = false;
    };
    const command = async (action: string, body: Record<string, unknown>) => {
      const next = await api.command(id, action, { clientInstanceId: clientId, connectionId: control.current.connectionId, ...body });
      if (!stopped) update(next); return next;
    };
    acknowledge.current = async incoming => {
      displayedFrame = incoming;
      if (stopped || !focused || acking || acknowledged || socket.current?.readyState !== WebSocket.OPEN || !panelVisible(image.current)) return;
      const generation = presentationGeneration, connection = socket.current;
      acking = true;
      try {
        const next = await command('presentation', { action: 'ack', frameId: incoming.frameId });
        if (stopped || generation !== presentationGeneration || connection !== socket.current) return;
        acknowledged = true; control.current.ready = true; setError('');
        if (next.state === 'human_active' && next.controller?.clientId === clientId && next.reconnectDeadline) {
          await command('claim', { action: 'resume', expectedVersion: next.version, frameId: incoming.frameId });
        }
      } catch { if (!stopped && generation === presentationGeneration && connection === socket.current) setError('画面确认未完成，正在刷新验证状态。'); }
      finally {
        acking = false;
        // The new image may have loaded while an obsolete HTTP ACK was in
        // flight. Its load event must not be lost behind that old request.
        if (!stopped && generation !== presentationGeneration && displayedFrame) void acknowledge.current(displayedFrame);
      }
    };
    const connect = async () => {
      if (stopped || connecting || !focused || document.visibilityState !== 'visible' || !document.hasFocus() || terminal(latest.current)) return;
      connecting = true;
      try {
        await api.command(id, 'presentation', { action: 'reserve', clientInstanceId: clientId });
        if (stopped) return;
        const ws = new WebSocket(verificationSocketUrl(`/api/v1/verification-sessions/${encodeURIComponent(id)}/stream?clientInstanceId=${encodeURIComponent(clientId)}`, baseUrl));
        ws.binaryType = 'blob'; socket.current = ws; acknowledged = false; metadata = undefined;
        ws.onmessage = event => {
          if (stopped || socket.current !== ws) return;
          if (typeof event.data === 'string') {
            try {
              const payload = JSON.parse(event.data);
              if (payload.type === 'hello') { control.current = { connectionId: payload.connectionId, sessionId: id, ready: false }; setConnectionId(payload.connectionId); }
              if (payload.session) update(payload.session);
              if (payload.type === 'frame') metadata = payload;
              if (payload.type === 'clear') { clearImage(); control.current.ready = false; acknowledged = false; }
              if (payload.type === 'input-ack' && !payload.accepted) setError('操作未被接纳，请等待新画面并重新确认控制权。');
            } catch { fail(); ws.close(); }
            return;
          }
          const info = metadata; metadata = undefined;
          if (!(event.data instanceof Blob) || !info || event.data.size !== info.byteLength || event.data.size > 250_000) { fail(); ws.close(); return; }
          const generation = ++decoding, url = URL.createObjectURL(event.data), decoder = new Image();
          decoder.onload = () => {
            if (stopped || generation !== decoding || socket.current !== ws) { URL.revokeObjectURL(url); return; }
            const old = currentUrl; currentUrl = url; setFrame({ ...info, url }); if (old) URL.revokeObjectURL(old);
          };
          decoder.onerror = () => { URL.revokeObjectURL(url); if (!stopped && socket.current === ws && generation === decoding) setError('验证画面加载失败，请重试连接。'); };
          decoder.src = url;
        };
        ws.onclose = () => {
          if (socket.current !== ws) return;
          socket.current = undefined; control.current = { connectionId: '', sessionId: '', ready: false }; setConnectionId(undefined); clearImage(); connecting = false;
          if (!stopped && !terminal(latest.current)) { fail(); reconnect = setTimeout(() => { void connect(); }, 500); }
        };
        ws.onerror = () => fail(ws);
      } catch { connecting = false; if (!stopped) { fail(); reconnect = setTimeout(() => { void connect(); }, 500); } }
    };
    const visibility = () => {
      if (!focused || document.visibilityState !== 'visible' || !document.hasFocus()) { control.current.ready = false; socket.current?.close(); }
      else void connect();
    };
    const blur = () => { focused = false; visibility(); };
    const focus = () => { focused = true; visibility(); };
    const renewal = setInterval(() => {
      if (terminal(latest.current)) { socket.current?.close(); return; }
      // A server clear revokes the old frame, not the visible presentation.
      // Keep this connection while a fresh frame is being produced. An actual
      // hidden/covered panel still releases control through socket cleanup.
      if (!panelVisible(image.current ?? surface.current)) { control.current.ready = false; socket.current?.close(); return; }
      if (!socket.current) { void connect(); return; }
      const connection = socket.current;
      if (acknowledged) void command('presentation', { action: 'reserve' }).catch(() => fail(connection));
    }, 2_000);
    void connect(); document.addEventListener('visibilitychange', visibility); window.addEventListener('blur', blur); window.addEventListener('focus', focus);
    return () => {
      stopped = true; acknowledge.current = () => undefined;
      control.current = { connectionId: '', sessionId: '', ready: false }; setConnectionId(undefined);
      clearInterval(renewal); if (reconnect) clearTimeout(reconnect); document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('blur', blur); window.removeEventListener('focus', focus);
      socket.current?.close(); socket.current = undefined; clearImage();
    };
  }, [api, clientId, baseUrl, update, session.id, image, surface, streamable]);
  const displayed = useCallback(() => { if (frame) acknowledge.current(frame); }, [frame]);
  const send = useCallback((action: 'down' | 'move' | 'up', x: number, y: number) => {
    if (!context || !frame || !control.current.ready || control.current.sessionId !== session.id || socket.current?.readyState !== WebSocket.OPEN
      || action !== 'up' && !panelVisible(image.current)) return false;
    const current = latest.current;
    if (current.state !== 'human_active' || current.controller?.clientId !== context.clientId) return false;
    const sequence = context.nextSequence(session.id);
    socket.current.send(JSON.stringify({ type: 'pointer', commandId: crypto.randomUUID(), controlEpoch: current.controlEpoch,
      frameId: frame.frameId, streamEpoch: frame.streamEpoch, geometryRevision: frame.geometryRevision, sequence, action, x, y }));
    return true;
  }, [context, frame, session.id, image]);
  const adopt = useCallback((next: VerificationSession) => { latest.current = next; }, []);
  return { frame, connectionId, error: streamable ? error : '', displayed, send, adopt, ready: control.current.ready };
}
