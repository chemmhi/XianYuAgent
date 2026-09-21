import { decryptCredentialValue } from './credential-crypto.js';
import type { CredentialRefRecord, Store } from './domain.js';
import { ServiceError } from './services.js';
import type { ApiKeyCredentialService } from './credential-store.js';
import { OpenAICompatibleModelClient, type ModelClient, type ModelWireApi } from './pi-runtime.js';

export type OpenAIConfigRole = 'primary' | 'backup';

export interface OpenAIConfigView {
  id?: string;
  accountId: string;
  role: OpenAIConfigRole;
  provider: string;
  alias: string;
  label?: string;
  baseUrl: string;
  model: string;
  wireApi: ModelWireApi;
  timeoutMs: number;
  status: CredentialRefRecord['status'];
  version: number;
  fingerprint?: string;
  apiKeyConfigured: boolean;
  apiKeyHint?: string;
  lastConnectivity?: 'unknown' | 'passed' | 'failed';
  lastConnectivityAt?: string;
  createdAt?: string;
  updatedAt?: string;
  canReveal: false;
}

export interface OpenAIConfigInput {
  adminId: string;
  accountId: string;
  configId?: string;
  role: OpenAIConfigRole;
  provider: string;
  alias: string;
  label?: string;
  baseUrl: string;
  model: string;
  wireApi?: ModelWireApi;
  timeoutMs?: number;
  apiKey?: string;
  expectedVersion?: number;
  requestId: string;
  traceId: string;
}

export type OpenAIConfigBody = Pick<OpenAIConfigInput, 'role' | 'provider' | 'alias' | 'label' | 'baseUrl' | 'model' | 'wireApi' | 'timeoutMs' | 'apiKey' | 'expectedVersion'>;

export interface OpenAIResolvedConfig extends OpenAIConfigView {
  apiKey: string;
}

type Audit = (input: { actorId: string; action: string; targetRef?: string; requestId: string; traceId: string; payload: unknown; accountId?: string }) => Promise<string>;

const DEFAULT_TIMEOUT_MS = 60_000;

export class OpenAISettingsService {
  constructor(
    private readonly store: Store,
    private readonly credentials: ApiKeyCredentialService,
    private readonly encryptionKey: string,
    private readonly audit: Audit,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async list(input: { adminId: string; accountId: string }): Promise<OpenAIConfigView[]> {
    const refs = await this.credentials.list(input);
    return refs
      .filter((ref) => ref.kind === 'api_key' && ref.purpose === 'model_client')
      .map((ref) => toView(ref));
  }

  async save(input: OpenAIConfigInput): Promise<OpenAIConfigView> {
    const normalized = normalizeInput(input);
    const current = input.configId ? await this.store.getCredentialRef(input.adminId, input.configId) : undefined;
    if (input.configId && (!current || current.accountId !== input.accountId)) throw new ServiceError(404, 'NOT_FOUND', '模型配置不存在');
    const existing = await this.list({ adminId: input.adminId, accountId: input.accountId });
    const duplicateRole = existing.find((item) => item.role === normalized.role && item.id !== input.configId && item.status !== 'revoked');
    if (duplicateRole) throw new ServiceError(409, 'CONFLICT', `${normalized.role === 'primary' ? '主配置' : '备用配置'}已存在`);

    let saved: CredentialRefRecord;
    if (!current) {
      if (!normalized.apiKey) throw new ServiceError(422, 'VALIDATION_FAILED', 'apiKey is required for a new model configuration');
      saved = await this.credentials.create({
        adminId: input.adminId,
        accountId: input.accountId,
        provider: normalized.provider,
        alias: normalized.alias,
        label: normalized.label,
        apiKey: normalized.apiKey,
        metadata: metadataFor(normalized),
        requestId: input.requestId,
        traceId: input.traceId,
      });
    } else {
      if (!Number.isInteger(input.expectedVersion) || input.expectedVersion! < 1) throw new ServiceError(422, 'VALIDATION_FAILED', 'expectedVersion must be a positive integer');
      saved = await this.credentials.update({
        adminId: input.adminId,
        credentialId: current.id,
        expectedVersion: input.expectedVersion!,
        provider: normalized.provider,
        alias: normalized.alias,
        label: normalized.label,
        metadata: metadataFor(normalized),
        requestId: input.requestId,
        traceId: input.traceId,
      });
      if (normalized.apiKey) {
        saved = await this.credentials.rotate({ adminId: input.adminId, credentialId: saved.id, expectedVersion: saved.version, apiKey: normalized.apiKey, requestId: input.requestId, traceId: input.traceId });
      }
    }

    await this.audit({ actorId: input.adminId, action: 'settings.openai.saved', targetRef: saved.id, requestId: input.requestId, traceId: input.traceId, payload: { role: normalized.role, provider: normalized.provider, model: normalized.model, wireApi: normalized.wireApi, timeoutMs: normalized.timeoutMs, version: saved.version }, accountId: saved.accountId });
    return toView(saved);
  }

  async test(input: OpenAIConfigInput): Promise<{ ok: true; provider: string; model: string; latencyMs: number; models: string[] }> {
    const normalized = normalizeInput(input);
    const secret = await this.resolveSecret(input.adminId, input.configId, normalized.apiKey);
    const started = Date.now();
    const models = await this.fetchModels({ baseUrl: normalized.baseUrl, apiKey: secret, timeoutMs: normalized.timeoutMs });
    return { ok: true, provider: normalized.provider, model: normalized.model, latencyMs: Date.now() - started, models };
  }

  async listModels(input: { adminId: string; accountId: string; configId?: string }): Promise<string[]> {
    const resolved = input.configId
      ? await this.resolveById(input.adminId, input.configId, input.accountId)
      : (await this.resolveForRuntime(input.adminId, input.accountId))[0];
    if (!resolved) return [];
    return this.fetchModels({ baseUrl: resolved.baseUrl, apiKey: resolved.apiKey, timeoutMs: resolved.timeoutMs });
  }

  async resolveForRuntime(adminId: string, accountId: string): Promise<OpenAIResolvedConfig[]> {
    const refs = await this.store.listCredentialRefs(adminId, accountId);
    const rows: OpenAIResolvedConfig[] = [];
    for (const ref of refs.filter((item) => item.status === 'active' && item.kind === 'api_key' && item.purpose === 'model_client')) {
      const secret = await this.store.getCredentialRefSecret(adminId, ref.id);
      if (!secret) continue;
      const view = toView(ref);
      rows.push({ ...view, apiKey: decryptCredentialValue(secret.secretCiphertext, this.encryptionKey) });
    }
    return rows.sort((left, right) => (left.role === 'primary' ? -1 : right.role === 'primary' ? 1 : 0));
  }

  async createRuntimeClient(config: OpenAIResolvedConfig): Promise<ModelClient> {
    return new OpenAICompatibleModelClient({ apiKey: config.apiKey, baseUrl: config.baseUrl, model: config.model, timeoutMs: config.timeoutMs, wireApi: config.wireApi });
  }

  async resolveById(adminId: string, configId: string, accountId: string): Promise<OpenAIResolvedConfig | undefined> {
    const ref = await this.store.getCredentialRef(adminId, configId);
    if (!ref || ref.accountId !== accountId || ref.status === 'revoked') return undefined;
    const secret = await this.store.getCredentialRefSecret(adminId, configId);
    if (!secret) return undefined;
    return { ...toView(ref), apiKey: decryptCredentialValue(secret.secretCiphertext, this.encryptionKey) };
  }

  private async resolveSecret(adminId: string, configId: string | undefined, provided: string | undefined): Promise<string> {
    if (provided?.trim()) return provided.trim();
    if (!configId) throw new ServiceError(422, 'VALIDATION_FAILED', 'apiKey is required');
    const secret = await this.store.getCredentialRefSecret(adminId, configId);
    if (!secret) throw new ServiceError(404, 'NOT_FOUND', '模型配置不存在');
    return decryptCredentialValue(secret.secretCiphertext, this.encryptionKey);
  }

  private async fetchModels(input: { baseUrl: string; apiKey: string; timeoutMs: number }): Promise<string[]> {
    const url = modelsUrl(input.baseUrl);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.min(Math.max(input.timeoutMs, 1_000), 120_000));
    try {
      const response = await this.fetchImpl(url, { method: 'GET', headers: { accept: 'application/json', authorization: `Bearer ${input.apiKey}` }, signal: controller.signal });
      if (!response.ok) throw new ServiceError(502, 'EXTERNAL_TIMEOUT', `模型供应商返回 HTTP ${response.status}`);
      const payload = await response.json() as unknown;
      return parseModelIds(payload);
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      throw new ServiceError(502, 'EXTERNAL_TIMEOUT', '模型供应商连接失败，请检查 Base URL、API Key 或网络');
    } finally { clearTimeout(timeout); }
  }
}

export function createFallbackModelClient(primary: ModelClient, backup?: ModelClient): ModelClient {
  return {
    async complete(input) {
      try { return await primary.complete(input); }
      catch (error) { if (!backup) throw error; return backup.complete(input); }
    },
  };
}

function normalizeInput(input: OpenAIConfigInput) {
  const provider = input.provider.trim();
  const alias = input.alias.trim() || (input.role === 'primary' ? 'primary' : 'backup');
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const model = input.model.trim();
  const wireApi: ModelWireApi = input.wireApi === 'chat' ? 'chat' : 'responses';
  const timeoutMs = Number.isFinite(input.timeoutMs) && (input.timeoutMs ?? 0) > 0 ? Math.min(Math.max(Math.trunc(input.timeoutMs!), 1_000), 120_000) : DEFAULT_TIMEOUT_MS;
  if (!provider || !model) throw new ServiceError(422, 'VALIDATION_FAILED', 'provider and model are required');
  return { ...input, provider, alias, baseUrl, model, wireApi, timeoutMs, apiKey: input.apiKey?.trim() || undefined };
}

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '');
  let parsed: URL;
  try { parsed = new URL(trimmed); } catch { throw new ServiceError(422, 'VALIDATION_FAILED', 'baseUrl must be a valid http(s) URL'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new ServiceError(422, 'VALIDATION_FAILED', 'baseUrl must use http or https');
  return parsed.toString().replace(/\/+$/, '');
}

function modelsUrl(baseUrl: string): string { return `${normalizeBaseUrl(baseUrl)}/models`; }

function metadataFor(input: { role: OpenAIConfigRole; baseUrl: string; model: string; wireApi: ModelWireApi; timeoutMs: number }): Record<string, string> {
  return { role: input.role, baseUrl: input.baseUrl, model: input.model, wireApi: input.wireApi, timeoutMs: String(input.timeoutMs) };
}

function roleFrom(ref: CredentialRefRecord): OpenAIConfigRole {
  return ref.metadata.role === 'backup' || ref.alias.trim().toLowerCase() === 'backup' ? 'backup' : 'primary';
}

function toView(ref: CredentialRefRecord): OpenAIConfigView {
  const role = roleFrom(ref);
  return {
    id: ref.id,
    accountId: ref.accountId,
    role,
    provider: ref.provider,
    alias: ref.alias,
    label: ref.label,
    baseUrl: ref.metadata.baseUrl ?? '',
    model: ref.metadata.model ?? '',
    wireApi: ref.metadata.wireApi === 'chat' ? 'chat' : 'responses',
    timeoutMs: Number(ref.metadata.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    status: ref.status,
    version: ref.version,
    fingerprint: ref.fingerprint,
    apiKeyConfigured: true,
    apiKeyHint: `••••${ref.fingerprint.slice(-4)}`,
    lastConnectivity: ref.metadata.lastConnectivity === 'passed' ? 'passed' : ref.metadata.lastConnectivity === 'failed' ? 'failed' : 'unknown',
    lastConnectivityAt: ref.metadata.lastConnectivityAt,
    createdAt: ref.createdAt,
    updatedAt: ref.updatedAt,
    canReveal: false,
  };
}

function parseModelIds(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return [];
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  return [...new Set(data.map((item) => item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string' ? String((item as { id: string }).id).trim() : '').filter(Boolean))].slice(0, 200);
}

export function redactedRuntimeConfigs(configs: OpenAIResolvedConfig[]): OpenAIConfigView[] {
  return configs.map(({ apiKey: _apiKey, ...view }) => view);
}

export function redactSecretFromError(error: unknown): string {
  return error instanceof Error ? error.message.replace(/sk-[A-Za-z0-9_-]+/g, 'sk-***') : 'MODEL_PROVIDER_FAILED';
}
