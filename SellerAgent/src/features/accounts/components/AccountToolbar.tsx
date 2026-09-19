import type { AccountListFilters, AccountsLoadPhase } from '../types';

interface AccountToolbarProps {
  filters: AccountListFilters;
  phase: AccountsLoadPhase;
  total: number;
  onSearchChange: (value: string) => void;
  onStatusChange: (value: AccountListFilters['status']) => void;
  onRefresh: () => void;
}

export function AccountToolbar({ filters, phase, total, onSearchChange, onStatusChange, onRefresh }: AccountToolbarProps) {
  return (
    <div className="accounts-domain-toolbar">
      <div>
        <h2>账号列表</h2>
        <p>按账号范围查看连接状态与可用能力，凭证正文不在列表中展示。</p>
      </div>
      <div className="accounts-domain-toolbar-actions">
        <label className="accounts-domain-search">
          <span className="sr-only">搜索账号</span>
          <input value={filters.search ?? ''} onChange={(event) => onSearchChange(event.target.value)} placeholder="搜索账号名称或备注" />
        </label>
        <select aria-label="账号状态筛选" value={filters.status ?? 'all'} onChange={(event) => onStatusChange(event.target.value as AccountListFilters['status'])}>
          <option value="all">全部状态</option>
          <option value="connected">已连接</option>
          <option value="degraded">降级</option>
          <option value="disconnected">已断开</option>
          <option value="expired">已过期</option>
          <option value="disabled">已停用</option>
          <option value="pending">待连接</option>
        </select>
        <button className="btn ghost" type="button" onClick={onRefresh} disabled={phase === 'loading'}>
          {phase === 'loading' ? '刷新中…' : '刷新'}
        </button>
        <span className="accounts-domain-total">共 {total} 个账号</span>
      </div>
    </div>
  );
}
