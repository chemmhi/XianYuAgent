import assert from 'node:assert/strict';
import test from 'node:test';
import { XianyuImClient, parsePushPayload, parsePushPayloadDetailed } from '../src/xianyu-im.js';

test('history request response does not emit an event by itself', async () => {
  const socket = new FakeSocket(false);
  const events: unknown[] = [];
  const client = new XianyuImClient({
    accountId: 'account-1',
    credential: { cookieHeader: 'unb=seller-1', accessToken: 'token', deviceId: 'device-1' },
    heartbeatIntervalMs: 60_000,
    webSocketFactory: () => socket,
    onEvent: (event) => { events.push(event); },
  });

  const connectPromise = client.connect();
  queueMicrotask(() => socket.emit('open'));
  await connectPromise;
  try {
    const page = await client.listMessages('64725235816', 123, 7);
    const request = socket.sent.find((message) => message.lwp === '/r/MessageManager/listUserMessages');
    assert.deepEqual(request?.body, ['64725235816@goofish', false, 123, 7, false]);
    assert.equal(page.hasMore, true);
    assert.equal(page.nextCursor, 99);
    assert.deepEqual(page.userMessageModels, []);
    assert.deepEqual(events, []);
  } finally {
    await client.disconnect();
  }
});

test('sync extra state recovery requests getState then acknowledges returned state', async () => {
  const socket = new SyncStateSocket();
  const client = new XianyuImClient({
    accountId: 'account-1',
    credential: { cookieHeader: 'unb=seller-1', accessToken: 'token', deviceId: 'device-1' },
    heartbeatIntervalMs: 60_000,
    webSocketFactory: () => socket,
  });

  const connectPromise = client.connect();
  queueMicrotask(() => socket.emit('open'));
  await connectPromise;
  try {
    socket.emit('message', JSON.stringify({ headers: { mid: 'sync-extra' }, body: { syncExtraType: { type: 1 } } }));
    for (let attempt = 0; attempt < 20 && !socket.sent.some((message) => message.lwp === '/r/SyncStatus/ackDiff'); attempt += 1) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }

    const lwps = socket.sent.map((message) => message.lwp).filter(Boolean);
    assert.deepEqual(lwps.slice(-2), ['/r/SyncStatus/getState', '/r/SyncStatus/ackDiff']);
    const ack = [...socket.sent].reverse().find((message) => message.lwp === '/r/SyncStatus/ackDiff');
    assert.deepEqual(ack?.body, [socket.stateBody]);
  } finally {
    await client.disconnect();
  }
});

test('mixed gateway response still dispatches syncPushPackage through onEvent', async () => {
  const socket = new FakeSocket(true);
  const events: unknown[] = [];
  const client = new XianyuImClient({
    accountId: 'account-1',
    credential: { cookieHeader: 'unb=seller-1', accessToken: 'token', deviceId: 'device-1' },
    heartbeatIntervalMs: 60_000,
    webSocketFactory: () => socket,
    onEvent: (event) => { events.push(event); },
  });

  const connectPromise = client.connect();
  queueMicrotask(() => socket.emit('open'));
  await connectPromise;
  try {
    const page = await client.listMessages('64725235816', 123, 7);
    await new Promise<void>((resolve) => setImmediate(resolve));

    assert.equal(page.hasMore, true);
    assert.equal(page.nextCursor, 99);
    assert.deepEqual(page.userMessageModels, []);
    assert.equal(events.length, 1);
    assert.deepEqual(events[0], {
      accountId: 'account-1',
      externalConversationRef: '64725235816',
      externalMessageRef: '4263141580162.PNM',
      senderRef: 'buyer-1',
      senderName: 'Buyer',
      direction: 'inbound',
      bodyType: 'text',
      bodyText: 'hello from push',
      assetRef: undefined,
      occurredAt: '2026-01-01T00:00:00.000Z',
      raw: {
        '1': {
          '2': '64725235816@goofish',
          '3': '4263141580162.PNM',
          '5': 1767225600000,
          '6': { '3': { '5': Buffer.from(JSON.stringify({ contentType: 1, text: { text: 'hello from push' } }), 'utf8').toString('base64') } },
          '10': { senderUserId: 'buyer-1', senderNick: 'Buyer', extJson: JSON.stringify({ messageId: '4263141580162.PNM' }) },
        },
      },
    });
    assert.ok(socket.sent.some((message) => message.code === 200 && message.headers?.mid === socket.historyMid));
  } finally {
    await client.disconnect();
  }
});

test('push parser prefers the stable PNM id over an internal transport id', () => {
  const parsed = parsePushPayload(pushPayload('canonical-1.PNM', 'same message', 'internal-32-char-id'), 'account-1', 'seller-1');
  assert.equal(parsed?.externalMessageRef, 'canonical-1.PNM');
});

test('push parser treats an account seller identity as outbound even when the cookie identity differs', () => {
  const sellerPayload = pushPayloadFromSender('seller-outbound-2.PNM', 'seller sent this', 'seller-account-2');
  const sellerParsed = parsePushPayload(sellerPayload, 'account-1', ['stale-cookie-seller', 'seller-account-2']);
  assert.equal(sellerParsed?.senderRef, 'seller-account-2');
  assert.equal(sellerParsed?.direction, 'outbound');

  const buyerParsed = parsePushPayload(pushPayload('buyer-inbound-1.PNM', 'buyer sent this'), 'account-1', ['stale-cookie-seller', 'seller-account-2']);
  assert.equal(buyerParsed?.senderRef, 'buyer-1');
  assert.equal(buyerParsed?.direction, 'inbound');
});

test('push parser accepts the named operation.sessionInfo buyer message envelope', () => {
  const parsed = parsePushPayload(operationPayload({ contentType: 1, messageId: 'operation-message-1.PNM', text: { text: '来自新 envelope 的买家消息' } }), 'account-1', 'seller-1');
  assert.deepEqual(parsed, {
    accountId: 'account-1',
    externalConversationRef: 'operation-conversation-1',
    externalMessageRef: 'operation-message-1.PNM',
    senderRef: 'buyer-operation-1',
    senderName: 'Operation Buyer',
    direction: 'inbound',
    bodyType: 'text',
    bodyText: '来自新 envelope 的买家消息',
    assetRef: undefined,
    occurredAt: '2026-01-01T00:00:00.000Z',
    raw: {
      chatType: 1,
      incrementType: 1,
      sessionId: 'operation-conversation-1',
      operation: {
        sessionInfo: { sessionId: 'operation-conversation-1', extensions: { extUserId: 'buyer-operation-1', itemId: 'item-1' } },
        content: { contentType: 1, messageId: 'operation-message-1.PNM', text: { text: '来自新 envelope 的买家消息' }, senderNick: 'Operation Buyer', createAt: 1767225600000 },
      },
    },
  });
});

test('sessionArouse system operation is quarantined instead of treated as buyer text', () => {
  const result = parsePushPayloadDetailed(operationPayload({ contentType: 8, messageId: 'session-arouse-1.PNM', text: '系统提醒' }), 'account-1', 'seller-1');
  assert.equal(result.event, undefined);
  assert.equal(result.quarantine?.reasonCode, 'PUSH_SYSTEM_CONTENT_IGNORED');
});

test('non-200 gateway response rejects pending request even when a body is present', async () => {
  const socket = new RejectingSocket();
  const statuses: string[] = [];
  const client = new XianyuImClient({
    accountId: 'account-1',
    credential: { cookieHeader: 'unb=seller-1', accessToken: 'token', deviceId: 'device-1' },
    heartbeatIntervalMs: 60_000,
    webSocketFactory: () => socket,
    onStatusChange: (status) => { statuses.push(status); },
  });
  const connectPromise = client.connect();
  queueMicrotask(() => socket.emit('open'));
  await assert.rejects(connectPromise, /XIANYU_IM_REQUEST_REJECTED:400/);
  assert.equal(client.status, 'failed');
  assert.ok(statuses.includes('failed'));
  await client.disconnect();
});

test('expired persisted access token refreshes before websocket registration', async () => {
  const sockets: AuthRefreshSocket[] = [];
  let tokenRefreshes = 0;
  const client = new XianyuImClient({
    accountId: 'account-1',
    credential: { cookieHeader: 'unb=seller-1; _m_h5_tk=cookie-token_1', accessToken: 'stale-token', deviceId: 'device-1' },
    heartbeatIntervalMs: 60_000,
    fetch: async () => {
      tokenRefreshes += 1;
      return new Response(JSON.stringify({ ret: ['SUCCESS::调用成功'], data: { accessToken: 'fresh-token' } }), { status: 200 });
    },
    webSocketFactory: () => {
      const socket = new AuthRefreshSocket(sockets.length === 0);
      sockets.push(socket);
      queueMicrotask(() => socket.emit('open'));
      return socket;
    },
  });

  try {
    await client.connect();
    assert.equal(client.connected, true);
    assert.equal(tokenRefreshes, 1);
    assert.equal(sockets.length, 2);
    assert.equal(sockets[0]?.registrationToken, 'stale-token');
    assert.equal(sockets[1]?.registrationToken, 'fresh-token');
  } finally {
    await client.disconnect();
  }
});

test('uses the service credential refresh callback after a 401', async () => {
  const sockets: AuthRefreshSocket[] = [];
  let refreshes = 0;
  let directFetches = 0;
  const client = new XianyuImClient({
    accountId: 'account-1',
    credential: { cookieHeader: 'unb=seller-1; _m_h5_tk=cookie-token_1', accessToken: 'stale-token', deviceId: 'device-1' },
    heartbeatIntervalMs: 60_000,
    fetch: async () => {
      directFetches += 1;
      throw new Error('direct IM token refresh should not run when the service callback is present');
    },
    refreshCredential: async () => {
      refreshes += 1;
      return { cookieHeader: 'unb=seller-1; _m_h5_tk=browser-cookie_2', accessToken: 'fresh-token', deviceId: 'device-1' };
    },
    webSocketFactory: () => {
      const socket = new AuthRefreshSocket(sockets.length === 0);
      sockets.push(socket);
      queueMicrotask(() => socket.emit('open'));
      return socket;
    },
  });

  try {
    await client.connect();
    assert.equal(refreshes, 1);
    assert.equal(directFetches, 0);
    assert.equal(sockets[1]?.registrationToken, 'fresh-token');
  } finally {
    await client.disconnect();
  }
});

test('message send 401 refreshes the IM token and retries once on a new socket', async () => {
  const sockets: AuthRefreshSocket[] = [];
  let tokenRefreshes = 0;
  const client = new XianyuImClient({
    accountId: 'account-1',
    credential: { cookieHeader: 'unb=seller-1; _m_h5_tk=cookie-token_1', accessToken: 'stale-token', deviceId: 'device-1' },
    heartbeatIntervalMs: 60_000,
    fetch: async () => {
      tokenRefreshes += 1;
      return new Response(JSON.stringify({ ret: ['SUCCESS::调用成功'], data: { accessToken: 'fresh-token' } }), { status: 200 });
    },
    webSocketFactory: () => {
      const socket = new AuthRefreshSocket(false, sockets.length === 0);
      sockets.push(socket);
      queueMicrotask(() => socket.emit('open'));
      return socket;
    },
  });

  try {
    const sent = await (async () => {
      await client.connect();
      return client.sendText('conversation-1', 'buyer-1', 'hello');
    })();
    assert.equal(typeof sent, 'object');
    assert.equal(tokenRefreshes, 1);
    assert.equal(sockets.length, 2);
    assert.equal(sockets[0]?.sendAttempts, 1);
    assert.equal(sockets[1]?.sendAttempts, 1);
    assert.equal(sockets[1]?.registrationToken, 'fresh-token');
  } finally {
    await client.disconnect();
  }
});

test('message business rejection marks the IM client failed', async () => {
  const socket = new BusinessRejectSocket();
  const statuses: string[] = [];
  const client = new XianyuImClient({
    accountId: 'account-1',
    credential: { cookieHeader: 'unb=seller-1', accessToken: 'token', deviceId: 'device-1' },
    heartbeatIntervalMs: 60_000,
    webSocketFactory: () => socket,
    onStatusChange: (status) => { statuses.push(status); },
  });

  const connectPromise = client.connect();
  queueMicrotask(() => socket.emit('open'));
  await connectPromise;
  try {
    await assert.rejects(() => client.sendText('conversation-1', 'buyer-1', 'hello'), /FAIL_SYS_USER_VALIDATE/);
    assert.equal(client.status, 'failed');
    assert.ok(statuses.includes('failed'));
  } finally {
    await client.disconnect();
  }
});

test('unexpected gateway close schedules a reconnect for the listener', async () => {
  const sockets: FakeSocket[] = [];
  const statuses: string[] = [];
  const client = new XianyuImClient({
    accountId: 'account-1',
    credential: { cookieHeader: 'unb=seller-1', accessToken: 'token', deviceId: 'device-1' },
    heartbeatIntervalMs: 60_000,
    webSocketFactory: () => {
      const socket = new FakeSocket(false);
      sockets.push(socket);
      queueMicrotask(() => socket.emit('open'));
      return socket;
    },
    onStatusChange: (status) => { statuses.push(status); },
  });

  await client.connect();
  assert.equal(sockets.length, 1);
  sockets[0]!.close();
  for (let attempt = 0; attempt < 40 && sockets.length < 2; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(sockets.length, 2);
  assert.equal(client.connected, true);
  assert.ok(statuses.includes('connected'));
  await client.disconnect();
});

test('transient push handler failure retries before continuing later gateway events', async () => {
  const socket = new FakeSocket(false);
  const events: Array<Record<string, unknown>> = [];
  let calls = 0;
  const client = new XianyuImClient({
    accountId: 'account-1',
    credential: { cookieHeader: 'unb=seller-1', accessToken: 'token', deviceId: 'device-1' },
    heartbeatIntervalMs: 60_000,
    webSocketFactory: () => socket,
    onEvent: async (event) => {
      calls += 1;
      if (calls === 1) throw new Error('transient-handler-failure');
      events.push(event as Record<string, unknown>);
    },
  });
  const connectPromise = client.connect();
  queueMicrotask(() => socket.emit('open'));
  await connectPromise;
  try {
    socket.emit('message', JSON.stringify({
      headers: { mid: 'push-batch' },
      body: { syncPushPackage: { data: [{ data: pushPayload('first.PNM', 'first') }, { data: pushPayload('second.PNM', 'second') }] } },
    }));
    for (let attempt = 0; attempt < 20 && events.length < 2; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(calls, 3);
    assert.deepEqual(events.map((event) => event.externalMessageRef), ['first.PNM', 'second.PNM']);
  } finally {
    await client.disconnect();
  }
});

function pushPayload(messageRef = '4263141580162.PNM', text = 'hello from push', transportMessageRef = messageRef): string {
  return pushPayloadFromSender(messageRef, text, 'buyer-1', transportMessageRef, 'Buyer');
}

function pushPayloadFromSender(messageRef: string, text: string, senderRef: string, transportMessageRef = messageRef, senderName = 'Sender'): string {
  const content = Buffer.from(JSON.stringify({ contentType: 1, text: { text } }), 'utf8').toString('base64');
  return Buffer.from(JSON.stringify({
    '1': {
      '2': '64725235816@goofish',
      '3': messageRef,
      '5': 1767225600000,
      '6': { '3': { '5': content } },
      '10': { senderUserId: senderRef, senderNick: senderName, extJson: JSON.stringify({ messageId: transportMessageRef }) },
    },
  }), 'utf8').toString('base64');
}

class FakeSocket {
  readyState = 0;
  historyMid = '';
  sent: Array<Record<string, any>> = [];
  private readonly listeners = new Map<string, Array<(...args: any[]) => void>>();

  constructor(private readonly includePushInHistory = true) {}

  send(data: string): void {
    const message = JSON.parse(data) as Record<string, any>;
    this.sent.push(message);
    const mid = message.headers?.mid;
    if (message.lwp === '/r/MessageManager/listUserMessages') {
      this.historyMid = mid;
      const body = {
        hasMore: true,
        nextCursor: 99,
        userMessageModels: [],
        ...(this.includePushInHistory ? { syncPushPackage: { data: [{ data: pushPayload() }] } } : {}),
      };
      queueMicrotask(() => this.emit('message', JSON.stringify({ code: 200, headers: { mid }, body })));
      return;
    }
    if (message.lwp === '/reg') queueMicrotask(() => this.emit('message', JSON.stringify({ code: 200, headers: { mid }, body: {} })));
  }

  close(): void { this.readyState = 3; this.emit('close'); }
  on(event: string, listener: (...args: any[]) => void): this { const current = this.listeners.get(event) ?? []; current.push(listener); this.listeners.set(event, current); return this; }
  once(event: string, listener: (...args: any[]) => void): this { const wrapped = (...args: any[]) => { this.removeListener(event, wrapped); listener(...args); }; return this.on(event, wrapped); }
  removeListener(event: string, listener: (...args: any[]) => void): this { const current = this.listeners.get(event) ?? []; this.listeners.set(event, current.filter((candidate) => candidate !== listener)); return this; }
  emit(event: string, ...args: any[]): void { if (event === 'open') this.readyState = 1; for (const listener of [...(this.listeners.get(event) ?? [])]) listener(...args); }
}

class RejectingSocket extends FakeSocket {
  override send(data: string): void {
    const message = JSON.parse(data) as Record<string, any>;
    this.sent.push(message);
    if (message.lwp === '/reg') queueMicrotask(() => this.emit('message', JSON.stringify({ code: 400, headers: { mid: message.headers?.mid }, body: { reason: 'SESSION_EXPIRED' } })));
  }
}

function operationPayload(content: { contentType: number; messageId: string; text: unknown }): string {
  return Buffer.from(JSON.stringify({
    chatType: 1,
    incrementType: 1,
    sessionId: 'operation-conversation-1',
    operation: {
      sessionInfo: { sessionId: 'operation-conversation-1', extensions: { extUserId: 'buyer-operation-1', itemId: 'item-1' } },
      content: { contentType: content.contentType, messageId: content.messageId, text: content.text, senderNick: 'Operation Buyer', createAt: 1767225600000 },
    },
  }), 'utf8').toString('base64');
}

class AuthRefreshSocket extends FakeSocket {
  registrationToken = '';
  sendAttempts = 0;

  constructor(private readonly rejectRegistration = false, private readonly rejectSend = false) {
    super(false);
  }

  override send(data: string): void {
    const message = JSON.parse(data) as Record<string, any>;
    this.sent.push(message);
    if (message.lwp === '/reg') {
      this.registrationToken = String(message.headers?.token ?? '');
      queueMicrotask(() => this.emit('message', JSON.stringify({ code: this.rejectRegistration ? 401 : 200, headers: { mid: message.headers.mid }, body: {} })));
      return;
    }
    if (message.lwp === '/r/MessageSend/sendByReceiverScope') {
      this.sendAttempts += 1;
      queueMicrotask(() => this.emit('message', JSON.stringify({ code: this.rejectSend ? 401 : 200, headers: { mid: message.headers.mid }, body: { messageId: 'sent-message.PNM' } })));
    }
  }
}

class BusinessRejectSocket extends FakeSocket {
  override send(data: string): void {
    const message = JSON.parse(data) as Record<string, any>;
    this.sent.push(message);
    if (message.lwp === '/reg') queueMicrotask(() => this.emit('message', JSON.stringify({ code: 200, headers: { mid: message.headers?.mid }, body: {} })));
    if (message.lwp === '/r/MessageSend/sendByReceiverScope') queueMicrotask(() => this.emit('message', JSON.stringify({ code: 200, headers: { mid: message.headers?.mid }, body: { reason: 'FAIL_SYS_USER_VALIDATE' } })));
  }
}

class SyncStateSocket extends FakeSocket {
  readonly stateBody = [{ topic: 'sync', highPts: 42, pts: 99, seq: 7, timestamp: 1_787_000_000_000 }];

  override send(data: string): void {
    super.send(data);
    const message = JSON.parse(data) as Record<string, any>;
    if (message.lwp === '/r/SyncStatus/getState') {
      queueMicrotask(() => this.emit('message', JSON.stringify({ code: 200, headers: { mid: message.headers?.mid }, body: this.stateBody })));
    }
    if (message.lwp === '/r/SyncStatus/ackDiff') {
      queueMicrotask(() => this.emit('message', JSON.stringify({ code: 200, headers: { mid: message.headers?.mid }, body: {} })));
    }
  }
}
