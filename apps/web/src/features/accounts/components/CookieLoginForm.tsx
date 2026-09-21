import { useState, type FormEvent } from 'react';
import type { AccountsApi } from '../api';
import { TextAreaField } from '../../../shared/ui/TextAreaField';
import { Button } from '../../../shared/ui/Button';

export function CookieLoginForm({ api, onCompleted }: { api: AccountsApi; onCompleted: () => void }) {
  const [cookieHeader, setCookieHeader] = useState('');
  const [phase, setPhase] = useState<'idle' | 'submitting' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!cookieHeader.trim()) {
      setPhase('error');
      setError('请粘贴完整 Cookie');
      return;
    }
    setPhase('submitting');
    setError(null);
    try {
      await api.loginWithCookie({ cookieHeader: cookieHeader.trim() });
      onCompleted();
    } catch (cause) {
      setPhase('error');
      setError(cause instanceof Error ? cause.message : 'Cookie 登录失败，请检查 Cookie 是否完整且未过期');
    }
  }

  return (
    <form className="account-login-form" onSubmit={submit}>
      <TextAreaField label="完整 Cookie" value={cookieHeader} onChange={(event) => setCookieHeader(event.target.value)} placeholder="粘贴浏览器开发者工具中复制的完整 Cookie" rows={6} autoFocus />
      <p className="account-login-hint">Cookie 只提交到服务端验证，不会回显给买家；登录成功后昵称、备注和头像由闲鱼资料接口返回。</p>
      {error && <div className="inline-error" role="alert">{error}</div>}
      <div className="modal-actions"><Button variant="primary" type="submit" disabled={phase === 'submitting'}>{phase === 'submitting' ? '验证中…' : '验证 Cookie 并添加账号'}</Button></div>
    </form>
  );
}
