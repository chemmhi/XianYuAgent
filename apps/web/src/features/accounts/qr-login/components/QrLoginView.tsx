import { qrStatusLabel, secondsUntilQrExpiry, type QrLoginModel } from '../model';

interface QrLoginViewProps {
  model: QrLoginModel;
  onStart: () => void;
  onRefresh: () => void;
  onRetry: () => void;
  onCancel: () => void;
}

export function QrLoginView({ model, onStart, onRefresh, onRetry, onCancel }: QrLoginViewProps) {
  const session = model.session;
  const busy = model.phase === 'creating';
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
      {!session && busy && <div className="qr-login-state"><div className="accounts-domain-skeleton"/><strong>正在生成二维码</strong><span>正在创建账号登录会话，请稍候。</span></div>}
      {!session && model.phase === 'idle' && <div className="qr-login-state"><strong>准备二维码登录</strong><span>二维码仅用于管理员授权，不会出现在买家消息或订单交付中。</span><button className="btn primary" type="button" onClick={onStart}>生成二维码</button></div>}
      {!session && model.phase === 'failed' && <div className="qr-login-state qr-login-error" role="alert"><strong>二维码生成失败</strong><span>{model.error?.message}</span><button className="btn primary" type="button" onClick={onRetry}>重新生成</button></div>}
      {session && <>
        <div className="qr-login-status-row"><span className={`badge ${badgeClass}`}>{qrStatusLabel(session.status)}</span><span className="qr-login-expiry">{terminal ? '' : `剩余 ${secondsUntilQrExpiry(session.expiresAt)} 秒`}</span></div>
        <div className="qr-login-code">
          {session.qrImageDataUrl ? <img src={session.qrImageDataUrl} alt="闲鱼二维码登录"/> : <div className="qr-login-placeholder"><strong>二维码暂不可用</strong><span>请点击重新生成，或打开验证链接。</span></div>}
        </div>
        {session.verificationUrl && <a className="qr-login-link" href={session.verificationUrl} target="_blank" rel="noreferrer">在新窗口打开验证链接</a>}
        {session.status === 'verification_required' && <div className="qr-login-error" role="alert"><strong>需要完成人工验证</strong><span>闲鱼已要求额外验证。完成验证后请重新扫码，系统不会伪造登录成功。</span></div>}
        {session.errorCode && session.status !== 'verification_required' && <div className="qr-login-error" role="alert"><strong>登录状态异常</strong><span>{session.errorCode}</span></div>}
        {session.status === 'succeeded' && <div className="qr-login-success" role="status"><strong>账号已重新连接</strong><span>凭证已由服务端保存并完成登录态校验。</span></div>}
        <div className="qr-login-actions">
          {!terminal && <button className="btn ghost" type="button" onClick={onRefresh}>立即刷新状态</button>}
          {terminal && session.status !== 'succeeded' && <button className="btn primary" type="button" onClick={onRetry}>重新生成二维码</button>}
          {!terminal && <button className="btn danger" type="button" onClick={onCancel}>取消登录</button>}
        </div>
      </>}
    </div>
  );
}
