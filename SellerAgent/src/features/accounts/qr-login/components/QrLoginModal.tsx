import type { AccountVM } from '../../types';
import type { QrLoginController } from '../controller';
import { QrLoginView } from './QrLoginView';

interface QrLoginModalProps {
  account: AccountVM;
  controller: QrLoginController;
  onClose: () => void;
}

export function QrLoginModal({ account, controller, onClose }: QrLoginModalProps) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={`二维码登录：${account.displayName}`} onMouseDown={onClose}>
      <section className="modal-card card qr-login-modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-head"><div><p className="eyebrow">QR Login</p><h2>扫码授权账号</h2></div><span className="badge badge-info">管理员操作</span></div>
        <QrLoginView account={account} model={controller.model} onStart={controller.start} onRefresh={controller.refresh} onRetry={controller.retry} onCancel={controller.cancel}/>
        <div className="card-actions"><button className="btn ghost" type="button" onClick={onClose}>关闭</button></div>
      </section>
    </div>
  );
}

