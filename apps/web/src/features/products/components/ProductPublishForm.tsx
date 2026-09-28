import type { ProductFormErrors } from '../validation';
import { inferProductCategory, inferProductSpecs, type ProductPublishFormValues, type ProductPublishSpecOption, type ProductPublishSpecPreview } from '../product-publish';
import type { ProductPublishPreviewVM } from '../api';
import type { PublishAttachment } from '../product-publish';
import { ProductPublishComposer } from './ProductPublishComposer';
import { InputField } from '../../../shared/ui/InputField';
import { SelectField } from '../../../shared/ui/SelectField';

type FieldKey = keyof ProductPublishFormValues;

export function ProductPublishForm({ values, errors, disabled, optimizing, officialPreview, previewState, onSpecOverrideChange, onChange, onAttachmentsChange, onOptimize }: {
  values: ProductPublishFormValues;
  errors: ProductFormErrors;
  disabled?: boolean;
  optimizing?: boolean;
  officialPreview?: ProductPublishPreviewVM | null;
  previewState?: 'idle' | 'loading' | 'success' | 'error';
  onSpecOverrideChange?: (property: ProductPublishSpecPreview, option: ProductPublishSpecOption) => void;
  onChange: (field: FieldKey, value: string) => void;
  onAttachmentsChange: (attachments: PublishAttachment[]) => void;
  onOptimize: () => void;
}) {
  const category = inferProductCategory(values.title, values.description);
  const specs = inferProductSpecs(values.title, values.description, values.attachments);
  const postageHint = values.postageMode === 'free' ? '按官方包邮模式发布' : values.postageMode === 'distance' ? '按官方距离计费模板发布' : values.postageMode === 'fixed' ? '买家承担固定邮费，金额必填' : '无需邮寄，仅支持自提类商品';
  const field = (key: FieldKey) => errors[key as keyof typeof errors];
  const optionKey = (option: ProductPublishSpecOption) => [option.valueId, option.valueName, option.channelCatId, option.catId, option.text].map((value) => value ?? '').join('|');
  const selectedOption = (property: ProductPublishSpecPreview) => values.specOverrides?.find((item) => item.propertyId === property.propertyId) ?? property.selected;
  const previewHint = previewState === 'loading' ? '正在同步闲鱼官方识别结果…' : previewState === 'error' ? '官方规格预览暂时失败，发布时会再次校验。' : previewState === 'success' ? '已同步官方规格，可在提交前修正。' : '上传图片并填写标题、描述后自动预览官方规格。';
  return <div className="product-publish-form">
    <section className="product-publish-card">
      <div className="product-publish-section-head"><h3>商品信息</h3></div>
      <div className="product-publish-fields">
        <label className="product-publish-field product-publish-field-wide"><span>商品标题 <em>*</em></span><InputField value={values.title} maxLength={60} disabled={disabled} placeholder="输入清晰、可检索的商品标题" onChange={(event) => onChange('title', event.target.value)} />{field('title') ? <small className="product-publish-error">{field('title')}</small> : <small>建议包含品类、核心卖点和使用场景，最多 60 字。</small>}</label>
        <div className="product-publish-field product-publish-field-wide"><span>商品分类与规格</span>{officialPreview ? <div className="product-publish-official-specs" aria-label="闲鱼官方规格预览">{officialPreview.specs.map((property) => { const selected = selectedOption(property); return <div className="product-publish-official-spec" key={property.propertyId}><b>{property.propertyName}</b>{property.options.length > 1 ? <SelectField aria-label={property.propertyName} value={selected ? optionKey(selected) : ''} disabled={disabled} options={property.options.map((option) => ({ value: optionKey(option), label: option.text }))} onChange={(event) => { const option = property.options.find((candidate) => optionKey(candidate) === event.target.value); if (option) onSpecOverrideChange?.(property, option); }} /> : <span className="product-publish-spec-value">{selected?.text ?? property.options[0]?.text ?? '待识别'}</span>}</div>; })}</div> : <div className="product-publish-auto-category"><div><strong>{category.label}</strong><span>{category.hint}</span></div><div className="product-publish-spec-list" aria-label="自动识别规格">{specs.map((spec) => <span className={`product-publish-spec product-publish-spec-${spec.source}`} key={`${spec.label}-${spec.value}`}><b>{spec.label}</b>{spec.value}</span>)}</div></div>}<small>{previewHint}</small></div>
        <label className="product-publish-field product-publish-field-wide"><span>商品描述 <em>*</em></span><ProductPublishComposer description={values.description} attachments={values.attachments} disabled={disabled} optimizing={optimizing} onDescriptionChange={(value) => onChange('description', value)} onAttachmentsChange={onAttachmentsChange} onOptimize={onOptimize} />{field('description') && <small className="product-publish-error">{field('description')}</small>}</label>
      </div>
      <div className="product-publish-divider" />
      <div className="product-publish-subhead"><h4>价格与物流</h4></div>
      <div className="product-publish-official-note">库存按闲鱼官方逻辑处理。</div>
      <div className="product-publish-fields">
        <label className="product-publish-field"><span>售价 <em>*</em></span><span className="product-publish-money-input"><b>¥</b><InputField aria-label="售价" inputMode="decimal" value={values.priceYuan} disabled={disabled} placeholder="0.00" onChange={(event) => onChange('priceYuan', event.target.value)} /></span>{field('priceYuan') && <small className="product-publish-error">{field('priceYuan')}</small>}</label>
        <label className="product-publish-field"><span>原价</span><span className="product-publish-money-input"><b>¥</b><InputField aria-label="原价" inputMode="decimal" value={values.originalPriceYuan} disabled={disabled} placeholder="可选" onChange={(event) => onChange('originalPriceYuan', event.target.value)} /></span>{field('originalPriceYuan') && <small className="product-publish-error">{field('originalPriceYuan')}</small>}</label>
        <label className="product-publish-field"><span>发货设置 <em>*</em></span><SelectField aria-label="发货设置" value={values.postageMode} disabled={disabled} options={[{ value: 'free', label: '包邮' }, { value: 'distance', label: '按距离计费' }, { value: 'fixed', label: '一口价' }, { value: 'none', label: '无需邮寄' }]} onChange={(event) => onChange('postageMode', event.target.value)} /><small>{postageHint}</small></label>
        <label className="product-publish-field"><span>邮费{values.postageMode === 'fixed' ? <em> *</em> : null}</span><span className="product-publish-money-input"><b>¥</b><InputField aria-label="邮费" inputMode="decimal" value={values.postageYuan} disabled={disabled || values.postageMode !== 'fixed'} placeholder={values.postageMode === 'fixed' ? '必填' : '按官方模式处理'} onChange={(event) => onChange('postageYuan', event.target.value)} /></span>{field('postageYuan') && <small className="product-publish-error">{field('postageYuan')}</small>}</label>
        <label className="product-publish-field product-publish-field-wide"><span>宝贝所在地</span><InputField aria-label="宝贝所在地" value={values.location} disabled={disabled} placeholder="例如：深圳湾公园" onChange={(event) => onChange('location', event.target.value)} /><small>发布前可直接修改地点名称，提交时同步到闲鱼的所在地字段。</small></label>
      </div>
    </section>
  </div>;
}
