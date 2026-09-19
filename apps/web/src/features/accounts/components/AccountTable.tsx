import { AccountConnectionBadge, AccountCredentialBadge, AccountStatusBadge } from './AccountStatusBadge';
import type { AccountVM } from '../types';

export function AccountTable({ accounts, activeAccountId, onReauthorize, onSwitch, onDelete }: {
  accounts: AccountVM[];
  activeAccountId?: string;
  onReauthorize: (account: AccountVM) => void;
  onSwitch: (account: AccountVM) => void;
  onDelete: (account: AccountVM) => void;
}) {
  return (
    <div className="accounts-domain-table" role="table" aria-label="账号列表">
      <div className="accounts-domain-row accounts-domain-head" role="row">
        <span role="columnheader">账号</span>
        <span role="columnheader">状态</span>
        <span role="columnheader">连接</span>
        <span role="columnheader">自动回复</span>
        <span role="columnheader">凭证引用</span>
        <span role="columnheader">最近更新</span>
        <span role="columnheader">操作</span>
      </div>
      {accounts.map((account) => (
        <div className="accounts-domain-row" role="row" key={account.id}>
          <div className="accounts-domain-account-cell" role="cell">
            <span className="accounts-domain-avatar">{account.displayName.slice(-1)}</span>
            <span>
              <strong>{account.displayName}</strong>
              <small>{account.remark || account.sellerRef}</small>
            </span>
          </div>
          <span role="cell"><AccountStatusBadge status={account.status} /></span>
          <span role="cell"><AccountConnectionBadge status={account.connection.status} /></span>
          <span role="cell"><span className={account.aiEnabled ? 'accounts-domain-enabled' : 'accounts-domain-muted'}>{account.aiEnabled ? '已启用' : '未启用'}</span></span>
          <span role="cell"><AccountCredentialBadge state={account.credentialState} /></span>
          <span role="cell" className="accounts-domain-updated">{formatUpdatedAt(account.updatedAt)}</span>
          <span role="cell" className="accounts-domain-row-actions">
            <button className={account.id === activeAccountId ? 'btn primary' : 'btn ghost'} type="button" data-testid="account-switch" onClick={() => onSwitch(account)} disabled={account.id === activeAccountId || account.status === 'disabled'}>{account.id === activeAccountId ? '当前账号' : '切换账号'}</button>
            <button className={account.status === 'connected' ? 'btn ghost' : 'btn primary'} type="button" onClick={() => onReauthorize(account)}>{account.status === 'connected' ? '重新授权' : '扫码授权'}</button>
            <button className="btn danger" type="button" data-testid="account-delete" onClick={() => onDelete(account)}>删除账号</button>
          </span>
        </div>
      ))}
    </div>
  );
}

function formatUpdatedAt(value: string): string {
  if (value === new Date(0).toISOString()) return '暂无记录';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false });
}
