import { useEffect, useRef, useState } from 'react';
import type { AccountsApi } from '../api';
import type { AccountVM } from '../types';
import { useQrLoginController } from '../qr-login/controller';
import { QrLoginView } from '../qr-login/components/QrLoginView';
import { LoginMethodSelector, type AccountLoginMethod } from './LoginMethodSelector';
import { CookieLoginForm } from './CookieLoginForm';
import { PasswordLoginForm } from './PasswordLoginForm';

export function AccountLoginModal({ api, account, initialMethod = 'qr', onClose, onCompleted, onStatusChanged }: { api: AccountsApi; account?: AccountVM; initialMethod?: AccountLoginMethod; onClose: () => void; onCompleted: () => void; onStatusChanged?: () => void }) {
  const [method, setMethod] = useState<AccountLoginMethod>(initialMethod);
  const qrController = useQrLoginController({ api, accountId: account?.id, enabled: method === 'qr' });
  const autoStartedRef = useRef(false);

  useEffect(() => {
    if (method !== 'qr') {
      autoStartedRef.current = false;
      return;
    }
    if (!autoStartedRef.current && qrController.model.phase === 'idle') {
      autoStartedRef.current = true;
      void qrController.start();
    }
  }, [method, qrController.model.phase, qrController.start]);

  useEffect(() => {
    if (qrController.model.phase === 'succeeded') {
      const timer = window.setTimeout(onCompleted, 700);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [onCompleted, qrController.model.phase]);

  const lastNotifiedPhaseRef = useRef<string | null>(null);
  useEffect(() => {
    const phase = qrController.model.phase;
    if (!['failed', 'expired', 'verification_required'].includes(phase) || lastNotifiedPhaseRef.current === phase) return;
    lastNotifiedPhaseRef.current = phase;
    onStatusChanged?.();
  }, [onStatusChanged, qrController.model.phase]);

  return (
    <div className="modal-backdrop account-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="modal-card account-login-modal" role="dialog" aria-modal="true" aria-labelledby="account-login-title">
        <header className="modal-head">
          <div><p className="eyebrow">Xianyu Account</p><h2 id="account-login-title">{account ? '重新授权闲鱼账号' : '添加闲鱼账号'}</h2><p>使用以下任一方式登录，登录后会自动同步账号资料。</p></div>
          <button className="icon-button" type="button" aria-label="关闭登录弹窗" onClick={onClose}>×</button>
        </header>
        <LoginMethodSelector value={method} onChange={setMethod} />
        <div className="account-login-body">
          {method === 'qr' && <QrLoginView model={qrController.model} />}
          {method === 'cookie' && <CookieLoginForm api={api} existingAccountId={account?.id} onCompleted={onCompleted} />}
          {method === 'password' && <PasswordLoginForm api={api} onCompleted={onCompleted} />}
        </div>
      </section>
    </div>
  );
}
