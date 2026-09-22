import type { AccountsLoadError, AccountsLoadPhase } from '../types';

export function AccountStateView({ phase, error, onRetry }: { phase: AccountsLoadPhase; error: AccountsLoadError | null; onRetry: () => void }) {
  if (phase === 'loading' || phase === 'idle') {
    return <div className="accounts-domain-state accounts-domain-state-loading" aria-live="polite"><span className="accounts-domain-spinner" aria-hidden="true" />正在加载账号列表…</div>;
  }
  if (phase === 'empty') {
    return <div className="accounts-domain-state accounts-domain-state-empty"><strong>暂无匹配账号</strong><span>调整搜索或筛选条件后重试。</span></div>;
  }
  if (phase === 'error' && error) {
    return <div className="accounts-domain-state accounts-domain-state-error" role="alert"><strong>{error.code === 'FORBIDDEN' ? '无权查看账号' : '账号列表加载失败'}</strong><span>{error.message}</span>{error.retryable && <button className="btn ghost" type="button" onClick={onRetry}>重新加载</button>}</div>;
  }
  return null;
}
