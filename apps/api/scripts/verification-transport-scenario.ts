import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import WebSocket from 'ws';
import { createVerificationServiceFixture } from './verification-service-fixture.js';
import { sha256 } from '../src/security.js';

async function until<T>(read: () => Promise<T> | T, accept: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 20_000;
  while (true) { const value = await read(); if (accept(value)) return value; if (Date.now() > deadline) throw new Error(`condition timeout: ${JSON.stringify(value)}`); await new Promise(done => setTimeout(done, 20)); }
}
function inbox(socket: WebSocket) {
  const json: any[] = []; const binary: Buffer[] = [];
  socket.on('message', (raw, isBinary) => { if (isBinary) binary.push(Buffer.from(raw as any)); else json.push(JSON.parse(raw.toString())); });
  return { json, binary, next: (type: string) => until(() => json.find(message => message.type === type), Boolean) };
}

export async function verificationTransportScenario(databaseUrl?: string, nativeChallenge = false, rejectFirstSlide = false, continuous = false, processingDelayMs = 0) {
  const f = await createVerificationServiceFixture({ databaseUrl, nativeChallenge, rejectFirstSlide }); const origin = 'http://127.0.0.1:5173';
  const clientId = randomUUID(); let eventSocket: WebSocket | undefined; let stream: WebSocket | undefined; let presence: ReturnType<typeof setInterval> | undefined;
  const call = async (path: string, body?: unknown, key = randomUUID(), csrf = f.csrf, cookie = f.cookie) => {
    const response = await fetch(`${f.baseUrl}/api/v1/verification-sessions${path}`, { method: body ? 'POST' : 'GET',
      headers: { cookie, 'content-type': 'application/json', 'x-csrf-token': csrf, 'idempotency-key': key }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json() as any };
  };
  try {
    assert.equal((await call('/retry', { accountId: f.account.id, mode: 'manual_only' }, randomUUID(), 'bad')).status, 403);
    eventSocket = new WebSocket(`${f.baseUrl.replace('http', 'ws')}/api/v1/verification-events?clientInstanceId=${clientId}`, { headers: { cookie: f.cookie, origin } });
    const events = inbox(eventSocket); await once(eventSocket, 'open'); await events.next('snapshot');
    const visible = () => eventSocket!.send(JSON.stringify({ type: 'presence', clientInstanceId: clientId, visible: true }));
    visible(); presence = setInterval(visible, 2_000); await new Promise(done => setTimeout(done, 30));
    const before = await f.runtime.store.findSession(f.session.id);
    assert.equal((await call('/retry', { accountId: f.account.id, mode: 'manual_only' })).status, 202);
    const sessions = await until(async () => (await call('?active=true')).body.data.sessions, rows => rows.length === 1);
    const id = sessions[0].id;
    assert.equal(sessions[0].mode, 'manual_only'); assert.equal(sessions[0].priorityDeadline, undefined);
    assert.equal((await call(`/${id}/presentation`, { action: 'reserve', clientInstanceId: clientId })).status, 200);
    stream = new WebSocket(`${f.baseUrl.replace('http', 'ws')}/api/v1/verification-sessions/${id}/stream?clientInstanceId=${clientId}`, { headers: { cookie: f.cookie, origin } });
    let frames = inbox(stream); await once(stream, 'open'); let hello = await frames.next('hello'); let frame = await frames.next('frame');
    await until(() => frames.binary.length, count => count > 0);
    assert.equal(frames.binary[0][0], 0xff); assert.equal(frames.binary[0][1], 0xd8); assert.equal(frame.width, nativeChallenge ? 420 : 320); assert.equal(frame.height, nativeChallenge ? 320 : 50);
    if (nativeChallenge) {
      const originalPage = f.contexts[0].pages()[0]; assert.equal(originalPage.url(), 'https://www.goofish.com/robots.txt');
      assert.equal(originalPage.frames().length, 2); assert.equal(await originalPage.locator('#xianyu-native-challenge-frame').getAttribute('sandbox'), 'allow-scripts allow-forms allow-same-origin');
    }
    const ack = await call(`/${id}/presentation`, { action: 'ack', clientInstanceId: clientId, connectionId: hello.connectionId, frameId: frame.frameId });
    assert.equal(ack.status, 200); assert.equal(ack.body.data.session.state, 'priority_wait');
    assert.equal((await call(`/${id}/claim`, { action: 'claim', clientInstanceId: clientId, connectionId: randomUUID(), frameId: frame.frameId, expectedVersion: ack.body.data.session.version })).status, 409);
    const claimBody = { action: 'claim', clientInstanceId: clientId, connectionId: hello.connectionId, frameId: frame.frameId, expectedVersion: ack.body.data.session.version };
    const claimKey = randomUUID(); let claim = await call(`/${id}/claim`, claimBody, claimKey);
    assert.equal(claim.status, 200); assert.equal(claim.body.data.session.state, 'human_active');
    assert.deepEqual((await call(`/${id}/claim`, claimBody, claimKey)).body.data, claim.body.data, 'HTTP idempotency returns the original grant');
    const originalDeadline = claim.body.data.session.humanDeadline;
    assert.equal((await call(`/${id}/claim`, { ...claimBody, action: 'resume', expectedVersion: claim.body.data.session.version })).status, 409, 'a live controller is not a reconnect grace period');
    const second = new WebSocket(`${f.baseUrl.replace('http', 'ws')}/api/v1/verification-sessions/${id}/stream?clientInstanceId=${clientId}`, { headers: { cookie: f.cookie, origin } });
    const secondInbox = inbox(second); await once(second, 'close');
    assert.equal(secondInbox.binary.length, 0); assert.equal(secondInbox.json.some(message => message.type === 'hello'), false, 'a second real stream is rejected before disclosure');
    const newCsrf = randomUUID(); const newSession = await f.runtime.store.createSession({ adminId: f.admin.id, csrfTokenHash: sha256(newCsrf), expiresAt: new Date(Date.now() + 60_000).toISOString() });
    assert.equal((await call(`/${id}/claim`, claimBody, claimKey, newCsrf, `session_id=${newSession.id}; csrf_token=${newCsrf}`)).status, 409, 'idempotency cache cannot move the grant to another auth session');
    const closed = once(stream, 'close'); stream.terminate(); await closed;
    assert.equal((await call(`/${id}/claim`, claimBody, claimKey)).status, 409, 'closed connection cannot recover a cached grant');
    await until(async () => (await call(`/${id}`)).body.data.session, row => !!row.reconnectDeadline);
    stream = new WebSocket(`${f.baseUrl.replace('http', 'ws')}/api/v1/verification-sessions/${id}/stream?clientInstanceId=${clientId}`, { headers: { cookie: f.cookie, origin } });
    frames = inbox(stream); await once(stream, 'open'); hello = await frames.next('hello'); frame = await frames.next('frame');
    claim = await call(`/${id}/claim`, { action: 'resume', clientInstanceId: clientId, connectionId: hello.connectionId, frameId: frame.frameId, expectedVersion: hello.session.version });
    assert.equal(claim.status, 200); assert.equal(claim.body.data.session.humanDeadline, originalDeadline, 'real reconnect does not grant another 30 seconds');
    const renew = setInterval(() => { void call(`/${id}/presentation`, { action: 'reserve', clientInstanceId: clientId }); }, 2_000);
    try {
      if (processingDelayMs) {
        const pointer = f.runtime.verification!.coordinator.pointer.bind(f.runtime.verification!.coordinator);
        f.runtime.verification!.coordinator.pointer = async (...args) => { await new Promise(resolve => setTimeout(resolve, processingDelayMs)); return pointer(...args); };
        let closure: { code: number; reason: string } | undefined;
        stream.on('close', (code, reason) => { closure = { code, reason: reason.toString() }; });
        const commandId = randomUUID();
        stream.send(JSON.stringify({ type: 'pointer', commandId, controlEpoch: claim.body.data.session.controlEpoch,
          frameId: frame.frameId, streamEpoch: frame.streamEpoch, geometryRevision: frame.geometryRevision,
          sequence: 1, action: 'down', ...f.pointer.start }));
        assert.equal((await until(() => frames.json.find(message => message.type === 'input-ack' && message.commandId === commandId), Boolean)).accepted, true);
        let sentMoves = 0;
        for (let step = 1; step <= 60 && !closure; step++) {
          await new Promise(resolve => setTimeout(resolve, 33)); if (closure) break;
          const current = frames.json.filter(message => message.type === 'frame').at(-1);
          stream.send(JSON.stringify({ type: 'pointer', commandId: randomUUID(), controlEpoch: claim.body.data.session.controlEpoch,
            frameId: current.frameId, streamEpoch: current.streamEpoch, geometryRevision: current.geometryRevision, sequence: step + 1,
            action: 'move', x: f.pointer.start.x + (f.pointer.end.x - f.pointer.start.x) * step / 90, y: f.pointer.start.y })); sentMoves++;
        }
        await until(() => closure, Boolean);
        assert.equal(closure!.code, 1008); assert.equal(closure!.reason, 'input queue exceeded'); assert.equal(f.stats.slideAnswers, 0);
        console.info(JSON.stringify({ evidence: 'slow-service-blind-33ms-producer', processingDelayMs, sentMoves, closeCode: closure!.code, reason: 'INPUT_QUEUE_EXCEEDED' }));
        return;
      }
      let sequence = 0;
      for (let attempt = 0; attempt < (rejectFirstSlide ? 2 : 1); attempt++) {
      const moves = continuous ? 90 : 12;
      const actions = nativeChallenge ? ['down', ...Array(moves + 1).fill('move'), 'up'] : ['down', 'move', 'up'];
      const acknowledgments: Promise<unknown>[] = [];
      const sentFrameIds = new Set<string>(), originalPage = f.contexts[0].pages()[0];
      const originalFrame = originalPage.frames().find(value => value.parentFrame());
      const positions: number[] = [];
      const sampledImages: string[] = []; let paintedPositions: number[] = [];
      const started = performance.now();
      for (const [index, action] of actions.entries()) {
        if (continuous && index === 1) await new Promise(resolve => setTimeout(resolve, 600));
        if (nativeChallenge && index > 0 && index <= moves) await new Promise(resolve => setTimeout(resolve, continuous ? 33 : 35));
        if (continuous) {
          frame = frames.json.filter(message => message.type === 'frame').at(-1);
          sentFrameIds.add(frame.frameId);
          if (index % 15 === 0 && originalFrame) {
            positions.push(await originalFrame.locator('#nc_1_n1z').evaluate(node => node.getBoundingClientRect().left));
            const imageIndex = Math.min(frames.json.filter(message => message.type === 'frame').length, frames.binary.length) - 1;
            sampledImages.push(frames.binary[imageIndex].toString('base64'));
          }
          if (action === 'up') paintedPositions = await originalPage.evaluate(async images => {
            const positions: number[] = [];
            for (const encoded of images) {
              const image = new Image(); image.src = `data:image/jpeg;base64,${encoded}`; await image.decode();
              const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
              const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0); const pixels = context.getImageData(0, 210, image.width, 1).data;
              let position = -1;
              for (let x = 60; x < 360; x++) if (pixels[x * 4] > 235 && pixels[x * 4 + 1] > 235 && pixels[x * 4 + 2] > 235) { position = x; break; }
              positions.push(position);
            }
            return positions;
          }, sampledImages);
        }
        const commandId = randomUUID();
        const progress = index === 0 ? 0 : nativeChallenge ? Math.min(1, index / moves) : 1;
        stream.send(JSON.stringify({ type: 'pointer', commandId, controlEpoch: claim.body.data.session.controlEpoch, frameId: frame.frameId,
          streamEpoch: frame.streamEpoch, geometryRevision: frame.geometryRevision, sequence: ++sequence, action,
          x: f.pointer.start.x + (f.pointer.end.x - f.pointer.start.x) * progress, y: f.pointer.start.y }));
        const acknowledgment = until(() => frames.json.find(message => message.type === 'input-ack' && message.commandId === commandId), Boolean)
          .then(inputAck => { assert.equal(inputAck.accepted, true, inputAck.reason); });
        acknowledgments.push(acknowledgment); void acknowledgment.catch(() => undefined);
        if (!nativeChallenge) await acknowledgment;
      }
      await Promise.all(acknowledgments);
      if (nativeChallenge) {
        if (continuous) {
          assert.ok(performance.now() - started >= 3_000); assert.ok(sentFrameIds.size >= 5, `fresh frames during continuous input: ${sentFrameIds.size}`);
          assert.ok(positions.length >= 5 && positions.every((x, index) => !index || x > positions[index - 1]), `native motion must visibly advance: ${positions}`);
          assert.ok(paintedPositions.length >= 5 && paintedPositions.every(x => x >= 60) && paintedPositions.at(-1)! > paintedPositions[0] + 150,
            `actual delivered JPEG pixels must keep advancing, not a frozen view: ${paintedPositions}`);
        } else assert.ok(performance.now() - started < 1_900);
        console.info(JSON.stringify({ evidence: continuous ? 'native-iframe-continuous-90x33ms-with-600ms-hold' : 'native-iframe-HTTP-WS-12x35ms', elapsedMs: Math.round(performance.now() - started), frameCount: sentFrameIds.size, positions, paintedPositions }));
      }
      if (rejectFirstSlide && attempt === 0) {
        const rejected = await until(async () => (await call(`/${id}`)).body.data.session, row => row.platformResult?.status === 'rejected');
        assert.equal(rejected.state, 'human_active'); assert.equal(rejected.platformResult.code, 300);
        assert.equal(rejected.platformResult.challengeGeneration, 1); assert.equal(rejected.humanDeadline, originalDeadline);
        assert.equal((await f.runtime.store.getCredential(f.admin.id, f.account.id))?.accessToken, 'old-access');
        assert.ok((await f.runtime.store.listAccountVerificationRisks(f.admin.id, f.account.id)).length > 0);
        assert.equal(f.stats.registrations, 0); assert.equal(f.stats.refreshes, 0, 'the service never automatically clicks native refresh');
        const beforeError = frame;
        frame = await until(() => frames.json.filter(message => message.type === 'frame').at(-1), value => !!value && value.streamEpoch > beforeError.streamEpoch);
        assert.equal(frame.width, 420); assert.equal(frame.height, 320);
        const original = f.contexts[0].pages()[0].frames()[1];
        assert.equal(await original.locator('#nc_1_n1z').count(), 0); assert.equal(await original.locator('#nc_1_refresh1.errloading').isVisible(), true);
        for (const action of ['down', 'up']) {
          const commandId = randomUUID();
          stream.send(JSON.stringify({ type: 'pointer', commandId, controlEpoch: claim.body.data.session.controlEpoch, frameId: frame.frameId,
            streamEpoch: frame.streamEpoch, geometryRevision: frame.geometryRevision, sequence: ++sequence, action, ...f.refreshPointer }));
          const ack = await until(() => frames.json.find(message => message.type === 'input-ack' && message.commandId === commandId), Boolean);
          if (action === 'down') assert.equal(ack.accepted, true, ack.reason);
          else if (!ack.accepted) assert.match(ack.reason, /^VERIFICATION_FRAME_STALE/, 'native mousedown reset invalidates the old UP frame and releases safely');
        }
        await until(() => f.stats.refreshes, count => count === 1);
        const beforeReset = frame;
        frame = await until(() => frames.json.filter(message => message.type === 'frame').at(-1), value => !!value && value.streamEpoch > beforeReset.streamEpoch);
        const afterReset = (await call(`/${id}`)).body.data.session;
        assert.equal(afterReset.state, 'human_active'); assert.equal(afterReset.humanDeadline, originalDeadline);
        assert.equal(afterReset.challengeGeneration, 1); assert.equal(afterReset.platformResult.code, 300);
      }
      }
      const final = await until(async () => (await call(`/${id}`)).body.data.session, row => ['succeeded', 'failed', 'completed_partial'].includes(row.state));
      assert.equal(final.state, 'succeeded', JSON.stringify(final));
      assert.equal((await f.runtime.store.listAccountVerificationRisks(f.admin.id, f.account.id)).length, 0);
      assert.equal((await f.runtime.store.getCredential(f.admin.id, f.account.id))?.accessToken, 'fixture-access');
      assert.equal(f.stats.browserLaunches, 1); assert.equal(f.stats.slideAnswers, rejectFirstSlide ? 2 : 1); assert.equal(f.stats.refreshes, rejectFirstSlide ? 1 : 0); assert.equal(f.stats.registrations, 1); assert.ok(f.stats.heartbeats >= 1);
      assert.equal(final.autoAttempts, 0, 'manual result never dispatches automatic gestures');
      const after = await f.runtime.store.findSession(f.session.id);
      assert.equal(after?.lastSeenAt, before?.lastSeenAt, 'presentation renewals, status snapshots and WS never extend authentication idle time');
      assert.equal(JSON.stringify(final).includes('ownerId'), false); assert.equal(JSON.stringify(final).includes('verificationUrl'), false);
      await f.runtime.store.revokeScope(f.admin.id, f.account.id, 'manage');
      assert.equal((await call(`/${id}/claim`, claimBody, claimKey)).status, 404, 'revoked manage is checked before reading a cached response');
    } finally { clearInterval(renew); }
  } finally { if (presence) clearInterval(presence); stream?.terminate(); eventSocket?.terminate(); await f.close(); }
}
