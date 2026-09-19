import { useState, type FormEvent } from 'react';

export function AdminBootstrapForm({ busy, error, onSubmit }: { busy: boolean; error: string | null; onSubmit: (input: { email: string; password: string; displayName: string }) => Promise<void> }) {
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try { await onSubmit({ displayName: displayName.trim(), email: email.trim(), password }); } catch { /* controller exposes the field-level error */ }
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <div className="auth-form-heading"><p className="eyebrow">First Run</p><h1>初始化管理员</h1><p>当前环境还没有管理员，请先创建一个管理员账号。</p></div>
      <label>显示名称<input autoComplete="name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} required /></label>
      <label>管理员邮箱<input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
      <label>设置密码<input type="password" autoComplete="new-password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
      {error && <p className="auth-form-error" role="alert">{error}</p>}
      <button className="btn primary auth-submit" type="submit" disabled={busy}>{busy ? '初始化中…' : '创建管理员并继续'}</button>
    </form>
  );
}
