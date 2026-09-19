import { createHash, randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

export interface Envelope<T> {
  success: boolean;
  message: string | null;
  data: T | null;
  error?: { code: string; details?: unknown };
  requestId: string;
  traceId: string;
}

export interface RequestContext {
  requestId: string;
  traceId: string;
  method: string;
  path: string;
  body: Record<string, unknown>;
  headers: Record<string, string | undefined>;
  cookies: Record<string, string>;
}

export function createIds(): Pick<RequestContext, 'requestId' | 'traceId'> {
  return { requestId: `req_${randomUUID()}`, traceId: `trc_${randomUUID()}` };
}

export function success<T>(ctx: RequestContext, data: T, statusCode = 200): { statusCode: number; body: Envelope<T> } {
  return { statusCode, body: { success: true, message: null, data, requestId: ctx.requestId, traceId: ctx.traceId } };
}

export function failure(ctx: RequestContext, statusCode: number, code: string, message: string, details?: unknown): { statusCode: number; body: Envelope<null> } {
  return { statusCode, body: { success: false, message, data: null, error: { code, details }, requestId: ctx.requestId, traceId: ctx.traceId } };
}

export function parseCookies(value: string | undefined): Record<string, string> {
  return Object.fromEntries((value ?? '').split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const index = part.indexOf('=');
    return index < 0 ? [part, ''] : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
  }));
}

export function setCookie(response: ServerResponse, name: string, value: string, options: { httpOnly?: boolean; secure?: boolean; maxAge?: number } = {}): void {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'SameSite=Lax'];
  if (options.httpOnly) parts.push('HttpOnly');
  if (options.secure) parts.push('Secure');
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  const existing = response.getHeader('Set-Cookie');
  const cookies = Array.isArray(existing) ? existing : existing ? [String(existing)] : [];
  response.setHeader('Set-Cookie', [...cookies, parts.join('; ')]);
}

export async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  if (!Buffer.concat(chunks).length) return {};
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('body must be a JSON object');
  return parsed as Record<string, unknown>;
}

export function fingerprint(method: string, path: string, body: unknown): string {
  return createHash('sha256').update(JSON.stringify({ method, path, body })).digest('hex');
}

export function writeJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(payload));
}
