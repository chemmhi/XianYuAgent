import { useEffect, useMemo, useState } from 'react';
import { SearchField } from '../../../shared/ui/SearchField';
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
  const [availableCheckedIds, setAvailableCheckedIds] = useState<string[]>([]);
  const [selectedCheckedIds, setSelectedCheckedIds] = useState<string[]>([]);
  const [availableSearch, setAvailableSearch] = useState('');
  const [selectedSearch, setSelectedSearch] = useState('');
  useEffect(() => {
    if (open) {
      setDraftIds(selectedIds);
      setAvailableCheckedIds([]);
      setSelectedCheckedIds([]);
      setAvailableSearch('');
      setSelectedSearch('');
    }
  }, [open, selectedIds]);
  const selectedSet = useMemo(() => new Set(draftIds), [draftIds]);
  const available = coupons.filter((coupon) => !selectedSet.has(coupon.id) && matches(coupon, availableSearch)).sort(compareCoupons);
  const selected = coupons.filter((coupon) => selectedSet.has(coupon.id) && matches(coupon, selectedSearch)).sort(compareCoupons);
  const addIds = (ids: string[]) => {
    setDraftIds((previous) => [...new Set([...previous, ...ids])]);
    setAvailableCheckedIds((previous) => previous.filter((id) => !ids.includes(id)));
  };
  const removeIds = (ids: string[]) => {
    setDraftIds((previous) => previous.filter((id) => !ids.includes(id)));
    setSelectedCheckedIds((previous) => previous.filter((id) => !ids.includes(id)));
  };
  if (!open) return null;
  return <div className="coupons-modal-backdrop product-automation-coupon-picker-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
    <section className="coupons-modal coupons-relation-modal coupon-picker-modal card" role="dialog" aria-modal="true" aria-label={title} data-testid="coupon-picker-dialog">
      <header><div><p className="eyebrow">Coupon Relation</p><h2>{title}</h2><p>{subtitle}</p></div><button className="icon-button" type="button" aria-label="关闭卡券选择" onClick={onCancel}>×</button></header>
      <div className="coupons-relation-grid coupon-picker-grid">
        <CouponPane title="待选卡券" count={available.length} search={availableSearch} onSearch={setAvailableSearch} coupons={available} checked={availableCheckedIds} empty="没有符合条件的待选卡券" onToggle={(coupon) => setAvailableCheckedIds((previous) => previous.includes(coupon.id) ? previous.filter((id) => id !== coupon.id) : [...previous, coupon.id])} onSelectAll={() => setAvailableCheckedIds(available.map((coupon) => coupon.id))} selectAllLabel="全选当前结果" placeholder="搜索卡券名称或 ID" />
        <div className="coupon-picker-transfer-column" aria-label="移动卡券"><button type="button" className="btn ghost btn-small coupon-picker-transfer-button coupon-transfer-arrow" aria-label="加入已选卡券" disabled={!availableCheckedIds.length} onClick={() => addIds(availableCheckedIds)}>→</button><button type="button" className="btn ghost btn-small coupon-picker-transfer-button coupon-transfer-arrow" aria-label="移出已选卡券" disabled={!selectedCheckedIds.length} onClick={() => removeIds(selectedCheckedIds)}>←</button></div>
        <CouponPane title="已选卡券" count={selected.length} search={selectedSearch} onSearch={setSelectedSearch} coupons={selected} checked={selectedCheckedIds} empty="暂无已选卡券，请从左侧选择" onToggle={(coupon) => setSelectedCheckedIds((previous) => previous.includes(coupon.id) ? previous.filter((id) => id !== coupon.id) : [...previous, coupon.id])} onRemove={(coupon) => removeIds([coupon.id])} placeholder="搜索已选卡券" />
      </div>
      <footer className="coupon-picker-footer"><span className="coupon-picker-footer-note">可多选卡券，保存后将按选择结果执行自动化。</span><div><button className="btn ghost" type="button" onClick={onCancel}>取消</button><button className="btn primary" type="button" data-testid="save-coupon-selection" onClick={() => onSave(draftIds)}>保存（{draftIds.length} 个）</button></div></footer>
    </section>
  </div>;
}

function CouponPane({ title, count, search, onSearch, coupons, checked, empty, onToggle, onRemove, onSelectAll, selectAllLabel, placeholder }: { title: string; count: number; search: string; onSearch: (value: string) => void; coupons: AutomationCoupon[]; checked: string[]; empty: string; onToggle: (coupon: AutomationCoupon) => void; onRemove?: (coupon: AutomationCoupon) => void; onSelectAll?: () => void; selectAllLabel?: string; placeholder: string }) {
  return <div className="coupons-relation-pane coupon-picker-pane coupon-transfer-pane"><div className="coupons-relation-pane-head"><strong>{title}</strong>{onSelectAll && <button className="btn ghost btn-small coupon-picker-select-all" type="button" onClick={onSelectAll}>{selectAllLabel}</button>}<span>{count} 个</span><SearchField className="coupons-relation-search" aria-label={`搜索${title}`} value={search} onChange={(event) => onSearch(event.target.value)} placeholder={placeholder} /></div><div className="coupons-relation-scroll">{coupons.length ? coupons.map((coupon) => <label className={`coupons-relation-item coupon-picker-item coupon-item${checked.includes(coupon.id) ? ' active selected' : ''}`} key={coupon.id}><input type="checkbox" checked={checked.includes(coupon.id)} onChange={() => onToggle(coupon)} aria-label={`选择${coupon.label}`} /><span className="coupons-relation-item-label coupon-item-main"><strong>{coupon.label}</strong><small>{coupon.typeLabel} · 可用于自动化</small></span>{onRemove && <button className="btn ghost btn-small coupons-relation-remove coupon-remove" type="button" aria-label={`移除${coupon.label}`} onClick={(event) => { event.preventDefault(); event.stopPropagation(); onRemove(coupon); }}>×</button>}</label>) : <div className="coupons-relation-state"><p className="coupons-empty-note">{empty}</p></div>}</div></div>;
}

function matches(coupon: AutomationCoupon, query: string) { const normalized = query.trim().toLowerCase(); return !normalized || `${coupon.label} ${coupon.id} ${coupon.typeLabel}`.toLowerCase().includes(normalized); }
function compareCoupons(left: AutomationCoupon, right: AutomationCoupon) { return couponTypeRank(left) - couponTypeRank(right) || left.label.localeCompare(right.label, 'zh-CN'); }
function couponTypeRank(coupon: AutomationCoupon) { return coupon.typeLabel === '数据卡' ? 0 : coupon.typeLabel === 'API 卡' ? 1 : 2; }
