import type { OrderVM } from '../types';
import { getOrderDisplayStatus, orderDisplayStatusLabel, orderDisplayStatusTone } from '../order-status';
import { formatOrderDate } from './order-date';

export function OrderTable({ orders, page, totalPages, total, onPageChange, onOpen }: { orders: OrderVM[]; page: number; totalPages: number; total: number; onPageChange: (page: number) => void; onOpen: (orderNo: string) => void }) {
  const allPages = getPageItems(page, totalPages);
  return <div className="orders-table-region">
    <div className="orders-table-scroll">
      <div className="orders-table" role="table" aria-label="订单列表" data-testid="orders-table">
        <div className="orders-row orders-head" role="row"><span>订单号</span><span>买家昵称</span><span>商品名称</span><span>金额</span><span>下单时间</span><span>当前状态</span><span>操作</span></div>
        {orders.map((order) => {
          const buyerNickname = order.buyerNickname?.trim() ?? '';
          const buyerName = order.buyerName?.trim() ?? '';
          const buyerAvatarUrl = normalizeImageUrl(order.buyerAvatarUrl);
          const itemTitle = order.itemTitle?.trim() && order.itemTitle.trim() !== order.itemId.trim() ? order.itemTitle.trim() : '';
          const itemUnavailable = !itemTitle;
          const itemImageUrl = normalizeImageUrl(order.itemImageUrl);
          return <div className="orders-row" role="row" key={order.orderNo} data-order-no={order.orderNo}>
          <button className="orders-order-link" type="button" onClick={() => onOpen(order.orderNo)}><strong>{order.orderNo}</strong><small>{order.deliveryType === 'coupon_only' ? '卡券交付' : order.deliveryType === 'no_logistics' ? '免物流' : order.deliveryType === 'mixed' ? '混合交付' : '人工发货'}</small></button>
          <div className="orders-buyer"><span className="orders-avatar">{buyerAvatarUrl ? <img src={buyerAvatarUrl} alt="" onError={(event) => { event.currentTarget.style.display = 'none'; }} /> : null}</span><span title={`买家姓名：${buyerName}`} aria-label={`买家昵称，悬浮查看买家姓名：${buyerName}`}><strong>{buyerNickname}</strong></span></div>
          <div className="orders-product" title={itemUnavailable ? '商品已删除或暂无本地商品信息' : itemTitle}><span className="orders-product-thumb">{itemImageUrl ? <img src={itemImageUrl} alt="" onError={(event) => { event.currentTarget.style.display = 'none'; }} /> : null}</span><strong className={itemUnavailable ? 'orders-product-missing' : undefined}>{itemUnavailable ? '商品已删除' : itemTitle}</strong></div>
          <span className="orders-amount">¥{(order.amountMinor / 100).toFixed(2)}</span>
          <time className="orders-time" dateTime={order.createdAt}>{formatOrderDate(order.createdAt)}</time>
          {(() => { const status = getOrderDisplayStatus(order); return <StatusPill tone={orderDisplayStatusTone(status)}>{orderDisplayStatusLabel(status)}</StatusPill>; })()}
          <span className="orders-row-actions"><button className="btn ghost btn-small" type="button" onClick={() => onOpen(order.orderNo)}>查看详情</button></span>
        </div>;
        })}
      </div>
    </div>
    <nav className="orders-pagination" aria-label="订单列表分页" data-testid="orders-pagination"><span>共 {total} 单</span><div>{<button className="orders-page-button" type="button" onClick={() => onPageChange(page - 1)} disabled={page <= 1}>上一页</button>}{allPages.map((item, index) => item === 'ellipsis' ? <span className="orders-page-ellipsis" key={`ellipsis-${index}`}>…</span> : <button className={`orders-page-button${item === page ? ' active' : ''}`} type="button" key={item} aria-current={item === page ? 'page' : undefined} data-testid={`orders-page-${item}`} onClick={() => onPageChange(item)}>{item}</button>)}<button className="orders-page-button" type="button" onClick={() => onPageChange(page + 1)} disabled={page >= totalPages}>下一页</button></div><span>第 {page} / {totalPages} 页</span></nav>
  </div>;
}

function StatusPill({ tone, children }: { tone: 'success' | 'warn' | 'danger' | 'neutral' | 'info'; children: string }) { return <b className={`orders-status orders-status-${tone}`}>{children}</b>; }
function normalizeImageUrl(value?: string): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  return normalized.startsWith('//') ? `https:${normalized}` : normalized;
}
function getPageItems(page: number, totalPages: number): Array<number | 'ellipsis'> { if (totalPages <= 5) return Array.from({ length: totalPages }, (_, index) => index + 1); if (page <= 3) return [1, 2, 3, 4, 'ellipsis', totalPages]; if (page >= totalPages - 2) return [1, 'ellipsis', totalPages - 3, totalPages - 2, totalPages - 1, totalPages]; return [1, 'ellipsis', page - 1, page, page + 1, 'ellipsis', totalPages]; }
