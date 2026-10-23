import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import { createRecordingStore, writeIntegrity } from './store.mjs';
import { installHttpRecording, installWebSocketRecording } from './http.mjs';

test('recorder preserves raw secrets, binary request/response and WebSocket payloads without changing I/O', async () => {
  const root = mkdtempSync(join(tmpdir(), 'xianyu-recorder-contract-'));
  const store = createRecordingStore(root);
  const drain = installHttpRecording(store);
  await installWebSocketRecording(store);
  const bytes = Buffer.from([0, 1, 255, 128, 10, 13]);
  const server = createServer((req, res) => {
    const input = [];
    req.on('data', (chunk) => input.push(chunk));
    req.on('end', () => { assert.deepEqual(Buffer.concat(input), bytes); res.writeHead(201, { 'set-cookie': 'x5sec=raw-cookie; Path=/', 'content-type': 'application/octet-stream' }); res.write(bytes.subarray(0, 2)); res.end(bytes.subarray(2)); });
  });
  const wss = new WebSocketServer({ server });
  wss.on('connection', (ws) => ws.on('message', (data) => ws.send(data)));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const response = await fetch(`${origin}/echo?token=raw-token`, { method: 'POST', headers: { cookie: 'session=original' }, body: bytes });
    assert.equal(response.status, 201);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
    const socket = new WebSocket(origin.replace('http:', 'ws:'));
    await new Promise((resolve) => socket.once('open', resolve));
    const echoed = new Promise((resolve) => socket.once('message', resolve));
    socket.send(bytes);
    assert.deepEqual(await echoed, bytes);
    socket.close();
    await new Promise((resolve) => socket.once('close', resolve));
    await assert.rejects(fetch('http://127.0.0.1:1/unavailable'));
    await drain();
    const events = readdirSync(root).filter((name) => name.endsWith('.ndjson')).flatMap((name) => readFileSync(join(root, name), 'utf8').trim().split('\n').map(JSON.parse));
    for (const type of ['fetch.request.body', 'fetch.response.body', 'http.request.body', 'http.response']) {
      const value = events.find((event) => event.type === type && event.data.body.bytes === bytes.length);
      assert.ok(value, `missing ${type}`);
      assert.deepEqual(readFileSync(join(root, value.data.body.path)), bytes);
    }
    assert.ok(events.some((event) => event.type === 'fetch.error'));
    assert.ok(events.some((event) => event.type === 'ws.send'));
    assert.ok(events.some((event) => event.type === 'ws.message'));
    const text = JSON.stringify(events);
    for (const value of ['raw-token', 'raw-cookie', 'session=original']) assert.ok(text.includes(value));
    const buffer = store.blob(bytes);
    const indexCount = await writeIntegrity(root);
    assert.ok(indexCount > 1);
    const index = JSON.parse(readFileSync(join(root, 'integrity.json'), 'utf8'));
    assert.equal(index.files.find((entry) => entry.path === buffer.path).sha256, buffer.sha256);
  } finally {
    await new Promise((resolve) => wss.close(resolve));
    await new Promise((resolve) => server.close(resolve));
  }
});
