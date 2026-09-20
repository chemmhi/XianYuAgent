import type { OrdersLoadError, OrdersLoadPhase } from '../types';

export function OrderStateView({ phase, error, onRetry, accountSelectionRequired, onChooseAccount }: { phase: OrdersLoadPhase; error: OrdersLoadError | null; onRetry: () => void; accountSelectionRequired?: boolean; onChooseAccount?: () => void }) {
  if (accountSelectionRequired) return <div className="orders-state orders-state-empty"><strong>请先选择运营账号</strong><span>订单数据按账号隔离，请在账号管理中选择当前账号后再查看订单。</span><button className="btn primary" type="button" onClick={onChooseAccount}>去选择账号</button></div>;
  if (phase === 'loading' || phase === 'idle') return <div className="orders-state orders-state-loading" aria-live="polite"><span className="orders-spinner" />正在加载订单列表…</div>;
  if (phase === 'empty') return <div className="orders-state orders-state-empty"><strong>暂无匹配订单</strong><span>当前账号范围内没有符合条件的订单，可调整搜索或筛选条件。</span></div>;
  if (phase === 'forbidden') return <div className="orders-state orders-state-error" role="alert"><strong>暂无订单访问权限</strong><span>{error?.message ?? '当前管理员没有读取订单的权限。'}</span></div>;
  if (phase === 'error') return <div className="orders-state orders-state-error" role="alert"><strong>订单列表加载失败</strong><span>{error?.message ?? '请稍后重试。'}</span>{error?.retryable && <button className="btn ghost" type="button" onClick={onRetry}>重新加载</button>}</div>;
  return null;
}

