import type { AccountListFilters, AccountsLoadPhase } from '../types';
import { SelectField } from '../../../shared/ui/SelectField';
import { SearchField } from '../../../shared/ui/SearchField';
import { Button } from '../../../shared/ui/Button';

interface AccountToolbarProps {
  filters: AccountListFilters;
  phase: AccountsLoadPhase;
  onSearchChange: (value: string) => void;
  onStatusChange: (value: AccountListFilters['status']) => void;
  onConnectionStatusChange: (value: AccountListFilters['connectionStatus']) => void;
  onRefresh: () => void;
  onAddAccount: () => void;
}

export function AccountToolbar({ filters, phase, onSearchChange, onStatusChange, onConnectionStatusChange, onRefresh, onAddAccount }: AccountToolbarProps) {
  const statusOptions = [
    { value: 'all', label: '全部状态' },
    { value: 'connected', label: '已连接' },
    { value: 'degraded', label: '降级' },
    { value: 'disconnected', label: '已断开' },
    { value: 'expired', label: '已过期' },
    { value: 'disabled', label: '已停用' },
    { value: 'pending', label: '待连接' },
  ] satisfies Array<{ value: AccountListFilters['status']; label: string }>;
  const connectionStatusOptions = [
    { value: 'all', label: '全部连接' },
    { value: 'online', label: '在线' },
    { value: 'offline', label: '离线' },
    { value: 'connecting', label: '连接中' },
    { value: 'expired', label: '已过期' },
    { value: 'unknown', label: '未知' },
  ] satisfies Array<{ value: AccountListFilters['connectionStatus']; label: string }>;
  return (
    <div className="accounts-domain-toolbar">
      <div>
        <h2>账号列表</h2>
        <p>按账号范围查看连接状态与可用能力，凭证正文不在列表中展示。</p>
      </div>
      <div className="accounts-domain-toolbar-actions">
        <SearchField className="accounts-domain-search" aria-label="搜索账号" value={filters.search ?? ''} onChange={(event) => onSearchChange(event.target.value)} placeholder="搜索账号名称或备注" />
        <SelectField aria-label="账号状态筛选" className="accounts-domain-status-select" value={filters.status ?? 'all'} onChange={(event) => onStatusChange(event.target.value as AccountListFilters['status'])} options={statusOptions} />
        <SelectField aria-label="连接状态筛选" className="accounts-domain-connection-select" value={filters.connectionStatus ?? 'all'} onChange={(event) => onConnectionStatusChange(event.target.value as AccountListFilters['connectionStatus'])} options={connectionStatusOptions} />
        <Button variant="ghost" type="button" onClick={onRefresh} disabled={phase === 'loading'}>
          {phase === 'loading' ? '刷新中…' : '刷新'}
        </Button>
        <Button variant="primary" type="button" onClick={onAddAccount}>添加闲鱼账号</Button>
      </div>
    </div>
  );
}
