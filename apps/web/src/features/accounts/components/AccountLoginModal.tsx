import { useEffect, useState } from 'react';
import type { AccountsApi } from '../api';
import type { AccountVM } from '../types';
import { useQrLoginController } from '../qr-login/controller';
import { QrLoginView } from '../qr-login/components/QrLoginView';
import { LoginMethodSelector, type AccountLoginMethod } from './LoginMethodSelector';
import { CookieLoginForm } from './CookieLoginForm';
import { PasswordLoginForm } from './PasswordLoginForm';

export function AccountLoginModal({ api, account, onClose, onCompleted }: { api: AccountsApi; account?: AccountVM; onClose: () => void; onCompleted: () => void }) {
  const [method, setMethod] = useState<AccountLoginMethod>('qr');
  const qrController = useQrLoginController({ api, accountId: account?.id, enabled: method === 'qr' });

  useEffect(() => {
    if (method === 'qr' && qrController.model.phase === 'idle') void qrController.start();
  }, [method, qrController.model.phase, qrController.start]);

  useEffect(() => {
    if (qrController.model.phase === 'succeeded') {
      const timer = window.setTimeout(onCompleted, 700);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [onCompleted, qrController.model.phase]);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="modal-card account-login-modal" role="dialog" aria-modal="true" aria-labelledby="account-login-title">
        <header className="modal-head">
          <div><p className="eyebrow">Xianyu Account</p><h2 id="account-login-title">{account ? '重新授权闲鱼账号' : '添加闲鱼账号'}</h2><p>直接选择登录方式。账号创建、凭证保存和资料同步均由服务端完成。</p></div>
          <button className="icon-button" type="button" aria-label="关闭登录弹窗" onClick={onClose}>×</button>
        </header>
        {!account && <LoginMethodSelector value={method} onChange={setMethod} />}
        <div className="account-login-body">
          {method === 'qr' && <QrLoginView model={qrController.model} onStart={qrController.start} onRefresh={qrController.refresh} onRetry={qrController.retry} onCancel={qrController.cancel} />}
          {method === 'cookie' && <CookieLoginForm api={api} onCompleted={onCompleted} />}
          {method === 'password' && <PasswordLoginForm api={api} onCompleted={onCompleted} />}
        </div>
        <div className="card-actions"><button className="btn ghost" type="button" onClick={onClose}>关闭</button></div>
      </section>
    </div>
  );
}
