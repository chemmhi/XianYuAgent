import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import WebSocket from 'ws';
import { createVerificationServiceFixture } from './verification-service-fixture.js';

const latch = () => { let open!: () => void; const promise = new Promise<void>(resolve => { open = resolve; }); return { promise, open }; };
async function until<T>(read: () => Promise<T> | T, predicate: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 15_000;
  while (true) { const value = await read(); if (predicate(value)) return value; if (Date.now() > deadline) throw new Error('fixture timeout'); await new Promise(resolve => setTimeout(resolve, 10)); }
}
async function prepare() {
  const fixture = await createVerificationServiceFixture(); const clientId = randomUUID(); const origin = 'http://127.0.0.1:5173';
  const call = async (id: string, action: string, body: unknown) => {
    const response = await fetch(`${fixture.baseUrl}/api/v1/verification-sessions/${id ? `${id}/` : ''}${action}`, { method: 'POST', headers: { cookie: fixture.cookie,
      'x-csrf-token': fixture.csrf, 'idempotency-key': randomUUID(), 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const envelope: any = await response.json(); assert.equal(response.status < 300, true, JSON.stringify(envelope)); return envelope.data;
  };
  const events = new WebSocket(`${fixture.baseUrl.replace('http', 'ws')}/api/v1/verification-events?clientInstanceId=${clientId}`, { headers: { origin, cookie: fixture.cookie } });
  const eventMessages: any[] = []; events.on('message', raw => eventMessages.push(JSON.parse(raw.toString()))); await once(events, 'open');
  const visible = () => { if (events.readyState === WebSocket.OPEN) events.send(JSON.stringify({ type: 'presence', clientInstanceId: clientId, visible: true })); };
  visible(); const presence = setInterval(visible, 2000); await until(() => eventMessages, rows => rows.some(row => row.type === 'presence-ack'));
  await call('', 'retry', { accountId: fixture.account.id, mode: 'manual_only' });
  const row = await until(async () => (await fixture.runtime.verification!.coordinator.repository.list())[0], Boolean);
  await call(row.id, 'presentation', { action: 'reserve', clientInstanceId: clientId });
  const stream = new WebSocket(`${fixture.baseUrl.replace('http', 'ws')}/api/v1/verification-sessions/${row.id}/stream?clientInstanceId=${clientId}`, { headers: { origin, cookie: fixture.cookie } });
  const messages: any[] = []; let images = 0; stream.on('message', (raw, binary) => { if (binary) images++; else messages.push(JSON.parse(raw.toString())); }); await once(stream, 'open');
  const hello = await until(() => messages.find(message => message.type === 'hello'), Boolean);
  const frame = await until(() => messages.find(message => message.type === 'frame'), Boolean);
  return { ...fixture, row, stream, events, clientId, messages, eventMessages, hello, frame, call, images: () => images,
    async finish() { clearInterval(presence); stream.terminate(); events.terminate(); await fixture.close(); } };
}

for (const waitPoint of ['dto', 'can-send', 'closed-input-queue'] as const) test(`real WS rejects data and actions invalidated while waiting at ${waitPoint}`, async () => {
  const f = await prepare(); const entered = latch(), gate = latch();
  try {
    if (waitPoint === 'closed-input-queue') {
      const presented = await f.call(f.row.id, 'presentation', { action: 'ack', clientInstanceId: f.clientId, connectionId: f.hello.connectionId, frameId: f.frame.frameId });
      const claimed = await f.call(f.row.id, 'claim', { action: 'claim', clientInstanceId: f.clientId, connectionId: f.hello.connectionId, frameId: f.frame.frameId, expectedVersion: presented.session.version });
      const original = f.runtime.auth.accessFromSession.bind(f.runtime.auth); let arm = true;
      f.runtime.auth.accessFromSession = async value => { if (arm) { arm = false; entered.open(); await gate.promise; } return original(value); };
      for (const [index, action] of ['down', 'move', 'up'].entries()) f.stream.send(JSON.stringify({ type: 'pointer', commandId: randomUUID(), action, sequence: index + 1,
        controlEpoch: claimed.session.controlEpoch, frameId: f.frame.frameId, streamEpoch: f.frame.streamEpoch, geometryRevision: f.frame.geometryRevision, x: index ? .95 : .05, y: .5 }));
      await entered.promise;
      const closed = once(f.stream, 'close'); f.stream.terminate(); await closed;
      await f.runtime.store.revokeSession(f.session.id, 'fixture revoked while input awaited admission'); gate.open();
      await new Promise(resolve => setTimeout(resolve, 100));
      assert.equal(f.stats.pointerDowns, 0, 'closed socket never executes its queued down/move/up');
      return;
    }
    if (waitPoint === 'dto') {
      const original = f.runtime.verification!.dto.bind(f.runtime.verification); let arm = true;
      f.runtime.verification!.dto = async value => { if (arm) { arm = false; entered.open(); await gate.promise; } return original(value); };
      f.runtime.verification!.coordinator.events.emit('updated', { ...await f.runtime.verification!.coordinator.snapshot(f.row.id, f.admin.id), eventSequence: f.row.eventSequence + 10 });
    } else {
      const browser = (f.runtime.verification!.coordinator as any).active.get(f.row.id).challenge.browser;
      const original = browser.canSend.bind(browser); let calls = 0;
      browser.canSend = async (...args: unknown[]) => { if (++calls === 4) { entered.open(); await gate.promise; } return original(...args); };
    }
    await entered.promise;
    const images = f.images(); const messages = f.messages.length; const eventMessages = f.eventMessages.length;
    if (waitPoint === 'dto') await f.runtime.store.revokeSession(f.session.id, 'fixture auth revoked during DTO');
    else await f.runtime.store.revokeScope(f.admin.id, f.account.id, 'manage');
    const closed = once(f.stream, 'close'); gate.open(); await closed;
    await new Promise(resolve => setTimeout(resolve, 40));
    assert.equal(f.images(), images, 'no binary image is sent after the await invalidates authority');
    assert.equal(f.messages.slice(messages).some(message => ['hello', 'session.updated', 'frame'].includes(message.type)), false, 'stream metadata is also fenced');
    assert.equal(f.eventMessages.slice(eventMessages).some(message => message.type === 'session.updated'), false, 'event DTO must recheck session and subject after storage');
  } finally { gate.open(); await f.finish(); }
});

test('slow DTO consumers coalesce thousands of live updates into bounded latest state for events and stream', async () => {
  const f = await prepare(); const entered = latch(), gate = latch(); let calls = 0;
  try {
    const runtime = f.runtime.verification!; const original = runtime.dto.bind(runtime);
    runtime.dto = async row => { calls++; if (calls <= 2) { entered.open(); await gate.promise; } return original(row); };
    const latest = { ...await runtime.coordinator.snapshot(f.row.id, f.admin.id), eventSequence: 10_001, version: 10_001 };
    runtime.coordinator.events.emit('updated', { ...latest, eventSequence: 2, version: 2 });
    await entered.promise;
    for (let sequence = 3; sequence <= 10_001; sequence++) runtime.coordinator.events.emit('updated', { ...latest, eventSequence: sequence, version: sequence });
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(calls <= 2, `at most one DTO runs per channel while storage is held: ${calls}`);
    gate.open();
    await until(() => f.eventMessages, messages => messages.some(message => message.type === 'session.updated' && message.eventSequence === 10_001));
    await until(() => f.messages, messages => messages.some(message => message.type === 'session.updated' && message.eventSequence === 10_001));
    assert.ok(calls <= 4, `intermediate pending states are replaced, never queued: ${calls}`);
  } finally { gate.open(); await f.finish(); }
});
