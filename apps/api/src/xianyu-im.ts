import crypto from 'node:crypto';
import { WebSocket } from 'ws';

export const XIANYU_IM_WS_URL = 'wss://wss-goofish.dingtalk.com/';
export const XIANYU_IM_TOKEN_API = 'mtop.taobao.idlemessage.pc.login.token';
export const XIANYU_IM_APP_KEY = '34839810';
export const XIANYU_IM_APP_ID = '444e9908a51d1cb236a27862abc769c9';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36';

export type XianyuImConnectionStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'failed';

export interface XianyuImCredential {
  cookieHeader: string;
  accessToken?: string;
  deviceId?: string;
}

export interface XianyuImConversationPage {
  hasMore?: boolean;
  nextCursor?: string | number;
  userConvs?: unknown[];
  [key: string]: unknown;
}

export interface XianyuImMessagePage {
  hasMore?: boolean;
  nextCursor?: string | number;
  userMessageModels?: unknown[];
  [key: string]: unknown;
}

export interface XianyuImMessageEvent {
  accountId: string;
  externalConversationRef: string;
  externalMessageRef: string;
  senderRef: string;
  senderName?: string;
  direction: 'inbound' | 'outbound';
  bodyType: 'text' | 'image' | 'system';
  bodyText?: string;
  assetRef?: string;
  occurredAt: string;
  receivedAt?: string;
  timestampQuality?: 'platform' | 'received';
  externalMessageRefAliases?: string[];
  sourceEventId?: string;
  sourceSequence?: number;
  riskFlags?: string[];
  raw?: Record<string, unknown>;
}

export interface XianyuImQuarantineEvent {
  accountId: string;
  reasonCode: string;
  payloadDigest: string;
  payloadPreview?: string;
  payloadSize: number;
  receivedAt: string;
}

/**
 * Platform 40103 read receipt. The compact payload uses numeric keys while
 * some gateways wrap the same event in a JSON object with named fields.
 */
export interface XianyuImReadReceipt {
  externalMessageRef?: string;
  externalConversationRef?: string;
  readAt: number;
}

export interface XianyuImReadReceiptEvent extends XianyuImReadReceipt {
  accountId: string;
  kind: 'read';
}

export type XianyuImEvent = XianyuImMessageEvent | XianyuImReadReceiptEvent;

interface ImWebSocket {
  readyState: number;
  send(data: string): void;
  close(): void;
  on(event: 'open' | 'message' | 'close' | 'error', listener: (...args: any[]) => void): this;
  once?(event: 'open' | 'close' | 'error', listener: (...args: any[]) => void): this;
  removeListener?(event: 'open' | 'message' | 'close' | 'error', listener: (...args: any[]) => void): this;
}

export interface XianyuImClientOptions {
  accountId: string;
  credential: XianyuImCredential;
  timeoutMs?: number;
  heartbeatIntervalMs?: number;
  fetch?: typeof fetch;
  webSocketFactory?: (url: string, options: { headers: Record<string, string> }) => ImWebSocket;
  saveCredential?: (credential: XianyuImCredential) => Promise<void>;
  onEvent?: (event: XianyuImEvent) => Promise<void> | void;
  onQuarantine?: (event: XianyuImQuarantineEvent) => Promise<void> | void;
}

export class XianyuImRequestRejected extends Error {
  readonly code: number;

  constructor(message: string, code: number) {
    super(message);
    this.name = 'XianyuImRequestRejected';
    this.code = code;
  }
}

interface PendingRequest {
  resolve: (value: Record<string, unknown>) => void;
  reject: (reason?: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class XianyuImClient {
  private readonly accountId: string;
  private credential: XianyuImCredential;
  private readonly timeoutMs: number;
  private readonly heartbeatIntervalMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly webSocketFactory: NonNullable<XianyuImClientOptions['webSocketFactory']>;
  private readonly saveCredential?: XianyuImClientOptions['saveCredential'];
  private readonly onEvent?: XianyuImClientOptions['onEvent'];
  private readonly onQuarantine?: XianyuImClientOptions['onQuarantine'];
  private readonly pending = new Map<string, PendingRequest>();
  private socket?: ImWebSocket;
  private heartbeatTimer?: ReturnType<typeof setInterval>;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private reconnectAttempt = 0;
  private reconnectEnabled = true;
  private connectionGeneration = 0;
  private connectPromise?: Promise<void>;
  private syncStatePromise?: Promise<void>;
  private incomingChain: Promise<void> = Promise.resolve();
  private myId: string;
  private _status: XianyuImConnectionStatus = 'idle';

  constructor(options: XianyuImClientOptions) {
    this.accountId = options.accountId;
    this.credential = { ...options.credential };
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 15_000;
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.webSocketFactory = options.webSocketFactory ?? ((url, wsOptions) => new WebSocket(url, wsOptions) as unknown as ImWebSocket);
    this.saveCredential = options.saveCredential;
    this.onEvent = options.onEvent;
    this.onQuarantine = options.onQuarantine;
    this.myId = cookieValue(this.credential.cookieHeader, 'unb') || cookieValue(this.credential.cookieHeader, 'munb') || '';
    if (!this.credential.deviceId) this.credential.deviceId = createDeviceId(this.myId);
  }

  get status(): XianyuImConnectionStatus { return this._status; }
  get connected(): boolean { return this._status === 'connected' && this.socket?.readyState === 1; }
  get deviceId(): string { return this.credential.deviceId ?? ''; }
  get userId(): string { return this.myId; }

  async connect(): Promise<void> {
    this.reconnectEnabled = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    if (this.connected) return;
    if (this.connectPromise) return this.connectPromise;
    this.connectPromise = this.connectInternal();
    try {
      await this.connectPromise;
    } finally {
      this.connectPromise = undefined;
    }
  }

  async disconnect(): Promise<void> {
    this.reconnectEnabled = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this._status = 'disconnected';
    await this.cleanupSocket();
  }

  async listConversations(startCursor?: number, limit = 20): Promise<XianyuImConversationPage> {
    const start = startCursor ?? Number.MAX_SAFE_INTEGER;
    const response = await this.sendLwp('/r/Conversation/listNewestPagination', [start, clampLimit(limit)]);
    return asRecord(response.body) as XianyuImConversationPage;
  }

  async listMessages(conversationRef: string, startCursor?: number, limit = 20): Promise<XianyuImMessagePage> {
    const cid = conversationRef.includes('@goofish') ? conversationRef : `${conversationRef}@goofish`;
    const start = startCursor ?? Number.MAX_SAFE_INTEGER;
    const response = await this.sendLwp('/r/MessageManager/listUserMessages', [cid, false, start, clampLimit(limit), false]);
    return asRecord(response.body) as XianyuImMessagePage;
  }

  async markRead(messageRefs: string[]): Promise<void> {
    const ids = [...new Set(messageRefs.map((value) => value.trim()).filter(Boolean))];
    if (ids.length === 0) return;
    await this.sendLwp('/r/MessageStatus/read', [ids]);
  }

  async sendText(conversationRef: string, recipientRef: string, text: string, requestId?: string): Promise<{ externalMessageRef?: string }> {
    const normalizedText = text.trim();
    const cid = stripGoofish(conversationRef);
    const toId = stripGoofish(recipientRef);
    if (!cid || !toId || !normalizedText) throw new Error('XIANYU_IM_SEND_INPUT_INVALID');
    if (!this.myId) throw new Error('XIANYU_IM_SENDER_ID_MISSING');
    const content = Buffer.from(JSON.stringify({ contentType: 1, text: { text: normalizedText } }), 'utf8').toString('base64');
    const response = await this.sendLwp('/r/MessageSend/sendByReceiverScope', [
      {
        uuid: requestId ? deterministicUuid(requestId) : crypto.randomUUID(),
        cid: `${cid}@goofish`,
        conversationType: 1,
        content: { contentType: 101, custom: { type: 1, data: content } },
        redPointPolicy: 0,
        extension: { extJson: '{}' },
        ctx: { appVersion: '1.0', platform: 'web' },
        mtags: {},
        msgReadStatusSetting: 1,
      },
      { actualReceivers: [`${toId}@goofish`, `${this.myId}@goofish`] },
    ], { retryAfterReconnect: false });
    assertSendAccepted(response);
    const body = asRecord(response.body);
    const externalMessageRef = extractMessageRef(body);
    return { externalMessageRef };
  }

  async sendImage(conversationRef: string, recipientRef: string, imageUrl: string, width = 800, height = 600): Promise<{ externalMessageRef?: string }> {
    const cid = stripGoofish(conversationRef);
    const toId = stripGoofish(recipientRef);
    const normalizedUrl = imageUrl.trim();
    if (!cid || !toId || !normalizedUrl) throw new Error('XIANYU_IM_SEND_IMAGE_INPUT_INVALID');
    if (!this.myId) throw new Error('XIANYU_IM_SENDER_ID_MISSING');
    const content = Buffer.from(JSON.stringify({ contentType: 2, image: { pics: [{ height: height > 0 ? height : 600, type: 0, url: normalizedUrl, width: width > 0 ? width : 800 }] } }), 'utf8').toString('base64');
    const response = await this.sendLwp('/r/MessageSend/sendByReceiverScope', [
      {
        uuid: crypto.randomUUID(),
        cid: `${cid}@goofish`,
        conversationType: 1,
        content: { contentType: 101, custom: { type: 1, data: content } },
        redPointPolicy: 0,
        extension: { extJson: '{}' },
        ctx: { appVersion: '1.0', platform: 'web' },
        mtags: {},
        msgReadStatusSetting: 1,
      },
      { actualReceivers: [`${toId}@goofish`, `${this.myId}@goofish`] },
    ], { retryAfterReconnect: false });
    assertSendAccepted(response);
    const body = asRecord(response.body);
    return { externalMessageRef: extractMessageRef(body) };
  }

  private async connectInternal(): Promise<void> {
    this._status = this._status === 'disconnected' ? 'reconnecting' : 'connecting';
    try {
      if (!this.credential.accessToken) await this.refreshToken();
      const socket = this.webSocketFactory(XIANYU_IM_WS_URL, {
        headers: {
          Cookie: this.credential.cookieHeader,
          Origin: 'https://www.goofish.com',
          'User-Agent': USER_AGENT,
        },
      });
      this.socket = socket;
      socket.on('message', (raw: unknown) => {
        this.incomingChain = this.incomingChain.then(() => this.handleIncoming(raw)).catch((error) => {
          console.warn(JSON.stringify({ component: 'xianyu-im-listener', event: 'frame_processing_failed', accountId: this.accountId, errorCode: eventErrorCode(error) }));
        });
      });
      socket.on('close', () => {
        if (this.socket !== socket) return;
        this.socket = undefined;
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = undefined;
        this.rejectPending('xianyu IM connection closed');
        if (this._status !== 'failed') this._status = 'disconnected';
        this.scheduleReconnect();
      });
      socket.on('error', () => {
        if (this.socket === socket && this._status === 'connecting') this._status = 'failed';
      });
      await waitForSocketOpen(socket, this.timeoutMs);
      const registrationMid = createMid();
      await this.sendAndWait(registrationMid, {
        lwp: '/reg',
        headers: {
          'cache-header': 'app-key token ua wv',
          'app-key': XIANYU_IM_APP_ID,
          token: decodeURIComponent(this.credential.accessToken ?? ''),
          ua: `${USER_AGENT} DingTalk(2.1.5) OS(Windows/10) Browser(Chrome/139.0.0.0) DingWeb/2.1.5`,
          dt: 'j',
          wv: 'im:3,au:3,sy:6',
          sync: '0,0;0;0;',
          did: this.deviceId,
          mid: registrationMid,
        },
      }, 5_000);
      this._status = 'connected';
      this.reconnectAttempt = 0;
      this.connectionGeneration += 1;
      this.heartbeatTimer = setInterval(() => {
        if (!this.connected) return;
        try { this.sendRaw({ lwp: '/!', headers: { mid: createMid() } }); } catch { /* close handler exposes status */ }
      }, this.heartbeatIntervalMs);
    } catch (error) {
      this._status = 'failed';
      await this.cleanupSocket();
      this._status = 'failed';
      this.scheduleReconnect();
      throw error;
    }
  }

  private async cleanupSocket(): Promise<void> {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = undefined;
    this.syncStatePromise = undefined;
    this.rejectPending('xianyu IM connection closed');
    const socket = this.socket;
    this.socket = undefined;
    if (socket && socket.readyState !== 3) socket.close();
  }

  private rejectPending(message: string): void {
    for (const [mid, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error(message));
      this.pending.delete(mid);
    }
  }

  private scheduleReconnect(): void {
    if (!this.reconnectEnabled || this.reconnectTimer || this.connectPromise) return;
    const delayMs = Math.min(30_000, 500 * 2 ** Math.min(this.reconnectAttempt, 6));
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.connect().catch(() => undefined);
    }, delayMs);
  }

  private async refreshToken(): Promise<void> {
    const token = cookieValue(this.credential.cookieHeader, '_m_h5_tk').split('_', 1)[0] ?? '';
    if (!token) throw new Error('XIANYU_IM_TOKEN_MISSING');
    const timestamp = String(Date.now());
    const data = JSON.stringify({ appKey: XIANYU_IM_APP_ID, deviceId: this.deviceId });
    const params = new URLSearchParams({
      jsv: '2.7.2', appKey: XIANYU_IM_APP_KEY, t: timestamp, sign: md5(`${token}&${timestamp}&${XIANYU_IM_APP_KEY}&${data}`),
      v: '1.0', type: 'originaljson', accountSite: 'xianyu', dataType: 'json', timeout: '20000', api: XIANYU_IM_TOKEN_API,
      sessionOption: 'AutoLoginOnly', spm_cnt: 'a21ybx.im.0.0',
    });
    const response = await this.fetchImpl(`https://h5api.m.goofish.com/h5/${XIANYU_IM_TOKEN_API}/1.0/?${params.toString()}`, {
      method: 'POST', headers: {
        accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded', origin: 'https://www.goofish.com',
        referer: 'https://www.goofish.com/', 'user-agent': USER_AGENT, cookie: this.credential.cookieHeader,
      }, body: new URLSearchParams({ data }).toString(), signal: AbortSignal.timeout(this.timeoutMs),
    });
    const payload = await response.json() as Record<string, unknown>;
    const ret = Array.isArray(payload.ret) ? payload.ret.map(String) : [];
    const accessToken = asRecord(payload.data).accessToken;
    if (!ret.some((value) => value.includes('SUCCESS::')) || typeof accessToken !== 'string' || !accessToken) {
      throw new Error(`XIANYU_IM_TOKEN_FAILED:${ret[0] ?? 'unknown'}`);
    }
    this.credential.accessToken = accessToken;
    const setCookies = getSetCookies(response.headers);
    if (setCookies.length > 0) this.credential.cookieHeader = mergeCookies(this.credential.cookieHeader, setCookies);
    await this.saveCredential?.({ ...this.credential });
  }

  private async sendLwp(lwp: string, body: unknown[], options: { retryAfterReconnect?: boolean } = {}): Promise<Record<string, unknown>> {
    const retryAfterReconnect = options.retryAfterReconnect ?? true;
    if (!this.connected) await this.connect();
    const generation = this.connectionGeneration;
    const mid = createMid();
    try {
      return await this.sendAndWait(mid, { lwp, headers: { mid }, body });
    } catch (error) {
      if (!retryAfterReconnect || !(error instanceof XianyuImRequestRejected) || error.code !== 400) throw error;
      if (this.connectionGeneration === generation) {
        await this.disconnect();
        this.credential.accessToken = undefined;
        await this.connect();
      }
      const retryMid = createMid();
      return this.sendAndWait(retryMid, { lwp, headers: { mid: retryMid }, body });
    }
  }

  private sendRaw(message: Record<string, unknown>): void {
    if (!this.socket || this.socket.readyState !== 1) throw new Error('XIANYU_IM_NOT_CONNECTED');
    this.socket.send(JSON.stringify(message));
  }

  private async sendAndWait(mid: string, message: Record<string, unknown>, timeoutMs = this.timeoutMs): Promise<Record<string, unknown>> {
    if (!this.socket || this.socket.readyState !== 1) throw new Error('XIANYU_IM_NOT_CONNECTED');
    const response = new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(mid);
        reject(new Error(`XIANYU_IM_TIMEOUT:${String(message.lwp ?? 'unknown')}`));
      }, timeoutMs);
      this.pending.set(mid, { resolve, reject, timer });
    });
    this.socket.send(JSON.stringify(message));
    return response;
  }

  private async handleIncoming(raw: unknown): Promise<void> {
    const text = raw instanceof Uint8Array ? Buffer.from(raw).toString('utf8') : String(raw);
    let message: Record<string, unknown>;
    try { message = JSON.parse(text) as Record<string, unknown>; } catch {
      await this.emitQuarantine('INVALID_FRAME_JSON', text, new Date().toISOString());
      return;
    }
    const headers = asRecord(message.headers);
    const mid = typeof headers.mid === 'string' ? headers.mid : undefined;
    if (mid) {
      try { this.sendRaw({ code: 200, headers: { ...headers } }); } catch { /* socket may be closing */ }
    }
    if (mid && this.pending.has(mid)) {
      const pending = this.pending.get(mid)!;
      this.pending.delete(mid);
      clearTimeout(pending.timer);
      const code = typeof message.code === 'number' ? message.code : 200;
      if (code !== 200) pending.reject(new XianyuImRequestRejected(`XIANYU_IM_REQUEST_REJECTED:${code}`, code));
      else pending.resolve(message);
    }
    void this.handleSyncExtra(message).catch((error) => {
      if (this._status !== 'disconnected' && this._status !== 'failed') {
        console.warn(JSON.stringify({ component: 'xianyu-im-listener', event: 'sync_state_recovery_failed', accountId: this.accountId, errorCode: eventErrorCode(error) }));
      }
    });
    const body = asRecord(message.body);
    const sync = asRecord(body.syncPushPackage);
    const entries = Array.isArray(sync.data) ? sync.data : [];
    for (const entry of entries) {
      const encoded = asRecord(entry).data;
      if (typeof encoded !== 'string') continue;
      const readReceipt = parseReadReceiptPayload(decodePushData(encoded));
      if (readReceipt) {
        try {
          await this.onEvent?.({ ...readReceipt, accountId: this.accountId, kind: 'read' });
        } catch (error) {
          console.warn(JSON.stringify({ component: 'xianyu-im-listener', event: 'push_handler_failed', accountId: this.accountId, errorCode: eventErrorCode(error) }));
        }
        continue;
      }
      const parsed = parsePushPayloadDetailed(encoded, this.accountId, this.myId, new Date().toISOString(), asRecord(entry));
      if (parsed.quarantine) {
        await this.emitQuarantine(parsed.quarantine.reasonCode, encoded, parsed.quarantine.receivedAt);
      } else if (parsed.event) {
        try {
          await this.onEvent?.(parsed.event);
        } catch (error) {
          console.warn(JSON.stringify({ component: 'xianyu-im-listener', event: 'push_handler_failed', accountId: this.accountId, errorCode: eventErrorCode(error) }));
        }
      }
    }
  }

  private async emitQuarantine(reasonCode: string, payload: string, receivedAt: string): Promise<void> {
    const payloadDigest = crypto.createHash('sha256').update(payload).digest('hex');
    try {
      await this.onQuarantine?.({ accountId: this.accountId, reasonCode, payloadDigest, payloadPreview: payload.slice(0, 500), payloadSize: Buffer.byteLength(payload, 'utf8'), receivedAt });
    } catch (error) {
      console.warn(JSON.stringify({ component: 'xianyu-im-listener', event: 'quarantine_persist_failed', accountId: this.accountId, reasonCode, errorCode: eventErrorCode(error) }));
    }
  }

  private async handleSyncExtra(message: Record<string, unknown>): Promise<void> {
    const body = asRecord(message.body);
    const syncExtraType = asRecord(body.syncExtraType);
    const type = numericValue(syncExtraType.type);
    if (type !== 1 && type !== 2) return;
    if (this.syncStatePromise) return this.syncStatePromise;

    const promise = (async () => {
      const generation = this.connectionGeneration;
      const state = await this.sendLwp('/r/SyncStatus/getState', [{ topic: 'sync' }], { retryAfterReconnect: false });
      if (this.connectionGeneration !== generation) return;
      if (state.body === undefined || state.body === null) throw new Error('XIANYU_IM_SYNC_STATE_MISSING');
      await this.sendLwp('/r/SyncStatus/ackDiff', [state.body], { retryAfterReconnect: false });
    })();
    const wrapped = promise.finally(() => {
      if (this.syncStatePromise === wrapped) this.syncStatePromise = undefined;
    });
    this.syncStatePromise = wrapped;
    return wrapped;
  }
}

export class XianyuImSessionManager {
  private readonly sessions = new Map<string, XianyuImClient>();

  async connect(accountId: string, credential: XianyuImCredential, options: Omit<XianyuImClientOptions, 'accountId' | 'credential'> = {}): Promise<XianyuImClient> {
    await this.disconnect(accountId);
    const client = new XianyuImClient({ ...options, accountId, credential });
    this.sessions.set(accountId, client);
    try {
      await client.connect();
      return client;
    } catch (error) {
      this.sessions.delete(accountId);
      throw error;
    }
  }

  get(accountId: string): XianyuImClient | undefined { return this.sessions.get(accountId); }
  status(accountId: string): XianyuImConnectionStatus { return this.sessions.get(accountId)?.status ?? 'disconnected'; }

  async disconnect(accountId: string): Promise<void> {
    const client = this.sessions.get(accountId);
    if (!client) return;
    this.sessions.delete(accountId);
    await client.disconnect();
  }

  async close(): Promise<void> {
    const clients = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.all(clients.map((client) => client.disconnect()));
  }
}

export function parsePushPayload(encoded: string, accountId: string, myId: string): XianyuImMessageEvent | undefined {
  return parsePushPayloadDetailed(encoded, accountId, myId).event;
}

export function parsePushPayloadDetailed(encoded: string, accountId: string, myId: string, receivedAt = new Date().toISOString(), sourceEnvelope?: unknown): { event?: XianyuImMessageEvent; quarantine?: { reasonCode: string; receivedAt: string } } {
  const parsed = decodePushData(encoded);
  if (!parsed || typeof parsed !== 'object') return { quarantine: { reasonCode: 'PUSH_PAYLOAD_DECODE_FAILED', receivedAt } };
  const message = asRecord(parsed);
  const msg1 = asRecord(message['1']);
  const msg10 = asRecord(msg1['10']);
  const conversationRef = stripGoofish(typeof msg1['2'] === 'string' ? msg1['2'] : typeof message['2'] === 'string' ? message['2'] : '');
  const senderRef = stripGoofish(String(msg10.senderUserId ?? asRecord(msg1['1'])?.['1'] ?? ''));
  const senderName = optionalString(msg10.senderNick ?? msg10.reminderTitle);
  const extension = parseJsonObject(msg10.extJson);
  const reminderUrl = optionalString(msg10.reminderUrl);
  // The gateway can expose two ids for one chat message: a stable `.PNM`
  // message number in the compact envelope and a short-lived internal UUID
  // in extJson. Prefer the stable platform id so history sync and live push
  // resolve to the same local message and database uniqueness key.
  const externalMessageRefCandidates = uniqueStrings([
    msg1['3'],
    message['3'],
    parseQueryParam(reminderUrl, 'messageId'),
    extension.messageId,
  ]);
  const externalMessageRef = selectCanonicalMessageRef(...externalMessageRefCandidates);
  if (!conversationRef) return { quarantine: { reasonCode: 'PUSH_CONVERSATION_REF_MISSING', receivedAt } };
  if (!externalMessageRef) return { quarantine: { reasonCode: 'PUSH_MESSAGE_REF_MISSING', receivedAt } };
  if (!senderRef) return { quarantine: { reasonCode: 'PUSH_SENDER_REF_MISSING', receivedAt } };
  const sourceOrdering = extractSourceOrdering([sourceEnvelope, message, msg1, msg10, extension]);
  const decoded = decodeContent(msg1);
  const fallbackText = optionalString(msg10.reminderContent);
  const bodyType = decoded.images.length > 0 ? 'image' : decoded.text || fallbackText ? 'text' : 'system';
  const timestamp = normalizeTimestamp(msg1['5'] ?? message['5'], receivedAt);
  return { event: {
    accountId,
    externalConversationRef: conversationRef,
    externalMessageRef,
    senderRef,
    senderName,
    direction: senderRef === myId ? 'outbound' : 'inbound',
    bodyType,
    bodyText: decoded.text || fallbackText,
    assetRef: decoded.images[0],
    occurredAt: timestamp.value,
    ...(timestamp.quality === 'received' ? { receivedAt, timestampQuality: timestamp.quality, riskFlags: ['source_timestamp_invalid'] } : {}),
    ...(externalMessageRefCandidates.filter((value) => value !== externalMessageRef).length > 0 ? { externalMessageRefAliases: externalMessageRefCandidates.filter((value) => value !== externalMessageRef) } : {}),
    ...(sourceOrdering.sourceEventId ? { sourceEventId: sourceOrdering.sourceEventId } : {}),
    ...(sourceOrdering.sourceSequence !== undefined ? { sourceSequence: sourceOrdering.sourceSequence } : {}),
    raw: message,
  } };
}

const SOURCE_EVENT_ID_KEYS = new Set(['sourceeventid', 'eventid', 'sourceid', 'pushid', 'eventref']);
const SOURCE_SEQUENCE_KEYS = new Set(['sourcesequence', 'sourceseq', 'eventsequence', 'sequence', 'seq', 'offset', 'cursor']);

/**
 * Push gateways are not consistent about where transport ordering metadata is
 * placed. Search only explicitly named fields, keep the walk bounded, and do
 * not reinterpret arbitrary numeric payload values as ordering evidence.
 */
function extractSourceOrdering(values: unknown[]): { sourceEventId?: string; sourceSequence?: number } {
  const sourceEventId = values.map((value) => findStringByKey(value, SOURCE_EVENT_ID_KEYS)).find((value): value is string => Boolean(value));
  const sourceSequence = values.map((value) => findPositiveSafeIntegerByKey(value, SOURCE_SEQUENCE_KEYS)).find((value): value is number => value !== undefined);
  return { sourceEventId, sourceSequence };
}

function findStringByKey(value: unknown, keys: Set<string>, depth = 0): string | undefined {
  if (depth > 8 || value === null || value === undefined) return undefined;
  if (Array.isArray(value)) {
    for (const child of value) {
      const found = findStringByKey(child, keys, depth + 1);
      if (found) return found;
    }
    return undefined;
  }
  const object = asRecord(value);
  for (const [key, child] of Object.entries(object)) {
    if (keys.has(normalizeMetadataKey(key))) {
      const candidate = optionalString(typeof child === 'number' || typeof child === 'bigint' ? String(child) : child);
      if (candidate) return candidate;
    }
  }
  for (const child of Object.values(object)) {
    const found = findStringByKey(child, keys, depth + 1);
    if (found) return found;
  }
  return undefined;
}

function findPositiveSafeIntegerByKey(value: unknown, keys: Set<string>, depth = 0): number | undefined {
  if (depth > 8 || value === null || value === undefined) return undefined;
  if (Array.isArray(value)) {
    for (const child of value) {
      const found = findPositiveSafeIntegerByKey(child, keys, depth + 1);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  const object = asRecord(value);
  for (const [key, child] of Object.entries(object)) {
    if (!keys.has(normalizeMetadataKey(key))) continue;
    const parsed = numericValue(child);
    if (parsed !== undefined && Number.isSafeInteger(parsed) && parsed > 0) return parsed;
  }
  for (const child of Object.values(object)) {
    const found = findPositiveSafeIntegerByKey(child, keys, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

function normalizeMetadataKey(value: string): string { return value.replace(/[^a-zA-Z0-9]/g, '').toLowerCase(); }

/**
 * Extract a platform 40103 outbound-message read receipt from a decoded push
 * payload. Goofish uses both a compact numeric-key envelope and named nested
 * envelopes depending on the gateway path, so this parser intentionally stays
 * pure and accepts either representation.
 */
export function parseReadReceiptPayload(value: unknown, now: () => number = Date.now): XianyuImReadReceipt | undefined {
  const root = parseMaybeJsonValue(value);
  if (root === undefined) return undefined;
  return parseCompactReadReceipt(root, now) ?? findNestedReadReceipt(root, now);
}

function parseCompactReadReceipt(value: unknown, now: () => number): XianyuImReadReceipt | undefined {
  const record = asRecord(value);
  if (!Object.prototype.hasOwnProperty.call(record, '1') || readReceiptString(record['2']) !== '2') return undefined;
  const messageId = readReceiptMessageId(record['1']);
  const preferredConversation = readReceiptString(record['4']);
  const fallbackConversation = readReceiptString(record['3']);
  const conversation = preferredConversation?.includes('@goofish') ? preferredConversation : fallbackConversation;
  if (!messageId && !conversation) return undefined;
  return {
    ...(messageId ? { externalMessageRef: messageId } : {}),
    ...(conversation ? { externalConversationRef: stripGoofish(conversation) } : {}),
    readAt: now(),
  };
}

function findNestedReadReceipt(value: unknown, now: () => number, depth = 0): XianyuImReadReceipt | undefined {
  if (depth > 20) return undefined;
  if (typeof value === 'string') {
    const decoded = parseMaybeJsonValue(value);
    return decoded === value ? undefined : findNestedReadReceipt(decoded, now, depth + 1);
  }
  if (Array.isArray(value)) {
    for (const child of value) {
      const receipt = findNestedReadReceipt(child, now, depth + 1);
      if (receipt) return receipt;
    }
    return undefined;
  }
  const record = asRecord(value);
  if (Object.keys(record).length === 0) return undefined;
  if (isReadReceiptEnvelope(record)) {
    const messageId = findNestedFieldString(record, ['messageid', 'message_id', 'id']);
    const conversation = findNestedFieldString(record, ['cid', 'chatid', 'chat_id']);
    if ((!messageId || isPnmMessageId(messageId)) && conversation) {
      return {
        ...(messageId && isPnmMessageId(messageId) ? { externalMessageRef: messageId } : {}),
        ...(conversation ? { externalConversationRef: stripGoofish(conversation) } : {}),
        readAt: now(),
      };
    }
  }
  for (const child of Object.values(record)) {
    const receipt = findNestedReadReceipt(child, now, depth + 1);
    if (receipt) return receipt;
  }
  return undefined;
}

function isReadReceiptEnvelope(record: Record<string, any>): boolean {
  return Object.entries(record).some(([key, value]) => {
    const normalized = key.toLowerCase();
    return (normalized === 'biztype' || normalized === 'biz_type' || normalized === 'type') && readReceiptString(value) === '40103';
  });
}

function findNestedFieldString(value: unknown, keys: string[], depth = 0): string | undefined {
  if (depth > 20) return undefined;
  if (typeof value === 'string') {
    const decoded = parseMaybeJsonValue(value);
    return decoded === value ? undefined : findNestedFieldString(decoded, keys, depth + 1);
  }
  if (Array.isArray(value)) {
    for (const child of value) {
      const found = findNestedFieldString(child, keys, depth + 1);
      if (found) return found;
    }
    return undefined;
  }
  const record = asRecord(value);
  for (const [key, child] of Object.entries(record)) {
    if (keys.some((candidate) => key.toLowerCase() === candidate.toLowerCase())) {
      const found = readReceiptString(child);
      if (found) return found;
    }
  }
  for (const child of Object.values(record)) {
    const found = findNestedFieldString(child, keys, depth + 1);
    if (found) return found;
  }
  return undefined;
}

function parseMaybeJsonValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  try { return JSON.parse(trimmed); } catch { return value; }
}

function readReceiptMessageId(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    for (const child of value) {
      const messageId = readReceiptMessageId(child);
      if (messageId) return messageId;
    }
    return undefined;
  }
  const messageId = readReceiptString(value);
  return messageId && isPnmMessageId(messageId) ? messageId : undefined;
}

function readReceiptString(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined;
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  return undefined;
}

function isPnmMessageId(value: string): boolean { return value.toUpperCase().endsWith('.PNM'); }

function selectCanonicalMessageRef(...values: unknown[]): string {
  const candidates = values
    .map((value) => {
      if (typeof value === 'string') return value.trim();
      if (typeof value === 'number' || typeof value === 'bigint') return String(value);
      return '';
    })
    .filter(Boolean);
  return candidates.find(isPnmMessageId) ?? candidates[0] ?? '';
}

function decodePushData(encoded: string): unknown {
  const bytes = Buffer.from(encoded, 'base64');
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    try { return decodeMessagePack(bytes); } catch { return undefined; }
  }
}

function parseJsonObject(value: unknown): Record<string, any> {
  if (typeof value !== 'string' || !value.trim()) return {};
  try { return asRecord(JSON.parse(value)); } catch { return {}; }
}

function parseQueryParam(value: string | undefined, key: string): string | undefined {
  if (!value) return undefined;
  try { return new URL(value.replace(/^fleamarket:\/\//, 'https://placeholder/')).searchParams.get(key) ?? undefined; } catch { return undefined; }
}

function decodeMessagePack(bytes: Uint8Array): unknown {
  let offset = 0;
  const read = (): unknown => {
    const prefix = bytes[offset++];
    if (prefix === undefined) throw new Error('msgpack eof');
    if (prefix <= 0x7f) return prefix;
    if (prefix >= 0xe0) return prefix - 0x100;
    if ((prefix & 0xe0) === 0xa0) return readString(prefix & 0x1f);
    if ((prefix & 0xf0) === 0x90) return readArray(prefix & 0x0f);
    if ((prefix & 0xf0) === 0x80) return readMap(prefix & 0x0f);
    switch (prefix) {
      case 0xc0: return null;
      case 0xc2: return false;
      case 0xc3: return true;
      case 0xcc: return bytes[offset++];
      case 0xcd: return readUint(2);
      case 0xce: return readUint(4);
      case 0xcf: return Number(readBigUint(8));
      case 0xd0: return readInt(1);
      case 0xd1: return readInt(2);
      case 0xd2: return readInt(4);
      case 0xd3: return Number(readBigInt(8));
      case 0xca: return readFloat(4);
      case 0xcb: return readFloat(8);
      case 0xd9: return readString(bytes[offset++]);
      case 0xda: return readString(readUint(2));
      case 0xdb: return readString(readUint(4));
      case 0xdc: return readArray(readUint(2));
      case 0xdd: return readArray(readUint(4));
      case 0xde: return readMap(readUint(2));
      case 0xdf: return readMap(readUint(4));
      case 0xc4: return readBinary(bytes[offset++]);
      case 0xc5: return readBinary(readUint(2));
      case 0xc6: return readBinary(readUint(4));
      default: throw new Error(`unsupported msgpack prefix ${prefix}`);
    }
  };
  const readUint = (size: number): number => { const view = new DataView(bytes.buffer, bytes.byteOffset + offset, size); const value = size === 2 ? view.getUint16(0) : view.getUint32(0); offset += size; return value; };
  const readBigUint = (size: number): bigint => { const view = new DataView(bytes.buffer, bytes.byteOffset + offset, size); const value = view.getBigUint64(0); offset += size; return value; };
  const readInt = (size: number): number => { const view = new DataView(bytes.buffer, bytes.byteOffset + offset, size); const value = size === 1 ? view.getInt8(0) : size === 2 ? view.getInt16(0) : view.getInt32(0); offset += size; return value; };
  const readBigInt = (size: number): bigint => { const view = new DataView(bytes.buffer, bytes.byteOffset + offset, size); const value = view.getBigInt64(0); offset += size; return value; };
  const readFloat = (size: number): number => { const view = new DataView(bytes.buffer, bytes.byteOffset + offset, size); const value = size === 4 ? view.getFloat32(0) : view.getFloat64(0); offset += size; return value; };
  const readString = (length: number): string => { const value = Buffer.from(bytes.subarray(offset, offset + length)).toString('utf8'); offset += length; return value; };
  const readBinary = (length: number): Buffer => { const value = Buffer.from(bytes.subarray(offset, offset + length)); offset += length; return value; };
  const readArray = (length: number): unknown[] => Array.from({ length }, () => read());
  const readMap = (length: number): Record<string, unknown> => { const output: Record<string, unknown> = {}; for (let index = 0; index < length; index += 1) { const key = read(); output[String(key)] = read(); } return output; };
  return read();
}

function decodeContent(msg1: Record<string, unknown>): { text?: string; images: string[] } {
  const content = asRecord(asRecord(msg1['6'])['3']);
  const candidates = [content['5'], content['1']];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || !candidate) continue;
    let parsed: unknown;
    try { parsed = JSON.parse(candidate); } catch {
      try { parsed = JSON.parse(Buffer.from(candidate, 'base64').toString('utf8')); } catch { continue; }
    }
    const data = asRecord(parsed);
    const text = optionalString(asRecord(data.text).text);
    const pics = asRecord(data.image).pics;
    const images = Array.isArray(pics) ? pics.map((pic) => optionalString(asRecord(pic).url)).filter((url): url is string => Boolean(url)) : [];
    if (text || images.length > 0) return { text, images };
  }
  return { images: [] };
}

function waitForSocketOpen(socket: ImWebSocket, timeoutMs: number): Promise<void> {
  if (socket.readyState === 1) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('XIANYU_IM_WS_OPEN_TIMEOUT')), timeoutMs);
    const onOpen = () => { clearTimeout(timer); resolve(); };
    socket.once?.('open', onOpen) ?? socket.on('open', onOpen);
  });
}

function createDeviceId(userId: string): string {
  return `${crypto.randomUUID()}-${userId}`;
}

function assertSendAccepted(response: Record<string, unknown>): void {
  const body = asRecord(response.body);
  const reason = optionalString(body.reason);
  if (!reason) return;
  const moreInfo = optionalString(body.moreInfo);
  throw new Error(moreInfo ? `${reason} (${moreInfo})` : reason);
}

function extractMessageRef(body: Record<string, unknown>): string | undefined {
  const nested = asRecord(body['1']);
  return optionalString(body.messageId)
    ?? optionalString(body.msgId)
    ?? optionalString(body.id)
    ?? optionalString(nested.messageId)
    ?? optionalString(nested.msgId)
    ?? optionalString(nested.id)
    ?? optionalString(body.uuid);
}

function createMid(): string { return `${Math.floor(Math.random() * 1000)}${Date.now()} 0`; }
function deterministicUuid(value: string): string {
  const bytes = crypto.createHash('sha256').update(value).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
function md5(value: string): string { return crypto.createHash('md5').update(value).digest('hex'); }
function eventErrorCode(error: unknown): string {
  const candidate = error as { code?: unknown } | null;
  if (typeof candidate?.code === 'string' && /^[A-Z0-9_:-]{1,64}$/.test(candidate.code)) return candidate.code;
  if (typeof candidate?.code === 'number' && Number.isFinite(candidate.code)) return `REMOTE_${candidate.code}`;
  if (error instanceof Error && error.name) return error.name;
  return 'UNKNOWN_ERROR';
}
function cookieValue(header: string, name: string): string { return header.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1) ?? ''; }
function mergeCookies(header: string, setCookies: string[]): string {
  const cookies = new Map<string, string>();
  for (const part of header.split(';')) { const index = part.indexOf('='); if (index > 0) cookies.set(part.slice(0, index).trim(), part.slice(index + 1).trim()); }
  for (const setCookie of setCookies) { const first = setCookie.split(';', 1)[0] ?? ''; const index = first.indexOf('='); if (index > 0) cookies.set(first.slice(0, index).trim(), first.slice(index + 1).trim()); }
  return [...cookies].map(([key, value]) => `${key}=${value}`).join('; ');
}
function getSetCookies(headers: Headers): string[] { return (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? []; }
function clampLimit(value: number): number { return Math.min(100, Math.max(1, Math.trunc(value))); }
function asRecord(value: unknown): Record<string, any> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {}; }
function optionalString(value: unknown): string | undefined { return typeof value === 'string' && value.trim() ? value.trim() : undefined; }
function stripGoofish(value: string): string { return value.replace(/@goofish$/, ''); }
function uniqueStrings(values: unknown[]): string[] { return [...new Set(values.map((value) => optionalString(typeof value === 'number' || typeof value === 'bigint' ? String(value) : value)).filter((value): value is string => Boolean(value)))]; }
function normalizeTimestamp(value: unknown, receivedAt: string): { value: string; quality: 'platform' | 'received' } {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return { value: receivedAt, quality: 'received' };
  const millis = numeric > 10_000_000_000 ? numeric : numeric * 1000;
  const parsed = new Date(millis);
  return Number.isNaN(parsed.getTime()) ? { value: receivedAt, quality: 'received' } : { value: parsed.toISOString(), quality: 'platform' };
}

function numericValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}
