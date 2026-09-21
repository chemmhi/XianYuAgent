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
  maxReplySegmentChars: number;
  maxReplySegments: number;
  replySegmentDelayMs: number;
  debounceMs: number;
  allowPaidOrderReply: boolean;
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
