import { useState } from 'react';
import type { XianyuDetailState, XianyuItemDetailVM, XianyuItemImageVM } from '../types';

export function XianyuDetailDrawer({ state, onClose, onRetry, onSync }: { state: XianyuDetailState; onClose: () => void; onRetry: () => void; onSync: () => void }) {
  if (state.phase === 'idle') return null;
  const detail = state.data;
  return <div className="products-detail-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <aside className="products-detail-panel xianyu-detail-drawer" role="dialog" aria-modal="true" aria-label="闲鱼商品详情">
      <header>
        <div>
          <p className="eyebrow">Xianyu Item Detail</p>
          <h2>{detail?.title ?? '闲鱼商品详情'}</h2>
          {detail?.itemId && <p className="xianyu-detail-subtitle">闲鱼商品 ID：{detail.itemId}</p>}
          {detail && <p className="xianyu-detail-source-note">{detail.cached ? '已读取数据库中的已保存详情' : '已从闲鱼同步并保存详情'}</p>}
        </div>
        <div className="products-detail-header-actions"><button className="btn ghost btn-small" type="button" onClick={onSync} disabled={state.phase === 'loading' || !detail}>同步闲鱼</button><button className="icon-button" type="button" aria-label="关闭闲鱼商品详情" onClick={onClose}>×</button></div>
      </header>
      {state.phase === 'loading' && <div className="products-detail-state" aria-live="polite"><span className="xianyu-detail-spinner" />{state.loadingMode === 'sync' ? '正在同步并保存闲鱼商品详情…' : '正在读取闲鱼商品详情（优先使用已保存缓存）…'}</div>}
      {(state.phase === 'error' || state.phase === 'forbidden') && <div className="products-detail-state products-error" role="alert"><strong>{state.phase === 'forbidden' ? '无权查看闲鱼商品详情' : '闲鱼商品详情加载失败'}</strong><span>{state.error?.message ?? '商品详情不存在或暂时不可用。'}</span>{state.phase === 'error' && state.error?.retryable && <button className="btn ghost" type="button" onClick={onRetry}>重新加载</button>}</div>}
      {state.phase === 'success' && detail && <XianyuDetailContent detail={detail} />}
    </aside>
  </div>;
}

function XianyuDetailContent({ detail }: { detail: XianyuItemDetailVM }) {
  return <div className="xianyu-detail-body">
    <section className="xianyu-detail-summary">
      <div className="xianyu-detail-price">{detail.priceText ?? formatPrice(detail.priceMinor)}</div>
      <div className="xianyu-detail-stat"><strong>{formatNumber(detail.browseCount)}</strong><span>浏览</span></div>
      <div className="xianyu-detail-stat"><strong>{formatNumber(detail.wantCount)}</strong><span>想要</span></div>
      <div className="xianyu-detail-stat"><strong>{formatNumber(detail.collectCount)}</strong><span>收藏</span></div>
    </section>

    <section>
      <h3>商品信息</h3>
      <dl className="xianyu-detail-list">
        <DetailField label="商品 ID" value={detail.itemId} />
        <DetailField label="分类 ID" value={detail.categoryId} />
        <DetailField label="库存" value={formatNumber(detail.quantity)} />
        <DetailField label="已售" value={formatNumber(detail.soldCount)} />
        <DetailField label="收藏数" value={formatNumber(detail.favoriteCount)} />
        <DetailField label="互动收藏" value={formatNumber(detail.interactFavoriteCount)} />
        <DetailField label="详情同步" value={formatDate(detail.detailSyncedAt)} />
        <DetailField label="摘要指纹" value={detail.sourcePayloadDigest} />
      </dl>
    </section>

    {detail.seller && <section>
      <h3>卖家信息</h3>
      <div className="xianyu-seller-card">
        {detail.seller.avatarUrl ? <img src={detail.seller.avatarUrl} alt={detail.seller.nickname ? `${detail.seller.nickname}头像` : '卖家头像'} /> : <span className="xianyu-seller-avatar">卖</span>}
        <div><strong>{detail.seller.nickname ?? '未提供昵称'}</strong><span>{detail.seller.city ?? '—'}{detail.seller.sellerId ? ` · ${detail.seller.sellerId}` : ''}</span></div>
        <div className="xianyu-seller-metrics"><span>在售 {formatNumber(detail.seller.itemCount)}</span><span>已售 {formatNumber(detail.seller.soldCount)}</span><span>好评 {formatNumber(detail.seller.goodRemarkCount)}</span></div>
      </div>
    </section>}

    <section>
      <h3>商品图片 <span className="xianyu-section-count">{detail.images.length} 张</span></h3>
      {detail.images.length > 0 ? <div className="xianyu-detail-gallery">{detail.images.map((image, index) => <ImageTile image={image} index={index} key={image.id ?? image.storageKey ?? image.url ?? index} />)}</div> : <p className="xianyu-detail-empty">暂无已保存图片。图片引用由对象存储返回，数据库仅保存地址和元数据。</p>}
    </section>

    <section>
      <h3>商品描述</h3>
      <div className="xianyu-detail-description">{detail.description || '暂无商品描述'}</div>
      {detail.richTextDescription && detail.richTextDescription !== detail.description && <details className="xianyu-rich-description"><summary>查看富文本描述</summary><div>{detail.richTextDescription}</div></details>}
    </section>

    {detail.rawPayload && <details className="xianyu-raw-payload"><summary>查看原始详情字段</summary><pre>{JSON.stringify(detail.rawPayload, null, 2)}</pre></details>}
    {detail.assetUploadErrors && detail.assetUploadErrors.length > 0 && <section className="xianyu-detail-upload-warning"><h3>图片存储告警</h3><p>部分图片未能写入对象存储，已保留原始地址和失败原因。</p><ul>{detail.assetUploadErrors.map((error) => <li key={`${error.sourceUrl}:${error.message}`}><span>{error.sourceUrl}</span><small>{error.message}</small></li>)}</ul></section>}
  </div>;
}

function ImageTile({ image, index }: { image: XianyuItemImageVM; index: number }) {
  const previewUrl = [image.thumbnailUrl, image.url].find((value) => isRenderableImageUrl(value));
  const [status, setStatus] = useState<'loading' | 'loaded' | 'failed'>(previewUrl ? 'loading' : 'failed');
  const showImage = Boolean(previewUrl && status === 'loaded');
  return <figure className="xianyu-detail-image">
    <div className="xianyu-detail-image-frame">
      {!showImage && <div className="xianyu-detail-image-placeholder">对象存储图片<br /><small>{image.storageKey ?? '等待访问地址'}</small></div>}
      {previewUrl && <img src={previewUrl} alt={image.alt ?? `商品图片 ${index + 1}`} loading="eager" style={{ opacity: showImage ? 1 : 0 }} onLoad={() => setStatus('loaded')} onError={() => setStatus('failed')} />}
    </div>
    <figcaption>{image.storageKey ? `对象存储 · ${image.storageKey}` : `图片 ${index + 1}`}</figcaption>
  </figure>;
}

function isRenderableImageUrl(value?: string): value is string {
  return Boolean(value && (/^\//.test(value) || /^(https?:|data:image\/|blob:)/i.test(value)));
}

function DetailField({ label, value }: { label: string; value?: string }) { return <div><dt>{label}</dt><dd>{value || '—'}</dd></div>; }
function formatNumber(value?: number) { return value === undefined ? '—' : value.toLocaleString('zh-CN'); }
function formatPrice(value?: number) { return value === undefined ? '价格待同步' : `¥${(value / 100).toFixed(2)}`; }
function formatDate(value?: string) { if (!value) return '—'; return value.replace('T', ' ').replace(/\.\d{3}Z$/, '').replace('Z', ''); }
