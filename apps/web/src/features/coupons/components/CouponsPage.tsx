import { useMemo, useState } from 'react';
import { createMockCouponsApi, type CouponsApi } from '../api';
import { useCouponsController } from '../controller';
import type { CouponBatchStatus, StockAlert } from '../types';
import { CouponBatchTable } from './CouponBatchTable';
import { CouponCreateModal } from './CouponCreateModal';
import { CouponDrawer } from './CouponDrawer';
import { CouponListStateView } from './CouponStateView';
import { CouponToolbar } from './CouponToolbar';
import './coupons.css';

export interface CouponsPageProps { api?: CouponsApi; }

export function CouponsPage({ api: providedApi }: CouponsPageProps) {
  const api = useMemo(() => providedApi ?? createMockCouponsApi(), [providedApi]);
  const controller = useCouponsController({ api });
  const [createOpen, setCreateOpen] = useState(false);
  const [copyNotice, setCopyNotice] = useState('');
  const batches = controller.state.data?.items ?? [];
  const total = controller.state.data?.total ?? 0;
  const available = batches.reduce((sum, batch) => sum + batch.availableCount, 0);
  const lowStock = batches.filter((batch) => batch.stockAlert === 'low_stock').length;

  return <section className="page-stack coupons-domain" data-coupons-domain>
    <div className="page-title"><div><p className="eyebrow">Coupon Inventory</p><h1>卡券首页</h1><p>查看批次库存、低库存告警、绑定商品，并通过受控接口预览正文。</p></div><div className="page-title-actions"><span className="coupons-domain-scope">管理员卡券范围</span></div></div>
    <div className="kpi-grid three coupons-kpis"><article className="card kpi-card"><div className="kpi-label">批次总数</div><div className="kpi-value">{total}</div><div className="kpi-delta"><span className="tone-info">当前筛选结果</span></div></article><article className="card kpi-card"><div className="kpi-label">可用库存</div><div className="kpi-value">{available}</div><div className="kpi-delta"><span className="tone-ok">不含正文</span></div></article><article className="card kpi-card"><div className="kpi-label">低库存批次</div><div className="kpi-value">{lowStock}</div><div className="kpi-delta"><span className={lowStock ? 'tone-warn' : 'tone-ok'}>{lowStock ? '需要关注' : '暂无告警'}</span></div></article></div>
    <article className="card panel coupons-panel"><CouponToolbar filters={controller.filters} phase={controller.state.phase} total={total} onKeywordChange={controller.setKeyword} onStatusChange={(status: CouponBatchStatus | 'all') => controller.setFilters((previous) => ({ ...previous, status, page: 1 }))} onAlertChange={(stockAlert: StockAlert | 'all') => controller.setFilters((previous) => ({ ...previous, stockAlert, page: 1 }))} onRefresh={controller.reload} onCreate={() => setCreateOpen(true)} />{copyNotice && <div className="coupons-copy-notice" role="status">{copyNotice}</div>}{controller.state.phase === 'success' && <CouponBatchTable batches={batches} onOpen={controller.openBatch} onCopy={(batch) => { void navigator.clipboard?.writeText(batch.batchId); setCopyNotice(`已复制批次编号 ${batch.batchId}`); window.setTimeout(() => setCopyNotice(''), 1800); }} onBind={(batchId) => { void controller.openBatch(batchId); }} onVoid={(batchId) => { if (window.confirm('确认作废该批次？作废不可逆。')) void controller.voidBatch(batchId); }} onDelete={(batchId) => { if (window.confirm('确认删除该批次？系统会保留审计和交付历史。')) void controller.deleteBatch(batchId); }} />}<CouponListStateView phase={controller.state.phase} error={controller.state.error} onRetry={controller.reload} /></article>
    <CouponDrawer state={controller.detail} content={controller.content} mutation={controller.mutation} onClose={controller.closeBatch} onRetry={() => controller.detail.batchId && controller.openBatch(controller.detail.batchId)} onImport={async (items) => { if (controller.detail.batchId) await controller.importItems(controller.detail.batchId, items); }} onBind={async (productId) => { if (controller.detail.batchId) await controller.bindBatch(controller.detail.batchId, productId); }} onVoid={async () => { if (controller.detail.batchId) await controller.voidBatch(controller.detail.batchId); }} onPreview={controller.previewContent} />
    {createOpen && <CouponCreateModal submitting={controller.mutation.phase === 'submitting'} onClose={() => setCreateOpen(false)} onSubmit={controller.createBatch} />}
  </section>;
}
