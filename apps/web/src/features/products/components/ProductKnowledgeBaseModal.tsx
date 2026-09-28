import { useEffect, useState } from 'react';
import type { ProductMutationError, ProductVM } from '../types';
import { TextAreaField } from '../../../shared/ui/TextAreaField';

export function ProductKnowledgeBaseModal({ product, saving, error, onClose, onSave }: {
  product: ProductVM;
  saving: boolean;
  error: ProductMutationError | null;
  onClose: () => void;
  onSave: (knowledgeBase: string) => Promise<boolean>;
}) {
  const initialContent = product.knowledgeBase ?? '';
  const [mode, setMode] = useState<'view' | 'edit'>(initialContent.trim() ? 'view' : 'edit');
  const [draft, setDraft] = useState(initialContent);
  const [confirmClose, setConfirmClose] = useState(false);

  useEffect(() => {
    const nextContent = product.knowledgeBase ?? '';
    setDraft(nextContent);
    setMode(nextContent.trim() ? 'view' : 'edit');
    setConfirmClose(false);
  }, [product.id, product.knowledgeBase]);

  const dirty = mode === 'edit' && draft !== initialContent;
  const requestClose = () => {
    if (dirty) setConfirmClose(true);
    else onClose();
  };

  const save = async () => {
    if (saving) return;
    const ok = await onSave(draft);
    if (ok) onClose();
  };

  return <div className="products-detail-backdrop product-knowledge-base-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) requestClose(); }}>
    <aside className="products-detail-panel product-knowledge-base-modal" role="dialog" aria-modal="true" aria-labelledby="product-knowledge-base-title" data-testid="product-knowledge-base-modal">
      <header className="product-knowledge-base-header">
        <div>
          <p className="eyebrow">商品配置 / Knowledge Base</p>
          <h2 id="product-knowledge-base-title">知识库</h2>
          <p>为「{product.title}」补充自动回复可使用的商品信息。</p>
        </div>
        <button className="icon-button" type="button" aria-label="关闭知识库" onClick={requestClose} disabled={saving}>×</button>
      </header>
      {error && <div className="products-inline-error product-knowledge-base-error" role="alert">{error.message}</div>}
      <div className="product-knowledge-base-body">
        {mode === 'view' ? <section className="product-knowledge-base-view" aria-label="知识库内容">
          <div className="product-knowledge-base-view-head"><h3>当前内容</h3><span>{initialContent.length}/5000</span></div>
          <div className="product-knowledge-base-content" data-testid="product-knowledge-base-content">{initialContent || '暂无知识库内容'}</div>
          {!initialContent && <p className="product-knowledge-base-hint">知识库内容会按商品单独保存，并提供给自动回复 Agent 查询商品时使用。</p>}
        </section> : <section className="product-knowledge-base-edit" aria-label="编辑知识库">
          <label htmlFor="product-knowledge-base-input">知识库内容</label>
          <TextAreaField id="product-knowledge-base-input" data-testid="product-knowledge-base-input" className="product-knowledge-base-textarea" value={draft} maxLength={5000} onChange={(event) => setDraft(event.target.value)} placeholder="例如：支持数字资料交付；付款后自动发送下载说明；只回答本商品相关问题。" autoFocus />
          <div className="product-knowledge-base-editor-meta"><span>仅用于商品相关问答，建议写清交付方式、适用范围和限制。</span><span>{draft.length}/5000</span></div>
        </section>}
      </div>
      <footer className="product-knowledge-base-footer">
        {mode === 'view' ? <><button className="btn ghost" type="button" onClick={requestClose}>关闭</button><button className="btn primary" type="button" data-testid="edit-product-knowledge-base" onClick={() => setMode('edit')}>编辑知识库</button></> : <><button className="btn ghost" type="button" onClick={requestClose} disabled={saving}>取消</button><button className="btn primary" type="button" data-testid="save-product-knowledge-base" onClick={() => void save()} disabled={saving}>{saving ? '保存中…' : '保存知识库'}</button></>}
      </footer>
      {confirmClose && <div className="product-knowledge-base-confirm" role="alertdialog" aria-modal="false" aria-label="确认放弃修改"><strong>还没有保存修改</strong><p>关闭后本次编辑内容会丢失。</p><div><button className="btn ghost" type="button" onClick={() => setConfirmClose(false)} disabled={saving}>继续编辑</button><button className="btn danger" type="button" onClick={onClose} disabled={saving}>放弃修改</button></div></div>}
    </aside>
  </div>;
}
