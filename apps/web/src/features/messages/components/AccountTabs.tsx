import type { AccountVM } from '../../accounts/types';

export function AccountTabs({ accounts, activeAccountId, onSelect }: { accounts: AccountVM[]; activeAccountId?: string; onSelect: (accountId: string) => void }) {
  return <div className="messages-account-tabs" role="tablist" aria-label="消息账号范围">
    {accounts.filter((account) => account.status !== 'disabled').map((account) => <button key={account.id} type="button" role="tab" aria-selected={account.id === activeAccountId} className={account.id === activeAccountId ? 'active' : ''} onClick={() => onSelect(account.id)}>{account.displayName || account.sellerRef}<small>{account.connection.status === 'online' ? '在线' : '离线'}</small></button>)}
  </div>;
}
