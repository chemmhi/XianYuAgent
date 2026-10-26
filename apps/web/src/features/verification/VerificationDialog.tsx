import { useEffect, useRef, type ReactNode } from 'react';

export function VerificationDialog({ title, onClose, children }: { title: string; onClose(): void; children: ReactNode }) {
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  return <div className="modal-backdrop verification-backdrop" role="presentation"><section ref={dialog} className="modal-card card verification-modal" role="dialog" aria-modal="true" aria-label="账号安全验证" onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); onClose(); }
    if (event.key !== 'Tab') return;
    const controls = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),[href],input:not(:disabled),[tabindex="0"]') ?? [])].filter(element => element.getClientRects().length > 0);
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }}>
    <header className="modal-head"><div><p className="eyebrow">账号安全验证</p><h2>{title}</h2></div><button type="button" className="icon-button" aria-label="收起验证弹窗" onClick={onClose}>×</button></header>
    <div className="verification-modal-body">{children}</div>
  </section></div>;
}
