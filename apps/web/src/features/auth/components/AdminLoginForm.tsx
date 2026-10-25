import { useState, type FormEvent } from 'react';
import { Button } from '../../../shared/ui/Button';
import { InputField } from '../../../shared/ui/InputField';

export function AdminLoginForm({ busy, onSubmit, onRegister }: { busy: boolean; onSubmit: (input: { email: string; password: string }) => Promise<void>; onRegister?: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try { await onSubmit({ email: email.trim(), password }); } catch { /* AuthGate reports the request error through the shared Toast */ }
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <div className="auth-form-heading"><p className="eyebrow">Administrator Access</p><h1>登录管理控制台</h1><p>请使用项目管理员账号登录，登录后才能访问账号、商品和订单数据。</p></div>
      <InputField label="管理员邮箱" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required />
      <InputField label="密码" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
      <Button variant="primary" className="auth-submit" type="submit" disabled={busy}>{busy ? '登录中…' : '登录'}</Button>{onRegister && <Button variant="ghost" type="button" onClick={onRegister}>没有账号？去注册</Button>}
    </form>
  );
}
