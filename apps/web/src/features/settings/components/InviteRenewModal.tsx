import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Button } from '../../../shared/ui/Button';
import { InputField } from '../../../shared/ui/InputField';
import { useToast } from '../../../shared/ui/ToastProvider';
import type { InviteVM } from '../api';

export function InviteRenewModal({ invite, onClose, onRenew }: {
  invite: InviteVM;
  onClose: () => void;
  onRenew: (days: number) => Promise<void>;
}) {
  const [days, setDays] = useState('7');
  const [busy, setBusy] = useState(false);
  const { showToast, dismissToast } = useToast();
  const [invalid, setInvalid] = useState(false);
  const notify = (message: string) => showToast({ id: 'invite-renew-error', tone: 'error', message });
  const formRef = useRef<HTMLFormElement>(null);
  const submitting = useRef(false);

  useEffect(() => {
    const previous = document.activeElement;
    formRef.current?.querySelector('input')?.focus();
    return () => { dismissToast('invite-renew-error'); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, [dismissToast]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    const value = Number(days);
    if (!Number.isInteger(value) || value < 1 || value > 365) {
      setInvalid(true);
      return;
    }
    submitting.current = true;
    setBusy(true);
    setInvalid(false);
    dismissToast('invite-renew-error');
    try { await onRenew(value); onClose(); }
    catch (error) { notify(error instanceof Error ? error.message : '续期失败，请重试'); }
    finally { submitting.current = false; setBusy(false); }
  }

  function keyDown(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key === 'Escape' && !submitting.current) { event.preventDefault(); onClose(); }
    if (event.key !== 'Tab') return;
    const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)')];
    const first = controls[0], last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }

  return <div className="modal-backdrop" role="presentation" onMouseDown={event => {
    if (event.target === event.currentTarget && !submitting.current) onClose();
  }}>
    <form ref={formRef} className="card modal-card settings-editor invite-renew-modal" role="dialog" aria-modal="true" aria-labelledby="invite-renew-title" aria-describedby="invite-renew-description" aria-busy={busy} onSubmit={event => void submit(event)} onKeyDown={keyDown} noValidate>
      <div className="modal-head">
        <div><p className="eyebrow">Invitation Codes</p><h2 id="invite-renew-title">续期邀请码</h2><p id="invite-renew-description">设置从今天起的有效天数，确认后更新到期日期。</p></div>
        <button className="icon-button" type="button" aria-label="关闭续期弹窗" disabled={busy} onClick={onClose}>×</button>
      </div>
      <div className="invite-renew-summary"><span>邀请码 <code>{invite.code}</code></span><span>当前到期日期 <strong>{new Date(invite.expiresAt).toLocaleDateString()}</strong></span></div>
      <InputField fieldClassName="invite-renew-days" error={invalid ? <span id="invite-renew-days-error">有效天数必须是 1-365 的整数</span> : undefined} aria-describedby={invalid ? 'invite-renew-days-error' : undefined} label="有效天数" aria-label="有效天数" type="number" min="1" max="365" step="1" value={days} disabled={busy} aria-invalid={invalid || undefined} onChange={event => { setDays(event.target.value); setInvalid(false); dismissToast('invite-renew-error'); }} hint="可填写 1-365 天" />
      <div className="modal-actions"><Button variant="ghost" type="button" disabled={busy} onClick={onClose}>取消</Button><Button variant="primary" type="submit" disabled={busy}>{busy ? '保存中…' : '确认续期'}</Button></div>
    </form>
  </div>;
}
