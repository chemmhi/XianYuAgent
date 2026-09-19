import { useState, type FormEvent } from 'react';
import type { AccountsApi } from '../api';
import type { AccountVM } from '../types';

export function CreateAccountModal({ api, onCreated, onClose }: { api: AccountsApi; onCreated: (account: AccountVM) => void; onClose: () => void }) {
  const [sellerRef, setSellerRef] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [phase, setPhase] = useState<'idle' | 'submitting' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!sellerRef.trim()) {
      setPhase('error');
      setError('请填写闲鱼账号标识。');
      return;
    }
    setPhase('submitting');
    setError(null);
    try {
      const account = await api.createAccount({ platform: 'xianyu', sellerRef: sellerRef.trim(), displayName: displayName.trim() || undefined });
      onCreated(account);
    } catch (cause) {
      setPhase('error');
      setError(cause instanceof Error && cause.message === 'ACCOUNT_ALREADY_EXISTS' ? '该账号标识已存在，请直接重新扫码授权。' : '创建账号失败，请稍后重试。');
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="modal-card create-account-modal" role="dialog" aria-modal="true" aria-labelledby="create-account-title">
        <header className="modal-head">
          <div><p className="eyebrow">Account Onboarding</p><h2 id="create-account-title">添加闲鱼账号</h2><p>先建立账号范围，再进入二维码授权。凭证正文不会在页面中展示。</p></div>
          <button className="icon-button" type="button" aria-label="关闭添加账号弹窗" onClick={onClose}>×</button>
        </header>
        <form className="create-account-form" onSubmit={submit}>
          <label><span>闲鱼账号标识</span><input autoFocus value={sellerRef} onChange={(event) => setSellerRef(event.target.value)} placeholder="例如 seller-001" /></label>
          <label><span>显示名称 <small>可选</small></span><input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="例如 资料自动发货店" /></label>
          {error && <div className="inline-error" role="alert">{error}</div>}
          <div className="modal-actions"><button className="btn ghost" type="button" onClick={onClose}>取消</button><button className="btn primary" type="submit" disabled={phase === 'submitting'}>{phase === 'submitting' ? '创建中…' : '创建并扫码授权'}</button></div>
        </form>
      </section>
    </div>
  );
}
