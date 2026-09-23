import { useEffect, useMemo, useState } from 'react';
import type { ProductVM } from '../../products/types';
import { InputField } from '../../../shared/ui/InputField';
import { TextAreaField } from '../../../shared/ui/TextAreaField';
import { CouponPickerDialog } from './CouponPickerDialog';
import type { AutomationCoupon, AutomationRuleKey, ProductAutomationConfig, ProductAutomationUpdate } from '../types';

const tabs: Array<{ key: AutomationRuleKey; title: string; subtitle: string }> = [
  { key: 'delivery', title: '付款后自动发货', subtitle: '使用已选卡券，规则在卡券中维护' },
  { key: 'reprice', title: '拍下未付款改价', subtitle: '未设置目标价格和话术' },
  { key: 'gift', title: '评价后发送赠品', subtitle: '使用已选赠品卡券，规则在卡券中维护' },
  { key: 'review', title: '超时未评价求评价', subtitle: '发货后 72 小时 · 每 24 小时 · 1 次' },
];

export function AutomationDrawer({ open, product, accountLabel = '当前账号', config, coupons, loadPhase, savePhase, error, onClose, onSave }: {
  open: boolean;
  product: ProductVM | null;
  accountLabel?: string;
  config: ProductAutomationConfig | null;
  coupons: AutomationCoupon[];
  loadPhase: 'idle' | 'loading' | 'success' | 'error';
  savePhase: 'idle' | 'saving' | 'success' | 'error';
  error: string | null;
  onClose: () => void;
  onSave: (input: ProductAutomationUpdate) => Promise<unknown>;
}) {
  const [activeTab, setActiveTab] = useState<AutomationRuleKey>('delivery');
  const boundCouponIds = useMemo(() => (product?.couponBatches ?? []).map((coupon) => coupon.id).filter(Boolean), [product]);
  const pickerCoupons = useMemo(() => {
    const byId = new Map(coupons.map((coupon) => [coupon.id, coupon]));
    for (const coupon of product?.couponBatches ?? []) {
      if (!byId.has(coupon.id)) byId.set(coupon.id, { id: coupon.id, label: coupon.label ?? coupon.id, typeLabel: '已绑定卡券', specSummary: '规格由卡券管理维护', quantitySummary: '按卡券设置', stockSummary: '由卡券管理维护' });
    }
    return [...byId.values()];
  }, [coupons, product]);
  const [draft, setDraft] = useState<ProductAutomationConfig | null>(() => config ? hydrateDraft(config, boundCouponIds) : config);
  const [couponTarget, setCouponTarget] = useState<AutomationRuleKey | null>(null);

  useEffect(() => {
    if (open) {
      setDraft(config ? hydrateDraft(config, boundCouponIds) : config);
      setActiveTab('delivery');
    }
  }, [boundCouponIds, config, open]);

  const selectedCoupons = useMemo(
    () => (key: AutomationRuleKey) => pickerCoupons.filter((coupon) => draft?.[key].couponIds?.includes(coupon.id)),
    [draft, pickerCoupons],
  );

  if (!open || !product) return null;

  const rule = draft?.[activeTab];
  const updateRule = (patch: Partial<NonNullable<typeof rule>>) => {
    setDraft((previous) => previous ? { ...previous, [activeTab]: { ...previous[activeTab], ...patch } } : previous);
  };
  const save = async () => {
    if (!draft) return;
    await onSave({ version: draft.version, delivery: draft.delivery, reprice: draft.reprice, gift: draft.gift, review: draft.review });
  };

  return (
    <div className="products-detail-backdrop automation-drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside className="products-detail-panel automation-drawer" role="dialog" aria-modal="true" aria-label="自动化配置" data-testid="automation-drawer">
        <header className="automation-drawer-head">
          <div className="automation-drawer-top">
            <div>
              <p className="automation-kicker">商品级规则配置</p>
              <h2>自动化配置</h2>
              <p className="automation-meta">{product.title} · 商品 ID {product.externalProductRef ?? product.id} · 当前账号 {accountLabel}</p>
            </div>
            <div className="automation-head-actions">
              <span className={`automation-status${loadPhase === 'error' || savePhase === 'error' ? ' error' : ''}`}>
                {loadPhase === 'loading' ? '加载中…' : loadPhase === 'error' ? '加载失败' : savePhase === 'saving' ? '保存中…' : savePhase === 'error' ? '保存失败' : '● 运行中'}
              </span>
              <button className="icon-button" type="button" aria-label="关闭自动化配置" onClick={onClose}>×</button>
            </div>
          </div>
          <div className="automation-summary-grid">
            {tabs.map((tab) => (
              <button key={tab.key} type="button" className={`automation-summary${activeTab === tab.key ? ' active' : ''}`} onClick={() => setActiveTab(tab.key)}>
                <div><strong>{tab.title}</strong><span>{draft?.[tab.key].enabled ? '✓' : '—'}</span></div>
                <p>{summaryText(tab.key, draft, selectedCoupons(tab.key))}</p>
                <em className={draft?.[tab.key].enabled ? 'on' : ''}>{draft?.[tab.key].enabled ? '已启用' : '未配置'}</em>
              </button>
            ))}
          </div>
        </header>

        <div className="automation-drawer-body">
          {(loadPhase === 'error' || savePhase === 'error') && <div className="automation-error" role="alert">{error ?? (savePhase === 'error' ? '自动化配置保存失败，请重试' : '自动化配置加载失败')}</div>}
          {loadPhase === 'loading' && <div className="automation-loading">正在加载自动化配置…</div>}
          {rule && <RulePanel tab={activeTab} rule={rule} selectedCoupons={selectedCoupons(activeTab)} onToggle={(enabled) => updateRule({ enabled })} onCouponChoose={() => setCouponTarget(activeTab)} onChange={(patch) => updateRule(patch)} />}
        </div>

        <footer className="automation-drawer-footer">
          <span>最近保存：{draft?.updatedAt ? formatTime(draft.updatedAt) : '未保存'} · 配置版本 v{draft?.version ?? 1}</span>
          <div>
            <button className="btn ghost" type="button" onClick={onClose} disabled={savePhase === 'saving'}>取消</button>
            <button className="btn" type="button" onClick={() => void save()} disabled={!draft || savePhase === 'saving'}>保存草稿</button>
            <button className="btn primary" type="button" data-testid="save-automation" onClick={() => void save()} disabled={!draft || savePhase === 'saving'}>{savePhase === 'saving' ? '保存中…' : '保存并启用'}</button>
          </div>
        </footer>
      </aside>

      {couponTarget && <CouponPickerDialog
        open
        title={couponTarget === 'gift' ? '选择赠品卡券' : '选择发货卡券'}
        subtitle={couponTarget === 'gift' ? '评价后自动发送的赠品卡券' : '付款后自动发货使用的卡券'}
        coupons={pickerCoupons}
        selectedIds={draft?.[couponTarget].couponIds ?? []}
        onCancel={() => setCouponTarget(null)}
        onSave={(ids) => {
          setDraft((previous) => previous ? { ...previous, [couponTarget]: { ...previous[couponTarget], couponIds: ids } } : previous);
          setCouponTarget(null);
        }}
      />}
    </div>
  );
}

function RulePanel({ tab, rule, selectedCoupons, onToggle, onCouponChoose, onChange }: {
  tab: AutomationRuleKey;
  rule: NonNullable<ProductAutomationConfig>[AutomationRuleKey];
  selectedCoupons: AutomationCoupon[];
  onToggle: (enabled: boolean) => void;
  onCouponChoose: () => void;
  onChange: (patch: Partial<typeof rule>) => void;
}) {
  const isCouponRule = tab === 'delivery' || tab === 'gift';
  const title = tabs.find((candidate) => candidate.key === tab)?.title ?? '';

  return (
    <section className="automation-rule-panel">
      <div className="automation-section-title">
        <div>
          <h3>{title}</h3>
          <p>{isCouponRule ? `这里只负责选择${tab === 'gift' ? '赠品' : '发货'}卡券，卡券细节统一在卡券管理中维护。` : tab === 'review' ? '只对已系统发货、未评价且存在会话的订单生效。' : '监听等待买家付款事件，修改价格后可发送提醒文本。'}</p>
        </div>
        <button className={`automation-switch${rule.enabled ? ' on' : ''}`} type="button" aria-label={`${title}${rule.enabled ? '已启用' : '未启用'}`} aria-pressed={rule.enabled} onClick={() => onToggle(!rule.enabled)}><span /></button>
      </div>

      {isCouponRule && <div className="automation-config-card">
        <h4>{tab === 'gift' ? '赠品卡券' : '发货卡券'}</h4>
        <div className="automation-selected-coupon">
          <div>
            {selectedCoupons.length ? selectedCoupons.map((coupon) => (
              <div className="automation-selected-coupon-item" key={coupon.id}>
                <strong>{coupon.label}</strong>
                <small>{coupon.typeLabel} · 已选{tab === 'gift' ? '赠品' : '发货'}卡券</small>
              </div>
            )) : <div className="automation-selected-coupon-item"><strong>未选择卡券</strong><small>请先选择可用卡券</small></div>}
          </div>
          <button className="btn" type="button" data-testid={`choose-${tab}-coupon`} onClick={onCouponChoose}>选择卡券</button>
        </div>
        {tab === 'delivery' && <div className="automation-sub-option">
          <div><strong>自动确认发货</strong><small>发卡成功后执行</small></div>
          <button className={`automation-switch${rule.autoConfirm ? ' on' : ''}`} type="button" data-testid="auto-confirm-delivery" aria-label={`自动确认发货${rule.autoConfirm ? '已开启' : '已关闭'}`} aria-pressed={Boolean(rule.autoConfirm)} onClick={() => onChange({ autoConfirm: !rule.autoConfirm })}><span /></button>
        </div>}
      </div>}

      {tab === 'reprice' && <div className="automation-config-card"><div className="automation-field-grid"><InputField label="目标价格" aria-label="目标价格" value={((rule.targetPriceMinor ?? 0) / 100).toFixed(2)} onChange={(event) => onChange({ targetPriceMinor: Math.round(Number(event.target.value || 0) * 100) })} /><InputField label="改价后发送文本" aria-label="改价后发送文本" value={rule.repriceMessage ?? ''} onChange={(event) => onChange({ repriceMessage: event.target.value })} /></div></div>}

      {tab === 'review' && <div className="automation-config-card"><div className="automation-field-grid"><InputField label="首次提醒（小时）" aria-label="首次提醒" type="number" min="1" value={rule.reviewInitialHours ?? 72} onChange={(event) => onChange({ reviewInitialHours: Number(event.target.value) })} /><InputField label="重复提醒间隔（小时）" aria-label="重复提醒间隔" type="number" min="1" value={rule.reviewRepeatHours ?? 24} onChange={(event) => onChange({ reviewRepeatHours: Number(event.target.value) })} /><InputField label="最多提醒次数" aria-label="最多提醒次数" type="number" min="1" value={rule.reviewMaxCount ?? 1} onChange={(event) => onChange({ reviewMaxCount: Number(event.target.value) })} /><TextAreaField label="提醒文案" aria-label="提醒文案" value={rule.reviewMessage ?? ''} onChange={(event) => onChange({ reviewMessage: event.target.value })} /></div></div>}

      {(tab === 'delivery' || tab === 'gift') && <div className="automation-preview"><p className="automation-kicker">规则预览</p><div><span>{tab === 'gift' ? '买家完成评价' : '买家付款'}</span><b>→</b><span>使用已选{tab === 'gift' ? '赠品' : '发货'}卡券</span>{tab === 'delivery' && <><b>→</b><span>确认发货</span></>}</div></div>}
      {tab === 'delivery' && <div className="automation-alert"><strong>风险提示</strong><span>卡券发送失败或外部结果未知时，不会自动确认发货，订单会进入人工复核。</span></div>}
    </section>
  );
}

function summaryText(key: AutomationRuleKey, config: ProductAutomationConfig | null, selected: AutomationCoupon[]) {
  if (!config) return '正在加载配置';
  if (key === 'delivery') return selected.length ? `已选${selected[0].label} · 规则在卡券中维护` : '未选择发货卡券';
  if (key === 'gift') return selected.length ? `已选${selected[0].label} · 规则在卡券中维护` : '未选择赠品卡券';
  if (key === 'review') return `发货后${config.review.reviewInitialHours ?? 72}小时 · 每${config.review.reviewRepeatHours ?? 24}小时 · ${config.review.reviewMaxCount ?? 1}次`;
  return config.reprice.enabled && config.reprice.targetPriceMinor ? `目标价 ¥${(config.reprice.targetPriceMinor / 100).toFixed(2)}` : '未设置目标价格和话术';
}

function hydrateDraft(config: ProductAutomationConfig, boundCouponIds: string[]): ProductAutomationConfig {
  const mergeBound = (ids?: string[]) => [...new Set([...(ids ?? []), ...boundCouponIds])];
  return {
    ...config,
    delivery: { ...config.delivery, couponIds: mergeBound(config.delivery.couponIds) },
    gift: { ...config.gift, couponIds: mergeBound(config.gift.couponIds) },
  };
}

function formatTime(value: string) {
  return value.replace('T', ' ').replace(/\.\d{3}Z$/, '').replace('Z', '');
}
