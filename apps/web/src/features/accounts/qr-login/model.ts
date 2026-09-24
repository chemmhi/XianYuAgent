import type { AccountConnectionVM } from '../types';

export type QrLoginStatus = 'waiting' | 'scanned' | 'succeeded' | 'expired' | 'failed' | 'cancelled' | 'verification_required';
export type QrLoginPhase = 'idle' | 'creating' | 'polling' | 'succeeded' | 'expired' | 'failed' | 'cancelled' | 'verification_required';

export interface QrLoginSessionVM {
  qrSessionId: string;
  accountId?: string;
  status: QrLoginStatus;
  qrImageDataUrl?: string;
  qrImageRef?: string;
  verificationUrl?: string;
  verificationAutoLaunch?: boolean;
  expiresAt: string;
  pollAfterMs: number;
  connection?: AccountConnectionVM;
  errorCode?: string;
  auditRef?: string;
}

export interface QrLoginError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface QrLoginModel {
  phase: QrLoginPhase;
  session: QrLoginSessionVM | null;
  error: QrLoginError | null;
}

export function createInitialQrLoginModel(): QrLoginModel { return { phase: 'idle', session: null, error: null }; }

export function isTerminalQrStatus(status: QrLoginStatus, options?: { verificationAutoLaunch?: boolean }): boolean {
  if (status === 'verification_required' && options?.verificationAutoLaunch) return false;
  return ['succeeded', 'expired', 'failed', 'cancelled', 'verification_required'].includes(status);
}

export function phaseForQrStatus(status: QrLoginStatus): QrLoginPhase {
  if (status === 'succeeded') return 'succeeded';
  if (status === 'expired') return 'expired';
  if (status === 'failed') return 'failed';
  if (status === 'cancelled') return 'cancelled';
  if (status === 'verification_required') return 'verification_required';
  return 'polling';
}

export function secondsUntilQrExpiry(expiresAt: string, now = Date.now()): number {
  const expiry = Date.parse(expiresAt);
  if (!Number.isFinite(expiry)) return 0;
  return Math.max(0, Math.ceil((expiry - now) / 1000));
}

export function qrStatusLabel(status: QrLoginStatus): string {
  const labels: Record<QrLoginStatus, string> = {
    waiting: '等待扫码',
    scanned: '已扫码，等待确认',
    succeeded: '登录成功',
    expired: '二维码已过期',
    failed: '登录失败',
    cancelled: '登录已取消',
    verification_required: '需要人工验证',
  };
  return labels[status];
}
