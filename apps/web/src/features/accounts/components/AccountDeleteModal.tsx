import type { AccountVM } from '../types';

const connectionLabels: Record<AccountVM['connection']['status'], string> = {
  online: '当前在线',
  offline: '当前离线',
  connecting: '连接中',
  expired: '连接已过期',
  unknown: '连接状态未知',
};

export function AccountDeleteModal({ account, submitting = false, error, onClose, onConfirm }: {
  account: AccountVM;
  submitting?: boolean;
  error?: string | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const accountReference = account.platformUserId ?? account.sellerRef;

  return <div className="modal-backdrop account-modal-backdrop" role="presentation" onMouseDown={(event) => { if (!submitting && event.target === event.currentTarget) onClose(); }}>
    <section className="modal-card account-delete-modal" role="dialog" aria-modal="true" aria-labelledby="account-delete-title" aria-describedby="account-delete-description">
      <header className="modal-head">
        <div><p className="eyebrow">Account Action</p><h2 id="account-delete-title">删除账号</h2><p id="account-delete-description">请确认是否移除这个闲鱼账号。</p></div>
        <button className="icon-button" type="button" aria-label="关闭删除账号弹窗" onClick={onClose} disabled={submitting}>×</button>
      </header>
      <div className="account-delete-body">
        <div className="account-delete-warning" role="note">
          <div className="account-delete-warning-icon" aria-hidden="true">!</div>
          <div><strong>删除后会撤销登录凭证</strong><p>历史商品记录会保留，但需要重新登录才能恢复账号操作。</p></div>
        </div>
        <div className="account-delete-summary">
          <span className="account-delete-avatar">
            {account.avatarUrl ? <img src={account.avatarUrl} alt="" /> : account.displayName.slice(-1)}
          </span>
          <div><strong>{account.displayName}</strong><span>账号 ID：{maskIdentifier(accountReference)} · {connectionLabels[account.connection.status]}</span></div>
        </div>
        {error && <div className="account-delete-error" role="alert">{error}</div>}
      </div>
      <div className="modal-actions">
        <button className="btn ghost" type="button" data-testid="account-delete-cancel" onClick={onClose} disabled={submitting}>取消</button>
        <button className="btn danger" type="button" data-testid="account-delete-confirm" onClick={onConfirm} disabled={submitting}>{submitting ? '删除中…' : '删除账号'}</button>
      </div>
    </section>
  </div>;
}

function maskIdentifier(value: string): string {
  if (value.length <= 8) return value;
  return `${value.slice(0, 4)}••••${value.slice(-4)}`;
}
