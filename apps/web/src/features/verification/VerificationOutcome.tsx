import { useState } from 'react';
import { Button } from '../../shared/ui/Button';
import { failureLabel, stateLabel, type VerificationSession } from './model';
import { useVerification } from './VerificationProvider';

export function VerificationOutcome({ session, onDismiss }: { session: VerificationSession; onDismiss?: () => void }) {
  const context = useVerification();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const succeeded = session.state === 'succeeded', partial = session.state === 'completed_partial';
  const retryable = ['failed', 'expired', 'cancelled'].includes(session.state)
    && !(session.state === 'cancelled' && session.subject.loginSessionId);
  const description = succeeded ? session.subject.loginSessionId ? '验证已完成，扫码登录流程将继续。' : '请以账号列表的实时连接状态为准。'
    : partial ? '请核对原操作结果，剩余事项需回到对应页面处理。'
    : session.state === 'cancelled' ? session.subject.loginSessionId ? '此次验证已取消，请关闭登录窗口后重新扫码。' : '此次验证已取消，账号状态未被标记为恢复。'
    : session.state === 'expired' && !session.failureCode ? '本次验证已超时，请重新获取验证画面。' : failureLabel(session.failureCode);
  return <section className="verification-panel is-finished" data-testid="verification-panel" data-state={session.state} aria-label="闲鱼验证操作区">
    <div className="verification-image verification-outcome">
      <div className="verification-outcome-copy" role="status">
        <span className={`verification-outcome-icon ${succeeded ? 'is-success' : partial || session.state === 'expired' ? 'is-warning' : 'is-neutral'}`} aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" />
            {succeeded ? <path d="m8 12 3 3 5-6" /> : <><path d="M12 7v6" /><path d="M12 17h.01" /></>}
          </svg>
        </span>
        <h3>{stateLabel(session.state)}</h3>
        <p>{description}</p>
      </div>
    </div>
    <VerificationSourceResults results={session.sourceResults} />
    {error && <p className="verification-error" role="alert">{error}</p>}
    <footer className="verification-footer">
      <p className="verification-footnote">验证完成不会自动重放发货、改价或消息发送操作。</p>
      <div className="modal-actions verification-actions">
        {onDismiss && <Button type="button" variant={succeeded || partial ? 'primary' : 'default'} disabled={busy} onClick={onDismiss}>{succeeded ? '完成' : '关闭'}</Button>}
        {retryable && context && <Button type="button" variant="primary" disabled={busy} onClick={() => {
          setBusy(true); setError('');
          void context.retry(session.subject).catch(() => setError('无法发起人工重试，请重新扫码授权。')).finally(() => setBusy(false));
        }}>{busy ? '正在准备…' : '我来重试'}</Button>}
      </div>
    </footer>
  </section>;
}

export function VerificationSourceResults({ results }: { results: VerificationSession['sourceResults'] }) {
  return results.length > 0 ? <ul className="verification-results">{results.map(result => <li key={result.source}>
    <span>{sourceLabel(result.source)}</span><span>{result.status === 'verified' ? '已验证' : result.status === 'probe_only' ? '请核对原操作' : result.status === 'superseded' ? '状态已更新' : '待处理'}</span>
    {result.nextAction && <small>{result.nextAction}</small>}
  </li>)}</ul> : null;
}

function sourceLabel(source: string) {
  if (/login.token|im_listener|^xianyu$/.test(source)) return '聊天连接';
  if (/item.list/.test(source)) return '商品列表';
  if (/sold.get|order/.test(source)) return '订单查询';
  return '原业务操作';
}
