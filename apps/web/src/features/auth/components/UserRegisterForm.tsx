import { useState, type FormEvent } from 'react';
import { Button } from '../../../shared/ui/Button';
import { InputField } from '../../../shared/ui/InputField';

export function UserRegisterForm({ busy, onSubmit, onBack }: {
  busy: boolean;
  onSubmit: (input: { inviteCode: string; email: string; password: string; displayName: string }) => Promise<void>;
  onBack: () => void;
}) {
  const [inviteCode, setInviteCode] = useState('');
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [passwordMismatch, setPasswordMismatch] = useState(false);

  function clearValidation() { setPasswordMismatch(false); }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password !== confirm) {
      setPasswordMismatch(true);
      event.currentTarget.querySelector<HTMLInputElement>('[name="confirmPassword"]')?.focus();
      return;
    }
    clearValidation();
    try { await onSubmit({ inviteCode: inviteCode.trim(), email: email.trim(), displayName: displayName.trim(), password }); }
    catch { /* AuthGate reports request errors through the shared Toast. */ }
  }

  return <form className="auth-form" onSubmit={submit}>
    <div className="auth-form-heading"><p className="eyebrow">Invitation Registration</p><h1>注册 FishAgent</h1><p>请输入管理员提供的邀请码。注册后只能查看和管理你自己绑定的闲鱼账号。</p></div>
    <InputField label="邀请码" value={inviteCode} onChange={event => setInviteCode(event.target.value)} required autoComplete="one-time-code" />
    <InputField label="昵称" value={displayName} onChange={event => setDisplayName(event.target.value)} required autoComplete="name" />
    <InputField label="邮箱" type="email" value={email} onChange={event => setEmail(event.target.value)} required autoComplete="email" />
    <InputField label="密码" type="password" value={password} onChange={event => { setPassword(event.target.value); clearValidation(); }} required minLength={8} autoComplete="new-password" />
    <InputField label="确认密码" fieldClassName="auth-confirm-field" error={passwordMismatch ? <span id="register-password-error">两次输入的密码不一致</span> : undefined} aria-describedby={passwordMismatch ? 'register-password-error' : undefined} name="confirmPassword" type="password" value={confirm} onChange={event => { setConfirm(event.target.value); clearValidation(); }} aria-invalid={passwordMismatch || undefined} required minLength={8} autoComplete="new-password" />
    <Button variant="primary" className="auth-submit" type="submit" disabled={busy}>{busy ? '注册中…' : '注册'}</Button>
    <Button variant="ghost" type="button" onClick={() => { clearValidation(); onBack(); }}>返回登录</Button>
  </form>;
}
