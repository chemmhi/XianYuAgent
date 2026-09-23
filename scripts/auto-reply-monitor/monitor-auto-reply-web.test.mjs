import assert from 'node:assert/strict';
import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const monitorScript = resolve(currentDirectory, 'monitor-auto-reply.mjs');

async function waitFor(readValue, predicate, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  let value;
  do {
    value = await readValue();
    if (predicate(value)) return value;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  } while (Date.now() < deadline);
  assert.fail(`Timed out waiting for expected value; last value: ${JSON.stringify(value)}`);
}

function waitForDashboardUrl(child) {
  return new Promise((resolvePromise, reject) => {
    let output = '';
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for monitor URL. Output: ${output}`)), 5_000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      output += chunk;
      const match = output.match(/AUTO_REPLY_GOD_VIEW_URL (http:\/\/127\.0\.0\.1:\d+\/)/);
      if (!match) return;
      clearTimeout(timeout);
      resolvePromise(match[1]);
    });
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

test('serves the HTML dashboard and streams Shanghai-formatted trace state', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'xianyu-auto-reply-monitor-web-'));
  const tracePath = join(directory, 'trace.ndjson');
  const flagPath = join(directory, 'flag.enable');
  const firstEvent = { ts: '2026-09-23T12:34:56.000Z', runId: 'run-1', traceId: 'trace-1', phase: 'test', event: 'route.policy', payload: { keyword: 'hello', count: 1, createdAt: '2026-09-23T12:34:56.000Z' } };
  const secondEvent = { ts: '2026-09-23T12:35:01.000Z', runId: 'run-1', traceId: 'trace-1', phase: 'test', event: 'run.finished', payload: { status: 'ok' } };
  await writeFile(tracePath, `${JSON.stringify(firstEvent)}\n`, 'utf8');

  const child = spawn(process.execPath, [monitorScript, '--no-health', '--no-open', '--port', '0', '--poll', '50', '--trace', tracePath, '--flag', flagPath], {
    cwd: resolve(currentDirectory, '../..'),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => {
    if (!child.killed) child.kill();
    await once(child, 'exit').catch(() => {});
    await rm(directory, { recursive: true, force: true });
  });

  const dashboardUrl = await waitForDashboardUrl(child);
  const html = await (await fetch(dashboardUrl)).text();
  assert.match(html, /EventSource/);
  assert.match(html, /JSON 高亮/);
  assert.match(html, /搜索事件/);
  assert.match(html, /YY-MM-DD-HH-MM-SS/);

  const stateUrl = new URL('api/state', dashboardUrl);
  const firstState = await waitFor(async () => (await fetch(stateUrl)).json(), (value) => value.events.length === 1);
  assert.equal(firstState.timeZone, 'Asia/Shanghai');
  assert.equal(firstState.events[0].time, '26-09-23-20-34-56');
  assert.equal(firstState.events[0].payload.createdAt, '26-09-23-20-34-56');

  const sseResponse = await fetch(new URL('events', dashboardUrl));
  assert.equal(sseResponse.headers.get('content-type'), 'text/event-stream; charset=utf-8');
  await sseResponse.body?.cancel();

  await appendFile(tracePath, `${JSON.stringify(secondEvent)}\n`, 'utf8');
  const secondState = await waitFor(async () => (await fetch(stateUrl)).json(), (value) => value.events.length === 2);
  assert.equal(secondState.events[1].time, '26-09-23-20-35-01');
});
