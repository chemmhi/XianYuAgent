import { useEffect, useMemo, useState } from 'react';
import { useAccountContext } from '../../../app/account-context';
import { createMockCouponsApi, type CouponsApi } from '../api';
import { useCouponsController } from '../controller';
import type { CouponBatchVM } from '../types';
import { createMockProductsApi, type ProductsApi } from '../../products/api';
import { CouponBatchTable } from './CouponBatchTable';
import { CouponCreateModal } from './CouponCreateModal';
import { CouponRelationModal } from './CouponRelationModal';
import { CouponListStateView } from './CouponStateView';
import { CouponToolbar } from './CouponToolbar';
import { saveCouponRelation } from './relation';
import './coupons.css';

export interface CouponsPageProps { api?: CouponsApi; productsApi?: ProductsApi; }

export function CouponsPage({ api: providedApi, productsApi: providedProductsApi }: CouponsPageProps) {
  const { currentAccountId, accountsLoading, accountsError } = useAccountContext();
  const scopedAccountId = currentAccountId ?? '__no_active_account__';
  const api = useMemo(() => providedApi ?? createMockCouponsApi(), [providedApi]);
  const productsApi = useMemo(() => providedProductsApi ?? createMockProductsApi(), [providedProductsApi]);
  const controller = useCouponsController({ api, initialFilters: { accountId: scopedAccountId, sortBy: 'createdAt', sortOrder: 'desc' } });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [editor, setEditor] = useState<{ mode: 'create' | 'edit' | 'copy'; batch?: CouponBatchVM } | null>(null);
  const [relationBatch, setRelationBatch] = useState<CouponBatchVM | null>(null);
  const [relationReadonly, setRelationReadonly] = useState(false);
  const batches = controller.state.data?.items ?? [];
  const page = controller.state.data?.page ?? controller.filters.page ?? 1;
  const total = controller.state.data?.total ?? 0;
  const totalPages = controller.state.data?.totalPages ?? 1;
  const contextMissing = !accountsLoading && !accountsError && !currentAccountId;
  useEffect(() => {
    controller.setFilters((previous) => previous.accountId === scopedAccountId ? previous : { ...previous, accountId: scopedAccountId, page: 1 });
    setSelectedIds(new Set());
    setEditor(null);
  }, [controller.setFilters, scopedAccountId]);
  const openEdit = async (batch: CouponBatchVM) => { const detail = await api.getDetail(batch.batchId); setEditor({ mode: 'edit', batch: detail }); };
  const openCopy = async (batch: CouponBatchVM) => { const detail = await api.getDetail(batch.batchId); setEditor({ mode: 'copy', batch: detail }); };
  const openRelation = async (batchId: string, readonly = false) => { const detail = await api.getDetail(batchId); setRelationReadonly(readonly); setRelationBatch(detail); };
  const saveRelation = async (productIds: string[], initialIds: string[]) => {
    if (!relationBatch) return;
    await saveCouponRelation(relationBatch.batchId, productIds, initialIds, {
      bindBatch: controller.bindBatch,
      unbindBatch: controller.unbindBatch,
      getDetail: api.getDetail,
    }, () => {
      setRelationBatch(null);
      setRelationReadonly(false);
    });
    await controller.reload();
  };
  const bulkActions = selectedIds.size > 0 && <div className="coupons-bulk-actions">{<button className="btn danger" type="button" onClick={() => { if (window.confirm(`确认删除选中的 ${selectedIds.size} 张卡券？`)) void controller.batchDelete(Array.from(selectedIds)).then(() => setSelectedIds(new Set())); }}>删除选中 ({selectedIds.size})</button>}{selectedIds.size === 1 && <button className="btn ghost" type="button" onClick={() => { const batchId = Array.from(selectedIds)[0]; if (batchId) void openRelation(batchId); }}>关联商品</button>}</div>;
  return <section className="page-stack coupons-domain" data-coupons-domain>
    <article className="card panel coupons-panel"><CouponToolbar filters={controller.filters} phase={controller.state.phase} createDisabled={accountsLoading || Boolean(accountsError) || !currentAccountId} onKeywordChange={(keyword) => { controller.setKeyword(keyword); setSelectedIds(new Set()); }} onPurposeChange={(purpose) => { controller.setFilters((previous) => ({ ...previous, purpose, page: 1 })); setSelectedIds(new Set()); }} onCreate={() => { if (!currentAccountId) return; setEditor({ mode: 'create' }); }} onRefresh={() => void controller.reload()} bulkActions={bulkActions} />{accountsError && <div className="coupons-inline-error" role="alert">账号上下文加载失败：{accountsError}</div>}{contextMissing && <div className="coupons-context-note" role="status">请先选择一个可用账号后再创建或管理卡券。</div>}{controller.state.phase === 'success' && <CouponBatchTable batches={batches} selectedIds={selectedIds} page={page} pageSize={controller.state.data?.pageSize ?? controller.filters.pageSize ?? 20} total={total} totalPages={totalPages} sortBy={controller.filters.sortBy ?? 'createdAt'} sortOrder={controller.filters.sortOrder ?? 'desc'} onSortChange={(sortBy, sortOrder) => controller.setFilters((previous) => ({ ...previous, sortBy, sortOrder, page: 1 }))} onPageChange={(nextPage) => controller.setFilters((previous) => ({ ...previous, page: Math.max(1, Math.min(nextPage, totalPages)) }))} onSelect={(batchId) => setSelectedIds((previous) => { const next = new Set(previous); if (next.has(batchId)) next.delete(batchId); else next.add(batchId); return next; })} onSelectAll={() => setSelectedIds((previous) => batches.every((batch) => previous.has(batch.batchId)) ? new Set() : new Set(batches.map((batch) => batch.batchId)))} onEdit={(batch) => void openEdit(batch)} onCopy={(batch) => void openCopy(batch)} onBind={(batchId) => void openRelation(batchId)} onToggle={(batch) => { if (batch.status === 'voided') return; void controller.updateBatch(batch.batchId, { status: batch.status === 'active' ? 'paused' : 'active' }); }} onDelete={(batchId) => { if (window.confirm('确认删除该卡券？删除后保留审计历史。')) void controller.deleteBatch(batchId); }} />}<CouponListStateView phase={controller.state.phase} error={controller.state.error} onRetry={controller.reload} /></article>
    {editor && <CouponCreateModal mode={editor.mode} batch={editor.batch} accountId={currentAccountId} submitting={controller.mutation.phase === 'submitting'} onClose={() => setEditor(null)} onSubmit={async (input) => { if (editor.mode === 'edit' && editor.batch) await controller.updateBatch(editor.batch.batchId, input); else await controller.createBatch(input as Parameters<typeof controller.createBatch>[0]); }} />}
    {relationBatch && <CouponRelationModal batch={relationBatch} productsApi={productsApi} readonly={relationReadonly} submitting={controller.mutation.phase === 'submitting'} onClose={() => { setRelationBatch(null); setRelationReadonly(false); }} onSave={saveRelation} />}
  </section>;
}
