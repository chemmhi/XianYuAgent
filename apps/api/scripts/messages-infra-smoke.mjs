import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createApp } from '../dist/app.js';
import { loadConfig } from '../dist/config.js';
import { hashPassword } from '../dist/security.js';
import { encodeMessageHistoryCursor } from '../dist/message-history-cursor.js';
import { WebSocket } from 'ws';

const execFileAsync = promisify(execFile);
const databaseUrl = process.env.DATABASE_URL ?? 'postgres://xianyu:xianyu_dev_only@127.0.0.1:5432/xianyu_agent';
const redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
const origin = 'http://localhost:5173';
const suffix = `${process.pid}-${Date.now()}`;
const port1 = 18680 + Math.floor(Math.random() * 120);
const port2 = port1 + 1;
const email = `messages-infra-${suffix}@example.com`;
const runtimes = [];
let ws;
let adminId;
let accountId;
let conversationId;
let paginationConversationId;

function cookiesFrom(response) {
  const setCookies = response.headers.getSetCookie?.() ?? [];
  return setCookies.map((value) => value.split(';', 1)[0]).join('; ');
}

function csrfFrom(cookie) {
  return decodeURIComponent(cookie.match(/csrf_token=([^;]+)/)?.[1] ?? '');
}

async function request(port, path, options = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.headers ?? {}),
    },
  });
  const body = await response.json();
  return { response, body };
}

async function waitFor(label, predicate, timeoutMs = 20_000, intervalMs = 250) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await predicate();
    if (last) return last;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`${label} timeout${last ? `: ${JSON.stringify(last)}` : ''}`);
}

async function retry(label, operation, attempts = 12) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return { value: await operation(), attempts: attempt };
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, Math.min(1_000, attempt * 250)));
    }
  }
  throw new Error(`${label} failed after ${attempts} attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

function waitForMessage(socket, predicate, timeoutMs = 8_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('message', onMessage);
      reject(new Error('websocket event timeout'));
    }, timeoutMs);
    const onMessage = (raw) => {
      const event = JSON.parse(raw.toString());
      if (!predicate(event)) return;
      clearTimeout(timer);
      socket.off('message', onMessage);
      resolve(event);
    };
    socket.on('message', onMessage);
  });
}

async function openSocket(port, cookie) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/api/v1/conversations/${conversationId}/events?cursor=0`, {
    headers: { Cookie: cookie, Origin: origin },
  });
  await Promise.race([
    new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('websocket open timeout')), 5_000)),
  ]);
  await waitForMessage(socket, (event) => event.type === 'chat.connection.changed', 5_000);
  return socket;
}

async function restartService(service) {
  const container = service === 'redis' ? process.env.REDIS_CONTAINER : process.env.POSTGRES_CONTAINER;
  const args = container ? ['restart', container] : ['compose', 'restart', service];
  console.log(`messages infra smoke: docker ${args.join(' ')}`);
  await execFileAsync('docker', args, { windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
}

async function cleanup() {
  if (ws) {
    try { ws.close(); } catch {}
    await new Promise((resolve) => ws.once('close', resolve));
  }
  if (runtimes[0]?.store?.pool && adminId) {
    const pool = runtimes[0].store.pool;
    try {
      await pool.query('begin');
      for (const id of [conversationId, paginationConversationId].filter(Boolean)) {
        await pool.query('delete from messages.events where conversation_id=$1', [id]);
        await pool.query('delete from messages.messages where conversation_id=$1', [id]);
        await pool.query('delete from messages.conversations where id=$1', [id]);
      }
      if (accountId) {
        await pool.query('delete from auth.account_scopes where account_id=$1', [accountId]);
        await pool.query('delete from auth.account_credentials where account_id=$1', [accountId]);
        await pool.query('delete from accounts.accounts where id=$1', [accountId]);
      }
      await pool.query('delete from auth.sessions where admin_id=$1', [adminId]);
      await pool.query('delete from observability.audit_events where actor_id=$1', [adminId]);
      await pool.query('delete from auth.admins where id=$1', [adminId]);
      await pool.query('commit');
    } catch {
      try { await pool.query('rollback'); } catch {}
    }
  }
  for (const runtime of runtimes.reverse()) {
    try { await runtime.close(); } catch {}
  }
}

try {
  console.log('messages infra smoke: start two API runtimes');
  const env = {
    ...process.env,
    HOST: '127.0.0.1',
    ALLOW_IN_MEMORY: 'false',
    DATABASE_URL: databaseUrl,
    REDIS_URL: redisUrl,
    COOKIE_SECURE: 'false',
    XIANYU_QR_MODE: 'stub',
    WS_ALLOWED_ORIGINS: origin,
  };
  const runtime1 = createApp(loadConfig({ ...env, PORT: String(port1) }));
  const runtime2 = createApp(loadConfig({ ...env, PORT: String(port2) }));
  runtimes.push(runtime1, runtime2);
  await Promise.all(runtimes.map((runtime) => runtime.listen()));
  await waitFor('postgres health', async () => (await runtime1.store.health()).reachable);
  await waitFor('redis health', async () => (await runtime1.redisRealtime?.health())?.reachable && (await runtime2.redisRealtime?.health())?.reachable);

  const admin = await runtime1.store.createAdmin({ email, passwordHash: await hashPassword('password-123'), displayName: 'Messages Infra Smoke' });
  const login = await runtime1.auth.login({ email, password: 'password-123' });
  adminId = admin.id;
  const cookie = `session_id=${login.session.id}; csrf_token=${encodeURIComponent(login.csrfToken)}`;
  const csrf = login.csrfToken;
  const account = await request(port1, '/api/v1/accounts', {
    method: 'POST',
    headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': `messages-infra-account-${suffix}` },
    body: JSON.stringify({ platform: 'xianyu', sellerRef: `messages-infra-${suffix}`, displayName: 'Messages Infra' }),
  });
  assert.equal(account.response.status, 201);
  accountId = account.body.data.id;
  const conversation = await runtime1.store.createConversation({ adminId, accountId, buyerRef: `buyer-${suffix}`, externalConversationRef: `infra-${suffix}` });
  conversationId = conversation.id;
  const paginationConversation = await runtime1.store.createConversation({ adminId, accountId, buyerRef: `buyer-pagination-${suffix}`, externalConversationRef: `infra-pagination-${suffix}` });
  paginationConversationId = paginationConversation.id;
  // Use deterministic sub-second timestamps to guard the opaque cursor's
  // millisecond precision (Date#toString would otherwise truncate them).
  await runtime1.store.pool.query("update messages.conversations set updated_at=$2 where id=$1", [conversationId, '2026-01-01T00:00:00.123456Z']);
  await runtime1.store.pool.query("update messages.conversations set updated_at=$2 where id=$1", [paginationConversationId, '2026-01-01T00:00:00.122456Z']);
  const firstConversationPage = await runtime1.store.listConversations(adminId, { accountId, limit: 1 });
  assert.equal(firstConversationPage.items.length, 1);
  assert.equal(firstConversationPage.hasMore, true);
  assert.equal(firstConversationPage.items[0].updatedAt, '2026-01-01T00:00:00.123Z');
  const secondConversationPage = await runtime1.store.listConversations(adminId, { accountId, limit: 1, cursor: firstConversationPage.nextCursor });
  assert.equal(secondConversationPage.items.length, 1);
  assert.notEqual(secondConversationPage.items[0].id, firstConversationPage.items[0].id);
  console.log('messages infra smoke: PostgreSQL conversation cursor precision passed');

  const paginationMessages = [];
  for (const [index, createdAt] of ['2030-01-01T00:00:01.000Z', '2030-01-01T00:00:02.000Z', '2030-01-01T00:00:03.000Z'].entries()) {
    paginationMessages.push(await runtime1.store.createMessage({ adminId, conversationId: paginationConversationId, direction: 'inbound', senderRole: 'buyer', bodyType: 'text', bodyText: `history-${index + 1}`, source: 'system', createdAt, traceId: `history-${index + 1}` }));
  }
  const historyHead = await runtime1.store.listMessages(adminId, paginationConversationId, { limit: 2 });
  assert.deepEqual(historyHead.items.map((message) => message.id), [paginationMessages[1].message.id, paginationMessages[2].message.id]);
  assert.equal(historyHead.hasMoreHistory, true);
  const historyCursor = encodeMessageHistoryCursor({ beforeCreatedAt: historyHead.items[0].createdAt, beforeMessageId: historyHead.items[0].id });
  const historyOlder = await runtime1.store.listMessages(adminId, paginationConversationId, { limit: 2, beforeCursor: historyCursor });
  assert.deepEqual(historyOlder.items.map((message) => message.id), [paginationMessages[0].message.id]);
  assert.equal(historyOlder.hasMoreHistory, false);
  console.log('messages infra smoke: PostgreSQL message history pagination passed');

  ws = await openSocket(port2, cookie);
  await runtime1.messages.createMessage({ adminId, conversationId, direction: 'inbound', senderRole: 'buyer', bodyType: 'text', bodyText: 'cross process before restart', source: 'system', requestId: `infra-before-${suffix}`, traceId: `infra-before-${suffix}` });
  const beforeRestart = await waitForMessage(ws, (event) => event.type === 'chat.message.created' && event.payload?.message?.bodyText === 'cross process before restart');
  assert.equal(beforeRestart.payload.message.conversationId, conversationId);
  console.log('messages infra smoke: Redis cross-process broadcast passed');

  await restartService('redis');
  await waitFor('Redis recovery', async () => {
    const [left, right] = await Promise.all([runtime1.redisRealtime?.health(), runtime2.redisRealtime?.health()]);
    return left?.reachable && right?.reachable && left.subscriberStatus === 'ready' && right.subscriberStatus === 'ready';
  }, 30_000);
  await runtime1.messages.createMessage({ adminId, conversationId, direction: 'inbound', senderRole: 'buyer', bodyType: 'text', bodyText: 'cross process after redis restart', source: 'system', requestId: `infra-redis-after-${suffix}`, traceId: `infra-redis-after-${suffix}` });
  const afterRedisRestart = await waitForMessage(ws, (event) => event.type === 'chat.message.created' && event.payload?.message?.bodyText === 'cross process after redis restart');
  assert.equal(afterRedisRestart.payload.message.conversationId, conversationId);
  console.log('messages infra smoke: Redis restart recovery passed');

  await restartService('postgres');
  await waitFor('PostgreSQL recovery', async () => (await runtime1.store.health()).reachable, 30_000);
  const readback = await retry('PostgreSQL message readback', () => runtime1.messages.listMessages(adminId, conversationId, {}));
  assert.ok(readback.value.items.some((message) => message.bodyText === 'cross process after redis restart'));
  await retry('PostgreSQL message write recovery', () => runtime1.messages.createMessage({ adminId, conversationId, direction: 'inbound', senderRole: 'buyer', bodyType: 'text', bodyText: 'after postgres restart', source: 'system', requestId: `infra-pg-after-${suffix}`, traceId: `infra-pg-after-${suffix}` }));
  const afterPostgresRestart = await waitForMessage(ws, (event) => event.type === 'chat.message.created' && event.payload?.message?.bodyText === 'after postgres restart');
  assert.equal(afterPostgresRestart.payload.message.conversationId, conversationId);
  console.log(`messages infra smoke: PostgreSQL restart recovery passed (read attempts=${readback.attempts})`);
  console.log('messages infra smoke passed');
} finally {
  await cleanup();
}
