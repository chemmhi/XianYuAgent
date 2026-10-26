import { useState } from 'react';
import { useVerification } from './VerificationProvider';
import { Button } from '../../shared/ui/Button';
/** QR and global presentation share the same server release barrier. */
export function useVerificationClose(loginSessionId: string | undefined, onClose: () => void) {
  const context = useVerification(); const [confirm, setConfirm] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const controlled = loginSessionId ? context?.sessions.find(row => row.subject.loginSessionId === loginSessionId && row.state === 'human_active' && row.controller?.clientId === context.clientId) : undefined;
  const handsToSystem = controlled?.autoAllowed === true && controlled.presentationKind !== 'native_iframe';
  return {
    requestClose: () => { if (controlled) setConfirm(true); else onClose(); },
    confirmation: confirm && <div className="verification-close-confirm" role="alertdialog" aria-label="交接人工验证"><p>{handsToSystem ? '交给系统后再关闭登录窗口？' : '结束本次人工验证并关闭登录窗口？本轮将停止。'}</p><div className="modal-actions verification-actions">
      <Button variant="ghost" type="button" disabled={busy} onClick={() => setConfirm(false)}>继续人工操作</Button><Button variant="primary" type="button" disabled={busy} onClick={() => {
        if (!controlled || !context) { setConfirm(false); onClose(); return; }
        setBusy(true); setError(''); void context.releaseSession(controlled.id).then(() => { setConfirm(false); onClose(); }).catch(() => setError('交接未完成，请等待连接状态更新。')).finally(() => setBusy(false));
      }}>{busy ? '正在结束…' : handsToSystem ? '交给系统并关闭' : '结束人工并关闭'}</Button>
    </div>{error && <p role="alert">{error}</p>}</div>,
  };
}
