import fs from 'node:fs/promises';
import { WebSocket } from 'ws';
import { XianyuImClient } from '../dist/xianyu-im.js';

const cookieHeader = await readCookie();
if (!cookieHeader) fail('set XIANYU_COOKIE or XIANYU_COOKIE_FILE');

const accountId = process.env.XIANYU_ACCOUNT_ID ?? 'gateway-probe';
const conversationRef = process.env.XIANYU_CONVERSATION_REF?.trim() || undefined;
const limit = clampNumber(process.env.XIANYU_MESSAGE_LIMIT, 20, 1, 100);
const startCursor = optionalNumber(process.env.XIANYU_START_CURSOR);
const waitMs = clampNumber(process.env.XIANYU_GATEWAY_PROBE_WAIT_MS, 30_000, 0, 300_000);
const requireHistory = process.env.XIANYU_REQUIRE_HISTORY === '1';
const requirePush = process.env.XIANYU_REQUIRE_PUSH === '1';
const events = [];
const frames = { sent: [], received: [] };

const client = new XianyuImClient({
  accountId,
  credential: {
    cookieHeader,
    accessToken: process.env.XIANYU_ACCESS_TOKEN,
    deviceId: process.env.XIANYU_DEVICE_ID,
  },
  timeoutMs: clampNumber(process.env.XIANYU_WS_TIMEOUT_MS, 20_000, 1_000, 120_000),
  heartbeatIntervalMs: clampNumber(process.env.XIANYU_HEARTBEAT_INTERVAL_MS, 15_000, 5_000, 120_000),
  webSocketFactory: (url, options) => {
    const socket = new WebSocket(url, options);
    socket.on('message', (raw) => {
      const message = parseJson(raw);
      if (message) {
        frames.received.push(summarizeFrame(message));
        console.log('[gateway<-]', JSON.stringify(summarizeFrame(message)));
      } else {
        console.log('[gateway<-] non-json frame');
      }
    });
    const originalSend = socket.send.bind(socket);
    socket.send = (data, ...rest) => {
      const message = parseJson(data);
      if (message) {
        frames.sent.push(summarizeFrame(message));
        console.log('[gateway->]', JSON.stringify(summarizeFrame(message)));
      } else {
        console.log('[gateway->] non-json frame');
      }
      return originalSend(data, ...rest);
    };
    return socket;
  },
  onEvent: (event) => {
    events.push(event);
    console.log('[onEvent]', JSON.stringify({
      kind: event.kind ?? 'message',
      conversation: tail(event.externalConversationRef),
      message: tail(event.externalMessageRef),
      direction: event.direction,
      bodyType: event.bodyType,
      occurredAt: event.occurredAt ?? new Date(event.readAt).toISOString(),
    }));
  },
});

try {
  await client.connect();
  console.log(JSON.stringify({ status: client.status, connected: client.connected, gateway: 'wss://wss-goofish.dingtalk.com/', deviceId: tail(client.deviceId), userId: tail(client.userId) }));

  if (conversationRef) {
    const history = await client.listMessages(conversationRef, startCursor, limit);
    const models = Array.isArray(history.userMessageModels) ? history.userMessageModels : [];
    console.log(JSON.stringify({ history: { request: '/r/MessageManager/listUserMessages', conversation: tail(conversationRef), count: models.length, hasMore: Boolean(history.hasMore), nextCursor: typeof history.nextCursor === 'number' || typeof history.nextCursor === 'string' ? history.nextCursor : undefined } }));
  } else {
    console.log(JSON.stringify({ history: 'skipped', reason: 'XIANYU_CONVERSATION_REF is not set' }));
  }

  if (waitMs > 0) {
    console.log(JSON.stringify({ pushWaitMs: waitMs, instruction: 'send a real buyer message now; probe only observes gateway/onEvent and never calls handleExternalEvent' }));
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  const summary = {
    status: client.status,
    historyFrames: frames.sent.filter((frame) => frame.lwp === '/r/MessageManager/listUserMessages').length,
    pushFrames: frames.received.filter((frame) => frame.hasSyncPushPackage).length,
    onEventCount: events.length,
    sentLwps: frames.sent.map((frame) => frame.lwp).filter(Boolean),
    receivedLwps: frames.received.map((frame) => frame.lwp).filter(Boolean),
  };
  console.log(JSON.stringify({ summary }));
  if (requireHistory && summary.historyFrames < 1) fail('history request was not observed');
  if (requirePush && summary.onEventCount < 1) fail('no push event reached onEvent during probe window');
} finally {
  await client.disconnect();
}

async function readCookie() {
  if (process.env.XIANYU_COOKIE?.trim()) return process.env.XIANYU_COOKIE.trim();
  if (!process.env.XIANYU_COOKIE_FILE) return '';
  return (await fs.readFile(process.env.XIANYU_COOKIE_FILE, 'utf8')).trim();
}
function summarizeFrame(message) {
  const headers = message?.headers && typeof message.headers === 'object' ? message.headers : {};
  const body = message?.body && typeof message.body === 'object' ? message.body : {};
  const sync = body.syncPushPackage && typeof body.syncPushPackage === 'object' ? body.syncPushPackage : undefined;
  return { lwp: typeof message?.lwp === 'string' ? message.lwp : undefined, code: typeof message?.code === 'number' ? message.code : undefined, mid: typeof headers.mid === 'string' ? tail(headers.mid) : undefined, hasBody: Boolean(message?.body), hasSyncPushPackage: Boolean(sync && Array.isArray(sync.data) && sync.data.length > 0), syncEntries: sync && Array.isArray(sync.data) ? sync.data.length : 0 };
}
function parseJson(value) { try { return JSON.parse(Buffer.from(value).toString('utf8')); } catch { return undefined; } }
function tail(value) { const text = String(value ?? ''); return text.length <= 8 ? text : `…${text.slice(-8)}`; }
function optionalNumber(value) { if (value === undefined || value === '') return undefined; const parsed = Number(value); if (!Number.isSafeInteger(parsed) || parsed < 0) fail(`invalid numeric value: ${value}`); return parsed; }
function clampNumber(value, fallback, min, max) { const parsed = value === undefined || value === '' ? fallback : Number(value); if (!Number.isFinite(parsed)) fail(`invalid numeric value: ${value}`); return Math.min(max, Math.max(min, Math.trunc(parsed))); }
function fail(message) { console.error(`[gateway-probe] ${message}`); process.exitCode = 2; throw new Error(message); }
