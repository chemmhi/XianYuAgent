import type { ProductFormErrors } from '../validation';
import { inferProductCategory, inferProductSpecs, type ProductPublishFormValues } from '../product-publish';
import type { PublishAttachment } from '../product-publish';
import { ProductPublishComposer } from './ProductPublishComposer';
import { InputField } from '../../../shared/ui/InputField';
import { SelectField } from '../../../shared/ui/SelectField';

type FieldKey = keyof ProductPublishFormValues;

export function ProductPublishForm({ values, errors, disabled, optimizing, onChange, onAttachmentsChange, onOptimize }: {
  values: ProductPublishFormValues;
  errors: ProductFormErrors;
  disabled?: boolean;
  optimizing?: boolean;
  onChange: (field: FieldKey, value: string) => void;
  onAttachmentsChange: (attachments: PublishAttachment[]) => void;
  onOptimize: () => void;
}) {
  const category = inferProductCategory(values.title, values.description);
  const specs = inferProductSpecs(values.title, values.description, values.attachments);
  const postageHint = values.postageMode === 'free' ? '按官方包邮模式发布' : values.postageMode === 'distance' ? '按官方距离计费模板发布' : values.postageMode === 'fixed' ? '买家承担固定邮费，金额必填' : '无需邮寄，仅支持自提类商品';
  const field = (key: FieldKey) => errors[key as keyof typeof errors];
  return <div className="product-publish-form">
    <section className="product-publish-card">
      <div className="product-publish-section-head"><h3>商品信息</h3></div>
      <div className="product-publish-fields">
        <label className="product-publish-field product-publish-field-wide"><span>商品标题 <em>*</em></span><InputField value={values.title} maxLength={60} disabled={disabled} placeholder="输入清晰、可检索的商品标题" onChange={(event) => onChange('title', event.target.value)} />{field('title') ? <small className="product-publish-error">{field('title')}</small> : <small>建议包含品类、核心卖点和使用场景，最多 60 字。</small>}</label>
        <div className="product-publish-field product-publish-field-wide"><span>商品分类与规格</span><div className="product-publish-auto-category"><div><strong>{category.label}</strong><span>{category.hint}</span></div><div className="product-publish-spec-list" aria-label="自动识别规格">{specs.map((spec) => <span className={`product-publish-spec product-publish-spec-${spec.source}`} key={`${spec.label}-${spec.value}`}><b>{spec.label}</b>{spec.value}</span>)}</div></div><small>发布时会把图片与描述一并提交给闲鱼官方属性推荐接口，自动确认可用规格后再发布。</small></div>
        <label className="product-publish-field product-publish-field-wide"><span>商品描述 <em>*</em></span><ProductPublishComposer description={values.description} attachments={values.attachments} disabled={disabled} optimizing={optimizing} onDescriptionChange={(value) => onChange('description', value)} onAttachmentsChange={onAttachmentsChange} onOptimize={onOptimize} />{field('description') && <small className="product-publish-error">{field('description')}</small>}</label>
      </div>
      <div className="product-publish-divider" />
      <div className="product-publish-subhead"><h4>价格与物流</h4></div>
      <div className="product-publish-fields">
        <label className="product-publish-field"><span>售价 <em>*</em></span><span className="product-publish-money-input"><b>¥</b><InputField aria-label="售价" inputMode="decimal" value={values.priceYuan} disabled={disabled} placeholder="0.00" onChange={(event) => onChange('priceYuan', event.target.value)} /></span>{field('priceYuan') && <small className="product-publish-error">{field('priceYuan')}</small>}</label>
        <label className="product-publish-field"><span>原价</span><span className="product-publish-money-input"><b>¥</b><InputField aria-label="原价" inputMode="decimal" value={values.originalPriceYuan} disabled={disabled} placeholder="可选" onChange={(event) => onChange('originalPriceYuan', event.target.value)} /></span>{field('originalPriceYuan') && <small className="product-publish-error">{field('originalPriceYuan')}</small>}</label>
        <label className="product-publish-field"><span>库存数量 <em>*</em></span><InputField aria-label="库存数量" inputMode="numeric" value={values.quantity} disabled={disabled} placeholder="0" onChange={(event) => onChange('quantity', event.target.value)} />{field('quantity') && <small className="product-publish-error">{field('quantity')}</small>}</label>
        <label className="product-publish-field"><span>发货设置 <em>*</em></span><SelectField aria-label="发货设置" value={values.postageMode} disabled={disabled} options={[{ value: 'free', label: '包邮' }, { value: 'distance', label: '按距离计费' }, { value: 'fixed', label: '一口价' }, { value: 'none', label: '无需邮寄' }]} onChange={(event) => onChange('postageMode', event.target.value)} /><small>{postageHint}</small></label>
        <label className="product-publish-field"><span>邮费{values.postageMode === 'fixed' ? <em> *</em> : null}</span><span className="product-publish-money-input"><b>¥</b><InputField aria-label="邮费" inputMode="decimal" value={values.postageYuan} disabled={disabled || values.postageMode !== 'fixed'} placeholder={values.postageMode === 'fixed' ? '必填' : '按官方模式处理'} onChange={(event) => onChange('postageYuan', event.target.value)} /></span>{field('postageYuan') && <small className="product-publish-error">{field('postageYuan')}</small>}</label>
        <div className="product-publish-field product-publish-field-wide"><span>宝贝所在地（本轮跳过）</span><div className="product-publish-location-skip"><strong>暂不发送地址设置</strong><span>按当前验收要求，发布请求不带官方地点字段；后续接入地点弹窗后再补充。</span>{values.location && <small>草稿已有地址：{values.location}</small>}</div></div>
      </div>
    </section>
  </div>;
}
