import { useState, type FormEvent } from 'react';
import { Button } from '../../../shared/ui/Button';
import { InputField } from '../../../shared/ui/InputField';

export function AdminLoginForm({ busy, error, onSubmit }: { busy: boolean; error: string | null; onSubmit: (input: { email: string; password: string }) => Promise<void> }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try { await onSubmit({ email: email.trim(), password }); } catch { /* controller exposes the field-level error */ }
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <div className="auth-form-heading"><p className="eyebrow">Administrator Access</p><h1>登录管理控制台</h1><p>请使用项目管理员账号登录，登录后才能访问账号、商品和订单数据。</p></div>
      <label>管理员邮箱<InputField type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
      <label>密码<InputField type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
      {error && <p className="auth-form-error" role="alert">{error}</p>}
      <Button variant="primary" className="auth-submit" type="submit" disabled={busy}>{busy ? '登录中…' : '登录'}</Button>
    </form>
  );
}
