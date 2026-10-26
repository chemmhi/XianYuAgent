import type { AccountListFilters, AccountsLoadPhase } from '../types';
import { SelectField } from '../../../shared/ui/SelectField';
import { SearchField } from '../../../shared/ui/SearchField';
import { Button } from '../../../shared/ui/Button';
import { accountStatusLabels, messageConnectionLabels } from '../presentation';

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
    ...(['connected', 'degraded', 'disconnected', 'expired', 'verification_required', 'disabled', 'pending'] as const).map(value => ({ value, label: accountStatusLabels[value] })),
  ] satisfies Array<{ value: AccountListFilters['status']; label: string }>;
  const connectionStatusOptions = [
    { value: 'all', label: '全部消息连接' },
    ...(['online', 'offline', 'connecting', 'expired', 'unknown'] as const).map(value => ({ value, label: messageConnectionLabels[value] })),
  ] satisfies Array<{ value: AccountListFilters['connectionStatus']; label: string }>;
  return (
    <div className="accounts-domain-toolbar">
      <div>
        <h2>账号列表</h2>
        <p>查看账号授权、消息连接和自动回复设置。</p>
      </div>
      <div className="accounts-domain-toolbar-actions">
        <SearchField className="accounts-domain-search" aria-label="搜索账号" value={filters.search ?? ''} onChange={(event) => onSearchChange(event.target.value)} onClear={() => onSearchChange('')} clearable placeholder="搜索账号名称或备注" />
        <SelectField aria-label="账号状态筛选" className="accounts-domain-status-select" value={filters.status ?? 'all'} onChange={(event) => onStatusChange(event.target.value as AccountListFilters['status'])} options={statusOptions} />
        <SelectField aria-label="消息连接筛选" className="accounts-domain-connection-select" value={filters.connectionStatus ?? 'all'} onChange={(event) => onConnectionStatusChange(event.target.value as AccountListFilters['connectionStatus'])} options={connectionStatusOptions} />
        <Button variant="ghost" type="button" onClick={onRefresh} disabled={phase === 'loading'}>
          {phase === 'loading' ? '刷新中…' : '刷新'}
        </Button>
        <Button variant="primary" type="button" onClick={onAddAccount}>添加闲鱼账号</Button>
      </div>
    </div>
  );
}
