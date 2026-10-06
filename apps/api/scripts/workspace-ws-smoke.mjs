import assert from 'node:assert/strict';
import net from 'node:net';
import { randomBytes } from 'node:crypto';
import { createApp } from '../dist/app.js';

const port = 18580 + (process.pid % 300);
const runtime = createApp({ host: '127.0.0.1', port, cookieSecure: false, allowInMemory: true, sessionIdleMs: 1_800_000, sessionAbsoluteMs: 28_800_000, xianyuQrMode: 'stub' });
await runtime.listen();

function cookiesFrom(response) { return (response.headers.getSetCookie?.() ?? []).map((value) => value.split(';', 1)[0]).join('; '); }
async function request(path, options = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { ...options, headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers ?? {}) } });
  const body = await response.json();
  return { response, body };
}

function frameParser(socket, initialBuffer = Buffer.alloc(0)) {
  let buffer = initialBuffer;
  let closed = false;
  const queue = [];
  const waiters = [];

  const deliver = (frame) => {
    const waiter = waiters.shift();
    if (waiter) {
      clearTimeout(waiter.timer);
      waiter.resolve(frame);
    } else {
      queue.push(frame);
    }
  };

  const parse = () => {
    while (buffer.length >= 2) {
      const first = buffer[0];
      const second = buffer[1];
      const opcode = first & 0x0f;
      const masked = (second & 0x80) !== 0;
      let payloadLength = second & 0x7f;
      let offset = 2;
      if (payloadLength === 126) {
        if (buffer.length < 4) return;
        payloadLength = buffer.readUInt16BE(2);
        offset = 4;
      } else if (payloadLength === 127) {
        if (buffer.length < 10) return;
        const length = buffer.readBigUInt64BE(2);
        if (length > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('websocket frame too large');
        payloadLength = Number(length);
        offset = 10;
      }
      const maskLength = masked ? 4 : 0;
      if (buffer.length < offset + maskLength + payloadLength) return;
      const mask = masked ? buffer.subarray(offset, offset + 4) : undefined;
      const payloadStart = offset + maskLength;
      const payload = Buffer.from(buffer.subarray(payloadStart, payloadStart + payloadLength));
      buffer = buffer.subarray(payloadStart + payloadLength);
      if (mask) for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index % 4];
      if (opcode === 0x8) {
        closed = true;
        deliver({ opcode, payload });
        for (const waiter of waiters.splice(0)) {
          clearTimeout(waiter.timer);
          waiter.resolve(null);
        }
        return;
      }
      deliver({ opcode, payload });
    }
  };

  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    try { parse(); } catch (error) {
      closed = true;
      for (const waiter of waiters.splice(0)) {
        clearTimeout(waiter.timer);
        waiter.reject(error);
      }
    }
  });
  socket.on('close', () => {
    closed = true;
    for (const waiter of waiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.resolve(null);
    }
  });
  socket.on('error', () => { closed = true; });
  parse();

  return {
    nextFrame(timeoutMs = 2_000) {
      if (queue.length) return Promise.resolve(queue.shift());
      if (closed) return Promise.resolve(null);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const index = waiters.findIndex((waiter) => waiter.resolve === resolve);
          if (index >= 0) waiters.splice(index, 1);
          reject(new Error('websocket frame timeout'));
        }, timeoutMs);
        waiters.push({ resolve, reject, timer });
      });
    },
    close() { closed = true; socket.destroy(); },
  };
}

async function requestUpgrade(path, headers = {}) {
  const key = randomBytes(16).toString('base64');
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    let handshakeBuffer = Buffer.alloc(0);
    let handshakeDone = false;
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error(`websocket handshake timeout: ${path}`));
    }, 2_000);
    const finish = (result) => { clearTimeout(timeout); resolve(result); };
    socket.once('connect', () => {
      const requestLines = [
        `GET ${path} HTTP/1.1`,
        `Host: 127.0.0.1:${port}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Key: ${key}`,
        'Sec-WebSocket-Version: 13',
        ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`),
        '',
        '',
      ];
      socket.write(requestLines.join('\r\n'));
    });
    socket.on('data', (chunk) => {
      if (handshakeDone) return;
      handshakeBuffer = Buffer.concat([handshakeBuffer, chunk]);
      const separator = handshakeBuffer.indexOf('\r\n\r\n');
      if (separator < 0) return;
      handshakeDone = true;
      const headerText = handshakeBuffer.subarray(0, separator).toString('latin1');
      const status = Number(headerText.match(/^HTTP\/1\.1 (\d+)/)?.[1] ?? 0);
      if (status !== 101) {
        socket.destroy();
        finish({ status, headerText });
        return;
      }
      const parser = frameParser(socket, handshakeBuffer.subarray(separator + 4));
      finish({ status, headerText, socket, ...parser });
    });
    socket.on('error', (error) => { if (!handshakeDone) { clearTimeout(timeout); reject(error); } });
    socket.on('close', () => {
      if (!handshakeDone) {
        clearTimeout(timeout);
        reject(new Error(`websocket closed during handshake: ${path}`));
      }
    });
  });
}

async function waitForRun(runId, cookie) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const current = await request(`/api/v1/workspace/runs/${runId}`, { headers: { cookie } });
    if (['succeeded', 'failed', 'cancelled', 'expired'].includes(current.body.data.status)) return current.body.data;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('workspace run did not reach terminal state');
}

try {
  const bootstrap = await request('/api/v1/auth/bootstrap', { method: 'POST', headers: { 'Idempotency-Key': 'workspace-ws-bootstrap' }, body: JSON.stringify({ email: 'workspace-ws@example.com', password: 'password-123', displayName: 'Workspace WS Test' }) });
  assert.equal(bootstrap.response.status, 200);
  const cookie = cookiesFrom(bootstrap.response);
  const csrf = decodeURIComponent(cookie.match(/csrf_token=([^;]+)/)?.[1] ?? '');
  assert.ok(csrf);

  const account = await request('/api/v1/accounts', { method: 'POST', headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': 'workspace-ws-account' }, body: JSON.stringify({ platform: 'xianyu', sellerRef: 'workspace-ws-seller', displayName: 'Workspace WS Account' }) });
  assert.equal(account.response.status, 201);
  const accountId = account.body.data.id;
  const createdSession = await request('/api/v1/workspace/agent-sessions', { method: 'POST', headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': 'workspace-ws-session' }, body: JSON.stringify({ accountId, title: 'Workspace WS 首条链路', summary: 'workspace ws smoke' }) });
  assert.equal(createdSession.response.status, 201);
  const sessionId = createdSession.body.data.id;

  const started = await request('/api/v1/workspace/runs', { method: 'POST', headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': 'workspace-ws-run' }, body: JSON.stringify({ accountId, sessionId, instruction: '验证首条 Run 实时事件流', clientRunRef: 'workspace-ws-run-001' }) });
  assert.equal(started.response.status, 201);
  const runId = started.body.data.runId;

  const live = await requestUpgrade(`/api/v1/workspace/runs/${encodeURIComponent(runId)}/events?after=NaN`, { Cookie: cookie, Origin: `http://127.0.0.1:${port}` });
  assert.equal(live.status, 101);
  const liveEvents = [];
  let sawSnapshot = false;
  while (!liveEvents.some((event) => event.event.eventType === 'run.succeeded')) {
    const frame = await live.nextFrame();
    assert.ok(frame, 'live websocket closed before run.succeeded');
    if (frame.opcode !== 1) continue;
    const message = JSON.parse(frame.payload.toString('utf8'));
    if (message.type === 'snapshot') { sawSnapshot = true; assert.equal(message.cursor, 0); continue; }
    if (message.type === 'event') liveEvents.push(message);
  }
  assert.ok(sawSnapshot);
  assert.ok(liveEvents.some((event) => event.event.eventType === 'run.queued'));
  assert.ok(liveEvents.some((event) => event.event.eventType === 'run.succeeded'));
  assert.deepEqual(liveEvents.map((event) => event.cursor), [...liveEvents].map((event) => event.cursor).sort((left, right) => left - right));
  const firstSequence = liveEvents[0].cursor;
  live.close();

  // A stale client may keep a stream open after its workspace session is
  // deleted. The server must close that stream without crashing the process.
  const stale = await requestUpgrade(`/api/v1/workspace/runs/${encodeURIComponent(runId)}/events?after=0`, { Cookie: cookie, Origin: `http://127.0.0.1:${port}` });
  assert.equal(stale.status, 101);
  await runtime.store.deleteAgentSession((await runtime.store.findAdminByEmail('workspace-ws@example.com')).id, sessionId);
  const staleFrames = [];
  for (;;) {
    const frame = await stale.nextFrame(2_000);
    if (!frame) break;
    staleFrames.push(frame);
  }
  assert.equal(staleFrames[0]?.opcode, 1);

  const completed = await waitForRun(runId, cookie);
  assert.equal(completed.status, 'succeeded');
  const replay = await requestUpgrade(`/api/v1/workspace/runs/${encodeURIComponent(runId)}/events?after=${firstSequence}`, { Cookie: cookie, Origin: `http://127.0.0.1:${port}` });
  assert.equal(replay.status, 101);
  const replayEvents = [];
  while (!replayEvents.some((event) => event.event.eventType === 'run.succeeded')) {
    const frame = await replay.nextFrame();
    assert.ok(frame, 'replay websocket closed before run.succeeded');
    if (frame.opcode !== 1) continue;
    const message = JSON.parse(frame.payload.toString('utf8'));
    if (message.type === 'event') replayEvents.push(message);
  }
  assert.ok(replayEvents.every((event) => event.cursor > firstSequence));
  replay.close();

  const unauthenticated = await requestUpgrade(`/api/v1/workspace/runs/${encodeURIComponent(runId)}/events`, { Origin: `http://127.0.0.1:${port}` });
  assert.equal(unauthenticated.status, 401);
  const originForbidden = await requestUpgrade(`/api/v1/workspace/runs/${encodeURIComponent(runId)}/events`, { Cookie: cookie, Origin: 'http://evil.example' });
  assert.equal(originForbidden.status, 403);
  const notFound = await requestUpgrade('/api/v1/workspace/runs/does-not-exist/events', { Cookie: cookie, Origin: `http://127.0.0.1:${port}` });
  assert.equal(notFound.status, 404);

  // A deleted run must close its old stream without taking down the API.
  const staleSession = await request('/api/v1/workspace/agent-sessions', { method: 'POST', headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': 'workspace-ws-stale-session' }, body: JSON.stringify({ accountId, title: 'Workspace WS 删除回归', summary: 'workspace ws stale run' }) });
  assert.equal(staleSession.response.status, 201);
  const adminId = (await runtime.store.listAdminIds())[0];
  const staleRun = await runtime.store.createRun({ adminId, accountId, sessionId: staleSession.body.data.id, instruction: '保持实时流以验证删除回归', clientRunRef: 'workspace-ws-stale-run' });
  await runtime.store.appendRunEvent({ runId: staleRun.run.id, eventType: 'run.queued', payload: { status: 'queued' } });
  const deletedRunSocket = await requestUpgrade(`/api/v1/workspace/runs/${encodeURIComponent(staleRun.run.id)}/events`, { Cookie: cookie, Origin: `http://127.0.0.1:${port}` });
  assert.equal(deletedRunSocket.status, 101);
  assert.ok(await deletedRunSocket.nextFrame(), 'stale websocket did not send snapshot');
  await runtime.store.deleteAgentSession(adminId, staleSession.body.data.id);
  let staleClosed = false;
  for (let index = 0; index < 3; index += 1) {
    if (await deletedRunSocket.nextFrame() === null) { staleClosed = true; break; }
  }
  assert.equal(staleClosed, true);
  const health = await request('/healthz');
  assert.equal(health.response.status, 200);

  console.log('workspace websocket smoke passed');
} finally {
  await runtime.close();
}
