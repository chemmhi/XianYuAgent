import { Form } from '../../../shared/ui/Form';
import { useState, type FormEvent } from 'react';
import type { AccountsApi } from '../api';
import { TextAreaField } from '../../../shared/ui/TextAreaField';
import { Button } from '../../../shared/ui/Button';
import { useToast } from '../../../shared/ui/ToastProvider';
import { accountErrorMessage } from '../feedback';

export function CookieLoginForm({ api, existingAccountId, onCompleted }: { api: AccountsApi; existingAccountId?: string; onCompleted: () => void }) {
  const existingAccount = Boolean(existingAccountId);
  const [cookieHeader, setCookieHeader] = useState('');
  const [phase, setPhase] = useState<'idle' | 'submitting' | 'error'>('idle');
  const { showToast, dismissToast } = useToast();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPhase('submitting');
    dismissToast('account-cookie-login');
    try {
      await api.loginWithCookie({ cookieHeader: cookieHeader.trim(), ...(existingAccountId ? { accountId: existingAccountId } : {}) });
      onCompleted();
    } catch (cause) {
      setPhase('error');
      showToast({ id: 'account-cookie-login', tone: 'error', message: accountErrorMessage(cause, 'Cookie 登录失败，请检查 Cookie 是否完整且未过期。') });
    }
  }

  return (
    <Form className="account-login-form" onSubmit={submit}>
      <TextAreaField label="完整 Cookie" required value={cookieHeader} onChange={(event) => setCookieHeader(event.target.value)} placeholder="粘贴浏览器开发者工具中复制的完整 Cookie" rows={6} autoFocus />
      <p className="account-login-hint">Cookie 只提交到服务端验证，不会回显给买家；{existingAccount ? '通过滑块后请重新复制该账号的最新完整 Cookie，用于更新当前账号凭证。' : '登录成功后昵称、备注和头像由闲鱼资料接口返回。'}</p>
      <div className="modal-actions"><Button variant="primary" type="submit" disabled={phase === 'submitting'}>{phase === 'submitting' ? '验证中…' : existingAccount ? '验证 Cookie 并更新账号' : '验证 Cookie 并添加账号'}</Button></div>
    </Form>
  );
}
