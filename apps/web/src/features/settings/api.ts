import type { AutoReplyAgentConfigVM, CredentialListVM, CredentialRefVM, CredentialStatus, OpenAIConfigListVM, OpenAIConfigVM, OpenAIRuntimeVM, OpenAIRoutingMode } from './types';

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
  update(input: { accountId: string; expectedVersion: number; patch: Partial<Omit<AutoReplyAgentConfigVM, 'accountId' | 'updatedByAdminId' | 'configVersion' | 'configDigest' | 'createdAt' | 'updatedAt' | 'debounceMs'>> }): Promise<AutoReplyAgentConfigVM>;
}

export interface OpenAISettingsApi {
  list(accountId: string): Promise<OpenAIConfigListVM>;
  save(input: { accountId: string; configId?: string; role: 'primary' | 'backup'; provider: string; alias: string; label?: string; baseUrl: string; model: string; reasoningEffort?: string; wireApi: 'responses' | 'chat'; timeoutMs: number; probeStrategy?: 'models' | 'completion' | 'health_url' | 'none'; probeUrl?: string; probeModel?: string; probeTimeoutMs?: number; apiKey?: string; expectedVersion?: number }): Promise<OpenAIConfigVM>;
  test(input: { accountId: string; configId?: string; role: 'primary' | 'backup'; provider: string; alias: string; baseUrl: string; model: string; reasoningEffort?: string; wireApi: 'responses' | 'chat'; timeoutMs: number; probeStrategy?: 'models' | 'completion' | 'health_url' | 'none'; probeUrl?: string; probeModel?: string; probeTimeoutMs?: number; apiKey?: string }): Promise<{ ok: true; provider: string; model: string; latencyMs: number; models: string[] }>;
  listModels(input: { accountId: string; configId?: string }): Promise<string[]>;
  updateRouting(input: { accountId: string; mode: OpenAIRoutingMode; preferredRole?: 'primary' | 'backup'; forceProbe?: boolean; expectedVersion: number }): Promise<OpenAIRuntimeVM>;
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

export function createOpenAISettingsApi(transport: Transport): OpenAISettingsApi {
  return {
    async list(accountId) {
      const params = new URLSearchParams({ accountId });
      return unwrap(await transport.get<OpenAIConfigListVM | ApiEnvelope<OpenAIConfigListVM>>(`/api/v1/settings/openai?${params.toString()}`));
    },
    async save(input) {
      const method = input.configId ? requirePatch(transport) : requirePost(transport);
      const path = input.configId ? `/api/v1/settings/openai/${encodeURIComponent(input.configId)}` : '/api/v1/settings/openai';
      return unwrap(await method<OpenAIConfigVM | ApiEnvelope<OpenAIConfigVM>>(path, input, { headers: { 'Idempotency-Key': idempotency(`openai-settings-${input.role}`) } }));
    },
    async test(input) {
      const post = requirePost(transport);
      return unwrap(await post<{ ok: true; provider: string; model: string; latencyMs: number; models: string[] } | ApiEnvelope<{ ok: true; provider: string; model: string; latencyMs: number; models: string[] }>>('/api/v1/settings/openai/test', input));
    },
    async listModels(input) {
      const params = new URLSearchParams({ accountId: input.accountId });
      if (input.configId) params.set('configId', input.configId);
      const result = unwrap(await transport.get<{ models: string[] } | ApiEnvelope<{ models: string[] }>>(`/api/v1/settings/openai/models?${params.toString()}`));
      return result.models;
    },
    async updateRouting(input) {
      const post = requirePost(transport);
      return unwrap(await post<OpenAIRuntimeVM | ApiEnvelope<OpenAIRuntimeVM>>('/api/v1/settings/openai/routing', input, { headers: { 'Idempotency-Key': idempotency('openai-routing') } }));
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
    toolTimeoutSeconds: 10,
    totalTimeoutSeconds: 600,
    maxHistory: 20,
    maxReplyLength: 1_000,
    replySegmentDelaySeconds: 0.8,
    debounceMs: 2_000,
    sendDelaySeconds: 300,
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

export function createMockOpenAISettingsApi(): OpenAISettingsApi {
  const now = () => new Date().toISOString();
  const rows = new Map<string, OpenAIConfigVM>();
  // Test-only fallback: production Model options always come from the provider /models endpoint.
  // Keep the fixture provider-neutral so it cannot be mistaken for a production model allowlist.
  const models = ['mock-provider-model-a', 'mock-provider-model-b'];
  let routingVersion = 0;
  return {
    async list(accountId) {
      const items = [...rows.values()].filter((item) => item.accountId === accountId);
      return { accountId, items, runtime: { mode: 'auto', preferred_provider: null, effective_provider: items.find((item) => item.role === 'primary') ? { role: 'primary', id: items.find((item) => item.role === 'primary')?.id, provider: items.find((item) => item.role === 'primary')?.provider ?? '', model: items.find((item) => item.role === 'primary')?.model ?? '' } : null, last_successful_provider: null, observed_at: now(), provider_states: {}, config_generation: 0, routing_version: routingVersion, server_time: now() } }; },
    async save(input) {
      const current = input.configId ? rows.get(input.configId) : undefined;
      if (current && current.version !== input.expectedVersion) throw new Error('版本冲突');
      if (!current && [...rows.values()].some((item) => item.accountId === input.accountId && item.role === input.role)) throw new Error('该账号已有相同角色配置');
      const timestamp = now();
      const value: OpenAIConfigVM = { id: current?.id ?? `openai_${Date.now()}_${input.role}`, accountId: input.accountId, role: input.role, provider: input.provider, alias: input.alias, label: input.label, baseUrl: input.baseUrl, model: input.model, reasoningEffort: input.reasoningEffort, wireApi: input.wireApi, timeoutMs: input.timeoutMs, status: 'active', version: current ? current.version + 1 : 1, fingerprint: current?.fingerprint ?? 'mock-fingerprint', apiKeyConfigured: true, apiKeyHint: input.apiKey ? maskApiKey(input.apiKey) : current?.apiKeyHint ?? maskApiKey('mock-api-key'), lastConnectivity: 'passed', lastConnectivityAt: timestamp, createdAt: current?.createdAt ?? timestamp, updatedAt: timestamp, canReveal: false };
      rows.set(value.id!, value);
      return value;
    },
    async test(input) { return { ok: true, provider: input.provider, model: input.model, latencyMs: 12, models }; },
    async listModels() { return models; },
    async updateRouting(input) { if (input.expectedVersion !== routingVersion) throw new Error('版本冲突'); routingVersion += 1; return { mode: input.mode, preferred_provider: null, effective_provider: null, last_successful_provider: null, observed_at: now(), provider_states: {}, config_generation: 0, routing_version: routingVersion, server_time: now() }; },
  };
}

function maskApiKey(value: string): string {
  const key = value.trim();
  if (!key) return '';
  const visibleEach = Math.min(4, Math.max(1, Math.floor((key.length - 1) / 2)));
  const middleLength = Math.max(1, key.length - visibleEach * 2);
  return `${key.slice(0, visibleEach)}${'*'.repeat(middleLength)}${key.slice(-visibleEach)}`;
}
