import assert from 'node:assert/strict';
import net from 'node:net';
import test from 'node:test';

import {
  assertPortFree,
  pidFilePath,
  projectRoot,
  readPidFile,
  removePidFile,
  writePidFile,
} from './dev-lifecycle.mjs';

test('runner pid state round-trips and cleans up', () => {
  removePidFile();
  writePidFile();
  const record = readPidFile();
  assert.equal(record?.pid, process.pid);
  assert.equal(record?.root, projectRoot);
  removePidFile();
  assert.equal(readPidFile(), null);
});

test('assertPortFree rejects an occupied port', async () => {
  const server = net.createServer();
  await new Promise((resolve) => server.listen({ host: '127.0.0.1', port: 0 }, resolve));
  const address = server.address();
  assert.equal(typeof address, 'object');
  await assert.rejects(assertPortFree(address.port), /already in use/);
  await new Promise((resolve) => server.close(resolve));
});

test('assertPortFree resolves for a free ephemeral port', async () => {
  const server = net.createServer();
  await new Promise((resolve) => server.listen({ host: '127.0.0.1', port: 0 }, resolve));
  const address = server.address();
  const port = address.port;
  await new Promise((resolve) => server.close(resolve));
  await assertPortFree(port);
});

test.after(() => removePidFile());

assert.ok(pidFilePath.endsWith('.xianyu-dev.pid'));
