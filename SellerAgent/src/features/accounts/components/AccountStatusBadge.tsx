import { Badge } from './Badge';
import type { AccountConnectionStatus, AccountCredentialState, AccountStatus } from '../types';

export function AccountStatusBadge({ status }: { status: AccountStatus }) {
  const labels: Record<AccountStatus, string> = { pending: '待连接', connected: '已连接', degraded: '降级', disconnected: '已断开', expired: '已过期', disabled: '已停用' };
  const tones: Record<AccountStatus, 'ok' | 'gray' | 'warn' | 'danger'> = { pending: 'warn', connected: 'ok', degraded: 'warn', disconnected: 'gray', expired: 'danger', disabled: 'gray' };
  return <Badge tone={tones[status]}>{labels[status]}</Badge>;
}

export function AccountConnectionBadge({ status }: { status: AccountConnectionStatus }) {
  const labels: Record<AccountConnectionStatus, string> = { online: '在线', offline: '离线', connecting: '连接中', expired: '需重新授权', unknown: '未知' };
  const tones: Record<AccountConnectionStatus, 'ok' | 'gray' | 'info' | 'warn' | 'danger'> = { online: 'ok', offline: 'gray', connecting: 'info', expired: 'warn', unknown: 'danger' };
  return <Badge tone={tones[status]}>{labels[status]}</Badge>;
}

export function AccountCredentialBadge({ state }: { state: AccountCredentialState }) {
  const labels: Record<AccountCredentialState, string> = { configured: '已配置', refresh_required: '待刷新', missing: '缺少凭证', unknown: '未确认' };
  const tones: Record<AccountCredentialState, 'ok' | 'warn' | 'danger' | 'gray'> = { configured: 'ok', refresh_required: 'warn', missing: 'danger', unknown: 'gray' };
  return <Badge tone={tones[state]}>{labels[state]}</Badge>;
}
