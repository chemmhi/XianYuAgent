import { Form } from '../../../shared/ui/Form';
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Button } from '../../../shared/ui/Button';
import { InputField } from '../../../shared/ui/InputField';
import { useToast } from '../../../shared/ui/ToastProvider';
import type { InviteVM } from '../api';

export function InviteDeleteModal({ invite, onClose, onDelete }: {
  invite: InviteVM;
  onClose: () => void;
  onDelete: () => Promise<void>;
}) {
  const used = invite.status === 'used' || Boolean(invite.usedAt);
  const [finalStep, setFinalStep] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const { showToast, dismissToast } = useToast();
  const target = invite.usedByEmail || invite.code || invite.id;

  useEffect(() => {
    const previous = document.activeElement;
    return () => { dismissToast('invite-delete-error'); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, [dismissToast]);
  useEffect(() => { formRef.current?.querySelector<HTMLElement>(finalStep ? 'input' : '[data-delete-cancel]')?.focus(); }, [finalStep]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    if (used && !finalStep) { setFinalStep(true); return; }
    if (used && confirmation.trim() !== target) { setInvalid(true); return; }
    submitting.current = true;
    setBusy(true);
    dismissToast('invite-delete-error');
    try { await onDelete(); onClose(); }
    catch (error) { showToast({ id: 'invite-delete-error', tone: 'error', message: error instanceof Error ? error.message : '删除失败，请重试' }); }
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

  return <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !submitting.current) onClose(); }}>
    <Form ref={formRef} className="card modal-card settings-editor invite-delete-modal" role="dialog" aria-modal="true" aria-labelledby="invite-delete-title" aria-describedby="invite-delete-description" aria-busy={busy} noValidate onSubmit={event => void submit(event)} onKeyDown={keyDown}>
      <div className="modal-head"><div><p className="eyebrow">Invitation Codes</p><h2 id="invite-delete-title">{finalStep ? '确认清空用户数据' : '删除邀请码'}</h2><p id="invite-delete-description">{used ? '此邀请码已激活账号，删除会同时删除该用户及其全部专属数据。' : '删除后，此邀请码将无法用于注册。'}</p></div><button className="icon-button" type="button" aria-label="关闭删除邀请码弹窗" disabled={busy} onClick={onClose}>×</button></div>
      <div className="invite-delete-warning" role="note"><strong>{used ? '危险操作，数据无法恢复' : '请确认删除'}</strong><p>{used ? '该用户的闲鱼账号、商品、卡券、Workspace 会话和个人配置将被清除，其他用户的数据不受影响。' : '已删除的邀请码无法恢复，需要重新生成。'}</p></div>
      <div className="invite-renew-summary"><span>邀请码 <code>{invite.code}</code></span>{used && <span>激活账号 <strong>{invite.usedByEmail || invite.usedByDisplayName || '已激活用户'}</strong></span>}</div>
      {finalStep && <InputField label={invite.usedByEmail ? '输入激活账号邮箱确认' : '输入邀请码确认'} aria-label="删除确认内容" value={confirmation} onChange={event => { setConfirmation(event.target.value); setInvalid(false); }} disabled={busy} required error={invalid ? '输入内容不匹配，请重新确认' : undefined} hint={`请输入 ${target}`} aria-invalid={invalid || undefined} />}
      <div className="modal-actions"><Button variant="ghost" type="button" data-delete-cancel disabled={busy} onClick={onClose}>取消</Button><Button variant="danger" type="submit" disabled={busy}>{busy ? '删除中…' : used && !finalStep ? '继续删除' : used ? '删除账号并清空数据' : '确认删除'}</Button></div>
    </Form>
  </div>;
}
