import { useEffect, useRef } from 'react';
import type { AccountVM } from '../../types';
import type { QrLoginController } from '../controller';
import { QrLoginView } from './QrLoginView';

interface QrLoginModalProps {
  account: AccountVM;
  controller: QrLoginController;
  onClose: () => void;
}

export function QrLoginModal({ account, controller, onClose }: QrLoginModalProps) {
  const autoStartedRef = useRef(false);

  useEffect(() => {
    if (!autoStartedRef.current && controller.model.phase === 'idle') {
      autoStartedRef.current = true;
      void controller.start();
    }
  }, [controller.model.phase, controller.start]);

  return (
    <div className="modal-backdrop account-modal-backdrop" role="dialog" aria-modal="true" aria-label={`二维码登录：${account.displayName}`} onMouseDown={onClose}>
      <section className="modal-card card qr-login-modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-head"><div><p className="eyebrow">QR Login</p><h2>扫码授权账号</h2></div><div className="modal-head-actions"><span className="badge badge-info">管理员操作</span><button className="icon-button" type="button" aria-label="关闭二维码登录弹窗" onClick={onClose}>×</button></div></div>
        <QrLoginView model={controller.model}/>
      </section>
    </div>
  );
}
