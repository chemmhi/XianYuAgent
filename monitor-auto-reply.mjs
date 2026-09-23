import { appendFile, mkdir, readFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { acquireMonitorFlag } from './monitor-auto-reply-flag.mjs';

const root = process.cwd();
const args = new Set(process.argv.slice(2));
const tracePath = resolve(valueAfter('--trace') ?? resolve(root, 'runtime-live', 'auto-reply-god-view.ndjson'));
const flagPath = resolve(valueAfter('--flag') ?? resolve(root, 'runtime-live', 'auto-reply-god-view.enable'));
const pollMs = Math.max(50, Number(valueAfter('--poll') ?? 250) || 250);
const once = args.has('--once');
const noHealth = args.has('--no-health');
const keepFlag = args.has('--keep-flag');

await mkdir(dirname(tracePath), { recursive: true });
if (args.has('--clear') && existsSync(tracePath)) await unlink(tracePath);
const flagLease = await acquireMonitorFlag(flagPath, { keepFlag });

let offset = 0;
let pending = '';
let lastHealthAt = 0;
let stopped = false;

function valueAfter(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function header(title) {
  console.log(`\n============ ${title} ============`);
}

function block(label, value) {
  if (value === undefined || value === null) return;
  console.log(`${label}:`);
  if (typeof value === 'string') console.log(value);
  else console.log(JSON.stringify(value, null, 2));
}

function formatEvent(event) {
  const time = Number.isNaN(Date.parse(event.ts ?? '')) ? new Date().toISOString() : new Date(event.ts).toISOString();
  const run = event.runId ?? '-';
  const trace = event.traceId ?? '-';
  const label = `${time} [${run}] [${event.phase ?? 'unknown'}/${event.event ?? 'unknown'}]`;
  const payload = event.payload ?? {};

  switch (event.event) {
    case 'inbound.received':
      header('BUYER / INBOUND');
      console.log(label);
      block('BUYER', event.buyer);
      block('MESSAGE', { messageId: payload.messageId, direction: payload.direction, bodyType: payload.bodyType, bodyText: payload.bodyText, bodyRef: payload.bodyRef, createdAt: payload.createdAt, requestId: payload.requestId });
      break;
    case 'route.classified':
      header('ROUTE / SAFETY');
      console.log(label);
      block('BUYER', event.buyer);
      block('ROUTE', payload);
      break;
    case 'route.policy':
      header('ROUTE / POLICY');
      console.log(label);
      block('POLICY ROUTE', payload);
      break;
    case 'memory.loaded':
      header('MEMORY / CONTEXT');
      console.log(label);
      block('BUYER', event.buyer);
      block('MEMORY (RAW CONTEXT)', payload.context);
      block('MEMORY META', { contextDigest: payload.contextDigest, maxHistory: payload.maxHistory });
      break;
    case 'agent.started':
      header('AGENT START');
      console.log(label);
      block('BUYER', event.buyer);
      block('AGENT CONFIG', payload.config);
      block('CLASSIFICATION', payload.classification);
      break;
    case 'model.request':
      header('MODEL REQUEST / PROMPT');
      console.log(label);
      console.log(`LOOP: ${payload.loop ?? '-'}`);
      block('MODEL PROMPT / MESSAGE ARRAY', payload.messages);
      block('TOOL DEFINITIONS', payload.tools);
      block('TOOL CHOICE', payload.toolChoice);
      break;
    case 'model.response':
      header('MODEL RESPONSE');
      console.log(label);
      console.log(`MODEL: ${payload.model ?? '-'}   DURATION_MS: ${payload.durationMs ?? '-'}`);
      block('MODEL OUTPUT (RAW)', payload.content);
      block('TOOL CALLS', payload.toolCalls);
      block('USAGE', payload.usage);
      break;
    case 'model.error':
      header('MODEL ERROR');
      console.log(label);
      block('MODEL ERROR', payload);
      break;
    case 'tool.request':
      header('TOOL CALL');
      console.log(label);
      console.log(`TOOL: ${payload.tool ?? '-'}   LOOP: ${payload.loop ?? '-'}   INDEX: ${payload.toolCallIndex ?? '-'}`);
      block('ARGUMENTS', payload.arguments);
      break;
    case 'tool.response':
      header('TOOL OUTPUT');
      console.log(label);
      console.log(`TOOL: ${payload.tool ?? '-'}   DURATION_MS: ${payload.durationMs ?? '-'}`);
      block('FORMATTED RESULT', payload.result);
      break;
    case 'tool.error':
      header('TOOL ERROR');
      console.log(label);
      block('TOOL ERROR', payload);
      break;
    case 'send.result':
      header('SEND / OUTBOX');
      console.log(label);
      block('SEND RESULT', payload);
      break;
    case 'run.finished':
      header('RUN FINISHED');
      console.log(label);
      block('FINAL RESULT', payload);
      break;
    case 'run.handoff':
      header('RUN HANDOFF');
      console.log(label);
      block('HANDOFF', payload);
      break;
    case 'run.failed':
      header('RUN FAILED');
      console.log(label);
      block('FAILURE', payload);
      break;
    default:
      header(`EVENT ${event.event ?? 'unknown'}`);
      console.log(label);
      block('BUYER', event.buyer);
      block('PAYLOAD', payload);
      break;
  }
  console.log(`TRACE_ID: ${trace}`);
}

async function readTrace() {
  if (!existsSync(tracePath)) return;
  const content = await readFile(tracePath, 'utf8');
  if (content.length < offset) {
    offset = 0;
    pending = '';
  }
  if (content.length === offset) return;
  pending += content.slice(offset);
  offset = content.length;
  const parts = pending.split(/\r?\n/);
  if (parts.length === 1) return;
  pending = parts.pop() ?? '';
  for (const line of parts) {
    if (!line.trim()) continue;
    try { formatEvent(JSON.parse(line)); } catch { console.log(`[TRACE_PARSE_ERROR] ${line}`); }
  }
}

async function writeHealth() {
  if (noHealth || Date.now() - lastHealthAt < 5_000) return;
  lastHealthAt = Date.now();
  const getStatus = async (path) => {
    try { return (await fetch(`http://127.0.0.1:8080${path}`)).status; } catch { return 'ERR'; }
  };
  const [health, ready] = await Promise.all([getStatus('/healthz'), getStatus('/readyz')]);
  console.log(`[HEALTH] health=${health} ready=${ready} trace=${tracePath}`);
}

async function cleanup() {
  await flagLease.release();
  if (!stopped) {
    stopped = true;
    console.log(`AUTO_REPLY_GOD_VIEW_STOPPED ${new Date().toISOString()}`);
  }
}

process.once('SIGINT', async () => { await cleanup(); process.exit(0); });
process.once('SIGTERM', async () => { await cleanup(); process.exit(0); });

console.log(`AUTO_REPLY_GOD_VIEW_STARTED ${new Date().toISOString()}`);
console.log('正在等待自动回复事件；Ctrl+C 退出。已启用本地 trace 开关。');
console.log('提示：本命令只监控 trace，不启动 API、worker 或闲鱼网关监听；请先运行 npm run dev。');
do {
  await readTrace();
  await writeHealth();
  if (!once) await new Promise((resolvePromise) => setTimeout(resolvePromise, pollMs));
} while (!once);
await cleanup();
