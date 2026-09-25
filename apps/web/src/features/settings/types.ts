export type CredentialStatus = 'active' | 'disabled' | 'rotating' | 'revoked';

export interface CredentialRefVM {
  id: string;
  accountId: string;
  kind: 'api_key';
  purpose: 'model_client';
  label?: string;
  status: CredentialStatus;
  version: number;
  provider: string;
  alias: string;
  fingerprint: string;
  metadata: Record<string, string>;
  lastRotatedAt?: string;
  createdAt: string;
  updatedAt: string;
  canReveal: false;
}

export interface CredentialListVM {
  accountId: string;
  items: CredentialRefVM[];
}

export type SettingsLoadPhase = 'idle' | 'loading' | 'empty' | 'success' | 'error' | 'submitting' | 'saved';

export interface SettingsState {
  phase: SettingsLoadPhase;
  data: CredentialListVM | null;
  error: string | null;
  lastAction?: string;
}

export type AutoReplyAgentSendMode = 'simulate' | 'live';

export interface AutoReplyAgentConfigVM {
  enabled: boolean;
  systemPrompt: string;
  userPromptTemplate: string;
  maxLoops: number;
  maxToolCalls: number;
  toolTimeoutMs: number;
  totalTimeoutMs: number;
  maxHistory: number;
  maxReplyLength: number;
  replySegmentDelayMs: number;
  debounceMs: number;
  sendDelaySeconds: number;
  sendMode: AutoReplyAgentSendMode;
  accountId: string;
  updatedByAdminId?: string;
  configVersion: number;
  configDigest: string;
  createdAt: string;
  updatedAt: string;
}

export interface AutoReplyAgentSettingsState {
  phase: SettingsLoadPhase;
  data: AutoReplyAgentConfigVM | null;
  error: string | null;
  lastAction?: string;
}

export type OpenAIConfigRole = 'primary' | 'backup';
export type OpenAIWireApi = 'responses' | 'chat';
export type OpenAIConnectivityState = 'unknown' | 'passed' | 'failed';

export interface OpenAIConfigVM {
  id?: string;
  accountId: string;
  role: OpenAIConfigRole;
  provider: string;
  alias: string;
  label?: string;
  baseUrl: string;
  model: string;
  reasoningEffort?: string;
  wireApi: OpenAIWireApi;
  timeoutMs: number;
  status: CredentialStatus;
  version: number;
  fingerprint?: string;
  apiKeyConfigured: boolean;
  apiKeyHint?: string;
  lastConnectivity?: OpenAIConnectivityState;
  lastConnectivityAt?: string;
  createdAt?: string;
  updatedAt?: string;
  canReveal: false;
}

export interface OpenAIConfigListVM {
  accountId: string;
  items: OpenAIConfigVM[];
}

export interface OpenAIModelsState {
  phase: 'idle' | 'loading' | 'success' | 'empty' | 'error';
  items: string[];
  error: string | null;
}

export interface OpenAISettingsState {
  phase: SettingsLoadPhase;
  data: OpenAIConfigListVM | null;
  error: string | null;
  lastAction?: string;
}
