import type { AccountsLoadError, AccountsLoadPhase } from '../types';
import { PageState } from '../../../shared/ui/PageState';
import { Button } from '../../../shared/ui/Button';

export function AccountStateView({ phase, error, onRetry, hasAccounts = true, onAddAccount }: { phase: AccountsLoadPhase; error: AccountsLoadError | null; onRetry: () => void; hasAccounts?: boolean; onAddAccount?: () => void }) {
  if (phase === 'loading' || phase === 'idle') {
    return <div className="accounts-domain-state accounts-domain-state-loading" aria-live="polite"><span className="accounts-domain-spinner" aria-hidden="true" />正在加载账号列表…</div>;
  }
  if (phase === 'empty') {
    return <PageState title={hasAccounts ? '暂无匹配账号' : '尚未添加闲鱼账号'} message={hasAccounts ? '调整搜索或筛选条件后重试。' : '添加闲鱼账号后，即可开始管理商品、聊天和订单。'} action={!hasAccounts && onAddAccount ? <Button variant="primary" type="button" onClick={onAddAccount}>添加闲鱼账号</Button> : undefined} />;
  }
  if (phase === 'error' && error) {
    return <div className="accounts-domain-state accounts-domain-state-error"><strong>{error.code === 'FORBIDDEN' ? '无权查看账号' : '账号列表暂不可用'}</strong>{error.retryable && <button className="btn ghost" type="button" onClick={onRetry}>重新加载</button>}</div>;
  }
  return null;
}
