import type { AccountSummary, PageResult } from '../../api/contracts';
import type {
  AccountConnectionStatus,
  AccountCredentialState,
  AccountListFilters,
  AccountVM,
  AccountsPageVM,
  AccountStatus,
} from './types';

export interface AccountsApiTransport {
  get<T>(path: string): Promise<T>;
}

export interface AccountsApi {
  list(filters?: AccountListFilters): Promise<AccountsPageVM>;
}

interface CanonicalAccountResponse {
  id: string;
  platform?: 'xianyu';
  sellerRef?: string;
  displayName: string;
  remark?: string;
  status?: AccountStatus | 'active' | 'error';
  connection?: {
    status: AccountConnectionStatus;
    lastConnectedAt?: string;
    latencyMs?: number;
    failureCode?: string;
    failureMessage?: string;
  };
  enabled?: boolean;
  aiEnabled?: boolean;
  credentialState?: AccountCredentialState;
  version?: number;
  updatedAt?: string;
}

interface CanonicalAccountsPayload {
  items?: CanonicalAccountResponse[];
  total?: number;
  page?: number;
  pageSize?: number;
  totalPages?: number;
}

interface ApiEnvelope<T> {
  success: boolean;
  data: T | null;
  error?: { code?: string; details?: unknown };
  message?: string | null;
}

function unwrapEnvelope<T>(payload: T | ApiEnvelope<T>): T {
  if (payload && typeof payload === 'object' && 'success' in payload && 'data' in payload) {
    const envelope = payload as ApiEnvelope<T>;
    if (!envelope.success || envelope.data === null) {
      const message = envelope.message ?? envelope.error?.code ?? '账号请求失败';
      throw new Error(message);
    }
    return envelope.data;
  }
  return payload as T;
}

function toAccountVM(account: CanonicalAccountResponse): AccountVM {
  const normalizedStatus: AccountStatus = account.status === 'active'
    ? 'connected'
    : account.status === 'error'
      ? 'degraded'
      : account.status ?? (account.enabled === false ? 'disabled' : 'pending');
  return {
    id: account.id,
    platform: 'xianyu',
    sellerRef: account.sellerRef ?? account.id,
    displayName: account.displayName,
    remark: account.remark,
    status: normalizedStatus,
    connection: {
      status: account.connection?.status ?? 'unknown',
      lastConnectedAt: account.connection?.lastConnectedAt,
      latencyMs: account.connection?.latencyMs,
      failureCode: account.connection?.failureCode,
      failureMessage: account.connection?.failureMessage,
    },
    enabled: account.enabled ?? true,
    aiEnabled: account.aiEnabled ?? false,
    credentialState: account.credentialState ?? 'unknown',
    version: account.version ?? 1,
    updatedAt: account.updatedAt ?? new Date(0).toISOString(),
  };
}

function toCanonicalPage(payload: CanonicalAccountsPayload): AccountsPageVM {
  const items = (payload.items ?? []).map(toAccountVM);
  const page = payload.page ?? 1;
  const pageSize = payload.pageSize ?? Math.max(items.length, 20);
  const total = payload.total ?? items.length;
  return {
    items,
    total,
    page,
    pageSize,
    totalPages: payload.totalPages ?? Math.max(1, Math.ceil(total / pageSize)),
  };
}

function queryString(filters: AccountListFilters = {}): string {
  const params = new URLSearchParams();
  if (filters.search?.trim()) params.set('search', filters.search.trim());
  if (filters.status && filters.status !== 'all') params.set('status', filters.status);
  if (filters.connectionStatus && filters.connectionStatus !== 'all') params.set('connectionStatus', filters.connectionStatus);
  if (filters.page) params.set('page', String(filters.page));
  if (filters.pageSize) params.set('pageSize', String(filters.pageSize));
  const value = params.toString();
  return value ? `?${value}` : '';
}

export function createAccountsApi(transport: AccountsApiTransport): AccountsApi {
  return {
    async list(filters) {
      const rawPayload = await transport.get<CanonicalAccountsPayload | ApiEnvelope<CanonicalAccountsPayload>>(`/api/v1/accounts${queryString(filters)}`);
      return toCanonicalPage(unwrapEnvelope(rawPayload));
    },
  };
}

function fromLegacySummary(account: AccountSummary): AccountVM {
  const connectionStatus: AccountConnectionStatus = account.online
    ? 'online'
    : account.credentialState === 'refresh_required'
      ? 'expired'
      : 'offline';
  const credentialState: AccountCredentialState = account.credentialState === 'complete'
    ? 'configured'
    : account.credentialState;
  return {
    id: account.id,
    platform: 'xianyu',
    sellerRef: account.id,
    displayName: account.displayName,
    remark: account.remark,
    status: account.enabled ? 'connected' : 'disabled',
    connection: { status: connectionStatus },
    enabled: account.enabled,
    aiEnabled: account.aiEnabled,
    credentialState,
    version: 1,
    updatedAt: new Date(0).toISOString(),
  };
}

export function createMockAccountsApi(seed: AccountSummary[] = [
  { id: 'A', displayName: '闲鱼账号 A', remark: '资料自动发货店', enabled: true, online: true, aiEnabled: true, credentialState: 'complete' },
  { id: 'B', displayName: '闲鱼账号 B', remark: '课程资料副店', enabled: true, online: false, aiEnabled: false, credentialState: 'refresh_required' },
  { id: 'C', displayName: '闲鱼账号 C', remark: '测试账号', enabled: false, online: true, aiEnabled: false, credentialState: 'missing' },
]): AccountsApi {
  const accounts = seed.map(fromLegacySummary);
  return {
    async list(filters = {}) {
      const search = filters.search?.trim().toLowerCase();
      const filtered = accounts.filter((account) => {
        const matchesSearch = !search || [account.id, account.displayName, account.remark ?? ''].some((value) => value.toLowerCase().includes(search));
        const matchesStatus = !filters.status || filters.status === 'all' || account.status === filters.status;
        const matchesConnection = !filters.connectionStatus || filters.connectionStatus === 'all' || account.connection.status === filters.connectionStatus;
        return matchesSearch && matchesStatus && matchesConnection;
      });
      const page = filters.page ?? 1;
      const pageSize = filters.pageSize ?? 20;
      const start = (page - 1) * pageSize;
      return {
        items: filtered.slice(start, start + pageSize),
        total: filtered.length,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(filtered.length / pageSize)),
      };
    },
  };
}

export function createLegacyAccountsApi(legacyApi: { list(query?: { page?: number; pageSize?: number; search?: string }): Promise<PageResult<AccountSummary>> }): AccountsApi {
  return {
    async list(filters) {
      const result = await legacyApi.list(filters);
      return {
        ...result,
        items: result.items.map(fromLegacySummary),
      };
    },
  };
}
