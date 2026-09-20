import type { CredentialListVM, CredentialRefVM, CredentialStatus } from './types';

interface Transport {
  get<T>(path: string): Promise<T>;
  post?<T>(path: string, body?: unknown, init?: RequestInit): Promise<T>;
  patch?<T>(path: string, body?: unknown, init?: RequestInit): Promise<T>;
}

interface ApiEnvelope<T> { success: boolean; data: T | null; message?: string | null; error?: { code?: string } }

function unwrap<T>(payload: T | ApiEnvelope<T>): T {
  if (payload && typeof payload === 'object' && 'success' in payload && 'data' in payload) {
    const envelope = payload as ApiEnvelope<T>;
    if (!envelope.success || envelope.data === null) throw new Error(envelope.message ?? envelope.error?.code ?? 'CREDENTIAL_REQUEST_FAILED');
    return envelope.data;
  }
  return payload as T;
}

function requirePost(transport: Transport) { if (!transport.post) throw new Error('CREDENTIAL_MUTATION_UNAVAILABLE'); return transport.post.bind(transport); }
function requirePatch(transport: Transport) { if (!transport.patch) throw new Error('CREDENTIAL_MUTATION_UNAVAILABLE'); return transport.patch.bind(transport); }
function idempotency(prefix: string): string { return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }

export interface CredentialApi {
  list(accountId: string): Promise<CredentialListVM>;
  create(input: { accountId: string; provider: string; alias: string; label?: string; apiKey: string; metadata?: Record<string, string> }): Promise<CredentialRefVM>;
  update(input: { credentialId: string; expectedVersion: number; provider?: string; alias?: string; label?: string; metadata?: Record<string, string> }): Promise<CredentialRefVM>;
  rotate(input: { credentialId: string; expectedVersion: number; apiKey: string }): Promise<CredentialRefVM>;
  setStatus(input: { credentialId: string; expectedVersion: number; status: Exclude<CredentialStatus, 'rotating'> }): Promise<CredentialRefVM>;
}

export function createCredentialApi(transport: Transport): CredentialApi {
  return {
    async list(accountId) {
      const params = new URLSearchParams({ accountId });
      return unwrap(await transport.get<CredentialListVM | ApiEnvelope<CredentialListVM>>(`/api/v1/credentials?${params.toString()}`));
    },
    async create(input) {
      const post = requirePost(transport);
      return unwrap(await post<CredentialRefVM | ApiEnvelope<CredentialRefVM>>('/api/v1/credentials', input, { headers: { 'Idempotency-Key': idempotency('credential-create') } }));
    },
    async update(input) {
      const patch = requirePatch(transport);
      return unwrap(await patch<CredentialRefVM | ApiEnvelope<CredentialRefVM>>(`/api/v1/credentials/${encodeURIComponent(input.credentialId)}`, input, { headers: { 'Idempotency-Key': idempotency('credential-update') } }));
    },
    async rotate(input) {
      const post = requirePost(transport);
      return unwrap(await post<CredentialRefVM | ApiEnvelope<CredentialRefVM>>(`/api/v1/credentials/${encodeURIComponent(input.credentialId)}/rotate`, { expectedVersion: input.expectedVersion, apiKey: input.apiKey }, { headers: { 'Idempotency-Key': idempotency('credential-rotate') } }));
    },
    async setStatus(input) {
      const post = requirePost(transport);
      const action = input.status === 'active' ? 'enable' : input.status === 'disabled' ? 'disable' : 'revoke';
      return unwrap(await post<CredentialRefVM | ApiEnvelope<CredentialRefVM>>(`/api/v1/credentials/${encodeURIComponent(input.credentialId)}/${action}`, { expectedVersion: input.expectedVersion }, { headers: { 'Idempotency-Key': idempotency(`credential-${action}`) } }));
    },
  };
}

export function createMockCredentialApi(): CredentialApi {
  const rows = new Map<string, CredentialRefVM>();
  return {
    async list(accountId) { return { accountId, items: [...rows.values()].filter((row) => row.accountId === accountId) }; },
    async create(input) {
      if ([...rows.values()].some((row) => row.accountId === input.accountId)) throw new Error('该账号已有模型 API Key 配置');
      const now = new Date().toISOString();
      const row: CredentialRefVM = { id: `cred_${Date.now()}`, accountId: input.accountId, kind: 'api_key', purpose: 'model_client', status: 'active', version: 1, provider: input.provider, alias: input.alias, label: input.label, fingerprint: 'mock-fingerprint', metadata: input.metadata ?? {}, lastRotatedAt: now, createdAt: now, updatedAt: now, canReveal: false };
      rows.set(row.id, row); return row;
    },
    async update(input) { const row = rows.get(input.credentialId); if (!row) throw new Error('credential not found'); if (row.version !== input.expectedVersion) throw new Error('版本冲突'); Object.assign(row, { provider: input.provider ?? row.provider, alias: input.alias ?? row.alias, label: input.label ?? row.label, metadata: input.metadata ?? row.metadata, version: row.version + 1, updatedAt: new Date().toISOString() }); return row; },
    async rotate(input) { const row = rows.get(input.credentialId); if (!row) throw new Error('credential not found'); if (row.version !== input.expectedVersion) throw new Error('版本冲突'); row.version += 1; row.status = 'active'; row.fingerprint = 'mock-rotated'; row.lastRotatedAt = new Date().toISOString(); row.updatedAt = row.lastRotatedAt; return row; },
    async setStatus(input) { const row = rows.get(input.credentialId); if (!row) throw new Error('credential not found'); if (row.version !== input.expectedVersion) throw new Error('版本冲突'); row.status = input.status; row.version += 1; row.updatedAt = new Date().toISOString(); return row; },
  };
}
