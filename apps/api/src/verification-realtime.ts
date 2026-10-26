import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import { parseCookies } from './http.js';
import { VerificationError, type VerificationSession } from './verification-domain.js';
import { realtimeSessionAccess } from './realtime-session-access.js';
import type { VerificationRuntime } from './verification-runtime.js';
import { verificationInputRejectionCode } from './verification-input-error.js';

const clientIdPattern = /^[a-zA-Z0-9_-]{16,100}$/;
export function verificationClientId(value: unknown): string {
  if (typeof value !== 'string' || !clientIdPattern.test(value)) throw new VerificationError('VERIFICATION_CLIENT_INVALID', 422);
  return value;
}
interface Stream {
  id: string; sessionId: string; clientId: string; authSessionId: string; adminId: string; socket: WebSocket;
  frames: Map<string, number>; lastInputAt: number;
}
export class VerificationRealtime {
  private readonly server = new WebSocketServer({ noServer: true, maxPayload: 16_384, perMessageDeflate: false });
  private readonly streams = new Map<string, Stream>();
  private readonly viewers = new Map<string, { socket: WebSocket; authSessionId: string; adminId: string }>();
  constructor(readonly runtime: VerificationRuntime) {}
  bound(connectionId: unknown, sessionId: string, adminId: string, authSessionId: string, clientId: string) {
    const stream = typeof connectionId === 'string' ? this.streams.get(connectionId) : undefined;
    if (!stream || stream.socket.readyState !== WebSocket.OPEN || stream.sessionId !== sessionId || stream.adminId !== adminId
      || stream.authSessionId !== authSessionId || stream.clientId !== clientId) throw new VerificationError('VERIFICATION_CONNECTION_CHANGED');
    return stream;
  }
  displayed(stream: Stream, frameId: unknown) {
    if (typeof frameId !== 'string' || Date.now() - (stream.frames.get(frameId) ?? 0) >= 2_000) throw new VerificationError('VERIFICATION_FRAME_STALE');
    return frameId;
  }
  async upgrade(request: IncomingMessage, socket: Duplex, head: Buffer) {
    const reject = (status: number) => { socket.end(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\n\r\n`); };
    try {
      const origin = request.headers.origin;
      if (!origin || !this.runtime.config.webSocketAllowedOrigins.includes(origin)) { reject(403); return; }
      const sessionId = parseCookies(request.headers.cookie).session_id;
      const access = await this.runtime.auth.accessFromSession(sessionId);
      if (!access) { reject(401); return; }
      const url = new URL(request.url!, 'http://verification');
      const match = /^\/api\/v1\/verification-sessions\/([^/]+)\/stream$/.exec(url.pathname);
      const clientId = verificationClientId(url.searchParams.get('clientInstanceId'));
      if (match) {
        const row = await this.runtime.coordinator.snapshot(match[1], access.admin.id);
        if (row.presentation?.clientId !== clientId || row.presentation.until <= Date.now()) throw new VerificationError('VERIFICATION_PRESENTATION_EXPIRED');
      } else if (url.pathname !== '/api/v1/verification-events') { reject(404); return; }
      this.server.handleUpgrade(request, socket, head, ws => {
        if (match) void this.stream(ws, match[1], clientId, access.admin.id, sessionId!).catch(() => ws.close(1008, 'verification unavailable'));
        else void this.events(ws, clientId, access.admin.id, sessionId!).catch(() => ws.close(1008, 'verification unavailable'));
      });
    } catch (error) { reject(error instanceof VerificationError ? error.statusCode : 503); }
  }
  private send(socket: WebSocket, value: unknown, finalAccess?: () => boolean) {
    if (finalAccess && !finalAccess()) return;
    if (socket.readyState !== WebSocket.OPEN) return;
    if (socket.bufferedAmount > 1_048_576) { socket.close(1013, 'slow verification consumer'); return; }
    socket.send(JSON.stringify(value));
  }
  private streamFailure(socket: WebSocket) {
    socket.close(1008, 'verification unavailable');
  }
  private async events(socket: WebSocket, clientId: string, adminId: string, authSessionId: string) {
    const previous = this.viewers.get(clientId);
    if (previous && (previous.adminId !== adminId || previous.authSessionId !== authSessionId)) { socket.close(1008, 'client identity occupied'); return; }
    previous?.socket.close(1008, 'client replaced');
    const viewer = { socket, adminId, authSessionId }; this.viewers.set(clientId, viewer);
    let initializing = true; let closed = false; const buffered = new Map<string, VerificationSession>();
    const versions = new Map<string, number>(); let flushing = false;
    const access = realtimeSessionAccess(async () => !!await this.runtime.auth.accessFromSession(authSessionId), () => socket.close(1008, 'session expired'));
    const deliver = async (row: VerificationSession) => {
      if (closed || !await access.check() || !await this.runtime.authorize(row.subject, adminId) || row.eventSequence <= (versions.get(row.id) ?? 0)) return;
      const session = await this.runtime.dto(row);
      if (closed || !await access.check() || !await this.runtime.authorize(row.subject, adminId)) return;
      versions.set(row.id, row.eventSequence);
      this.send(socket, { type: 'session.updated', sessionId: row.id, eventSequence: row.eventSequence, session }, access.current);
    };
    const flush = async () => {
      if (flushing || initializing) return;
      flushing = true;
      try { while (buffered.size && !closed) { const [id, row] = buffered.entries().next().value!; buffered.delete(id); await deliver(row); } }
      catch { socket.close(1008, 'verification unavailable'); }
      finally { flushing = false; }
    };
    const listener = (row: VerificationSession) => {
      buffered.set(row.id, row);
      if (buffered.size > 200) { socket.close(1013, 'snapshot overflow'); return; }
      void flush();
    };
    this.runtime.coordinator.events.on('updated', listener);
    socket.on('close', () => {
      closed = true; access.stop(); this.runtime.coordinator.events.off('updated', listener);
      if (this.viewers.get(clientId) === viewer) { this.viewers.delete(clientId); this.runtime.coordinator.disconnect(clientId); }
    });
    socket.on('error', () => socket.close());
    let presenceBusy = false;
    socket.on('message', (raw, binary) => {
      if (binary || Buffer.byteLength(raw as any) > 1024 || presenceBusy) return;
      presenceBusy = true;
      void (async () => {
        const message = JSON.parse(raw.toString());
        if (message.type !== 'presence' || message.clientInstanceId !== clientId || typeof message.visible !== 'boolean' || !await access.check()) return;
        this.runtime.coordinator.presence(adminId, clientId, message.visible);
        this.send(socket, { type: 'presence-ack', serverTime: Date.now() });
      })().catch(() => socket.close(1008, 'invalid presence')).finally(() => { presenceBusy = false; });
    });
    const snapshot = await this.runtime.list(adminId, true);
    if (closed || !await access.check()) return;
    const visible = [];
    for (const row of snapshot.sessions) {
      try { await this.runtime.coordinator.snapshot(row.id, adminId); visible.push(row); versions.set(row.id, row.eventSequence); } catch { /* authorization changed during DTO creation */ }
    }
    if (closed || !await access.check()) return;
    this.send(socket, { type: 'snapshot', ...snapshot, sessions: visible }, access.current); initializing = false;
    void flush();
  }
  private async stream(socket: WebSocket, sessionId: string, clientId: string, adminId: string, authSessionId: string) {
    const previous = [...this.streams.values()].find(value => value.sessionId === sessionId && value.socket.readyState !== WebSocket.CLOSED);
    if (previous) { socket.close(1008, 'presentation stream occupied'); return; }
    const stream: Stream = { id: randomUUID(), socket, sessionId, clientId, adminId, authSessionId, frames: new Map(), lastInputAt: 0 };
    this.streams.set(stream.id, stream); let closed = false; let pendingInputs = 0; let inputTail = Promise.resolve();
    const commands = new Map<string, { fingerprint: string; result: unknown }>(); let bytesAt = Date.now(); let bytes = 0;
    const access = realtimeSessionAccess(async () => {
      if (!await this.runtime.auth.accessFromSession(authSessionId)) return false;
      const row = await this.runtime.coordinator.snapshot(sessionId, adminId);
      return await this.runtime.authorize(row.subject, adminId) && !!await this.runtime.auth.accessFromSession(authSessionId);
    }, () => socket.close(1008, 'verification access expired'));
    const cleanup = () => { closed = true; access.stop(); this.streams.delete(stream.id); this.runtime.coordinator.events.off('updated', status);
      this.runtime.coordinator.events.off('stream-invalidated', invalidated); this.runtime.coordinator.disconnect(clientId, stream.id); };
    let pendingStatus: VerificationSession | undefined; let statusFlushing = false;
    const flushStatus = async () => {
      if (statusFlushing) return;
      statusFlushing = true;
      try {
        while (pendingStatus && !closed) {
          const row = pendingStatus; pendingStatus = undefined;
          if (!await access.check()) return;
          const session = await this.runtime.dto(row);
          if (!closed && await access.check()) this.send(socket, { type: 'session.updated', sessionId, eventSequence: row.eventSequence, session }, access.current);
        }
      } catch { this.streamFailure(socket); }
      finally { statusFlushing = false; }
    };
    const status = (row: VerificationSession) => {
      if (row.id !== sessionId || closed) return;
      pendingStatus = row; void flushStatus();
    };
    const invalidated = (event: { sessionId: string; streamEpoch: number }) => { if (event.sessionId === sessionId) { stream.frames.clear(); this.send(socket, { type: 'clear', streamEpoch: event.streamEpoch }); } };
    this.runtime.coordinator.events.on('updated', status); this.runtime.coordinator.events.on('stream-invalidated', invalidated);
    socket.on('close', cleanup); socket.on('error', () => socket.close());
    const session = await this.runtime.dto(await this.runtime.coordinator.snapshot(sessionId, adminId));
    if (closed || !await access.check()) return;
    this.send(socket, { type: 'hello', connectionId: stream.id, session, serverTime: Date.now() }, access.current);
    socket.on('message', (raw, binary) => {
      if (binary || Buffer.byteLength(raw as any) > 2048 || ++pendingInputs > 16) { socket.close(1008, 'input queue exceeded'); return; }
      inputTail = inputTail.then(async () => {
        let message: any;
        try {
          if (closed || !access.current() && !await access.check()) return;
          message = JSON.parse(raw.toString());
          if (!['down', 'move', 'up'].includes(message.action) || message.type !== 'pointer' || typeof message.commandId !== 'string' || !clientIdPattern.test(message.commandId)) throw new VerificationError('VERIFICATION_INPUT_INVALID', 422);
          const fingerprint = JSON.stringify(message); const prior = commands.get(message.commandId);
          if (prior) { if (prior.fingerprint !== fingerprint) throw new VerificationError('VERIFICATION_COMMAND_REUSED'); this.send(socket, prior.result); return; }
          if (message.action === 'move' && Date.now() - stream.lastInputAt < 12) await new Promise(resolve => setTimeout(resolve, 12 - (Date.now() - stream.lastInputAt)));
          stream.lastInputAt = Date.now();
          if (!await access.check()) return;
          await this.runtime.coordinator.pointer(sessionId, { adminId, authSessionId, clientId, connectionId: stream.id, epoch: message.controlEpoch },
            { type: message.action, x: message.x, y: message.y, frameId: message.frameId, streamEpoch: message.streamEpoch, geometryRevision: message.geometryRevision, sequence: message.sequence }, () => access.check());
          const result = { type: 'input-ack', commandId: message.commandId, sequence: message.sequence, accepted: true };
          commands.set(message.commandId, { fingerprint, result }); if (commands.size > 128) commands.delete(commands.keys().next().value!);
          this.send(socket, result);
        } catch (error) {
          const reason = verificationInputRejectionCode(error);
          this.send(socket, { type: 'input-ack', commandId: message?.commandId, sequence: message?.sequence, accepted: false, reason });
        }
      }).finally(() => { pendingInputs--; });
    });
    const pump = async () => {
      try {
        if (closed || !await access.check()) return;
        const row = await this.runtime.coordinator.snapshot(sessionId, adminId);
        if (row.presentation?.clientId !== clientId || row.presentation.until <= Date.now()) { socket.close(1008, 'presentation expired'); return; }
        const frame = socket.bufferedAmount <= 1_048_576 ? await this.runtime.coordinator.frame(sessionId, adminId, clientId) : undefined;
        if (Date.now() - bytesAt >= 1000) { bytesAt = Date.now(); bytes = 0; }
        if (frame && frame.image.length <= 250_000 && bytes + frame.image.length <= 2_000_000 && await access.check()) {
          await this.runtime.coordinator.sendFrame(sessionId, adminId, clientId, frame, () => {
            if (closed || !access.current() || socket.readyState !== WebSocket.OPEN || socket.bufferedAmount > 1_048_576) return;
            const { image, ...metadata } = frame;
            this.send(socket, { type: 'frame', sessionId, ...metadata, mime: 'image/jpeg', byteLength: image.length });
            socket.send(image, { binary: true }); bytes += image.length;
            stream.frames.set(frame.frameId, frame.capturedAt); for (const [id, at] of stream.frames) if (Date.now() - at >= 2000) stream.frames.delete(id);
          }, access.check, access.current);
        }
        if (!closed) setTimeout(() => { void pump(); }, row.state === 'human_active' ? 100 : 500).unref();
      } catch { this.streamFailure(socket); }
    };
    void pump();
  }
  async close() { for (const socket of this.server.clients) socket.terminate(); await new Promise<void>(resolve => this.server.close(() => resolve())); }
}
