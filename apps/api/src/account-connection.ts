import type { AccountRecord } from './domain.js';

type ConnectionAccount = Pick<AccountRecord, 'status' | 'transportStatus' | 'transportSeenAt' | 'lastConnectedAt' | 'riskCode' | 'riskSource' | 'riskFirstSeenAt'>;
export type MessageConnectionStatus = 'online' | 'offline' | 'connecting' | 'expired' | 'unknown';

export function messageConnectionStatus(account: ConnectionAccount, now = Date.now()): MessageConnectionStatus {
  if (account.status === 'verification_required') return 'unknown';
  if (account.status === 'expired') return 'expired';
  if (account.status === 'disabled') return 'offline';
  const seenAt = Date.parse(account.transportSeenAt ?? '');
  if (account.transportStatus === 'connected' && seenAt > now - 15_000 && seenAt <= now) return 'online';
  if (account.transportStatus === 'connecting') return 'connecting';
  if (account.transportStatus === 'disconnected' || account.transportStatus === 'failed') return 'offline';
  if (account.status === 'pending') return 'connecting';
  return account.status === 'degraded' ? 'unknown' : 'offline';
}

// Fixed expression for the accounts alias used by PostgresStore. Values from
// query parameters are bound separately, never interpolated into this SQL.
export const ACCOUNT_MESSAGE_CONNECTION_SQL = `(case
  when a.risk_episode is not null or a.status='verification_required' then 'unknown'
  when a.status='expired' then 'expired'
  when a.status='disabled' then 'offline'
  when a.transport_status='connected' and a.transport_seen_at>now()-interval '15 seconds' and a.transport_seen_at<=now() then 'online'
  when a.transport_status='connecting' then 'connecting'
  when a.transport_status in ('disconnected','failed') then 'offline'
  when a.status='pending' then 'connecting'
  when a.degraded_source is not null or a.status='degraded' then 'unknown'
  else 'offline' end)`;

export function connectionView(account: ConnectionAccount) {
  return {
    status: messageConnectionStatus(account), lastConnectedAt: account.lastConnectedAt,
    failureCode: account.status === 'verification_required' ? account.riskCode ?? 'ACCOUNT_VALIDATION_REQUIRED' : account.status === 'degraded' ? 'ADAPTER_UNKNOWN' : undefined,
    failureMessage: account.status === 'verification_required' ? '闲鱼账号需要安全验证。' : account.status === 'degraded' ? '最近账号操作出现异常，消息连接状态单独确认。' : undefined,
    failureAt: account.riskFirstSeenAt,
  };
}
