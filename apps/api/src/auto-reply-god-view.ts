import { appendFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';

export type AutoReplyGodViewPhase =
  | 'inbound'
  | 'route'
  | 'memory'
  | 'model'
  | 'tool'
  | 'send'
  | 'run';

export interface AutoReplyGodViewEvent {
  ts: string;
  phase: AutoReplyGodViewPhase;
  event: string;
  traceId?: string;
  runId?: string;
  buyer?: {
    adminId?: string;
    accountId?: string;
    conversationId?: string;
    buyerRef?: string;
    buyerName?: string;
    externalConversationRef?: string;
  };
  payload: Record<string, unknown>;
}

export interface AutoReplyGodViewSink {
  emit(event: Omit<AutoReplyGodViewEvent, 'ts'>): Promise<void>;
}

export interface AutoReplyGodViewOptions {
  env?: NodeJS.ProcessEnv;
  filePath?: string;
  flagPath?: string;
}

const REPOSITORY_ROOT = resolveRepositoryRoot();
const DEFAULT_FILE_PATH = resolve(REPOSITORY_ROOT, 'runtime-live', 'auto-reply-god-view.ndjson');
const DEFAULT_FLAG_PATH = resolve(REPOSITORY_ROOT, 'runtime-live', 'auto-reply-god-view.enable');

/**
 * Local-only, opt-in runtime trace sink. It deliberately does not write to
 * auto_reply_run_events, because that table is an audit surface for redacted
 * summaries rather than a prompt/transcript store.
 */
export function createAutoReplyGodViewSink(options: AutoReplyGodViewOptions = {}): AutoReplyGodViewSink {
  const env = options.env ?? process.env;
  const filePath = resolve(options.filePath ?? env.AUTO_REPLY_GOD_VIEW_FILE ?? DEFAULT_FILE_PATH);
  const flagPath = resolve(options.flagPath ?? env.AUTO_REPLY_GOD_VIEW_FLAG ?? DEFAULT_FLAG_PATH);
  const forced = env.AUTO_REPLY_GOD_VIEW === '1' || env.AUTO_REPLY_TRACE_VERBOSE === '1';
  const maxChars = positiveInt(env.AUTO_REPLY_GOD_VIEW_MAX_CHARS, 200_000);
  let pending = Promise.resolve();

  return {
    emit(event) {
      if (!forced && !existsSync(flagPath)) return Promise.resolve();
      const record = sanitizeEvent({ ...event, ts: new Date().toISOString() }, maxChars);
      const line = `${JSON.stringify(record)}\n`;
      pending = pending.then(async () => {
        await mkdir(dirname(filePath), { recursive: true });
        await appendFile(filePath, line, 'utf8');
      }).catch(() => {
        // Observability must never change the business outcome.
      });
      return pending;
    },
  };
}

export function sanitizeEvent(event: AutoReplyGodViewEvent, maxChars = 200_000): AutoReplyGodViewEvent {
  return {
    ...event,
    buyer: event.buyer ? sanitizeValue(event.buyer, maxChars) as AutoReplyGodViewEvent['buyer'] : undefined,
    payload: sanitizeValue(event.payload, maxChars) as Record<string, unknown>,
  };
}

function sanitizeValue(value: unknown, maxChars: number, key?: string): unknown {
  if (typeof value === 'string') return sanitizeText(value, maxChars, key);
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, maxChars, key));
  if (!value || typeof value !== 'object') return value;
  const result: Record<string, unknown> = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    if (isSecretKey(childKey)) {
      result[childKey] = '[REDACTED]';
      continue;
    }
    result[childKey] = sanitizeValue(childValue, maxChars, childKey);
  }
  return result;
}

function sanitizeText(value: string, maxChars: number, key?: string): string {
  if (isSecretKey(key ?? '')) return '[REDACTED]';
  const redacted = value
    .replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi, '[INLINE_IMAGE_REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]')
    .replace(/(cookie|authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|signature)(\s*[:=]\s*)("[^"]*"|'[^']*'|\S+)/gi, '$1$2[REDACTED]');
  return redacted.length > maxChars ? `${redacted.slice(0, maxChars)}…[TRUNCATED]` : redacted;
}

function isSecretKey(key: string): boolean {
  return /(?:cookie|authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|signature)/i.test(key);
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function resolveRepositoryRoot(): string {
  let current = resolve(process.cwd());
  for (let depth = 0; depth < 5; depth += 1) {
    if (existsSync(resolve(current, 'package.json')) && existsSync(resolve(current, 'apps', 'api'))) return current;
    const parent = resolve(current, '..');
    if (parent === current) break;
    current = parent;
  }
  return resolve(process.cwd());
}
