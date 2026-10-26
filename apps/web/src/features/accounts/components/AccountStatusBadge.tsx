import { Badge } from './Badge';
import type { AccountConnectionStatus, AccountCredentialState, AccountStatus } from '../types';
import { accountRiskLabel } from '../feedback';
import { accountStatusLabels, messageConnectionLabels } from '../presentation';

export function AccountStatusBadge({ status, riskCode }: { status: AccountStatus; riskCode?: string }) {
  const tones: Record<AccountStatus, 'ok' | 'gray' | 'warn' | 'danger'> = { pending: 'warn', connected: 'ok', degraded: 'warn', disconnected: 'gray', expired: 'danger', verification_required: 'danger', disabled: 'gray' };
  return <Badge tone={tones[status]}>{status === 'verification_required' ? accountRiskLabel(riskCode) : accountStatusLabels[status]}</Badge>;
}

export function AccountConnectionBadge({ status }: { status: AccountConnectionStatus }) {
  const tones: Record<AccountConnectionStatus, 'ok' | 'gray' | 'info' | 'warn'> = { online: 'ok', offline: 'gray', connecting: 'info', expired: 'warn', unknown: 'warn' };
  return <Badge tone={tones[status]}>{messageConnectionLabels[status]}</Badge>;
}

export function AccountCredentialBadge({ state }: { state: AccountCredentialState }) {
  const labels: Record<AccountCredentialState, string> = { configured: '已配置', refresh_required: '待刷新', missing: '缺少凭证', unknown: '未确认' };
  const tones: Record<AccountCredentialState, 'ok' | 'warn' | 'danger' | 'gray'> = { configured: 'ok', refresh_required: 'warn', missing: 'danger', unknown: 'gray' };
  return <Badge tone={tones[state]}>{labels[state]}</Badge>;
}
