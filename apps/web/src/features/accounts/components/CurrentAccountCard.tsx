import type { AccountVM } from '../types';
import { accountStatusDescription, autoReplyLabel } from '../presentation';
import { AccountConnectionBadge, AccountStatusBadge } from './AccountStatusBadge';

export function CurrentAccountCard({ account }: { account?: AccountVM }) {
  return <article className="card kpi-card accounts-current-card" data-testid="current-account-card">
    <div className="kpi-label">当前账号</div>
    {account ? <>
      <div className="accounts-current-identity">
        <span className="accounts-domain-avatar">{account.avatarUrl ? <img src={account.avatarUrl} alt="" /> : account.displayName.slice(-1)}</span>
        <strong className="accounts-current-name">{account.displayName}</strong>
      </div>
      <div className="accounts-current-status"><AccountStatusBadge status={account.status} riskCode={account.riskCode} /><AccountConnectionBadge status={account.connection.status} /></div>
      <p className="accounts-current-description">{accountStatusDescription(account)} 自动回复{autoReplyLabel(account.aiEnabled)}。</p>
    </> : <><div className="accounts-current-name">未选择账号</div><p className="accounts-current-description">在列表中点击“切换”选择当前账号。</p></>}
  </article>;
}
