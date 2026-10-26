import { useEffect, useRef } from 'react';
import { useAccountContext } from './account-context';
import { accountErrorMessage, accountRiskLabel } from '../features/accounts/feedback';
import { useToast, type ToastNotice } from '../shared/ui/ToastProvider';

export function AccountRiskFeedback({ onViewAccounts }: { onViewAccounts: () => void }) {
  const { accounts, accountsError, riskNotifications, acknowledgeRiskNotifications, refreshAccounts } = useAccountContext();
  const { showToast, dismissToast } = useToast();
  const seenNotifications = useRef(new Set<string>());
  const previousRisks = useRef(new Set<string>());
  const previousError = useRef<string | null>(null);
  const confirming = useRef(false);
  const currentNotice = useRef('');

  useEffect(() => {
    if (accountsError && accountsError !== previousError.current) {
      showToast({ id: 'account-refresh', tone: 'error', message: accountsError, actions: [{ label: '重试', onClick: () => { void refreshAccounts(); } }] });
    }
    if (!accountsError) dismissToast('account-refresh');
    previousError.current = accountsError;
  }, [accountsError, refreshAccounts, showToast, dismissToast]);

  useEffect(() => {
    if (accountsError) return;
    const risks = accounts.filter((account) => account.status === 'verification_required');
    const keys = risks.map((account) => `${account.id}:${account.riskFirstSeenAt ?? ''}:${account.riskCode ?? ''}`);
    const newRisk = keys.some((key) => !previousRisks.current.has(key));
    if (keys.length === 0 && previousRisks.current.size > 0) dismissToast('account-risk');
    previousRisks.current = new Set(keys);
    const unread = riskNotifications.filter((notice) => !seenNotifications.current.has(notice.id));
    for (const notice of unread) seenNotifications.current.add(notice.id);
    if (!newRisk && unread.length === 0) return;
    const noticeKey = JSON.stringify([keys, riskNotifications.map((notice) => notice.id)]);
    currentNotice.current = noticeKey;
    const message = risks.length > 0
      ? `${risks.length} 个闲鱼账号需要安全验证：${risks.map((account) => `${account.displayName || '闲鱼账号'}（${accountRiskLabel(account.riskCode)}）`).join('、')}。请查看账号的验证进度并按提示处理。`
      : '账号验证状态已更新，请查看账号状态。';
    const publish = (failure?: string, busy = false) => {
      const notice: ToastNotice = {
        id: 'account-risk', tone: failure || risks.length > 0 ? 'error' : 'info',
        message: failure ?? message, durationMs: failure || busy ? 0 : 10_000,
        actions: [
          { label: '查看账号', onClick: onViewAccounts },
          ...(riskNotifications.length > 0 ? [{ label: busy ? '确认中…' : failure ? '重试' : '已知晓', disabled: busy, onClick: () => { void confirm(); } }] : []),
        ],
      };
      showToast(notice);
    };
    const confirm = async () => {
      if (confirming.current) return;
      confirming.current = true;
      publish(undefined, true);
      try {
        await acknowledgeRiskNotifications();
        if (currentNotice.current === noticeKey) dismissToast('account-risk');
      } catch (error) {
        if (currentNotice.current === noticeKey) publish(accountErrorMessage(error, '通知确认失败，请稍后重试。'));
      } finally {
        confirming.current = false;
      }
    };
    publish();
  }, [accounts, accountsError, riskNotifications, acknowledgeRiskNotifications, onViewAccounts, showToast, dismissToast]);
  return null;
}
