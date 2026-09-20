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
}

export const DEFAULT_DATABASE_URL = 'postgres://xianyu:xianyu_dev_only@127.0.0.1:5432/xianyu_agent';
export const DEFAULT_REDIS_URL = 'redis://127.0.0.1:6379';

function asBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
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
  };
}
