import type { AutoReplyAgentConfigVM, CredentialListVM, CredentialRefVM, CredentialStatus } from './types';

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

export interface AutoReplyAgentSettingsApi {
  get(accountId: string): Promise<AutoReplyAgentConfigVM>;
  update(input: { accountId: string; expectedVersion: number; patch: Partial<Omit<AutoReplyAgentConfigVM, 'accountId' | 'updatedByAdminId' | 'configVersion' | 'configDigest' | 'createdAt' | 'updatedAt'>> }): Promise<AutoReplyAgentConfigVM>;
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

export function createAutoReplyAgentSettingsApi(transport: Transport): AutoReplyAgentSettingsApi {
  return {
    async get(accountId) {
      const params = new URLSearchParams({ accountId });
      return unwrap(await transport.get<AutoReplyAgentConfigVM | ApiEnvelope<AutoReplyAgentConfigVM>>(`/api/v1/settings/agent?${params.toString()}`));
    },
    async update(input) {
      const patch = requirePatch(transport);
      return unwrap(await patch<AutoReplyAgentConfigVM | ApiEnvelope<AutoReplyAgentConfigVM>>('/api/v1/settings/agent', { accountId: input.accountId, expectedVersion: input.expectedVersion, ...input.patch }, { headers: { 'Idempotency-Key': idempotency('auto-reply-agent-settings') } }));
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

export function createMockAutoReplyAgentSettingsApi(): AutoReplyAgentSettingsApi {
  let value: AutoReplyAgentConfigVM = {
    accountId: 'mock-account', configVersion: 0, configDigest: 'mock-default', createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
    enabled: true,
    systemPrompt: '你是闲鱼卖家面向买家的自动回复 Agent。只根据工具事实回答，不确定时转人工。',
    userPromptTemplate: '{{buyerMessage}}',
    maxLoops: 4,
    maxToolCalls: 8,
    toolTimeoutMs: 10_000,
    totalTimeoutMs: 60_000,
    maxHistory: 20,
    maxReplyLength: 1_000,
    maxReplySegmentChars: 300,
    maxReplySegments: 4,
    replySegmentDelayMs: 800,
    debounceMs: 2_000,
    allowPaidOrderReply: false,
    sendMode: 'simulate',
  };
  return {
    async get(accountId) { return { ...value, accountId }; },
    async update(input) {
      if (value.configVersion !== input.expectedVersion) throw new Error('版本冲突');
      value = { ...value, accountId: input.accountId, ...input.patch, configVersion: value.configVersion + 1, configDigest: `mock-${value.configVersion + 1}`, updatedAt: new Date().toISOString() };
      return { ...value };
    },
  };
}
