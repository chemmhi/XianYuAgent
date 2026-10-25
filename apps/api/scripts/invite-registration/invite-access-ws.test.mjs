import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket } from 'ws';
import { fixture } from './test-support.mjs';

async function waitFor(predicate, message, timeout = 3000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) { if (Date.now() > deadline) throw new Error(message); await delay(10); }
}
async function openSocket(f, path, actor) {
  const frames = [];
  const socket = new WebSocket(f.origin.replace('http:', 'ws:') + path, { headers: { Cookie: actor.cookie, Origin: path.includes('/workspace/') ? f.origin : 'http://localhost:5173' } });
  socket.on('message', value => frames.push(JSON.parse(String(value))));
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  await waitFor(() => frames.length > 0, 'initial realtime snapshot missing');
  return { socket, frames };
}
function closed(socket) {
  return new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('unauthorized websocket remained open')), 3500); socket.once('close', code => { clearTimeout(timer); resolve(code); }); });
}
async function rejectedUpgrade(f, path, actor) {
  const socket = new WebSocket(f.origin.replace('http:', 'ws:') + path, { headers: { Cookie: actor.cookie, Origin: path.includes('/workspace/') ? f.origin : 'http://localhost:5173' } });
  socket.on('error', () => {});
  return new Promise((resolve, reject) => {
    socket.once('open', () => { socket.terminate(); reject(new Error('unauthorized upgrade succeeded')); });
    socket.once('unexpected-response', (_request, response) => { response.resume(); socket.terminate(); resolve(response.statusCode); });
  });
}

for (const kind of ['memory', 'postgres']) test(kind + ': both realtime channels reject post-revocation frames and idle expiry without refreshing sessions', async t => {
  const f = await fixture(kind); t.after(() => f.close());
  const owner = await f.actor('ws-owner@example.com');
  const a = await f.actor('ws-user@example.com', 'user');
  const account = await f.runtime.store.createAccount({ adminId: a.id, platform: 'xianyu', sellerRef: 'ws-grant-account' });
  const session = await f.runtime.store.createAgentSession({ adminId: a.id, accountId: account.id, title: 'Access WS' });
  const { run } = await f.runtime.store.createRun({ adminId: a.id, accountId: account.id, sessionId: session.id, instruction: 'queued read' });
  const conversation = await f.runtime.store.createConversation({ adminId: a.id, accountId: account.id, buyerRef: 'ws-buyer' });
  const workspacePath = `/api/v1/workspace/runs/${run.id}/events`;
  const conversationPath = `/api/v1/conversations/${conversation.id}/events`;
  const authSessionId = a.cookie.match(/session_id=([^;]+)/)[1];
  const before = (await f.runtime.store.findSession(authSessionId)).lastSeenAt;
  const sockets = await Promise.all([workspacePath, conversationPath].map(path => openSocket(f, path, a)));
  t.after(() => sockets.forEach(item => item.socket.terminate()));
  await delay(1100);
  assert.equal((await f.runtime.store.findSession(authSessionId)).lastSeenAt, before, 'heartbeat/upgrade must not refresh idle time');
  const closeEvents = sockets.map(item => closed(item.socket));
  assert.equal((await f.request(`/api/v1/auth/invites/${a.inviteId}/disable`, { ...owner, method: 'POST', key: randomUUID(), body: {} })).status, 200);
  await f.runtime.store.appendRunEvent({ runId: run.id, eventType: 'access.secret', payload: { secret: 'AFTER_DISABLE_SENTINEL' } });
  f.runtime.messages.realtime.publish({ eventId: randomUUID(), conversationId: conversation.id, accountId: account.id, cursor: 1, type: 'chat.message.created', occurredAt: new Date().toISOString(), traceId: 'access-test', payload: { secret: 'AFTER_DISABLE_SENTINEL' } });
  assert.deepEqual(await Promise.all(closeEvents), [1008, 1008]);
  for (const item of sockets) assert.ok(!JSON.stringify(item.frames).includes('AFTER_DISABLE_SENTINEL'));
  assert.equal(f.runtime.messages.realtime.listeners.get(conversation.id)?.size ?? 0, 0, 'revocation unsubscribes conversation listener');
  assert.equal(await rejectedUpgrade(f, workspacePath, a), 401);
  assert.equal(await rejectedUpgrade(f, conversationPath, a), 401);
  assert.equal((await f.request(`/api/v1/auth/invites/${a.inviteId}/enable`, { ...owner, method: 'POST', key: randomUUID(), body: {} })).status, 200);
  const resumed = await Promise.all([workspacePath, conversationPath].map(path => openSocket(f, path, a)));
  t.after(() => resumed.forEach(item => item.socket.terminate()));
  const expiryEvents = resumed.map(item => closed(item.socket));
  await f.runtime.store.renewInvite(owner.id, a.inviteId, new Date(Date.now() - 1).toISOString());
  assert.deepEqual(await Promise.all(expiryEvents), [1008, 1008], 'idle streams close after expiry even without new events');
  assert.equal(f.runtime.messages.realtime.listeners.get(conversation.id)?.size ?? 0, 0);
});
