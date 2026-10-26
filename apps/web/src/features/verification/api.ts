import type { VerificationSession } from './model';
export interface VerificationTransport {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown, init?: RequestInit): Promise<T>;
}
interface Envelope<T> { success: boolean; data: T; message?: string | null }
function unwrap<T>(value: T | Envelope<T>): T {
  if (value && typeof value === 'object' && 'success' in value) {
    const envelope = value as Envelope<T>;
    if (!envelope.success) throw new Error(envelope.message ?? '验证请求失败');
    return envelope.data;
  }
  return value as T;
}
export function createVerificationApi(transport: VerificationTransport) {
  return {
    async native(id: string, action: 'presentation' | 'claim' | 'result' | 'cancel', body: Record<string, unknown>) {
      return unwrap(await transport.post<{ session: VerificationSession; leaseId?: string; url?: string; origin?: string }>(
        `/api/v1/verification-sessions/${encodeURIComponent(id)}/native/${action}`, body));
    },
    async list() { return unwrap(await transport.get<{ sessions: VerificationSession[]; serverTime: number }>('/api/v1/verification-sessions?active=true')); },
    async get(id: string) { return unwrap(await transport.get<{ session: VerificationSession }>(`/api/v1/verification-sessions/${encodeURIComponent(id)}`)).session; },
    async command(id: string, action: string, body: Record<string, unknown>) {
      return unwrap(await transport.post<{ session: VerificationSession }>(`/api/v1/verification-sessions/${encodeURIComponent(id)}/${action}`, body, { headers: { 'Idempotency-Key': crypto.randomUUID() } })).session;
    },
    async retry(subject: VerificationSession['subject']) {
      return unwrap(await transport.post<{ session?: VerificationSession; pending?: boolean }>('/api/v1/verification-sessions/retry', { ...subject, mode: 'manual_only' }, { headers: { 'Idempotency-Key': crypto.randomUUID() } }));
    },
  };
}
export type VerificationApi = ReturnType<typeof createVerificationApi>;
export function verificationSocketUrl(path: string, baseUrl = ''): string {
  const url = new URL(`${baseUrl.replace(/\/$/, '')}${path}`, window.location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.href;
}
