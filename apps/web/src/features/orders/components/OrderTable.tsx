import type { OrderVM } from '../types';
import { formatOrderDate } from './order-date';

const paymentLabels: Record<OrderVM['paymentStatus'], string> = { unpaid: '待付款', paid: '已付款', closed: '已关闭', unknown: '未知' };
const orderLabels: Record<OrderVM['orderStatus'], string> = { open: '进行中', cancelling: '取消中', cancelled: '已取消', completed: '已完成', closed: '已关闭', failed: '处理失败' };
const deliveryLabels: Record<OrderVM['deliveryStatus'], string> = { pending: '待发货', reserving: '锁库存', delivered: '已发货', partially_delivered: '部分发货', failed: '发货失败', cancelled: '未发货' };
const afterSalesLabels: Record<OrderVM['afterSalesStatus'], string> = { none: '无售后', requested: '售后申请', refunding: '退款中', refunded: '已退款', rejected: '已驳回', closed: '售后关闭' };

export function OrderTable({ orders, page, totalPages, total, onPageChange, onOpen }: { orders: OrderVM[]; page: number; totalPages: number; total: number; onPageChange: (page: number) => void; onOpen: (orderNo: string) => void }) {
  const allPages = getPageItems(page, totalPages);
  return <div className="orders-table-region">
    <div className="orders-table-scroll">
      <div className="orders-table" role="table" aria-label="订单列表" data-testid="orders-table">
        <div className="orders-row orders-head" role="row"><span>订单号</span><span>买家</span><span>商品</span><span>金额</span><span>支付状态</span><span>订单状态</span><span>发货状态</span><span>售后</span><span>下单时间</span><span>账号</span><span>操作</span></div>
        {orders.map((order) => <div className="orders-row" role="row" key={order.orderNo} data-order-no={order.orderNo}>
          <button className="orders-order-link" type="button" onClick={() => onOpen(order.orderNo)}><strong>{order.orderNo}</strong><small>{order.deliveryType === 'coupon_only' ? '卡券交付' : order.deliveryType === 'no_logistics' ? '免物流' : order.deliveryType === 'mixed' ? '混合交付' : '人工发货'}</small></button>
          <div className="orders-buyer"><span className="orders-avatar">{order.buyerName.slice(0, 1)}</span><span><strong>{order.buyerName}</strong><small>{order.buyerId}</small></span></div>
          <div className="orders-product"><strong>{order.itemTitle}</strong><small>{order.itemId}</small></div>
          <span className="orders-amount">¥{(order.amountMinor / 100).toFixed(2)}</span>
          <StatusPill tone={order.paymentStatus === 'paid' ? 'success' : order.paymentStatus === 'closed' ? 'neutral' : order.paymentStatus === 'unknown' ? 'danger' : 'warn'}>{paymentLabels[order.paymentStatus]}</StatusPill>
          <StatusPill tone={order.orderStatus === 'completed' ? 'success' : order.orderStatus === 'failed' ? 'danger' : order.orderStatus === 'closed' || order.orderStatus === 'cancelled' ? 'neutral' : 'info'}>{orderLabels[order.orderStatus]}</StatusPill>
          <StatusPill tone={order.deliveryStatus === 'delivered' ? 'success' : order.deliveryStatus === 'failed' ? 'danger' : order.deliveryStatus === 'cancelled' ? 'neutral' : 'warn'}>{deliveryLabels[order.deliveryStatus]}</StatusPill>
          <StatusPill tone={order.afterSalesStatus === 'none' ? 'neutral' : order.afterSalesStatus === 'refunded' || order.afterSalesStatus === 'closed' ? 'success' : 'warn'}>{afterSalesLabels[order.afterSalesStatus]}</StatusPill>
          <time className="orders-time" dateTime={order.createdAt}>{formatOrderDate(order.createdAt)}</time>
          <span className="orders-account">{order.accountName ?? order.accountId}</span>
          <span className="orders-row-actions"><button className="btn ghost btn-small" type="button" onClick={() => onOpen(order.orderNo)}>查看详情</button></span>
        </div>)}
      </div>
    </div>
    <nav className="orders-pagination" aria-label="订单列表分页" data-testid="orders-pagination"><span>共 {total} 单</span><div>{<button className="orders-page-button" type="button" onClick={() => onPageChange(page - 1)} disabled={page <= 1}>上一页</button>}{allPages.map((item, index) => item === 'ellipsis' ? <span className="orders-page-ellipsis" key={`ellipsis-${index}`}>…</span> : <button className={`orders-page-button${item === page ? ' active' : ''}`} type="button" key={item} aria-current={item === page ? 'page' : undefined} data-testid={`orders-page-${item}`} onClick={() => onPageChange(item)}>{item}</button>)}<button className="orders-page-button" type="button" onClick={() => onPageChange(page + 1)} disabled={page >= totalPages}>下一页</button></div><span>第 {page} / {totalPages} 页</span></nav>
  </div>;
}

function StatusPill({ tone, children }: { tone: 'success' | 'warn' | 'danger' | 'neutral' | 'info'; children: string }) { return <b className={`orders-status orders-status-${tone}`}>{children}</b>; }
function getPageItems(page: number, totalPages: number): Array<number | 'ellipsis'> { if (totalPages <= 5) return Array.from({ length: totalPages }, (_, index) => index + 1); if (page <= 3) return [1, 2, 3, 4, 'ellipsis', totalPages]; if (page >= totalPages - 2) return [1, 'ellipsis', totalPages - 3, totalPages - 2, totalPages - 1, totalPages]; return [1, 'ellipsis', page - 1, page, page + 1, 'ellipsis', totalPages]; }
