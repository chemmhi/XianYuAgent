import { AccountConnectionBadge, AccountStatusBadge } from './AccountStatusBadge';
import { accountStatusDescription, autoReplyLabel } from '../presentation';
import type { AccountVM } from '../types';
import { VerificationAccountActions } from '../../verification/VerificationProvider';

export function AccountTable({ accounts, activeAccountId, page, total, totalPages, onPageChange, onReauthorize, onSwitch, onDelete }: {
  accounts: AccountVM[];
  activeAccountId?: string;
  page: number;
  total: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  onReauthorize: (account: AccountVM) => void;
  onSwitch: (account: AccountVM) => void;
  onDelete: (account: AccountVM) => void;
}) {
  const pageItems = getPageItems(page, totalPages);
  return <div className="accounts-domain-table-region">
    <div className="accounts-domain-table-scroll">
      <div className="accounts-domain-table" role="table" aria-label="账号列表">
        <div className="accounts-domain-row accounts-domain-head" role="row">
          <span role="columnheader">账号</span>
          <span role="columnheader">账号状态</span>
          <span role="columnheader">消息连接</span>
          <span role="columnheader">自动回复</span>
          <span role="columnheader">最近更新</span>
          <span role="columnheader">操作</span>
        </div>
        {accounts.map((account) => (
          <div className="accounts-domain-row" role="row" key={account.id}>
            <div className="accounts-domain-account-cell" role="cell">
              <span className="accounts-domain-avatar">
                {account.avatarUrl ? (
                  <img src={account.avatarUrl} alt="" loading="lazy" />
                ) : (
                  account.displayName.slice(-1)
                )}
              </span>
              <span>
                <strong title={account.displayName}>{account.displayName}</strong>
                <small>{account.remark || account.sellerRef}</small>
              </span>
            </div>
            <span role="cell" className="accounts-domain-health"><AccountStatusBadge status={account.status} riskCode={account.riskCode} /><small>{accountStatusDescription(account)}</small></span>
            <span role="cell"><AccountConnectionBadge status={account.connection.status} /></span>
            <span role="cell"><span className={account.aiEnabled ? 'accounts-domain-enabled' : 'accounts-domain-muted'}>{autoReplyLabel(account.aiEnabled)}</span></span>
            <span role="cell" className="accounts-domain-updated">{formatUpdatedAt(account.updatedAt)}</span>
            <span role="cell" className="accounts-domain-row-actions">
              {account.status === 'verification_required' && <VerificationAccountActions accountId={account.id} />}
              <button className={account.id === activeAccountId ? 'btn primary' : 'btn ghost'} type="button" data-testid="account-switch" onClick={() => onSwitch(account)} disabled={account.id === activeAccountId || account.status === 'disabled'}>{account.id === activeAccountId ? '当前' : '切换'}</button>
              <button className={['expired', 'pending'].includes(account.status) ? 'btn primary' : 'btn ghost'} type="button" onClick={() => onReauthorize(account)}>授权</button>
              <button className="btn danger" type="button" data-testid="account-delete" onClick={() => onDelete(account)}>删除</button>
            </span>
          </div>
        ))}
      </div>
    </div>
    <nav className="accounts-domain-pagination" aria-label="账号列表分页" data-testid="accounts-pagination">
      <span className="accounts-domain-pagination-total">共 {total} 个账号</span>
      <div className="accounts-domain-pagination-controls">
        <button className="accounts-domain-page-button" type="button" data-testid="accounts-prev-page" onClick={() => onPageChange(page - 1)} disabled={page <= 1}>上一页</button>
        {pageItems.map((item, index) => item === 'ellipsis'
          ? <span className="accounts-domain-pagination-ellipsis" key={`ellipsis-${index}`} aria-hidden="true">…</span>
          : <button className={`accounts-domain-page-button${item === page ? ' active' : ''}`} type="button" key={item} data-testid={`accounts-page-${item}`} aria-current={item === page ? 'page' : undefined} onClick={() => onPageChange(item)}>{item}</button>)}
        <button className="accounts-domain-page-button" type="button" data-testid="accounts-next-page" onClick={() => onPageChange(page + 1)} disabled={page >= totalPages}>下一页</button>
      </div>
      <span className="accounts-domain-pagination-status">第 {page} / {totalPages} 页</span>
    </nav>
  </div>;
}

function formatUpdatedAt(value: string): string {
  if (value === new Date(0).toISOString()) return '暂无记录';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false });
}

function getPageItems(page: number, totalPages: number): Array<number | 'ellipsis'> {
  if (totalPages <= 5) return Array.from({ length: totalPages }, (_, index) => index + 1);
  if (page <= 3) return [1, 2, 3, 4, 'ellipsis', totalPages];
  if (page >= totalPages - 2) return [1, 'ellipsis', totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
  return [1, 'ellipsis', page - 1, page, page + 1, 'ellipsis', totalPages];
}
