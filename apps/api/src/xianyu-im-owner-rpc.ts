import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Store } from './domain.js';
import { idempotent, ServiceError } from './services.js';
import { XianyuImSendNotStartedError, type XianyuImService } from './xianyu-im-service.js';

export const IM_OWNER_RPC_PATH = '/internal/xianyu-im/v1';
const METHODS = ['isReady', 'startListener', 'resetClient', 'listConversations', 'listMessages',
  'markConversationRead', 'recoverRecentMessages', 'verifyPartialDeliveryImage', 'sendExternalText', 'sendText', 'sendImage'] as const;
type Method = typeof METHODS[number];
type Operations = Pick<XianyuImService, Method>;
const SEND_METHODS = new Set<Method>(['sendExternalText', 'sendText', 'sendImage']);
const MAX_BODY_BYTES = 15 * 1024 * 1024;
const AUTH_WINDOW_MS = 60_000;

export function hasImOwnerSecret(secret: string): boolean {
  return secret.length >= 32 && secret !== 'development-only-credential-key-change-me';
}

function signature(secret: string, timestamp: string, nonce: string, body: string): string {
  const key = createHmac('sha256', secret).update('xianyu-im-owner:v1').digest();
  return createHmac('sha256', key).update(`${timestamp}\n${nonce}\n${body}`).digest('hex');
}

export class XianyuImOwnerClient {
  private readonly url: string;
  constructor(baseUrl: string, private readonly secret: string, private readonly timeoutMs = 420_000) {
    if (!hasImOwnerSecret(secret)) throw new Error('XIANYU_IM_OWNER_SECRET_REQUIRED');
    const url = new URL(baseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('XIANYU_IM_OWNER_URL_INVALID');
    this.url = new URL(IM_OWNER_RPC_PATH, url).toString();
  }

  async call<K extends Method>(method: K, args: Parameters<Operations[K]>): Promise<Awaited<ReturnType<Operations[K]>>> {
    const wireArgs: unknown[] = [...args];
    if (method === 'sendImage') {
      const file = wireArgs[3] as { filename: string; contentType: string; data: Buffer };
      wireArgs[3] = { filename: file.filename, contentType: file.contentType, data: file.data.toString('base64') };
    }
    const body = JSON.stringify({ method, args: wireArgs });
    if (Buffer.byteLength(body) > MAX_BODY_BYTES) throw new ServiceError(413, 'IMAGE_TOO_LARGE', 'IM request is too large');
    const timestamp = String(Date.now()), nonce = randomUUID();
    let payload: { ok?: boolean; result?: unknown; error?: { code?: string; message?: string; statusCode?: number } };
    try {
      const response = await fetch(this.url, { method: 'POST', redirect: 'error',
        headers: { 'content-type': 'application/json', 'x-im-time': timestamp, 'x-im-nonce': nonce,
          'x-im-signature': signature(this.secret, timestamp, nonce, body) },
        body, signal: AbortSignal.timeout(this.timeoutMs) });
      payload = await response.json() as typeof payload;
      if (payload.ok !== true && !payload.error?.code) throw new Error('INVALID_OWNER_RESPONSE');
    } catch {
      // A lost response can follow a successful send. Never fall back to a
      // second socket or blindly replay the request from this transport.
      throw new ServiceError(502, SEND_METHODS.has(method) ? 'XIANYU_IM_SEND_OUTCOME_UNKNOWN' : 'XIANYU_IM_OWNER_UNAVAILABLE', 'IM owner response unavailable');
    }
    if (!payload.ok) {
      const code = SEND_METHODS.has(method) && payload.error?.code === 'IDEMPOTENCY_IN_PROGRESS'
        ? 'XIANYU_IM_SEND_OUTCOME_UNKNOWN' : payload.error!.code!;
      throw new ServiceError(payload.error?.statusCode ?? 502, code, payload.error?.message ?? 'IM owner operation failed');
    }
    return payload.result as Awaited<ReturnType<Operations[K]>>;
  }
}

/** Authenticated worker requests execute only on the API's existing service. */
export class XianyuImOwnerServer {
  private readonly nonces = new Map<string, number>();
  constructor(private readonly secret: string, private readonly service: XianyuImService, private readonly store: Store) {}

  async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    let send = false;
    try {
      if (!hasImOwnerSecret(this.secret)) throw new ServiceError(503, 'XIANYU_IM_OWNER_SECRET_REQUIRED', 'IM owner authentication is not configured');
      if (request.method !== 'POST') throw new ServiceError(405, 'METHOD_NOT_ALLOWED', 'POST is required');
      const timestamp = String(request.headers['x-im-time'] ?? ''), nonce = String(request.headers['x-im-nonce'] ?? '');
      const supplied = String(request.headers['x-im-signature'] ?? '');
      if (!/^\d{13}$/.test(timestamp) || Math.abs(Date.now() - Number(timestamp)) > AUTH_WINDOW_MS
        || !/^[a-f0-9-]{36}$/.test(nonce) || !/^[a-f0-9]{64}$/.test(supplied)) {
        throw new ServiceError(403, 'IM_OWNER_AUTH_FAILED', 'Invalid internal authentication');
      }
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of request) {
        const buffer = Buffer.from(chunk); size += buffer.length;
        if (size > MAX_BODY_BYTES) throw new ServiceError(413, 'IMAGE_TOO_LARGE', 'IM request is too large');
        chunks.push(buffer);
      }
      const body = Buffer.concat(chunks).toString('utf8');
      if (!timingSafeEqual(Buffer.from(supplied, 'hex'), Buffer.from(signature(this.secret, timestamp, nonce, body), 'hex'))) {
        throw new ServiceError(403, 'IM_OWNER_AUTH_FAILED', 'Invalid internal authentication');
      }
      for (const [key, expires] of this.nonces) if (expires <= Date.now()) this.nonces.delete(key);
      if (this.nonces.has(nonce)) throw new ServiceError(403, 'IM_OWNER_AUTH_REPLAY', 'Internal request already received');
      if (this.nonces.size >= 20_000) throw new ServiceError(503, 'IM_OWNER_BUSY', 'IM owner is busy');
      this.nonces.set(nonce, Date.now() + AUTH_WINDOW_MS * 2);
      const input = JSON.parse(body) as { method: Method; args: unknown[] };
      if (!METHODS.includes(input.method) || !Array.isArray(input.args) || input.args.length < 2
        || input.args.length > 6 || input.args.slice(0, 2).some(value => typeof value !== 'string' || !value || value.length > 128)) {
        throw new ServiceError(400, 'IM_OWNER_REQUEST_INVALID', 'Invalid IM operation');
      }
      // JSON arrays encode omitted optional parameters as null. Restore their
      // original undefined value so cursor/default-argument behavior survives.
      const method = input.method, args = input.args.map(value => value === null ? undefined : value);
      send = SEND_METHODS.has(method);
      const [adminId, accountId] = args as [string, string];
      if (!await this.store.hasAccountScope(adminId, accountId)) throw new ServiceError(403, 'ACCOUNT_SCOPE_FORBIDDEN', 'Account scope required');
      const fingerprint = createHash('sha256').update(JSON.stringify({ method, args: send ? args.slice(0, 5) : args })).digest('hex');
      if (method === 'sendImage') {
        const file = args[3] as { filename?: unknown; contentType?: unknown; data?: unknown };
        if (!file || typeof file.filename !== 'string' || typeof file.contentType !== 'string' || typeof file.data !== 'string'
          || !/^[a-zA-Z0-9+/]*={0,2}$/.test(file.data)) throw new ServiceError(400, 'IM_OWNER_IMAGE_INVALID', 'Invalid image payload');
        args[3] = { filename: file.filename, contentType: file.contentType, data: Buffer.from(file.data, 'base64') };
      }
      const execute = async () => {
        try {
          const operation = this.service[method] as (...values: unknown[]) => Promise<unknown>;
          let result = await operation.apply(this.service, args);
          // Worker send callers need the receipt, not another stored copy of
          // private coupon text or media in the idempotency response.
          if (send) result = { externalMessageRef: (result as { externalMessageRef?: string } | undefined)?.externalMessageRef };
          return { statusCode: 200, body: { ok: true, result: result ?? null } };
        } catch (error) {
          // Only the service's explicit pre-send marker can release the fence.
          // Connection error codes alone cannot prove a socket write did not occur.
          if (error instanceof XianyuImSendNotStartedError) throw error;
          return this.failure(error, send);
        }
      };
      let result;
      if (send) {
        const requestId = args[4];
        if (typeof requestId !== 'string' || !requestId || requestId.length > 512) throw new ServiceError(400, 'IM_OWNER_REQUEST_ID_REQUIRED', 'Message request ID required');
        // The handler serializes failures too: an uncertain send must never
        // delete its durable fence and become eligible for another delivery.
        result = await idempotent(this.store, { scope: `xianyu-im-owner:${adminId}:${accountId}:${method}`,
          key: requestId, fingerprint, traceId: String(args[5] ?? requestId), handler: execute });
      } else result = await execute();
      this.reply(response, result.statusCode, result.body);
    } catch (error) {
      const result = this.failure(error, send);
      this.reply(response, result.statusCode, result.body);
    }
  }

  private failure(error: unknown, send: boolean) {
    const known = error instanceof ServiceError;
    const statusCode = known ? error.statusCode : 502;
    const code = known ? error.code : send ? 'XIANYU_IM_SEND_OUTCOME_UNKNOWN' : 'XIANYU_IM_OWNER_OPERATION_FAILED';
    return { statusCode, body: { ok: false, error: { statusCode, code, message: known ? error.message : 'IM owner operation failed' } } };
  }

  private reply(response: ServerResponse, statusCode: number, body: unknown): void {
    if (response.destroyed) return;
    response.writeHead(statusCode, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    response.end(JSON.stringify(body));
  }
}
