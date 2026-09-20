import type { OrderVM } from '../types';

const labels = {
  paymentStatus: { unpaid: '待付款', paid: '已付款', closed: '已关闭', unknown: '未知' },
  orderStatus: { open: '进行中', cancelling: '取消中', cancelled: '已取消', completed: '已完成', closed: '已关闭', failed: '处理失败' },
  deliveryStatus: { pending: '待发货', reserving: '锁库存', delivered: '已发货', partially_delivered: '部分发货', failed: '发货失败', cancelled: '未发货' },
  afterSalesStatus: { none: '无售后', requested: '售后申请', refunding: '退款中', refunded: '已退款', rejected: '已驳回', closed: '售后关闭' },
} as const;

export function OrderDetailDrawer({ order, phase, error, onClose, onRetry }: { order: OrderVM | null; phase: 'idle' | 'loading' | 'success' | 'error' | 'forbidden'; error: { message: string } | null; onClose: () => void; onRetry: () => void }) {
  if (phase === 'idle') return null;
  return <div className="orders-drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <aside className="orders-drawer" role="dialog" aria-modal="true" aria-label="订单详情">
      <div className="orders-drawer-head"><div><p className="eyebrow">Order Detail</p><h2>{order?.orderNo ?? '订单详情'}</h2><p>{order ? `${order.buyerName} · ${order.itemTitle}` : '正在读取订单信息'}</p></div><button type="button" className="icon-button" onClick={onClose} aria-label="关闭订单详情">×</button></div>
      {phase === 'loading' && <div className="orders-drawer-state"><span className="orders-spinner" />正在加载订单详情…</div>}
      {(phase === 'error' || phase === 'forbidden') && <div className="orders-drawer-state orders-state-error" role="alert"><strong>{phase === 'forbidden' ? '无权查看订单' : '订单详情加载失败'}</strong><span>{error?.message ?? '订单不存在或已失效。'}</span>{phase === 'error' && <button type="button" className="btn ghost" onClick={onRetry}>重新加载</button>}</div>}
      {phase === 'success' && order && <div className="orders-drawer-body">
        <section className="orders-detail-summary"><div className="orders-detail-price">¥{(order.amountMinor / 100).toFixed(2)}</div><span className="orders-detail-muted">下单于 {formatDate(order.createdAt)}</span><span className="orders-detail-muted">交付方式：{deliveryModeLabel(order.deliveryType)}</span></section>
        <section><h3>状态矩阵</h3><div className="orders-status-matrix"><StatusCell label="支付状态" value={labels.paymentStatus[order.paymentStatus]} tone={order.paymentStatus === 'paid' ? 'success' : order.paymentStatus === 'unknown' ? 'danger' : 'warn'} /><StatusCell label="订单状态" value={labels.orderStatus[order.orderStatus]} tone={order.orderStatus === 'completed' ? 'success' : order.orderStatus === 'failed' ? 'danger' : 'info'} /><StatusCell label="发货状态" value={labels.deliveryStatus[order.deliveryStatus]} tone={order.deliveryStatus === 'delivered' ? 'success' : order.deliveryStatus === 'failed' ? 'danger' : 'warn'} /><StatusCell label="售后状态" value={labels.afterSalesStatus[order.afterSalesStatus]} tone={order.afterSalesStatus === 'none' ? 'neutral' : 'warn'} /></div></section>
        <section><h3>订单信息</h3><dl className="orders-detail-list"><div><dt>买家</dt><dd>{order.buyerName}<small>{order.buyerId}</small></dd></div><div><dt>商品</dt><dd>{order.itemTitle}<small>{order.itemId}</small></dd></div><div><dt>所属账号</dt><dd>{order.accountName ?? order.accountId}</dd></div><div><dt>会话关联</dt><dd>{order.conversationId ? <a href={`/messages?conversationId=${encodeURIComponent(order.conversationId)}`}>打开聊天会话</a> : '暂无关联会话'}</dd></div></dl></section>
        {order.deliveryFailReason && <section className="orders-risk-note"><span className="orders-risk-dot" /><div><strong>发货异常</strong><p>{order.deliveryFailReason}</p><small>当前为只读订单列表切片，发货、取消和重试将在后续交付切片中接入。</small></div></section>}
        <section><h3>审计摘要</h3><div className="orders-audit-line"><span>配置版本 v{order.configVersion}</span><span>最后更新 {formatDate(order.updatedAt ?? order.createdAt)}</span><span>敏感交付内容未在列表与详情中返回</span></div></section>
      </div>}
    </aside>
  </div>;
}

function StatusCell({ label, value, tone }: { label: string; value: string; tone: 'success' | 'warn' | 'danger' | 'neutral' | 'info' }) { return <div className="orders-status-cell"><span>{label}</span><b className={`orders-status orders-status-${tone}`}>{value}</b></div>; }
function deliveryModeLabel(value: OrderVM['deliveryType']) { return value === 'coupon_only' ? '只发卡券' : value === 'no_logistics' ? '免物流发货' : value === 'mixed' ? '混合交付' : '人工发货'; }
function formatDate(value: string) { return value ? value.replace('T', ' ').replace(/[+-]\d\d:\d\d$/, '').replace(/\.\d{3}Z$/, '').replace('Z', '') : '—'; }

