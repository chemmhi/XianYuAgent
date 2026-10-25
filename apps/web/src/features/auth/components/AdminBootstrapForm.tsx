import { Form } from '../../../shared/ui/Form';
import { useState, type FormEvent } from 'react';
import { Button } from '../../../shared/ui/Button';
import { InputField } from '../../../shared/ui/InputField';

export function AdminBootstrapForm({ busy, onSubmit }: { busy: boolean; onSubmit: (input: { email: string; password: string; displayName: string }) => Promise<void> }) {
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try { await onSubmit({ displayName: displayName.trim(), email: email.trim(), password }); } catch { /* AuthGate reports the request error through the shared Toast */ }
  }

  return (
    <Form className="auth-form" onSubmit={submit}>
      <div className="auth-form-heading"><p className="eyebrow">First Run</p><h1>初始化管理员</h1><p>当前环境还没有管理员，请先创建一个管理员账号。</p></div>
      <InputField label="显示名称" autoComplete="name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} required />
      <InputField label="管理员邮箱" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required />
      <InputField label="设置密码" type="password" autoComplete="new-password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} required />
      <Button variant="primary" className="auth-submit" type="submit" disabled={busy}>{busy ? '初始化中…' : '创建管理员并继续'}</Button>
    </Form>
  );
}
