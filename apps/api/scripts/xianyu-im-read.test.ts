import assert from 'node:assert/strict';
import test from 'node:test';
import { XianyuImClient, parseReadReceiptPayload } from '../src/xianyu-im.js';

const READ_AT = 1_786_945_729_928;

test('parses compact 40103 receipt and strips @goofish suffix', () => {
  const receipt = parseReadReceiptPayload({
    '1': '4263141580162.PNM',
    '2': 2,
    '3': 0,
    '4': '64725235816@goofish',
    '5': 1,
    '6': READ_AT,
  }, () => READ_AT);

  assert.deepEqual(receipt, {
    externalMessageRef: '4263141580162.PNM',
    externalConversationRef: '64725235816',
    readAt: READ_AT,
  });
});

test('parses compact batch receipt and uses field 3 as conversation fallback', () => {
  const receipt = parseReadReceiptPayload({
    '1': ['4263107993838.PNM'],
    '2': 2,
    '3': '64725235816@goofish',
    '4': 1,
  }, () => READ_AT);

  assert.deepEqual(receipt, {
    externalMessageRef: '4263107993838.PNM',
    externalConversationRef: '64725235816',
    readAt: READ_AT,
  });
});

test('ignores compact receipts that are not read status 2', () => {
  assert.equal(parseReadReceiptPayload({ '1': '4263141580162.PNM', '2': 1, '4': '64725235816@goofish' }, () => READ_AT), undefined);
});

test('parses nested named 40103 receipt', () => {
  const receipt = parseReadReceiptPayload({
    body: {
      event: {
        bizType: 40103,
        data: { message_id: '4263141580162.PNM', chatId: '64725235816@goofish' },
      },
    },
  }, () => READ_AT);

  assert.deepEqual(receipt, {
    externalMessageRef: '4263141580162.PNM',
    externalConversationRef: '64725235816',
    readAt: READ_AT,
  });
});

test('parses nested JSON-string envelope', () => {
  const receipt = parseReadReceiptPayload(JSON.stringify({
    wrapper: JSON.stringify({ type: '40103', payload: { id: '4263141580162.PNM', cid: '64725235816@goofish' } }),
  }), () => READ_AT);

  assert.deepEqual(receipt, {
    externalMessageRef: '4263141580162.PNM',
    externalConversationRef: '64725235816',
    readAt: READ_AT,
  });
});

test('supports conversation fallback when platform omits the message id', () => {
  assert.deepEqual(parseReadReceiptPayload({ type: 40103, cid: '64725235816@goofish' }, () => READ_AT), {
    externalConversationRef: '64725235816',
    readAt: READ_AT,
  });
  assert.equal(parseReadReceiptPayload({ type: 40103, id: '4263141580162', cid: '64725235816@goofish' }, () => READ_AT), undefined);
});

test('reports conversation reads through the platform MessageStatus endpoint', async () => {
  const socket = new FakeSocket();
  const client = new XianyuImClient({
    accountId: 'account-1',
    credential: { cookieHeader: 'unb=buyer-1', accessToken: 'token', deviceId: 'device-1' },
    heartbeatIntervalMs: 60_000,
    webSocketFactory: () => socket,
  });

  const connectPromise = client.connect();
  queueMicrotask(() => socket.emit('open'));
  await connectPromise;

  await client.markRead(['4263141580162.PNM', '4263141580162.PNM', '4263141580163.PNM']);
  const request = socket.sent.find((message) => message.lwp === '/r/MessageStatus/read');
  assert.deepEqual(request?.body, [['4263141580162.PNM', '4263141580163.PNM']]);
  await client.disconnect();
});

test('routes websocket 40103 pushes to read callback and still ACKs the frame', async () => {
  const socket = new FakeSocket();
  const events: unknown[] = [];
  const client = new XianyuImClient({
    accountId: 'account-1',
    credential: { cookieHeader: 'unb=buyer-1', accessToken: 'token', deviceId: 'device-1' },
    heartbeatIntervalMs: 60_000,
    webSocketFactory: () => socket,
    onEvent: (event) => { events.push(event); },
  });

  const connectPromise = client.connect();
  queueMicrotask(() => socket.emit('open'));
  await connectPromise;

  const encoded = Buffer.from(JSON.stringify({
    '1': '4263141580162.PNM',
    '2': 2,
    '3': 0,
    '4': '64725235816@goofish',
  }), 'utf8').toString('base64');
  socket.emit('message', JSON.stringify({
    headers: { mid: 'push-40103' },
    body: { syncPushPackage: { data: [{ data: encoded }] } },
  }));
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(events.length, 1);
  const event = events[0] as Record<string, unknown>;
  assert.equal(event.externalMessageRef, '4263141580162.PNM');
  assert.equal(event.externalConversationRef, '64725235816');
  assert.equal(event.accountId, 'account-1');
  assert.equal(event.kind, 'read');
  assert.equal(typeof event.readAt, 'number');
  assert.ok(socket.sent.some((message) => message.code === 200 && message.headers?.mid === 'push-40103'));
  await client.disconnect();
});

class FakeSocket {
  readyState = 0;
  sent: Array<Record<string, any>> = [];
  private readonly listeners = new Map<string, Array<(...args: any[]) => void>>();

  send(data: string): void {
    const message = JSON.parse(data) as Record<string, any>;
    this.sent.push(message);
    if (message.lwp === '/reg' || message.lwp === '/r/MessageStatus/read') {
      queueMicrotask(() => this.emit('message', JSON.stringify({ code: 200, headers: { mid: message.headers.mid }, body: {} })));
    }
  }

  close(): void { this.readyState = 3; this.emit('close'); }

  on(event: string, listener: (...args: any[]) => void): this {
    const current = this.listeners.get(event) ?? [];
    current.push(listener);
    this.listeners.set(event, current);
    return this;
  }

  once(event: string, listener: (...args: any[]) => void): this {
    const wrapped = (...args: any[]) => {
      this.removeListener(event, wrapped);
      listener(...args);
    };
    return this.on(event, wrapped);
  }

  removeListener(event: string, listener: (...args: any[]) => void): this {
    const current = this.listeners.get(event) ?? [];
    this.listeners.set(event, current.filter((candidate) => candidate !== listener));
    return this;
  }

  emit(event: string, ...args: any[]): void {
    if (event === 'open') this.readyState = 1;
    for (const listener of [...(this.listeners.get(event) ?? [])]) listener(...args);
  }
}
