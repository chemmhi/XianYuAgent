import { useState, type FormEvent } from 'react';
import type { AccountsApi } from '../api';
import { InputField } from '../../../shared/ui/InputField';
import { Button } from '../../../shared/ui/Button';

export function PasswordLoginForm({ api, onCompleted }: { api: AccountsApi; onCompleted: () => void }) {
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [phase, setPhase] = useState<'idle' | 'submitting' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!account.trim() || !password) {
      setPhase('error');
      setError('请输入闲鱼账号和密码');
      return;
    }
    setPhase('submitting');
    setError(null);
    try {
      await api.loginWithPassword({ account: account.trim(), password });
      onCompleted();
    } catch (cause) {
      setPhase('error');
      setError(cause instanceof Error ? cause.message : '账号密码登录失败');
    }
  }

  return (
    <form className="account-login-form" onSubmit={submit}>
      <InputField label="闲鱼账号" value={account} onChange={(event) => setAccount(event.target.value)} placeholder="手机号或用户名" autoFocus />
      <InputField label="密码" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="请输入密码" />
      <p className="account-login-hint">账号密码登录由后端适配器处理；若闲鱼要求人脸或验证码，界面会保留明确的验证失败状态，不会伪造成功。</p>
      {error && <div className="inline-error" role="alert">{error}</div>}
      <div className="modal-actions"><Button variant="primary" type="submit" disabled={phase === 'submitting'}>{phase === 'submitting' ? '提交中…' : '登录并添加账号'}</Button></div>
    </form>
  );
}
