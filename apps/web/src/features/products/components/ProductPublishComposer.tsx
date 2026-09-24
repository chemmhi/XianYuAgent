import { useEffect, useRef, useState } from 'react';
import { clipboardImageFiles, fileIdentityKey, isImageFile } from '../../messages/attachments';
import type { PublishAttachment } from '../product-publish';
import { TextAreaField } from '../../../shared/ui/TextAreaField';

const MAX_IMAGES = 9;

function createId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `publish-image-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function ProductPublishComposer({ description, attachments, disabled, optimizing, onDescriptionChange, onAttachmentsChange, onOptimize }: {
  description: string;
  attachments: PublishAttachment[];
  disabled?: boolean;
  optimizing?: boolean;
  onDescriptionChange: (value: string) => void;
  onAttachmentsChange: (attachments: PublishAttachment[]) => void;
  onOptimize: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const attachmentsRef = useRef(attachments);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => { attachmentsRef.current = attachments; }, [attachments]);
  useEffect(() => () => {
    for (const attachment of attachmentsRef.current) if (attachment.file && attachment.url.startsWith('blob:')) URL.revokeObjectURL(attachment.url);
  }, []);

  function appendFiles(files: readonly (File | null | undefined)[]) {
    const known = new Set(attachments.map((item) => item.file ? fileIdentityKey(item.file) : `${item.name}\u0000${item.size ?? 0}\u0000${item.mimeType}`));
    const next = [...attachments];
    for (const file of files) {
      if (!isImageFile(file) || next.length >= MAX_IMAGES) continue;
      const key = fileIdentityKey(file);
      if (known.has(key)) continue;
      known.add(key);
      next.push({ id: createId(), file, url: URL.createObjectURL(file), name: file.name, mimeType: file.type, size: file.size });
    }
    onAttachmentsChange(next);
  }

  function removeAttachment(id: string) {
    const removed = attachments.find((item) => item.id === id);
    if (removed?.file && removed.url.startsWith('blob:')) URL.revokeObjectURL(removed.url);
    if (previewUrl === removed?.url) setPreviewUrl(null);
    onAttachmentsChange(attachments.filter((item) => item.id !== id));
  }

  return <>
    <div className="product-publish-composer" data-testid="product-publish-composer">
      {attachments.length > 0 && <div className="product-publish-attachments" aria-label="商品图片附件">
        {attachments.map((attachment, index) => <div className="product-publish-attachment" key={attachment.id}>
          <button className="product-publish-attachment-trigger" type="button" aria-label={`预览商品图片 ${index + 1}`} onClick={() => setPreviewUrl(attachment.url)} disabled={disabled}>
            <img src={attachment.url} alt={attachment.name || `商品图片 ${index + 1}`} />
          </button>
          <button className="product-publish-attachment-remove" type="button" aria-label={`移除商品图片 ${index + 1}`} onClick={() => removeAttachment(attachment.id)} disabled={disabled}>×</button>
        </div>)}
      </div>}
      <div className="product-publish-composer-editor"><TextAreaField aria-label="商品描述" className="product-publish-description-control" value={description} maxLength={2000} disabled={disabled} placeholder="像聊天一样输入商品描述，支持直接上传或粘贴图片。" onChange={(event) => onDescriptionChange(event.target.value)} onPaste={(event) => { const files = clipboardImageFiles(event.clipboardData); if (files.length === 0) return; event.preventDefault(); appendFiles(files); }} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) event.preventDefault(); }} /></div>
      <div className="product-publish-composer-footer">
        <div className="product-publish-composer-tools">
          <button className="product-publish-upload" type="button" aria-label="添加商品图片" onClick={() => inputRef.current?.click()} disabled={disabled || attachments.length >= MAX_IMAGES}>+</button>
          <input ref={inputRef} className="product-publish-file-input" type="file" accept="image/*" multiple onChange={(event) => { appendFiles(Array.from(event.target.files ?? [])); event.currentTarget.value = ''; }} />
          <span>按 Enter 换行</span>
          <span className="product-publish-media-meta">图片 {attachments.length} / {MAX_IMAGES} · 支持粘贴</span>
        </div>
        <div className="product-publish-composer-actions"><span>{description.length} / 2000</span><button className="product-publish-ai-button" type="button" onClick={onOptimize} disabled={disabled || optimizing}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 1.4 4.6L18 9l-4.6 1.4L12 15l-1.4-4.6L6 9l4.6-1.4Z" /><path d="m18.5 14 .7 2.3 2.3.7-2.3.7-.7 2.3-.7-2.3-2.3-.7Z" /></svg>{optimizing ? '优化中…' : 'AI 优化文案'}</button></div>
      </div>
    </div>
    {previewUrl && <div className="product-publish-lightbox" role="dialog" aria-modal="true" aria-label="商品图片预览" onClick={() => setPreviewUrl(null)}><div className="product-publish-lightbox-panel" onClick={(event) => event.stopPropagation()}><button className="product-publish-lightbox-close" type="button" aria-label="关闭图片预览" onClick={() => setPreviewUrl(null)}>×</button><img src={previewUrl} alt="商品图片大图预览" /></div></div>}
  </>;
}
