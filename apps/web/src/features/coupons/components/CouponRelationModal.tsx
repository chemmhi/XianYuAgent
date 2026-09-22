import { useEffect, useMemo, useState } from 'react';
import type { ProductsApi } from '../../products/api';
import type { ProductVM } from '../../products/types';
import type { CouponBatchVM } from '../types';
import { SearchField } from '../../../shared/ui/SearchField';

export function CouponRelationProductLabel({ title }: { title: string }) {
  return <span className="coupons-relation-item-label"><strong>{title}</strong></span>;
}

export function CouponRelationModal({ batch, productsApi, readonly = false, submitting, onClose, onSave }: { batch: CouponBatchVM; productsApi: ProductsApi; readonly?: boolean; submitting: boolean; onClose: () => void; onSave: (productIds: string[], initialIds: string[]) => Promise<void> }) {
  const initialIds = useMemo(() => batch.bindings.filter((binding) => binding.status === 'active').map((binding) => binding.productId), [batch]);
  const [leftSearch, setLeftSearch] = useState('');
  const [rightSearch, setRightSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set(initialIds));
  const [items, setItems] = useState<ProductVM[]>([]);
  const [cache, setCache] = useState<Record<string, ProductVM>>({});
  const [phase, setPhase] = useState<'loading' | 'success' | 'error'>('loading');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  useEffect(() => { let active = true; const timer = window.setTimeout(() => { void (async () => { setPhase('loading'); try { const data = await productsApi.list({ accountId: batch.accountId, keyword: leftSearch, page, pageSize: 20 }); if (!active) return; setItems((previous) => page === 1 ? data.items : [...previous, ...data.items]); setCache((previous) => Object.fromEntries([...Object.entries(previous), ...data.items.map((item) => [item.id, item])])); setTotal(data.total); setPhase('success'); } catch { if (active) setPhase('error'); } })(); }, 220); return () => { active = false; window.clearTimeout(timer); }; }, [batch.accountId, leftSearch, page, productsApi]);
  const selectedItems = useMemo(() => Array.from(selectedIds).map((id) => cache[id] ?? { id, accountId: batch.accountId, title: id, configVersion: 1, attributesJson: {}, status: 'draft', updatedAt: '', skuCount: 0, assetCount: 0 } as ProductVM).filter((item) => !rightSearch || `${item.title} ${item.id}`.toLowerCase().includes(rightSearch.toLowerCase())), [batch.accountId, cache, rightSearch, selectedIds]);
  const allLoadedSelected = items.length > 0 && items.every((item) => selectedIds.has(item.id));
  function toggle(id: string) { if (readonly) return; setSelectedIds((previous) => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }
  return <div className="coupons-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
    <section className="coupons-modal coupons-relation-modal card" aria-label={readonly ? '查看关联商品' : '管理关联商品'}>
      <header><div><p className="eyebrow">Product Relation</p><h2>{readonly ? '查看关联商品' : '管理关联商品'}</h2><p>{batch.label}</p></div><button className="icon-button" type="button" onClick={onClose} aria-label="关闭">×</button></header>
      <div className="coupons-relation-grid">
        <div className="coupons-relation-pane"><div className="coupons-relation-pane-head"><strong>待选商品</strong><button className="btn ghost btn-small" type="button" disabled={readonly || !items.length} onClick={() => setSelectedIds((previous) => { const next = new Set(previous); if (allLoadedSelected) items.forEach((item) => next.delete(item.id)); else items.forEach((item) => next.add(item.id)); return next; })}>{allLoadedSelected ? '取消全选' : '全选当前结果'}</button><span>{total} 个</span><SearchField className="coupons-relation-search" value={leftSearch} onChange={(event) => { setLeftSearch(event.target.value); setPage(1); }} placeholder="搜索商品名称或 ID" aria-label="搜索商品名称或 ID" /></div><div className="coupons-relation-scroll">{phase === 'loading' && page === 1 ? <div className="coupons-relation-state"><p className="coupons-empty-note">加载中…</p></div> : phase === 'error' ? <div className="coupons-relation-state"><p className="coupons-form-error">商品列表加载失败</p></div> : items.length === 0 ? <div className="coupons-relation-state"><p className="coupons-empty-note">暂无商品</p></div> : <>{items.map((item) => <button type="button" key={item.id} className={`coupons-relation-item${selectedIds.has(item.id) ? ' active' : ''}`} onClick={() => toggle(item.id)}><span>{selectedIds.has(item.id) ? '☑' : '□'}</span><CouponRelationProductLabel title={item.title} /></button>)}{items.length < total && <button type="button" className="btn ghost btn-small" onClick={() => setPage((value) => value + 1)}>加载更多</button>}</>}</div></div>
        <div className="coupons-relation-pane selected-pane"><div className="coupons-relation-pane-head"><strong>{readonly ? '已关联商品' : '已选商品'}</strong><span>{selectedIds.size} 个</span><SearchField className="coupons-relation-search" value={rightSearch} onChange={(event) => setRightSearch(event.target.value)} placeholder="搜索已选商品" aria-label="搜索已选商品" /></div><div className="coupons-relation-scroll">{selectedItems.length === 0 ? <div className="coupons-relation-state"><p className="coupons-empty-note">请在左侧选择商品</p></div> : selectedItems.map((item) => <div className="coupons-relation-item active" key={item.id}><CouponRelationProductLabel title={item.title} />{!readonly && <button type="button" className="coupons-action-icon danger" onClick={() => toggle(item.id)} aria-label="移除">×</button>}</div>)}</div></div>
      </div>
      <footer><button className="btn ghost" type="button" onClick={onClose} disabled={submitting}>{readonly ? '关闭' : '取消'}</button>{!readonly && <button className="btn primary" type="button" disabled={submitting} onClick={() => void onSave(Array.from(selectedIds), initialIds)}>{submitting ? '保存中…' : `保存（${selectedIds.size} 个）`}</button>}</footer>
    </section>
  </div>;
}
