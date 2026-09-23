import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquireMonitorFlag } from './monitor-auto-reply-flag.mjs';
import { formatShanghaiTimestamp } from './monitor-auto-reply-time.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const monitorDirectory = dirname(fileURLToPath(import.meta.url));
const args = new Set(process.argv.slice(2));
const tracePath = resolve(valueAfter('--trace') ?? resolve(root, 'runtime-live', 'auto-reply-god-view.ndjson'));
const flagPath = resolve(valueAfter('--flag') ?? resolve(root, 'runtime-live', 'auto-reply-god-view.enable'));
const pollMs = Math.max(50, Number(valueAfter('--poll') ?? 250) || 250);
const requestedPort = Math.max(0, Number(valueAfter('--port') ?? process.env.AUTO_REPLY_MONITOR_PORT ?? 0) || 0);
const once = args.has('--once');
const noHealth = args.has('--no-health');
const noOpen = once || args.has('--no-open');
const keepFlag = args.has('--keep-flag');
const host = '127.0.0.1';
const maxEvents = 100;

await mkdir(dirname(tracePath), { recursive: true });
if (args.has('--clear') && existsSync(tracePath)) await unlink(tracePath);
const flagLease = await acquireMonitorFlag(flagPath, { keepFlag });

let offset = 0;
let pending = '';
let lastHealthAt = 0;
let stopped = false;
let monitorServer;
let dashboardHtml;
const events = [];
const clients = new Set();
let healthState = { health: 'UNKNOWN', ready: 'UNKNOWN', checkedAt: null };

function valueAfter(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function eventTitle(event) {
  switch (event.event) {
    case 'inbound.received': return 'BUYER / INBOUND';
    case 'route.classified': return 'ROUTE / SAFETY';
    case 'route.policy': return 'ROUTE / POLICY';
    case 'memory.loaded': return 'MEMORY / CONTEXT';
    case 'agent.started': return 'AGENT START';
    case 'model.request': return 'MODEL REQUEST / PROMPT';
    case 'model.response': return 'MODEL RESPONSE';
    case 'model.error': return 'MODEL ERROR';
    case 'tool.request': return 'TOOL CALL';
    case 'tool.response': return 'TOOL OUTPUT';
    case 'tool.error': return 'TOOL ERROR';
    case 'send.result': return 'SEND / OUTBOX';
    case 'run.finished': return 'RUN FINISHED';
    case 'run.handoff': return 'RUN HANDOFF';
    case 'run.failed': return 'RUN FAILED';
    default: return `EVENT ${event.event ?? 'unknown'}`;
  }
}

const isoTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

function formatDisplayValue(value) {
  if (typeof value === 'string' && isoTimestampPattern.test(value)) return formatShanghaiTimestamp(value);
  if (Array.isArray(value)) return value.map(formatDisplayValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, nestedValue]) => [key, formatDisplayValue(nestedValue)]));
  return value;
}

function normalizeEvent(event) {
  return {
    id: `${event.ts ?? 'no-ts'}-${event.runId ?? 'no-run'}-${event.event ?? 'unknown'}-${events.length}`,
    time: formatShanghaiTimestamp(event.ts),
    title: eventTitle(event),
    phase: event.phase ?? 'unknown',
    event: event.event ?? 'unknown',
    runId: event.runId ?? '-',
    traceId: event.traceId ?? '-',
    buyer: formatDisplayValue(event.buyer ?? null),
    payload: formatDisplayValue(event.payload ?? {}),
  };
}

function writeSse(response, eventName, data) {
  response.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
}

function broadcast(eventName, data) {
  for (const client of clients) {
    try {
      writeSse(client, eventName, data);
    } catch {
      clients.delete(client);
    }
  }
}

function pushEvent(event) {
  const normalized = normalizeEvent(event);
  events.push(normalized);
  if (events.length > maxEvents) events.shift();
  broadcast('trace', normalized);
}

function createDashboardServer() {
  return createServer((request, response) => {
    const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host ?? `${host}:${requestedPort}`}`);
    if (request.method !== 'GET') {
      response.writeHead(405, { allow: 'GET' });
      response.end('Method Not Allowed');
      return;
    }
    if (requestUrl.pathname === '/') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      response.end(dashboardHtml);
      return;
    }
    if (requestUrl.pathname === '/api/state') {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      response.end(JSON.stringify({ timeZone: 'Asia/Shanghai', events, health: healthState }));
      return;
    }
    if (requestUrl.pathname === '/events') {
      response.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-store, must-revalidate',
        connection: 'keep-alive',
        'access-control-allow-origin': '*',
      });
      response.write(': connected\n\n');
      writeSse(response, 'snapshot', events);
      writeSse(response, 'health', healthState);
      clients.add(response);
      request.on('close', () => clients.delete(response));
      return;
    }
    response.writeHead(404);
    response.end('Not Found');
  });
}

async function startDashboard() {
  dashboardHtml = await readFile(resolve(monitorDirectory, 'monitor-auto-reply.html'), 'utf8');
  monitorServer = createDashboardServer();
  await new Promise((resolvePromise, reject) => {
    monitorServer.once('error', reject);
    monitorServer.listen(requestedPort, host, resolvePromise);
  });
  const address = monitorServer.address();
  const port = typeof address === 'object' && address ? address.port : requestedPort;
  const dashboardUrl = `http://${host}:${port}/`;
  console.log(`AUTO_REPLY_GOD_VIEW_URL ${dashboardUrl}`);
  if (!noOpen) {
    await openBrowser(dashboardUrl).catch((error) => {
      console.warn(`[AUTO_REPLY_GOD_VIEW_BROWSER_OPEN_FAILED] ${error instanceof Error ? error.message : String(error)}`);
    });
  }
}

function openBrowser(url) {
  const command = process.platform === 'win32' ? 'cmd.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const commandArgs = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, commandArgs, { detached: true, stdio: 'ignore', windowsHide: true });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolvePromise();
    });
  });
}

async function readTrace() {
  if (!existsSync(tracePath)) return;
  const content = await readFile(tracePath, 'utf8');
  if (content.length < offset) {
    offset = 0;
    pending = '';
    events.length = 0;
    broadcast('reset', []);
  }
  if (content.length === offset) return;
  pending += content.slice(offset);
  offset = content.length;
  const parts = pending.split(/\r?\n/);
  if (parts.length === 1) return;
  pending = parts.pop() ?? '';
  for (const line of parts) {
    if (!line.trim()) continue;
    try {
      pushEvent(JSON.parse(line));
    } catch {
      broadcast('monitor-error', { message: 'TRACE_PARSE_ERROR', line });
    }
  }
}

async function writeHealth() {
  if (noHealth || Date.now() - lastHealthAt < 5_000) return;
  lastHealthAt = Date.now();
  const getStatus = async (path) => {
    try { return (await fetch(`http://127.0.0.1:8080${path}`)).status; } catch { return 'ERR'; }
  };
  const [health, ready] = await Promise.all([getStatus('/healthz'), getStatus('/readyz')]);
  healthState = { health, ready, checkedAt: formatShanghaiTimestamp() };
  broadcast('health', healthState);
}

async function closeDashboard() {
  for (const client of clients) client.end();
  clients.clear();
  if (!monitorServer) return;
  await new Promise((resolvePromise) => monitorServer.close(() => resolvePromise()));
  monitorServer = undefined;
}

async function cleanup() {
  if (stopped) return;
  stopped = true;
  await closeDashboard();
  await flagLease.release();
  console.log(`AUTO_REPLY_GOD_VIEW_STOPPED ${formatShanghaiTimestamp()}`);
}

process.once('SIGINT', async () => { await cleanup(); process.exit(0); });
process.once('SIGTERM', async () => { await cleanup(); process.exit(0); });

await startDashboard();
console.log(`AUTO_REPLY_GOD_VIEW_STARTED ${formatShanghaiTimestamp()}`);
console.log('自动回复 HTML 面板已启动：支持实时 trace、折叠、JSON 高亮和关键词搜索。');
console.log('提示：本命令只监控 trace，不启动 API、worker 或闲鱼网关监听；请先运行 npm run dev。');
do {
  await readTrace();
  await writeHealth();
  if (!once) await new Promise((resolvePromise) => setTimeout(resolvePromise, pollMs));
} while (!once);
await cleanup();
