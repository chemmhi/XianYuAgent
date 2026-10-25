import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import { once } from 'node:events';
import net from 'node:net';
import test from 'node:test';
import { createDevEnvironment, findAvailablePort, resolveDevPorts } from './dev-ports.mjs';

async function listen(port = 0) {
  const server = net.createServer();
  server.listen(port, '0.0.0.0');
  await once(server, 'listening');
  return server;
}

const close = (server) => new Promise((resolve) => server.close(resolve));

async function range(t) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const servers = [];
    try {
      const port = 20_000 + randomInt(9_997);
      servers.push(await listen(port));
      servers.push(await listen(port + 1));
      servers.push(await listen(port + 2));
      t.after(() => Promise.all(servers.filter((server) => server.listening).map(close)));
      return { port, servers };
    } catch (error) {
      if (error.code !== 'EADDRINUSE') throw error;
    } finally {
      if (servers.length !== 3) await Promise.all(servers.map(close));
    }
  }
  throw new Error('Could not reserve consecutive ports');
}

test('keeps the starting port when free and releases the probe socket', async (t) => {
  const { port, servers } = await range(t);
  await close(servers[0]);
  assert.equal(await findAvailablePort(port), port);
  const actual = await listen(port);
  await close(actual);
});

test('increments across consecutive occupied ports without stopping their owners', async (t) => {
  const { port, servers } = await range(t);
  await close(servers[2]);
  assert.equal(await findAvailablePort(port), port + 2);
  assert.ok(servers[0].listening && servers[1].listening);
});

test('does not allocate the same free port to API and Web', async (t) => {
  const { port, servers } = await range(t);
  await Promise.all(servers.slice(1).map(close));
  assert.deepEqual(await resolveDevPorts({ PORT: String(port), VITE_PORT: String(port) }), {
    apiPort: port + 1, webPort: port + 2,
  });
});

test('validates ports before probing or spawning children', async () => {
  for (const invalid of [0, -1, 65536, 1.5, '', 'abc', NaN]) {
    await assert.rejects(findAvailablePort(invalid), /integer between 1 and 65535/);
    await assert.rejects(resolveDevPorts({ PORT: invalid }), /PORT must be/);
    await assert.rejects(resolveDevPorts({ VITE_PORT: invalid }), /VITE_PORT must be/);
  }
});

test('reports exhaustion instead of wrapping past the maximum TCP port', async () => {
  await assert.rejects(findAvailablePort(65535, { exclude: [65535] }), /No available port between 65535 and 65535/);
});

test('propagates bind errors other than an occupied port', async () => {
  await assert.rejects(findAvailablePort(8080, { host: 123 }), { code: 'ERR_INVALID_ARG_TYPE' });
});

test('synchronizes ports and proxy while preserving custom WebSocket origins and environment', () => {
  const original = { WS_ALLOWED_ORIGINS: ' https://custom.example ,https://custom.example',
    VITE_API_PROXY_TARGET: 'http://127.0.0.1:8080', DATABASE_URL: 'test-database' };
  const env = createDevEnvironment({ apiPort: 8082, webPort: 5175 }, original);
  assert.equal(env.PORT, '8082');
  assert.equal(env.VITE_PORT, '5175');
  assert.equal(env.VITE_API_PROXY_TARGET, 'http://127.0.0.1:8082');
  assert.equal(env.DATABASE_URL, 'test-database');
  assert.deepEqual(env.WS_ALLOWED_ORIGINS.split(','), [
    'https://custom.example', 'http://localhost:8082', 'http://127.0.0.1:8082',
    'http://localhost:5175', 'http://127.0.0.1:5175',
  ]);
  assert.equal(original.VITE_API_PROXY_TARGET, 'http://127.0.0.1:8080');
});

test('shares a fresh internal IM secret without changing persisted credential encryption', () => {
  const original = { CREDENTIAL_ENCRYPTION_KEY: 'existing-encryption-key' };
  const first = createDevEnvironment({ apiPort: 8080, webPort: 5173 }, original);
  const second = createDevEnvironment({ apiPort: 8080, webPort: 5173 }, original);
  assert.match(first.XIANYU_IM_OWNER_SECRET, /^[a-f0-9]{64}$/);
  assert.notEqual(first.XIANYU_IM_OWNER_SECRET, second.XIANYU_IM_OWNER_SECRET);
  assert.equal(first.CREDENTIAL_ENCRYPTION_KEY, original.CREDENTIAL_ENCRYPTION_KEY);
  assert.equal(original.XIANYU_IM_OWNER_SECRET, undefined);
});

test('preserves an explicitly configured internal IM secret', () => {
  const secret = 'configured-im-owner-secret-with-32-characters';
  const env = createDevEnvironment({ apiPort: 8080, webPort: 5173 }, { XIANYU_IM_OWNER_SECRET: secret });
  assert.equal(env.XIANYU_IM_OWNER_SECRET, secret);
});
