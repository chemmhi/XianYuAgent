import { useEffect, useState } from 'react';
import type { ProductKnowledgeBaseActionVM } from '../api';
import type { ProductMutationError, ProductVM } from '../types';
import { TextAreaField } from '../../../shared/ui/TextAreaField';

export function ProductKnowledgeBaseModal({ product, saving, error, onClose, onSave, onGenerateFromConversations, onOptimizeKnowledgeBase }: {
  product: ProductVM;
  saving: boolean;
  error: ProductMutationError | null;
  onClose: () => void;
  onSave: (knowledgeBase: string) => Promise<boolean>;
  onGenerateFromConversations?: (product: ProductVM) => Promise<ProductKnowledgeBaseActionVM | null>;
  onOptimizeKnowledgeBase?: (product: ProductVM) => Promise<ProductKnowledgeBaseActionVM | null>;
}) {
  const initialContent = product.knowledgeBase ?? '';
  const [baseContent, setBaseContent] = useState(initialContent);
  const [mode, setMode] = useState<'view' | 'edit'>(initialContent.trim() ? 'view' : 'edit');
  const [draft, setDraft] = useState(initialContent);
  const [confirmClose, setConfirmClose] = useState(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  useEffect(() => {
    const nextContent = product.knowledgeBase ?? '';
    setBaseContent(nextContent);
    setDraft(nextContent);
    setMode(nextContent.trim() ? 'view' : 'edit');
    setConfirmClose(false);
    setActionNotice(null);
  }, [product.id, product.knowledgeBase]);

  const dirty = mode === 'edit' && draft !== baseContent;
  const requestClose = () => {
    if (dirty) setConfirmClose(true);
    else onClose();
  };

  const save = async () => {
    if (saving) return;
    const ok = await onSave(draft);
    if (ok) onClose();
  };

  const generateFromConversations = async () => {
    if (saving || dirty) return;
    const result = await onGenerateFromConversations?.(product);
    if (!result) return;
    const nextContent = result.product.knowledgeBase ?? '';
    setBaseContent(nextContent);
    setDraft(nextContent);
    setMode('edit');
    setActionNotice(result.changed ? `已整理 ${result.questionCount} 个高频问题，并追加 ${result.humanReplyCount} 条人工回复。` : '没有发现需要追加的新内容。');
  };

  const optimizeKnowledgeBase = async () => {
    if (saving || dirty) return;
    const result = await onOptimizeKnowledgeBase?.(product);
    if (!result) return;
    const nextContent = result.product.knowledgeBase ?? '';
    setBaseContent(nextContent);
    setDraft(nextContent);
    setMode('edit');
    setActionNotice(result.changed ? '知识库已去重、拆分并修正。' : '当前知识库已经是可用结构。');
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
      {actionNotice && <div className="product-knowledge-base-notice" role="status">{actionNotice}</div>}
      <div className="product-knowledge-base-body">
        {mode === 'view' ? <section className="product-knowledge-base-view" aria-label="知识库内容">
          <div className="product-knowledge-base-view-head"><h3>当前内容</h3><span>{baseContent.length}/5000</span></div>
          <div className="product-knowledge-base-content" data-testid="product-knowledge-base-content">{baseContent || '暂无知识库内容'}</div>
          {!baseContent && <p className="product-knowledge-base-hint">知识库内容会按商品单独保存，并提供给自动回复 Agent 查询商品时使用。</p>}
        </section> : <section className="product-knowledge-base-edit" aria-label="编辑知识库">
          <label htmlFor="product-knowledge-base-input">知识库内容</label>
          <TextAreaField id="product-knowledge-base-input" data-testid="product-knowledge-base-input" className="product-knowledge-base-textarea" value={draft} maxLength={5000} onChange={(event) => setDraft(event.target.value)} placeholder="例如：支持数字资料交付；付款后自动发送下载说明；只回答本商品相关问题。" autoFocus />
          <div className="product-knowledge-base-editor-meta"><span>{dirty ? '请先保存当前修改，再使用对话整理或优化。' : '仅用于商品相关问答，建议写清交付方式、适用范围和限制。'}</span><span>{draft.length}/5000</span></div>
        </section>}
      </div>
      <footer className="product-knowledge-base-footer">
        {mode === 'view' ? <><button className="btn ghost" type="button" onClick={requestClose}>关闭</button><button className="btn primary" type="button" data-testid="edit-product-knowledge-base" onClick={() => { setActionNotice(null); setMode('edit'); }}>编辑知识库</button></> : <><button className="btn ghost" type="button" data-testid="generate-product-knowledge-base" onClick={() => void generateFromConversations()} disabled={saving || dirty}>{saving ? '整理中…' : '从对话整理'}</button><button className="btn ghost" type="button" data-testid="optimize-product-knowledge-base" onClick={() => void optimizeKnowledgeBase()} disabled={saving || dirty || !draft.trim()}>{saving ? '优化中…' : '优化知识库'}</button><button className="btn ghost" type="button" onClick={requestClose} disabled={saving}>取消</button><button className="btn primary" type="button" data-testid="save-product-knowledge-base" onClick={() => void save()} disabled={saving}>{saving ? '保存中…' : '保存知识库'}</button></>}
      </footer>
      {confirmClose && <div className="product-knowledge-base-confirm" role="alertdialog" aria-modal="false" aria-label="确认放弃修改"><strong>还没有保存修改</strong><p>关闭后本次编辑内容会丢失。</p><div><button className="btn ghost" type="button" onClick={() => setConfirmClose(false)} disabled={saving}>继续编辑</button><button className="btn danger" type="button" onClick={onClose} disabled={saving}>放弃修改</button></div></div>}
    </aside>
  </div>;
}
