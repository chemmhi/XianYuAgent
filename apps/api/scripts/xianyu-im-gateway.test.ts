import assert from 'node:assert/strict';
import test from 'node:test';
import { XianyuImClient } from '../src/xianyu-im.js';

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

test('non-200 gateway response rejects pending request even when a body is present', async () => {
  const socket = new RejectingSocket();
  const client = new XianyuImClient({
    accountId: 'account-1',
    credential: { cookieHeader: 'unb=seller-1', accessToken: 'token', deviceId: 'device-1' },
    heartbeatIntervalMs: 60_000,
    webSocketFactory: () => socket,
  });
  const connectPromise = client.connect();
  queueMicrotask(() => socket.emit('open'));
  await assert.rejects(connectPromise, /XIANYU_IM_REQUEST_REJECTED:400/);
  assert.equal(client.status, 'failed');
  await client.disconnect();
});

test('unexpected gateway close schedules a reconnect for the listener', async () => {
  const sockets: FakeSocket[] = [];
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
  });

  await client.connect();
  assert.equal(sockets.length, 1);
  sockets[0]!.close();
  for (let attempt = 0; attempt < 40 && sockets.length < 2; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(sockets.length, 2);
  assert.equal(client.connected, true);
  await client.disconnect();
});

test('one push handler failure does not stop later gateway events in the frame', async () => {
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
      if (calls === 1) throw new Error('handler-secret');
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
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(calls, 2);
    assert.equal(events[0]?.externalMessageRef, 'second.PNM');
  } finally {
    await client.disconnect();
  }
});

function pushPayload(messageRef = '4263141580162.PNM', text = 'hello from push'): string {
  const content = Buffer.from(JSON.stringify({ contentType: 1, text: { text } }), 'utf8').toString('base64');
  return Buffer.from(JSON.stringify({
    '1': {
      '2': '64725235816@goofish',
      '3': messageRef,
      '5': 1767225600000,
      '6': { '3': { '5': content } },
      '10': { senderUserId: 'buyer-1', senderNick: 'Buyer', extJson: JSON.stringify({ messageId: messageRef }) },
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
