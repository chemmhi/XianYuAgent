import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import test from 'node:test';
import WebSocket from 'ws';
import { createVerificationServiceFixture } from './verification-service-fixture.js';
import { sha256 } from '../src/security.js';

async function until<T>(read: () => Promise<T> | T, accepts: (value: T) => boolean) {
  const deadline = Date.now() + 15_000;
  while (true) { const value = await read(); if (accepts(value)) return value; if (Date.now() > deadline) throw new Error(`condition timeout: ${JSON.stringify(value)}`); await new Promise(done => setTimeout(done, 10)); }
}
async function upgradeStatus(url: string, cookie: string, origin?: string) {
  return new Promise<number>((resolve, reject) => {
    const ws = new WebSocket(url, { headers: { cookie, ...(origin ? { origin } : {}) } });
    ws.on('unexpected-response', (_request, response) => { resolve(response.statusCode!); response.resume(); ws.terminate(); });
    ws.on('open', () => { ws.terminate(); reject(new Error('unauthorized upgrade accepted')); });
    ws.on('error', () => undefined);
  });
}

test('live HTTP/WS authorization: Origin, manage scope, real connection/frame, metadata-only human request and revocation', async () => {
  const f = await createVerificationServiceFixture(); const origin = 'http://127.0.0.1:5173'; const clientId = randomUUID();
  let events: WebSocket | undefined; let stream: WebSocket | undefined; let presence: ReturnType<typeof setInterval> | undefined;
  const call = async (path: string, body?: unknown, cookie = f.cookie, csrf = f.csrf) => {
    const res = await fetch(`${f.baseUrl}/api/v1/verification-sessions${path}`, { method: body ? 'POST' : 'GET', headers: { cookie, 'x-csrf-token': csrf, 'idempotency-key': randomUUID(), 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json() as any };
  };
  try {
    const eventsUrl = `${f.baseUrl.replace('http', 'ws')}/api/v1/verification-events?clientInstanceId=${clientId}`;
    assert.equal(await upgradeStatus(eventsUrl, f.cookie, 'https://untrusted.example'), 403);
    assert.equal(await upgradeStatus(eventsUrl, '', origin), 401);
    events = new WebSocket(eventsUrl, { headers: { cookie: f.cookie, origin } });
    const eventMessages: any[] = []; events.on('message', raw => eventMessages.push(JSON.parse(raw.toString()))); await once(events, 'open');
    events.send(JSON.stringify({ type: 'presence', clientInstanceId: clientId, visible: true }));
    presence = setInterval(() => events!.send(JSON.stringify({ type: 'presence', clientInstanceId: clientId, visible: true })), 2000);
    await until(() => eventMessages, rows => rows.some(row => row.type === 'presence-ack'));
    await call('/retry', { accountId: f.account.id, mode: 'manual_only' });
    const list = await until(async () => (await call('?active=true')).body.data.sessions, rows => rows.length === 1);
    const id = list[0].id;
    const other = await f.runtime.store.createAdmin({ email: `${randomUUID()}@example.test`, passwordHash: 'fixture', displayName: 'other', role: 'admin' });
    const csrf = randomUUID(); const authSession = await f.runtime.store.createSession({ adminId: other.id, csrfTokenHash: sha256(csrf), expiresAt: new Date(Date.now() + 60_000).toISOString() });
    const otherCookie = `session_id=${authSession.id}; csrf_token=${csrf}`;
    assert.equal((await call(`/${id}`, undefined, otherCookie, csrf)).status, 404);
    assert.deepEqual((await call('?active=true', undefined, otherCookie, csrf)).body.data.sessions, []);
    await f.runtime.store.grantScope({ adminId: other.id, accountId: f.account.id, scope: 'read' });
    assert.equal((await call(`/${id}`, undefined, otherCookie, csrf)).status, 404, 'read access is insufficient for remote control');
    await f.runtime.store.grantScope({ adminId: other.id, accountId: f.account.id, scope: 'manage' });
    const visibleToManager = await call(`/${id}`, undefined, otherCookie, csrf);
    assert.equal(visibleToManager.status, 200); assert.equal(JSON.stringify(visibleToManager.body.data).includes(f.admin.id), false);
    await call(`/${id}/presentation`, { action: 'reserve', clientInstanceId: clientId });
    stream = new WebSocket(`${f.baseUrl.replace('http', 'ws')}/api/v1/verification-sessions/${id}/stream?clientInstanceId=${clientId}`, { headers: { cookie: f.cookie, origin } });
    const messages: any[] = []; stream.on('message', (raw, binary) => { if (!binary) messages.push(JSON.parse(raw.toString())); }); await once(stream, 'open');
    const hello = await until(() => messages.find(message => message.type === 'hello'), Boolean);
    const frame = await until(() => messages.find(message => message.type === 'frame'), Boolean);
    assert.equal((await call(`/${id}/presentation`, { action: 'ack', clientInstanceId: clientId, connectionId: hello.connectionId, frameId: randomUUID() })).status, 409);
    assert.equal((await call(`/${id}/presentation`, { action: 'ack', clientInstanceId: randomUUID(), connectionId: hello.connectionId, frameId: frame.frameId })).status, 409);
    await call(`/${id}/auto`, { clientInstanceId: clientId, connectionId: hello.connectionId });
    await until(async () => (await call(`/${id}`)).body.data.session.state, state => state === 'auto_active');
    // No display lease, event channel or stream belongs to this second manager.
    // This is only an intent; the HTTP response must grant no control epoch.
    const requested = await call(`/${id}/request-human`, { clientInstanceId: randomUUID() }, otherCookie, csrf);
    assert.equal(requested.status, 200); assert.equal(requested.body.data.session.controller, undefined);
    const closed = once(stream, 'close'); const revokedAt = Date.now();
    await f.runtime.store.revokeScope(f.admin.id, f.account.id, 'manage');
    await closed; assert.ok(Date.now() - revokedAt < 1500, 'revocation stops the stream within the one-second access cadence');
    assert.equal((await call(`/${id}`)).status, 404);
    assert.equal(f.stats.slideAnswers, 0, 'revocation stops both human and automatic actions before a platform answer');
  } finally { if (presence) clearInterval(presence); stream?.terminate(); events?.terminate(); await f.close(); }
});
