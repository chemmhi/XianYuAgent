import type { CouponsLoadError, CouponsLoadPhase } from '../types';

export function CouponListStateView({ phase, error, onRetry }: { phase: CouponsLoadPhase; error: CouponsLoadError | null; onRetry: () => void }) {
  if (phase === 'idle' || phase === 'loading') return <div className="coupons-state" aria-live="polite"><div className="coupons-skeleton" /><div className="coupons-skeleton" /><div className="coupons-skeleton" /></div>;
  if (phase === 'empty') return <div className="coupons-state"><strong>暂无卡券批次</strong><span>当前账号范围内没有匹配的批次，可调整筛选或创建新批次。</span></div>;
  if (phase === 'forbidden') return <div className="coupons-state coupons-error" role="alert"><strong>无权查看卡券</strong><span>{error?.message}</span></div>;
  if (phase === 'error' && error) return <div className="coupons-state coupons-error" role="alert"><strong>卡券列表加载失败</strong><span>{error.message}</span>{error.retryable && <button className="btn ghost" type="button" onClick={onRetry}>重新加载</button>}</div>;
  return null;
}

export function CouponDetailStateView({ phase, error, onRetry }: { phase: 'idle' | 'loading' | 'success' | 'error' | 'forbidden'; error: CouponsLoadError | null; onRetry: () => void }) {
  if (phase === 'loading') return <div className="coupons-detail-state">正在加载批次详情…</div>;
  if (phase === 'forbidden') return <div className="coupons-detail-state coupons-error" role="alert"><strong>无权查看批次详情</strong><span>{error?.message}</span></div>;
  if (phase === 'error') return <div className="coupons-detail-state coupons-error" role="alert"><strong>批次详情加载失败</strong><span>{error?.message}</span>{error?.retryable && <button className="btn ghost" type="button" onClick={onRetry}>重试</button>}</div>;
  return null;
}
