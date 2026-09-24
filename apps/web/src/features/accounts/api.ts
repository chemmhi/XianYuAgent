import type { AccountSummary, PageResult } from '../../api/contracts';
import type {
  AccountConnectionVM,
  AccountConnectionStatus,
  AccountCredentialState,
  AccountListFilters,
  AccountVM,
  AccountsPageVM,
  AccountStatus,
} from './types';
import type { QrLoginSessionVM, QrLoginStatus } from './qr-login/model';

export interface AccountsApiTransport {
  get<T>(path: string): Promise<T>;
  post?<T>(path: string, body?: unknown, init?: RequestInit): Promise<T>;
  delete?<T>(path: string, init?: RequestInit): Promise<T>;
}

export interface AccountsApi {
  list(filters?: AccountListFilters): Promise<AccountsPageVM>;
  createAccount(input: { platform: 'xianyu'; sellerRef: string; displayName?: string }): Promise<AccountVM>;
  deleteAccount?(accountId: string): Promise<void>;
  getDetail(accountId: string): Promise<AccountVM>;
  getConnection(accountId: string): Promise<AccountConnectionVM>;
  createQrSession(accountId?: string): Promise<QrLoginSessionVM>;
  getQrSession(accountId: string | undefined, qrSessionId: string): Promise<QrLoginSessionVM>;
  renewQrSession?(accountId: string | undefined, qrSessionId: string): Promise<QrLoginSessionVM>;
  cancelQrSession?(accountId: string | undefined, qrSessionId: string): Promise<void>;
  loginWithCookie(input: { cookieHeader: string; accountId?: string }): Promise<AccountVM>;
  loginWithPassword(input: { account: string; password: string }): Promise<AccountVM>;
}

interface CanonicalAccountResponse {
  id: string;
  platform?: 'xianyu';
  sellerRef?: string;
  displayName: string;
  remark?: string;
  avatarUrl?: string;
  platformUserId?: string;
  status?: AccountStatus | 'active' | 'error';
  connection?: { status: AccountConnectionStatus; lastConnectedAt?: string; latencyMs?: number; failureCode?: string; failureMessage?: string };
  enabled?: boolean;
  aiEnabled?: boolean;
  credentialState?: AccountCredentialState;
  version?: number;
  updatedAt?: string;
}

interface CanonicalAccountsPayload { items?: CanonicalAccountResponse[]; total?: number; page?: number; pageSize?: number; totalPages?: number; }
interface ApiEnvelope<T> { success: boolean; data: T | null; error?: { code?: string; details?: unknown }; message?: string | null; }
interface CanonicalQrSessionResponse { id?: string; qrSessionId?: string; accountId?: string; status: string; qrImageDataUrl?: string; qrImageRef?: string; verificationUrl?: string; verificationAutoLaunch?: boolean; expiresAt: string; pollAfterMs?: number; connection?: AccountConnectionVM; errorCode?: string; auditRef?: string; }

function unwrapEnvelope<T>(payload: T | ApiEnvelope<T>): T {
  if (payload && typeof payload === 'object' && 'success' in payload && 'data' in payload) {
    const envelope = payload as ApiEnvelope<T>;
    if (!envelope.success || envelope.data === null) throw new Error(envelope.message ?? envelope.error?.code ?? 'ACCOUNT_REQUEST_FAILED');
    return envelope.data;
  }
  return payload as T;
}

function toAccountVM(account: CanonicalAccountResponse): AccountVM {
  const normalizedStatus: AccountStatus = account.status === 'active' ? 'connected' : account.status === 'error' ? 'degraded' : account.status ?? (account.enabled === false ? 'disabled' : 'pending');
  return {
    id: account.id,
    platform: 'xianyu',
    sellerRef: account.sellerRef ?? account.id,
    displayName: account.displayName,
    remark: account.remark,
    avatarUrl: account.avatarUrl,
    platformUserId: account.platformUserId,
    status: normalizedStatus,
    connection: { status: account.connection?.status ?? (normalizedStatus === 'connected' ? 'online' : normalizedStatus === 'expired' ? 'expired' : normalizedStatus === 'disconnected' ? 'offline' : normalizedStatus === 'pending' ? 'connecting' : 'unknown'), lastConnectedAt: account.connection?.lastConnectedAt, latencyMs: account.connection?.latencyMs, failureCode: account.connection?.failureCode, failureMessage: account.connection?.failureMessage },
    enabled: account.enabled ?? true,
    aiEnabled: account.aiEnabled ?? false,
    credentialState: account.credentialState ?? (normalizedStatus === 'connected' ? 'configured' : 'unknown'),
    version: account.version ?? 1,
    updatedAt: account.updatedAt ?? new Date(0).toISOString(),
  };
}

function toCanonicalPage(payload: CanonicalAccountsPayload): AccountsPageVM {
  const items = (payload.items ?? []).map(toAccountVM);
  const page = payload.page ?? 1;
  const pageSize = payload.pageSize ?? Math.max(items.length, 20);
  const total = payload.total ?? items.length;
  return { items, total, page, pageSize, totalPages: payload.totalPages ?? Math.max(1, Math.ceil(total / pageSize)) };
}

function toQrLoginStatus(status: string): QrLoginStatus {
  if (status === 'created') return 'waiting';
  return ['waiting', 'scanned', 'succeeded', 'expired', 'failed', 'cancelled', 'verification_required'].includes(status) ? status as QrLoginStatus : 'failed';
}

function toQrLoginSession(payload: CanonicalQrSessionResponse): QrLoginSessionVM {
  const qrSessionId = payload.qrSessionId ?? payload.id;
  if (!qrSessionId) throw new Error('QR_SESSION_ID_MISSING');
  return { qrSessionId, accountId: payload.accountId, status: toQrLoginStatus(payload.status), qrImageDataUrl: payload.qrImageDataUrl, qrImageRef: payload.qrImageRef, verificationUrl: payload.verificationUrl, verificationAutoLaunch: payload.verificationAutoLaunch, expiresAt: payload.expiresAt, pollAfterMs: payload.pollAfterMs ?? 1500, connection: payload.connection, errorCode: payload.errorCode, auditRef: payload.auditRef };
}

function unwrapQrSession(payload: CanonicalQrSessionResponse | ApiEnvelope<CanonicalQrSessionResponse>): QrLoginSessionVM { return toQrLoginSession(unwrapEnvelope(payload)); }
function requirePost(transport: AccountsApiTransport): NonNullable<AccountsApiTransport['post']> { if (!transport.post) throw new Error('ACCOUNT_MUTATION_UNAVAILABLE'); return transport.post.bind(transport); }
function requireDelete(transport: AccountsApiTransport): NonNullable<AccountsApiTransport['delete']> { if (!transport.delete) throw new Error('ACCOUNT_DELETE_UNAVAILABLE'); return transport.delete.bind(transport); }

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
    async list(filters) { return toCanonicalPage(unwrapEnvelope(await transport.get<CanonicalAccountsPayload | ApiEnvelope<CanonicalAccountsPayload>>(`/api/v1/accounts${queryString(filters)}`))); },
    async createAccount(input) { const post = requirePost(transport); return toAccountVM(unwrapEnvelope(await post<CanonicalAccountResponse | ApiEnvelope<CanonicalAccountResponse>>('/api/v1/accounts', input, { headers: { 'Idempotency-Key': `account-create-${input.sellerRef}-${Date.now()}` } }))); },
    async deleteAccount(accountId) { const del = requireDelete(transport); await del<unknown>(`/api/v1/accounts/${encodeURIComponent(accountId)}`, { headers: { 'Idempotency-Key': `account-delete-${accountId}-${Date.now()}` } }); },
    async getDetail(accountId) { return toAccountVM(unwrapEnvelope(await transport.get<CanonicalAccountResponse | ApiEnvelope<CanonicalAccountResponse>>(`/api/v1/accounts/${encodeURIComponent(accountId)}`))); },
    async getConnection(accountId) { return unwrapEnvelope(await transport.get<AccountConnectionVM | ApiEnvelope<AccountConnectionVM>>(`/api/v1/accounts/${encodeURIComponent(accountId)}/connection`)); },
    async createQrSession(accountId) { const post = requirePost(transport); return unwrapQrSession(await post<CanonicalQrSessionResponse | ApiEnvelope<CanonicalQrSessionResponse>>('/api/v1/auth/qr-sessions', accountId ? { accountId } : {}, { headers: { 'Idempotency-Key': `qr-login-${accountId ?? 'onboarding'}-${Date.now()}` } })); },
    async getQrSession(_accountId, qrSessionId) { return unwrapQrSession(await transport.get<CanonicalQrSessionResponse | ApiEnvelope<CanonicalQrSessionResponse>>(`/api/v1/auth/qr-sessions/${encodeURIComponent(qrSessionId)}`)); },
    async renewQrSession(accountId, qrSessionId) { const post = requirePost(transport); const path = accountId ? `/api/v1/accounts/${encodeURIComponent(accountId)}/login-sessions/${encodeURIComponent(qrSessionId)}/renew` : `/api/v1/auth/qr-sessions/${encodeURIComponent(qrSessionId)}/renew`; return unwrapQrSession(await post<CanonicalQrSessionResponse | ApiEnvelope<CanonicalQrSessionResponse>>(path, {}, { headers: { 'Idempotency-Key': `qr-login-renew-${accountId ?? 'onboarding'}-${qrSessionId}-${Date.now()}` } })); },
    async cancelQrSession(accountId, qrSessionId) { const post = requirePost(transport); const path = accountId ? `/api/v1/accounts/${encodeURIComponent(accountId)}/login-sessions/${encodeURIComponent(qrSessionId)}/cancel` : `/api/v1/auth/qr-sessions/${encodeURIComponent(qrSessionId)}/cancel`; await post(path, {}, { headers: { 'Idempotency-Key': `qr-login-cancel-${accountId ?? 'onboarding'}-${qrSessionId}-${Date.now()}` } }); },
    async loginWithCookie(input) { const post = requirePost(transport); const payload = unwrapEnvelope(await post<{ account: CanonicalAccountResponse } | ApiEnvelope<{ account: CanonicalAccountResponse }>>('/api/v1/auth/cookie-login', input, { headers: { 'Idempotency-Key': `cookie-login-${Date.now()}` } })); return toAccountVM(payload.account); },
    async loginWithPassword(input) { const post = requirePost(transport); const payload = unwrapEnvelope(await post<{ account: CanonicalAccountResponse } | ApiEnvelope<{ account: CanonicalAccountResponse }>>('/api/v1/accounts/password-login', input, { headers: { 'Idempotency-Key': `password-login-${Date.now()}` } })); return toAccountVM(payload.account); },
  };
}

function fromLegacySummary(account: AccountSummary): AccountVM {
  const connectionStatus: AccountConnectionStatus = account.online ? 'online' : account.credentialState === 'refresh_required' ? 'expired' : 'offline';
  const credentialState: AccountCredentialState = account.credentialState === 'complete' ? 'configured' : account.credentialState;
  return { id: account.id, platform: 'xianyu', sellerRef: account.id, displayName: account.displayName, remark: account.remark, status: account.enabled ? 'connected' : 'disabled', connection: { status: connectionStatus }, enabled: account.enabled, aiEnabled: account.aiEnabled, credentialState, version: 1, updatedAt: new Date(0).toISOString() };
}

export function createMockAccountsApi(seed: AccountSummary[] = [
  { id: 'A', displayName: '闲鱼账号 A', remark: '资料自动发货店', enabled: true, online: true, aiEnabled: true, credentialState: 'complete' },
  { id: 'B', displayName: '闲鱼账号 B', remark: '课程资料副店', enabled: true, online: false, aiEnabled: false, credentialState: 'refresh_required' },
  { id: 'C', displayName: '闲鱼账号 C', remark: '测试账号', enabled: false, online: true, aiEnabled: false, credentialState: 'missing' },
]): AccountsApi {
  const accounts = seed.map(fromLegacySummary);
  const qrSessions = new Map<string, QrLoginSessionVM>();
  const createQrSession = (accountId?: string): QrLoginSessionVM => {
    if (accountId && !accounts.some((account) => account.id === accountId)) throw new Error('account not found');
    const session: QrLoginSessionVM = { qrSessionId: `qr_${accountId ?? 'onboarding'}_${Date.now()}`, accountId, status: 'waiting', expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(), pollAfterMs: 1500 };
    qrSessions.set(session.qrSessionId, session);
    return session;
  };
  return {
    async list(filters = {}) { const search = filters.search?.trim().toLowerCase(); const filtered = accounts.filter((account) => (!search || [account.id, account.displayName, account.remark ?? ''].some((value) => value.toLowerCase().includes(search))) && (!filters.status || filters.status === 'all' || account.status === filters.status) && (!filters.connectionStatus || filters.connectionStatus === 'all' || account.connection.status === filters.connectionStatus)); const page = filters.page ?? 1; const pageSize = filters.pageSize ?? 20; const start = (page - 1) * pageSize; return { items: filtered.slice(start, start + pageSize), total: filtered.length, page, pageSize, totalPages: Math.max(1, Math.ceil(filtered.length / pageSize)) }; },
    async createAccount(input) { if (accounts.some((account) => account.sellerRef === input.sellerRef)) throw new Error('ACCOUNT_ALREADY_EXISTS'); const account: AccountVM = { id: `account-${Date.now()}`, platform: 'xianyu', sellerRef: input.sellerRef, displayName: input.displayName?.trim() || input.sellerRef, status: 'pending', connection: { status: 'unknown' }, enabled: true, aiEnabled: false, credentialState: 'missing', version: 1, updatedAt: new Date().toISOString() }; accounts.unshift(account); return account; },
    async deleteAccount(accountId) { const index = accounts.findIndex((account) => account.id === accountId); if (index < 0) throw new Error('ACCOUNT_NOT_FOUND'); accounts.splice(index, 1); },
    async getDetail(accountId) { const account = accounts.find((item) => item.id === accountId); if (!account) throw new Error('account not found'); return account; },
    async getConnection(accountId) { return (await this.getDetail(accountId)).connection; },
    async createQrSession(accountId) { return createQrSession(accountId); },
    async getQrSession(accountId, qrSessionId) { const session = qrSessions.get(qrSessionId); if (!session || (session.accountId ?? '') !== (accountId ?? '')) throw new Error('qr session not found'); return session; },
    async renewQrSession(accountId, qrSessionId) { const previous = qrSessions.get(qrSessionId); if (!previous || (previous.accountId ?? '') !== (accountId ?? '')) throw new Error('qr session not found'); previous.status = 'expired'; return createQrSession(accountId); },
    async cancelQrSession(accountId, qrSessionId) { const session = qrSessions.get(qrSessionId); if (!session || (session.accountId ?? '') !== (accountId ?? '')) throw new Error('qr session not found'); session.status = 'cancelled'; },
    async loginWithCookie() { throw new Error('COOKIE_LOGIN_UNAVAILABLE'); },
    async loginWithPassword() { throw new Error('PASSWORD_LOGIN_UNAVAILABLE'); },
  };
}

export function createLegacyAccountsApi(legacyApi: { list(query?: { page?: number; pageSize?: number; search?: string }): Promise<PageResult<AccountSummary>> }): AccountsApi {
  return {
    async list(filters) { const result = await legacyApi.list(filters); return { ...result, items: result.items.map(fromLegacySummary) }; },
    async createAccount() { throw new Error('ACCOUNT_CREATE_UNAVAILABLE'); },
    async deleteAccount() { throw new Error('ACCOUNT_DELETE_UNAVAILABLE'); },
    async getDetail(accountId) { const result = await legacyApi.list({ search: accountId }); const account = result.items.find((item) => item.id === accountId); if (!account) throw new Error('account not found'); return fromLegacySummary(account); },
    async getConnection(accountId) { return (await this.getDetail(accountId)).connection; },
    async createQrSession() { throw new Error('QR_LOGIN_UNAVAILABLE'); },
    async getQrSession() { throw new Error('QR_LOGIN_UNAVAILABLE'); },
    async renewQrSession() { throw new Error('QR_LOGIN_UNAVAILABLE'); },
    async cancelQrSession() { throw new Error('QR_LOGIN_UNAVAILABLE'); },
    async loginWithCookie() { throw new Error('COOKIE_LOGIN_UNAVAILABLE'); },
    async loginWithPassword() { throw new Error('PASSWORD_LOGIN_UNAVAILABLE'); },
  };
}
