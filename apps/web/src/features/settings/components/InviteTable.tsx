import { Button } from '../../../shared/ui/Button';
import type { InviteVM } from '../api';

export type InviteAction = 'create' | 'enable' | 'disable' | 'renew' | 'delete';
export interface InvitePending { id: string; action: InviteAction; }

const statusLabels: Record<NonNullable<InviteVM['status']>, string> = {
  active: '有效', disabled: '已禁用', expired: '已过期', used: '已激活', deleted: '已删除',
};

export function inviteAccessStatus(item: InviteVM): 'active' | 'disabled' | 'expired' {
  if (item.accessStatus) return item.accessStatus;
  if (item.disabledAt || item.revokedAt || item.deletedAt || item.status === 'disabled' || item.status === 'deleted') return 'disabled';
  const expiresAt = Date.parse(item.expiresAt);
  if (item.status === 'expired' || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) return 'expired';
  return 'active';
}

export function InviteTable({ items, newIds, pending, loading = false, onCopy, onStatus, onRenew, onDelete }: {
  items: InviteVM[];
  newIds: Set<string>;
  pending: InvitePending | null;
  loading?: boolean;
  onCopy: (item: InviteVM) => void;
  onStatus: (item: InviteVM, next: 'active' | 'disabled') => void;
  onRenew: (item: InviteVM) => void;
  onDelete: (item: InviteVM) => void;
}) {
  const blocked = Boolean(pending) || loading;
  return <div className="invite-table-wrap"><table className="invite-table" aria-label="邀请码列表" aria-busy={blocked}>
    <colgroup><col className="invite-col-code" /><col className="invite-col-status" /><col className="invite-col-expiry" /><col className="invite-col-user" /><col className="invite-col-email" /><col className="invite-col-actions" /></colgroup>
    <thead><tr><th>邀请码</th><th>状态</th><th>到期日期</th><th>用户名</th><th>邮箱</th><th>操作</th></tr></thead>
    <tbody>{items.map(item => { const access = inviteAccessStatus(item); const deleted = item.status === 'deleted' || Boolean(item.deletedAt); const statusLabel = deleted ? '已删除' : access === 'disabled' ? '已禁用' : access === 'expired' ? '已过期' : item.usedAt || item.usedBy || item.status === 'used' ? '已激活' : statusLabels[item.status ?? 'active']; return <tr key={item.id}>
      <td><div className="invite-code-cell"><code>{item.code}</code><button className="invite-copy-button" type="button" aria-label={`复制邀请码 ${item.code ?? ''}`} title="复制邀请码" disabled={!item.code} onClick={() => onCopy(item)}><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5" y="5" width="8" height="9" rx="1.5" /><path d="M10 3V2H2v9h1" /></svg></button>{newIds.has(item.id) && <span className="invite-new-badge">NEW</span>}</div></td>
      <td><span className={`status-pill invite-status-${access}`}>{statusLabel}</span></td>
      <td>{new Date(item.expiresAt).toLocaleDateString()}</td>
      <td className="invite-user-cell" title={item.usedByDisplayName}>{item.usedByDisplayName || '—'}</td>
      <td className="invite-email-cell" title={item.usedByEmail}>{item.usedByEmail || '—'}</td>
      <td><div className="invite-actions">
        <span className="invite-status-action">{!deleted && <Button variant="ghost" type="button" disabled={blocked} onClick={() => onStatus(item, access === 'disabled' ? 'active' : 'disabled')}>{pending?.id === item.id && ['enable', 'disable'].includes(pending.action) ? '处理中…' : access === 'disabled' ? '启用' : '禁用'}</Button>}</span>
        <span className="invite-renew-action">{!deleted && <Button variant="ghost" type="button" disabled={blocked} onClick={() => onRenew(item)}>续期</Button>}</span>
        <Button variant="danger" type="button" disabled={blocked} onClick={() => onDelete(item)}>{pending?.id === item.id && pending.action === 'delete' ? '删除中…' : '删除'}</Button>
      </div></td>
    </tr>; })}</tbody>
  </table>{items.length === 0 && <div className="invite-empty">{loading ? '正在读取邀请码…' : '暂无邀请码，可在工具栏生成。'}</div>}</div>;
}
