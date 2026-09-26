import { useState } from 'react';
import { InputField } from '../../../shared/ui/InputField';
import type { AutomationRuleKey, AutomationRuleState, ProductAutomationBatchUpdate } from '../types';

const rules: Array<{ key: AutomationRuleKey; title: string; description: string }> = [
  { key: 'delivery', title: '付款后自动发货', description: '统一使用同一张发货卡券，卡券细节在卡券管理维护。' },
  { key: 'reprice', title: '拍下未付款自动改价', description: '统一设置目标价格和提醒文本。' },
  { key: 'gift', title: '评价后发送赠品', description: '统一使用同一张赠品卡券。' },
  { key: 'review', title: '超时未评价求评价', description: '统一设置首次等待、重复间隔和提醒文案。' },
];

export function BatchAutomationDialog({ open, productIds, onCancel, onSave, error }: { open: boolean; productIds: string[]; onCancel: () => void; onSave: (input: ProductAutomationBatchUpdate) => void | Promise<unknown>; error?: string | null }) {
  const [apply, setApply] = useState<Record<AutomationRuleKey, boolean>>({ delivery: false, reprice: false, gift: false, review: false });
  const [enabled, setEnabled] = useState<Record<AutomationRuleKey, boolean>>({ delivery: false, reprice: false, gift: false, review: false });
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  if (!open) return null;
  const rulesPayload: Record<AutomationRuleKey, AutomationRuleState> = { delivery: { enabled: enabled.delivery, couponIds: [] }, reprice: { enabled: enabled.reprice, targetPriceMinor: 990, repriceMessage: '已为您调整价格，请及时付款' }, gift: { enabled: enabled.gift, couponIds: [] }, review: { enabled: enabled.review, reviewInitialMinutes: 72 * 60, reviewRepeatMinutes: 24 * 60, reviewMaxCount: 1, reviewMessage: '商品已经发出，如果使用满意，麻烦帮忙点个好评～' } };
  const submit = async () => { setSaving(true); setLocalError(null); try { const result = await onSave({ productIds, apply, rules: rulesPayload }); if (result === null || result === false) { setSaving(false); setLocalError(error ?? '批量自动化配置保存失败，请重试'); } } catch (cause) { setSaving(false); setLocalError(cause instanceof Error ? cause.message : '批量自动化配置保存失败，请重试'); } };
  return <div className="product-automation-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}><section className="batch-automation-dialog" role="dialog" aria-modal="true" aria-label="批量配置自动化" data-testid="batch-automation-dialog"><header className="automation-modal-head"><div><p className="automation-kicker">商品批量操作</p><h3>批量配置自动化</h3><p>已选择 {productIds.length} 件商品；只覆盖勾选“应用此规则”的功能。</p></div><button className="icon-button" type="button" aria-label="关闭批量配置" onClick={onCancel}>×</button></header><div className="batch-automation-body">{(localError || error) && <div className="automation-error" role="alert">{localError ?? error}</div>}{rules.map((rule) => <div className="batch-rule-row" key={rule.key}><InputField className="batch-apply-checkbox" type="checkbox" aria-label={`应用${rule.title}`} checked={apply[rule.key]} onChange={(event) => setApply((previous) => ({ ...previous, [rule.key]: event.target.checked }))} /><div><h4>{rule.title}</h4><p>{rule.description}</p></div><button className={`automation-switch${enabled[rule.key] ? ' on' : ''}`} type="button" aria-label={`${rule.title}${enabled[rule.key] ? '已启用' : '未启用'}`} aria-pressed={enabled[rule.key]} onClick={() => setEnabled((previous) => ({ ...previous, [rule.key]: !previous[rule.key] }))}><span /></button></div>)}</div><footer className="automation-modal-footer"><span>批量规则仅覆盖已勾选的功能。</span><div><button className="btn ghost" type="button" onClick={onCancel} disabled={saving}>取消</button><button className="btn primary" type="button" data-testid="save-batch-automation" onClick={() => void submit()} disabled={saving || productIds.length === 0}>{saving ? '保存中…' : '保存并启用'}</button></div></footer></section></div>;
}
