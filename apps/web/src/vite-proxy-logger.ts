import { createLogger, type LogErrorOptions, type Logger } from 'vite';

const TRANSIENT_PROXY_CODES = new Set([
  'ECONNABORTED',
  'ECONNREFUSED',
  'ECONNRESET',
  'EPIPE',
  'ETIMEDOUT',
]);

const PROXY_ERROR_MARKER = /\b(?:http|ws) proxy(?: socket)? error:/i;

function readErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('code' in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

export function isTransientProxyErrorLog(message: string, error?: unknown): boolean {
  if (!PROXY_ERROR_MARKER.test(message)) return false;
  const code = readErrorCode(error);
  return (code !== undefined && TRANSIENT_PROXY_CODES.has(code))
    || [...TRANSIENT_PROXY_CODES].some((candidate) => message.includes(candidate));
}

export function createProxyTolerantLogger(): Logger {
  const logger = createLogger();
  const originalError = logger.error.bind(logger);
  logger.error = (message: string, options?: LogErrorOptions) => {
    if (!isTransientProxyErrorLog(message, options?.error)) originalError(message, options);
  };
  return logger;
}
