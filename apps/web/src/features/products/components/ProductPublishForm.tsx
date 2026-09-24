import type { ProductFormErrors } from '../validation';
import { inferProductCategory, type ProductPublishFormValues } from '../product-publish';
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
  const field = (key: FieldKey) => errors[key as keyof typeof errors];
  return <div className="product-publish-form">
    <section className="product-publish-card">
      <div className="product-publish-section-head"><h3>商品信息</h3></div>
      <div className="product-publish-fields">
        <label className="product-publish-field product-publish-field-wide"><span>商品标题 <em>*</em></span><InputField value={values.title} maxLength={60} disabled={disabled} placeholder="输入清晰、可检索的商品标题" onChange={(event) => onChange('title', event.target.value)} />{field('title') ? <small className="product-publish-error">{field('title')}</small> : <small>建议包含品类、核心卖点和使用场景，最多 60 字。</small>}</label>
        <div className="product-publish-field product-publish-field-wide"><span>商品分类</span><div className="product-publish-auto-category"><strong>{category.label}</strong><span>{category.hint}</span></div></div>
        <label className="product-publish-field product-publish-field-wide"><span>商品描述 <em>*</em></span><ProductPublishComposer description={values.description} attachments={values.attachments} disabled={disabled} optimizing={optimizing} onDescriptionChange={(value) => onChange('description', value)} onAttachmentsChange={onAttachmentsChange} onOptimize={onOptimize} />{field('description') && <small className="product-publish-error">{field('description')}</small>}</label>
      </div>
      <div className="product-publish-divider" />
      <div className="product-publish-subhead"><h4>价格与物流</h4></div>
      <div className="product-publish-fields">
        <label className="product-publish-field"><span>售价 <em>*</em></span><span className="product-publish-money-input"><b>¥</b><InputField aria-label="售价" inputMode="decimal" value={values.priceYuan} disabled={disabled} placeholder="0.00" onChange={(event) => onChange('priceYuan', event.target.value)} /></span>{field('priceYuan') && <small className="product-publish-error">{field('priceYuan')}</small>}</label>
        <label className="product-publish-field"><span>原价</span><span className="product-publish-money-input"><b>¥</b><InputField aria-label="原价" inputMode="decimal" value={values.originalPriceYuan} disabled={disabled} placeholder="可选" onChange={(event) => onChange('originalPriceYuan', event.target.value)} /></span>{field('originalPriceYuan') && <small className="product-publish-error">{field('originalPriceYuan')}</small>}</label>
        <label className="product-publish-field"><span>库存数量 <em>*</em></span><InputField aria-label="库存数量" inputMode="numeric" value={values.quantity} disabled={disabled} placeholder="0" onChange={(event) => onChange('quantity', event.target.value)} />{field('quantity') && <small className="product-publish-error">{field('quantity')}</small>}</label>
        <label className="product-publish-field"><span>邮费模式 <em>*</em></span><SelectField aria-label="邮费模式" value={values.postageMode} disabled={disabled} options={[{ value: 'seller', label: '包邮' }, { value: 'buyer', label: '买家承担' }]} onChange={(event) => onChange('postageMode', event.target.value)} /></label>
        <label className="product-publish-field"><span>邮费</span><span className="product-publish-money-input"><b>¥</b><InputField aria-label="邮费" inputMode="decimal" value={values.postageYuan} disabled={disabled || values.postageMode === 'seller'} placeholder="0.00" onChange={(event) => onChange('postageYuan', event.target.value)} /></span>{field('postageYuan') && <small className="product-publish-error">{field('postageYuan')}</small>}</label>
        <label className="product-publish-field"><span>发货地 <em>*</em></span><InputField aria-label="发货地" value={values.location} disabled={disabled} placeholder="省 / 市" onChange={(event) => onChange('location', event.target.value)} />{field('location') && <small className="product-publish-error">{field('location')}</small>}</label>
      </div>
    </section>
  </div>;
}
