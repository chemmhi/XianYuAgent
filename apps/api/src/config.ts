import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export type AgentRuntimeMode = 'pi' | 'in-process';

export interface AppConfig {
  host: string;
  port: number;
  databaseUrl?: string;
  redisUrl?: string;
  cookieSecure: boolean;
  allowInMemory: boolean;
  sessionIdleMs: number;
  sessionAbsoluteMs: number;
  xianyuQrMode: 'real' | 'stub';
  webSocketAllowedOrigins: string[];
  agentRuntime: AgentRuntimeMode;
  modelApiKey?: string;
  modelBaseUrl?: string;
  modelName?: string;
  modelTimeoutMs: number;
  credentialEncryptionKey: string;
}

export const DEFAULT_DATABASE_URL = 'postgres://xianyu:xianyu_dev_only@127.0.0.1:5432/xianyu_agent';
export const DEFAULT_REDIS_URL = 'redis://127.0.0.1:6379';

function asBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  if (env === process.env) loadLocalEnvFile();
  const modelApiKey = firstDefined(env.API_KEY, env.OPENAI_API_KEY, env.PI_API_KEY);
  const modelBaseUrl = firstDefined(env.BASE_URL, env.OPENAI_BASE_URL, env.PI_BASE_URL);
  const modelName = firstDefined(env.MODEL, env.OPENAI_MODEL, env.PI_MODEL);
  const configuredRuntime = env.AGENT_RUNTIME?.trim().toLowerCase();
  const agentRuntime: AgentRuntimeMode = configuredRuntime === 'in-process'
    ? 'in-process'
    : configuredRuntime === 'pi' || Boolean(modelApiKey && modelBaseUrl && modelName)
      ? 'pi'
      : 'in-process';
  return {
    host: env.HOST ?? '0.0.0.0',
    port: Number(env.PORT ?? 8080),
    databaseUrl: env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
    redisUrl: env.REDIS_URL ?? DEFAULT_REDIS_URL,
    cookieSecure: asBoolean(env.COOKIE_SECURE, false),
    allowInMemory: asBoolean(env.ALLOW_IN_MEMORY, false),
    sessionIdleMs: Number(env.SESSION_IDLE_MINUTES ?? 30) * 60_000,
    sessionAbsoluteMs: Number(env.SESSION_ABSOLUTE_HOURS ?? 8) * 3_600_000,
    xianyuQrMode: env.XIANYU_QR_MODE === 'stub' ? 'stub' : 'real',
    webSocketAllowedOrigins: (env.WS_ALLOWED_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173,http://localhost:8080,http://127.0.0.1:8080').split(',').map((value) => value.trim()).filter(Boolean),
    agentRuntime,
    modelApiKey,
    modelBaseUrl,
    modelName,
    modelTimeoutMs: positiveNumber(env.MODEL_TIMEOUT_MS, 60_000),
    credentialEncryptionKey: env.CREDENTIAL_ENCRYPTION_KEY?.trim() || 'development-only-credential-key-change-me',
  };
}

function firstDefined(...values: Array<string | undefined>): string | undefined {
  return values.map((value) => value?.trim()).find((value): value is string => Boolean(value));
}

function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function loadLocalEnvFile(): void {
  const candidates = [resolve(process.cwd(), '.env'), resolve(process.cwd(), '..', '..', '.env')];
  const filename = candidates.find((candidate) => existsSync(candidate));
  if (!filename || typeof process.loadEnvFile !== 'function') return;
  try { process.loadEnvFile(filename); } catch { /* malformed local env must not crash config discovery */ }
}
