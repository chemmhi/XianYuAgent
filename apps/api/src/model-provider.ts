export interface ProviderModel {
  id: string;
  object?: string;
  ownedBy?: string;
  /** Provider-declared reasoning controls; never populated from a local allowlist. */
  reasoningEfforts?: string[];
  thinkingLevels?: string[];
}

export interface ListProviderModelsInput {
  apiKey: string;
  baseUrl: string;
  provider?: string;
  modelsPath?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export type ModelProviderErrorCode =
  | 'MODEL_PROVIDER_BASE_URL_REQUIRED'
  | 'MODEL_PROVIDER_INVALID_URL'
  | 'MODEL_PROVIDER_HTTP_ERROR'
  | 'MODEL_PROVIDER_INVALID_RESPONSE'
  | 'MODEL_PROVIDER_NETWORK_ERROR'
  | 'MODEL_PROVIDER_TIMEOUT';

export class ModelProviderError extends Error {
  constructor(readonly code: ModelProviderErrorCode, message: string, readonly status?: number) {
    super(message);
    this.name = 'ModelProviderError';
  }
}

/**
 * Lists models from an OpenAI-compatible provider. The provider response is
 * the source of truth; no model ids are embedded in this module.
 */
export async function listProviderModels(input: ListProviderModelsInput): Promise<ProviderModel[]> {
  const baseUrl = input.baseUrl.trim().replace(/\/+$/, '');
  if (!baseUrl) throw new ModelProviderError('MODEL_PROVIDER_BASE_URL_REQUIRED', 'model provider base URL is required');
  const endpoint = resolveModelsEndpoint(baseUrl, input.modelsPath);
  const timeoutMs = Number.isFinite(input.timeoutMs) && (input.timeoutMs ?? 0) > 0 ? Math.trunc(input.timeoutMs!) : 10_000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const fetchImpl = input.fetchImpl ?? fetch;

  try {
    const response = await fetchImpl(endpoint, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${input.apiKey}`,
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new ModelProviderError('MODEL_PROVIDER_HTTP_ERROR', `model provider returned HTTP ${response.status}`, response.status);

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new ModelProviderError('MODEL_PROVIDER_INVALID_RESPONSE', 'model provider returned invalid JSON');
    }
    const candidates = extractModelCandidates(payload);
    return dedupeModels(candidates);
  } catch (error) {
    if (error instanceof ModelProviderError) throw error;
    if (controller.signal.aborted) throw new ModelProviderError('MODEL_PROVIDER_TIMEOUT', `model provider request timed out after ${timeoutMs}ms`);
    throw new ModelProviderError('MODEL_PROVIDER_NETWORK_ERROR', 'model provider request failed');
  } finally {
    clearTimeout(timeout);
  }
}

export function resolveModelsEndpoint(baseUrl: string, modelsPath?: string): string {
  let parsedBase: URL;
  try {
    parsedBase = new URL(baseUrl);
  } catch {
    throw new ModelProviderError('MODEL_PROVIDER_INVALID_URL', 'model provider base URL is invalid');
  }
  if (!['http:', 'https:'].includes(parsedBase.protocol) || parsedBase.username || parsedBase.password) {
    throw new ModelProviderError('MODEL_PROVIDER_INVALID_URL', 'model provider base URL is invalid');
  }
  const normalizedPath = modelsPath?.trim();
  if (normalizedPath) {
    if (/^[a-z][a-z\d+.-]*:/i.test(normalizedPath) || normalizedPath.startsWith('//')) {
      throw new ModelProviderError('MODEL_PROVIDER_INVALID_URL', 'model provider models path must stay on the configured host');
    }
    return new URL(normalizedPath.replace(/^\/+/, ''), `${baseUrl}/`).toString();
  }
  if (baseUrl.endsWith('/models')) return baseUrl;
  return `${baseUrl}/models`;
}

function extractModelCandidates(payload: unknown): ProviderModel[] {
  const source = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray(payload.data)
      ? payload.data
      : isRecord(payload) && Array.isArray(payload.models)
        ? payload.models
        : undefined;
  if (!source) throw new ModelProviderError('MODEL_PROVIDER_INVALID_RESPONSE', 'model provider returned no model list');
  return source.flatMap((candidate): ProviderModel[] => {
    if (typeof candidate === 'string' && candidate.trim()) return [{ id: candidate.trim() }];
    if (!isRecord(candidate) || typeof candidate.id !== 'string' || !candidate.id.trim()) return [];
    const reasoningEfforts = readStringArray(candidate, ['reasoningEfforts', 'reasoning_efforts']);
    const thinkingLevels = readStringArray(candidate, ['thinkingLevels', 'thinking_levels']);
    return [{
      id: candidate.id.trim(),
      ...(typeof candidate.object === 'string' ? { object: candidate.object } : {}),
      ...(typeof candidate.owned_by === 'string' ? { ownedBy: candidate.owned_by } : typeof candidate.ownedBy === 'string' ? { ownedBy: candidate.ownedBy } : {}),
      ...(reasoningEfforts ? { reasoningEfforts } : {}),
      ...(thinkingLevels ? { thinkingLevels } : {}),
    }];
  });
}

function readStringArray(record: Record<string, unknown>, keys: string[]): string[] | undefined {
  for (const key of keys) {
    const value = record[key];
    if (!Array.isArray(value)) continue;
    const values = [...new Set(value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean))];
    return values.length > 0 ? values : undefined;
  }
  return undefined;
}

function dedupeModels(models: ProviderModel[]): ProviderModel[] {
  const seen = new Set<string>();
  return models.filter((model) => {
    if (seen.has(model.id)) return false;
    seen.add(model.id);
    return true;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
