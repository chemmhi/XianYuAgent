import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomInt } from 'node:crypto';
import { once } from 'node:events';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { terminateProcessTree } from './dev-lifecycle.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const npmCli = process.env.npm_execpath ?? path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');

async function listen(port = 0) {
  const server = net.createServer();
  server.listen(port, '0.0.0.0');
  await once(server, 'listening');
  return server;
}

async function reserveRange() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const servers = [];
    try {
      // Avoid the OS ephemeral range: outbound connections must not claim
      // a released candidate while the npm subprocess starts.
      const port = 20_000 + randomInt(9_996);
      servers.push(await listen(port));
      for (let offset = 1; offset < 4; offset += 1) servers.push(await listen(port + offset));
      return { port, servers };
    } catch (error) {
      if (error.code !== 'EADDRINUSE') throw error;
    } finally {
      if (servers.length !== 4) await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
    }
  }
  throw new Error('Could not reserve a consecutive test port range');
}

async function waitFor(check, output) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(100);
  }
  throw new Error(`Development command did not become ready:\n${output()}`);
}

function upgradeStatus(url, origin) {
  return new Promise((resolve, reject) => {
    const request = http.request(url, { headers: {
      origin, connection: 'Upgrade', upgrade: 'websocket',
      'sec-websocket-version': '13', 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
    } });
    request.once('response', (response) => { response.resume(); resolve(response.statusCode); });
    request.once('error', reject);
    request.setTimeout(5_000, () => request.destroy(new Error('WebSocket upgrade timed out')));
    request.end();
  });
}

test('npm run dev increments occupied ports and keeps HTTP, sessions and WebSocket origins connected', { timeout: 60_000 }, async (t) => {
  // Run the shipped launcher with real API, Worker and Vite entries, in an
  // isolated workspace. Only Docker provisioning and live-data defaults are
  // replaced: this test must not connect to the developer database or Xianyu.
  const fixture = await mkdtemp(path.join(tmpdir(), 'devports-'));
  let child;
  let servers = [];
  t.after(async () => {
    if (child) {
      await terminateProcessTree(child.pid);
      if (child.exitCode === null) await Promise.race([once(child, 'exit'), delay(5_000)]);
    }
    await Promise.all(servers.filter((server) => server.listening).map((server) => new Promise((resolve) => server.close(resolve))));
    await rm(fixture, { recursive: true, force: true });
  });
  await mkdir(path.join(fixture, 'scripts'));
  for (const filename of ['dev-runner.mjs', 'dev-lifecycle.mjs', 'dev-ports.mjs']) {
    await cp(path.join(root, 'scripts', filename), path.join(fixture, 'scripts', filename));
  }
  const range = await reserveRange();
  const { port } = range;
  servers = range.servers;
  await Promise.all(servers.slice(2).map((server) => new Promise((resolve) => server.close(resolve))));
  const apiUrl = `http://127.0.0.1:${port + 2}`;
  const webUrl = `http://127.0.0.1:${port + 3}`;
  const quote = (value) => `"${value.replaceAll('\\', '/')}"`;
  const node = 'node';
  const entry = (filename) => `${node} --import ${quote(pathToFileURL(path.join(root, 'node_modules/tsx/dist/loader.mjs')).href)} ${quote(path.join(root, 'apps/api/src', filename))}`;
  const original = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const viteCommand = `${node} ${quote(path.join(root, 'node_modules/vite/bin/vite.js'))} ${quote(path.join(root, 'apps/web'))} --host 0.0.0.0`;
  await writeFile(path.join(fixture, 'package.json'), JSON.stringify({ private: true, scripts: {
    dev: `${node} scripts/dev-runner.mjs`,
    'dev:api': entry('index.ts'), 'dev:worker': entry('worker.ts'),
    // Keep the production web script's environment overrides in this test.
    'dev:web': original.scripts['dev:web'].replace('cross-env ', `${node} ${quote(path.join(root, 'node_modules/cross-env/dist/bin/cross-env.js'))} `).replace('npm --workspace apps/web run dev', viteCommand),
  } }));
  await writeFile(path.join(fixture, '.env'), `PORT=${port}\nVITE_PORT=${port}\nWS_ALLOWED_ORIGINS=http://custom.invalid\n`);
  const env = { ...process.env, NODE_ENV: 'development', HOST: '0.0.0.0', DATABASE_URL: '', REDIS_URL: '',
    CREDENTIAL_ENCRYPTION_KEY: '', XIANYU_IM_OWNER_SECRET: '', XIANYU_IM_OWNER_URL: '',
    ALLOW_IN_MEMORY: 'true', COOKIE_SECURE: 'false', AGENT_RUNTIME: 'in-process', XIANYU_QR_MODE: 'stub',
    AUTO_REPLY_SEND_MODE: 'simulate', AUTO_REPLY_MODEL_ENABLED: 'false', AUTO_REPLY_REPAIR_MODE: 'enforce',
    AUTO_REPLY_OUTCOME_REVIEW_WORKER_ENABLED: 'false', VITE_API_MODE: 'live', VITE_API_BASE_URL: '',
  };
  for (const key of ['PORT', 'VITE_PORT', 'WS_ALLOWED_ORIGINS', 'VITE_API_PROXY_TARGET']) delete env[key];
  child = spawn(process.execPath, [npmCli, 'run', 'dev'], { cwd: fixture, env, windowsHide: true,
    detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  await waitFor(() => {
    assert.equal(child.exitCode, null, output);
    return output.includes(`[dev] API: ${apiUrl}`) && output.includes(`[dev] Web: ${webUrl}`);
  }, () => `Expected API ${apiUrl}, Web ${webUrl}\n${output}`);
  await waitFor(() => {
    assert.equal(child.exitCode, null, output);
    return output.includes('xianyu-agent-worker started;');
  }, () => output);
  await waitFor(async () => {
    try { return (await fetch(`${webUrl}/api/v1/auth/session`)).ok; } catch { return false; }
  }, () => output);
  const bootstrap = await fetch(`${webUrl}/api/v1/auth/bootstrap`, { method: 'POST',
    headers: { 'content-type': 'application/json', 'Idempotency-Key': `devports-${process.pid}` },
    body: JSON.stringify({ email: 'ports@example.com', password: 'password-123', displayName: 'Port fallback' }),
  });
  assert.equal(bootstrap.status, 200, await bootstrap.clone().text());
  assert.equal((await bootstrap.json()).data.profile.displayName, 'Port fallback');
  const cookie = bootstrap.headers.getSetCookie().map((value) => value.split(';', 1)[0]).join('; ');
  const csrf = decodeURIComponent(cookie.match(/csrf_token=([^;]+)/)[1]);
  const created = await fetch(`${webUrl}/api/v1/accounts`, { method: 'POST', headers: {
    cookie, 'x-csrf-token': csrf, 'content-type': 'application/json', 'Idempotency-Key': `account-${process.pid}`,
  }, body: JSON.stringify({ platform: 'xianyu', sellerRef: 'port-fallback-seller', displayName: 'Port fallback account' }) });
  assert.equal(created.status, 201, await created.clone().text());
  const account = (await created.json()).data;
  const listed = await (await fetch(`${apiUrl}/api/v1/accounts`, { headers: { cookie } })).json();
  assert.equal(listed.data.items[0].id, account.id);
  const session = await (await fetch(`${webUrl}/api/v1/auth/session`, { headers: { cookie } })).json();
  assert.equal(session.data.authenticated, true);
  assert.equal(session.data.admin.displayName, 'Port fallback');
  assert.equal(await upgradeStatus(`${webUrl}/api/v1/conversations/missing/events`, webUrl), 401);
  assert.equal(await upgradeStatus(`${webUrl}/api/v1/conversations/missing/events`, 'http://custom.invalid'), 401);
  assert.equal(await upgradeStatus(`${webUrl}/api/v1/conversations/missing/events`, 'http://forbidden.invalid'), 403);
  assert.ok(servers[0].listening && servers[1].listening, 'Unrelated port owners must stay alive');
});
