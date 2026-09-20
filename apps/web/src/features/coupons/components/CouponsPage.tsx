import { useMemo, useState } from 'react';
import { createMockCouponsApi, type CouponsApi } from '../api';
import { useCouponsController } from '../controller';
import type { CouponBatchVM } from '../types';
import { createMockProductsApi, type ProductsApi } from '../../products/api';
import { CouponBatchTable } from './CouponBatchTable';
import { CouponCreateModal } from './CouponCreateModal';
import { CouponDrawer } from './CouponDrawer';
import { CouponRelationModal } from './CouponRelationModal';
import { CouponListStateView } from './CouponStateView';
import { CouponToolbar } from './CouponToolbar';
import './coupons.css';

export interface CouponsPageProps { api?: CouponsApi; productsApi?: ProductsApi; }

export function CouponsPage({ api: providedApi, productsApi: providedProductsApi }: CouponsPageProps) {
  const api = useMemo(() => providedApi ?? createMockCouponsApi(), [providedApi]);
  const productsApi = useMemo(() => providedProductsApi ?? createMockProductsApi(), [providedProductsApi]);
  const controller = useCouponsController({ api });
  const [draftKeyword, setDraftKeyword] = useState('');
  const [draftPurpose, setDraftPurpose] = useState<CouponBatchVM['purpose'] | 'all'>('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [editor, setEditor] = useState<{ mode: 'create' | 'edit' | 'copy'; batch?: CouponBatchVM } | null>(null);
  const [relationBatch, setRelationBatch] = useState<CouponBatchVM | null>(null);
  const [relationReadonly, setRelationReadonly] = useState(false);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const batches = controller.state.data?.items ?? [];
  const total = controller.state.data?.total ?? 0;
  const available = batches.reduce((sum, batch) => sum + batch.availableCount, 0);
  const lowStock = batches.filter((batch) => batch.stockAlert === 'low_stock').length;
  const search = () => { controller.setFilters((previous) => ({ ...previous, keyword: draftKeyword.trim() || undefined, purpose: draftPurpose, page: 1 })); setSelectedIds(new Set()); };
  const reset = () => { setDraftKeyword(''); setDraftPurpose('all'); controller.setFilters((previous) => ({ ...previous, keyword: undefined, purpose: 'all', page: 1 })); setSelectedIds(new Set()); };
  const openEdit = async (batch: CouponBatchVM) => { const detail = await api.getDetail(batch.batchId); setEditor({ mode: 'edit', batch: detail }); };
  const openCopy = async (batch: CouponBatchVM) => { const detail = await api.getDetail(batch.batchId); setEditor({ mode: 'copy', batch: detail }); };
  const openRelation = async (batchId: string, readonly = false) => { const detail = await api.getDetail(batchId); setRelationReadonly(readonly); setRelationBatch(detail); };
  const saveRelation = async (productIds: string[], initialIds: string[]) => { if (!relationBatch) return; const next = new Set(productIds); for (const productId of initialIds) if (!next.has(productId)) await controller.unbindBatch(relationBatch.batchId, productId); for (const productId of productIds) if (!initialIds.includes(productId)) await controller.bindBatch(relationBatch.batchId, productId); const detail = await api.getDetail(relationBatch.batchId); setRelationBatch(detail); setRelationReadonly(false); };
  return <section className="page-stack coupons-domain" data-coupons-domain>
    <div className="kpi-grid three coupons-kpis"><article className="card kpi-card"><div className="kpi-label">卡券总数</div><div className="kpi-value">{total}</div><div className="kpi-delta"><span className="tone-info">当前筛选结果</span></div></article><article className="card kpi-card"><div className="kpi-label">可用库存</div><div className="kpi-value">{available}</div><div className="kpi-delta"><span className="tone-ok">库存摘要</span></div></article><article className="card kpi-card"><div className="kpi-label">低库存卡券</div><div className="kpi-value">{lowStock}</div><div className="kpi-delta"><span className={lowStock ? 'tone-warn' : 'tone-ok'}>{lowStock ? '需要关注' : '暂无告警'}</span></div></article></div>
    <div className="coupons-page-actions"><div className="coupons-bulk-actions">{selectedIds.size > 0 && <button className="btn danger" type="button" onClick={() => { if (window.confirm(`确认删除选中的 ${selectedIds.size} 张卡券？`)) void controller.batchDelete(Array.from(selectedIds)).then(() => setSelectedIds(new Set())); }}>删除选中 ({selectedIds.size})</button>}{selectedIds.size === 1 && <button className="btn ghost" type="button" onClick={() => { const batchId = Array.from(selectedIds)[0]; if (batchId) void openRelation(batchId); }}>关联商品</button>}</div><div className="coupons-page-actions-right"><button className="btn primary" type="button" onClick={() => setEditor({ mode: 'create' })}>新建卡券</button><button className="btn ghost" type="button" onClick={() => void controller.reload()} disabled={controller.state.phase === 'loading'}>刷新</button></div></div>
    <article className="card panel coupons-panel"><CouponToolbar filters={{ ...controller.filters, keyword: draftKeyword, purpose: draftPurpose }} phase={controller.state.phase} total={total} onKeywordChange={setDraftKeyword} onPurposeChange={setDraftPurpose} onSearch={search} onReset={reset} />{controller.state.phase === 'success' && <CouponBatchTable batches={batches} selectedIds={selectedIds} onSelect={(batchId) => setSelectedIds((previous) => { const next = new Set(previous); if (next.has(batchId)) next.delete(batchId); else next.add(batchId); return next; })} onSelectAll={() => setSelectedIds((previous) => batches.every((batch) => previous.has(batch.batchId)) ? new Set() : new Set(batches.map((batch) => batch.batchId)))} onOpen={controller.openBatch} onEdit={(batch) => void openEdit(batch)} onCopy={(batch) => void openCopy(batch)} onBind={(batchId) => void openRelation(batchId)} onToggle={(batch) => { if (batch.status === 'voided') return; void controller.updateBatch(batch.batchId, { status: batch.status === 'active' ? 'paused' : 'active' }); }} onDelete={(batchId) => { if (window.confirm('确认删除该卡券？删除后保留审计历史。')) void controller.deleteBatch(batchId); }} onImagePreview={setImagePreview} />}<CouponListStateView phase={controller.state.phase} error={controller.state.error} onRetry={controller.reload} /></article>
    <CouponDrawer state={controller.detail} content={controller.content} mutation={controller.mutation} onClose={controller.closeBatch} onRetry={() => controller.detail.batchId && controller.openBatch(controller.detail.batchId)} onImport={async (items) => { if (controller.detail.batchId) await controller.importItems(controller.detail.batchId, items); }} onBind={async (productId) => { if (controller.detail.batchId) await controller.bindBatch(controller.detail.batchId, productId); }} onVoid={async () => { if (controller.detail.batchId) await controller.voidBatch(controller.detail.batchId); }} onPreview={controller.previewContent} />
    {editor && <CouponCreateModal mode={editor.mode} batch={editor.batch} submitting={controller.mutation.phase === 'submitting'} onClose={() => setEditor(null)} onSubmit={async (input) => { if (editor.mode === 'edit' && editor.batch) await controller.updateBatch(editor.batch.batchId, input); else await controller.createBatch(input as Parameters<typeof controller.createBatch>[0]); }} />}
    {relationBatch && <CouponRelationModal batch={relationBatch} productsApi={productsApi} readonly={relationReadonly} submitting={controller.mutation.phase === 'submitting'} onClose={() => { setRelationBatch(null); setRelationReadonly(false); }} onSave={saveRelation} />}
    {imagePreview && <div className="coupons-image-preview-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setImagePreview(null); }}><div className="coupons-image-preview card"><button type="button" className="icon-button" onClick={() => setImagePreview(null)} aria-label="关闭">×</button><img src={imagePreview} alt="卡券原图预览" /></div></div>}
  </section>;
}
