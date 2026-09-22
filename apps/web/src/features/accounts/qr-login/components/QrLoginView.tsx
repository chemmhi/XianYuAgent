import { qrStatusLabel, secondsUntilQrExpiry, type QrLoginModel } from '../model';

interface QrLoginViewProps {
  model: QrLoginModel;
}

export function QrLoginView({ model }: QrLoginViewProps) {
  const session = model.session;
  const terminal = ['succeeded', 'expired', 'failed', 'cancelled', 'verification_required'].includes(model.phase);
  const badgeClass = session?.status === 'succeeded'
    ? 'badge-ok'
    : session?.status === 'failed' || session?.status === 'expired'
      ? 'badge-danger'
      : session?.status === 'verification_required'
        ? 'badge-warn'
        : 'badge-info';

  return (
    <div className="qr-login-view">
      <div className={`qr-login-status-row${session ? '' : ' qr-login-status-row-placeholder'}`} aria-hidden={session ? undefined : true}>
        <span className={`badge ${session ? badgeClass : 'badge-info'}`}>{session ? qrStatusLabel(session.status) : '等待扫码'}</span>
        <span className="qr-login-expiry">{session ? (terminal ? '' : `二维码有效期 ${formatQrExpiry(secondsUntilQrExpiry(session.expiresAt))}`) : '二维码有效期 00:00'}</span>
      </div>
      {!session && (model.phase === 'creating' || model.phase === 'idle') && <div className="qr-login-code qr-login-code-loading" role="status" aria-live="polite"><div className="qr-login-loading-content"><span className="qr-login-spinner" aria-hidden="true"/><strong>{model.phase === 'creating' ? '正在生成二维码' : '准备二维码登录'}</strong><span>{model.phase === 'creating' ? '正在创建账号登录会话，请稍候。' : '二维码会在弹窗打开后自动生成。'}</span></div></div>}
      {!session && model.phase === 'failed' && <div className="qr-login-code qr-login-code-loading qr-login-error" role="alert"><div className="qr-login-loading-content"><strong>二维码生成失败</strong><span>{model.error?.message}</span><span>请关闭弹窗后重新打开以重试。</span></div></div>}
      {session && <>
        <div className="qr-login-code">
          {session.qrImageDataUrl ? <><img src={session.qrImageDataUrl} alt="闲鱼二维码登录"/><span className="qr-login-help">打开闲鱼 App → 扫一扫</span><span className="qr-login-note">请勿截屏或转发二维码</span></> : <div className="qr-login-placeholder"><strong>二维码暂不可用</strong><span>请关闭弹窗后重新打开。</span></div>}
        </div>
        {session.verificationUrl && <a className="qr-login-link" href={session.verificationUrl} target="_blank" rel="noreferrer">在新窗口打开验证链接</a>}
        {session.status === 'verification_required' && <div className="qr-login-error" role="alert"><strong>需要完成人工验证</strong><span>闲鱼已要求额外验证。完成验证后请重新扫码，系统不会伪造登录成功。</span></div>}
        {session.errorCode && session.status !== 'verification_required' && <div className="qr-login-error" role="alert"><strong>登录状态异常</strong><span>{session.errorCode}</span></div>}
        {session.status === 'succeeded' && <div className="qr-login-success" role="status"><strong>账号已重新连接</strong><span>凭证已由服务端保存并完成登录态校验。</span></div>}
      </>}
    </div>
  );
}

function formatQrExpiry(seconds: number): string {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, '0');
  const remainingSeconds = Math.max(0, seconds % 60).toString().padStart(2, '0');
  return `${minutes}:${remainingSeconds}`;
}
