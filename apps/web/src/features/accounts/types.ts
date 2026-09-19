export type AccountStatus = 'pending' | 'connected' | 'degraded' | 'disconnected' | 'expired' | 'disabled';

export type AccountConnectionStatus = 'online' | 'offline' | 'connecting' | 'expired' | 'unknown';

export type AccountCredentialState = 'configured' | 'refresh_required' | 'missing' | 'unknown';

export interface AccountConnectionVM {
  status: AccountConnectionStatus;
  lastConnectedAt?: string;
  latencyMs?: number;
  failureCode?: string;
  failureMessage?: string;
}

export interface AccountVM {
  id: string;
  platform: 'xianyu';
  sellerRef: string;
  displayName: string;
  remark?: string;
  avatarUrl?: string;
  platformUserId?: string;
  status: AccountStatus;
  connection: AccountConnectionVM;
  enabled: boolean;
  aiEnabled: boolean;
  credentialState: AccountCredentialState;
  version: number;
  updatedAt: string;
}

export interface AccountListFilters {
  search?: string;
  status?: AccountStatus | 'all';
  connectionStatus?: AccountConnectionStatus | 'all';
  page?: number;
  pageSize?: number;
}

export interface AccountsPageVM {
  items: AccountVM[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export type AccountsLoadPhase = 'idle' | 'loading' | 'success' | 'empty' | 'error';

export interface AccountsLoadError {
  code: 'NETWORK_ERROR' | 'FORBIDDEN' | 'UNKNOWN';
  message: string;
  retryable: boolean;
}

export interface AccountsState {
  phase: AccountsLoadPhase;
  data: AccountsPageVM | null;
  error: AccountsLoadError | null;
}
