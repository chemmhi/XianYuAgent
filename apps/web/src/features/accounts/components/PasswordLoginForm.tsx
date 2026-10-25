import { Form } from '../../../shared/ui/Form';
import { useState, type FormEvent } from 'react';
import type { AccountsApi } from '../api';
import { InputField } from '../../../shared/ui/InputField';
import { Button } from '../../../shared/ui/Button';
import { useToast } from '../../../shared/ui/ToastProvider';
import { accountErrorMessage } from '../feedback';

export function PasswordLoginForm({ api, onCompleted }: { api: AccountsApi; onCompleted: () => void }) {
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [phase, setPhase] = useState<'idle' | 'submitting' | 'error'>('idle');
  const { showToast, dismissToast } = useToast();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPhase('submitting');
    dismissToast('account-password-login');
    try {
      await api.loginWithPassword({ account: account.trim(), password });
      onCompleted();
    } catch (cause) {
      setPhase('error');
      showToast({ id: 'account-password-login', tone: 'error', message: accountErrorMessage(cause, '账号密码登录失败，请稍后重试。') });
    }
  }

  return (
    <Form className="account-login-form" onSubmit={submit}>
      <InputField label="闲鱼账号" required value={account} onChange={(event) => setAccount(event.target.value)} placeholder="手机号或用户名" autoFocus />
      <InputField label="密码" required type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="请输入密码" />
      <p className="account-login-hint">账号密码登录由后端适配器处理；若闲鱼要求人脸或验证码，界面会保留明确的验证失败状态，不会伪造成功。</p>
      <div className="modal-actions"><Button variant="primary" type="submit" disabled={phase === 'submitting'}>{phase === 'submitting' ? '提交中…' : '登录并添加账号'}</Button></div>
    </Form>
  );
}
