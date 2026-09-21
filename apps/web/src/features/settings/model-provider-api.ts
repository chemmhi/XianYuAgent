export interface ProviderModelVM {
  id: string;
  object?: string;
  ownedBy?: string;
  /** Optional provider-owned reasoning/thinking controls. Empty means unsupported. */
  reasoningEfforts?: string[];
  thinkingLevels?: string[];
}

export interface ProviderModelsVM {
  accountId: string;
  configId: string;
  provider: string;
  models: ProviderModelVM[];
}

interface ApiEnvelope<T> {
  success: boolean;
  data: T | null;
  message?: string | null;
  error?: { code?: string };
}

export interface ModelProviderApiTransport {
  get<T>(path: string): Promise<T>;
}

export interface ModelProviderApi {
  list(input: { accountId: string; configId: string }): Promise<ProviderModelsVM>;
}

export function createModelProviderApi(transport: ModelProviderApiTransport): ModelProviderApi {
  return {
    async list(input) {
      const params = new URLSearchParams({ accountId: input.accountId, configId: input.configId });
      const payload = await transport.get<ProviderModelsVM | ApiEnvelope<ProviderModelsVM>>(`/api/v1/settings/openai/models?${params.toString()}`);
      return unwrap(payload);
    },
  };
}

function unwrap<T>(payload: T | ApiEnvelope<T>): T {
  if (payload && typeof payload === 'object' && 'success' in payload && 'data' in payload) {
    const envelope = payload as ApiEnvelope<T>;
    if (!envelope.success || envelope.data === null) throw new Error(envelope.message ?? envelope.error?.code ?? 'MODEL_LIST_REQUEST_FAILED');
    return envelope.data;
  }
  return payload as T;
}
