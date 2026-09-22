import { useEffect, useMemo, useState } from 'react';
import { InputField } from '../../../shared/ui/InputField';
import type { AutomationCoupon } from '../types';

export function CouponPickerDialog({ open, title, subtitle, coupons, selectedIds, onCancel, onSave }: {
  open: boolean;
  title: string;
  subtitle: string;
  coupons: AutomationCoupon[];
  selectedIds: string[];
  onCancel: () => void;
  onSave: (ids: string[]) => void;
}) {
  const [draftIds, setDraftIds] = useState<string[]>(selectedIds);
  const [availableSearch, setAvailableSearch] = useState('');
  const [selectedSearch, setSelectedSearch] = useState('');
  useEffect(() => { if (open) { setDraftIds(selectedIds); setAvailableSearch(''); setSelectedSearch(''); } }, [open, selectedIds]);
  const selectedSet = useMemo(() => new Set(draftIds), [draftIds]);
  const available = coupons.filter((coupon) => !selectedSet.has(coupon.id) && matches(coupon, availableSearch));
  const selected = coupons.filter((coupon) => selectedSet.has(coupon.id) && matches(coupon, selectedSearch));
  const addIds = (ids: string[]) => setDraftIds((previous) => [...new Set([...previous, ...ids])]);
  const removeIds = (ids: string[]) => setDraftIds((previous) => previous.filter((id) => !ids.includes(id)));
  if (!open) return null;
  return <div className="product-automation-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
    <section className="coupon-picker-dialog" role="dialog" aria-modal="true" aria-label={title} data-testid="coupon-picker-dialog">
      <header className="automation-modal-head"><div><p className="automation-kicker">COUPON RELATION</p><h3>{title}</h3><p>{subtitle}</p></div><button className="icon-button" type="button" aria-label="关闭卡券选择" onClick={onCancel}>×</button></header>
      <div className="coupon-picker-body"><div className="coupon-transfer-grid">
        <CouponPane title="待选卡券" count={available.length} search={availableSearch} onSearch={setAvailableSearch} coupons={available} selected={[]} empty="没有符合条件的待选卡券" onToggle={(coupon) => addIds([coupon.id])} onSelectAll={() => addIds(available.map((coupon) => coupon.id))} selectAllLabel="全选当前结果" />
        <div className="coupon-transfer-actions"><button type="button" className="coupon-transfer-arrow" aria-label="加入已选卡券" onClick={() => addIds(available.map((coupon) => coupon.id))}>→</button><button type="button" className="coupon-transfer-arrow" aria-label="移出已选卡券" onClick={() => removeIds(selected.map((coupon) => coupon.id))}>←</button></div>
        <CouponPane title="已选卡券" count={selected.length} search={selectedSearch} onSearch={setSelectedSearch} coupons={selected} selected={draftIds} empty="暂无已选卡券，请从左侧选择" onToggle={(coupon) => removeIds([coupon.id])} />
      </div></div>
      <footer className="automation-modal-footer"><span>卡券规格、每件数量和库存仍在卡券管理中维护。</span><div><button className="btn ghost" type="button" onClick={onCancel}>取消</button><button className="btn primary" type="button" data-testid="save-coupon-selection" onClick={() => onSave(draftIds)}>保存（{draftIds.length}个）</button></div></footer>
    </section>
  </div>;
}

function CouponPane({ title, count, search, onSearch, coupons, selected, empty, onToggle, onSelectAll, selectAllLabel }: { title: string; count: number; search: string; onSearch: (value: string) => void; coupons: AutomationCoupon[]; selected: string[]; empty: string; onToggle: (coupon: AutomationCoupon) => void; onSelectAll?: () => void; selectAllLabel?: string }) {
  return <div className="coupon-transfer-pane"><div className="coupon-pane-head"><span>{title}</span><span>{count} 个</span></div>{onSelectAll && <button className="coupon-select-all" type="button" onClick={onSelectAll}>{selectAllLabel}</button>}<InputField className="coupon-search" aria-label={`搜索${title}`} value={search} onChange={(event) => onSearch(event.target.value)} placeholder="搜索卡券名称或 ID" /><div className="coupon-list">{coupons.length ? coupons.map((coupon) => <label className="coupon-item" key={coupon.id}><InputField className="coupon-checkbox" type="checkbox" checked={selected.includes(coupon.id)} onChange={() => onToggle(coupon)} /><span className="coupon-item-main"><strong>{coupon.label}</strong><small>{coupon.typeLabel} · {coupon.specSummary} · {coupon.quantitySummary}</small></span><em>{coupon.stockSummary}</em></label>) : <div className="coupon-empty">{empty}</div>}</div></div>;
}

function matches(coupon: AutomationCoupon, query: string) { const normalized = query.trim().toLowerCase(); return !normalized || `${coupon.label} ${coupon.id} ${coupon.typeLabel}`.toLowerCase().includes(normalized); }
