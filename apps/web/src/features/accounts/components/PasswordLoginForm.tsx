import { Form } from '../../../shared/ui/Form';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { AccountsApi, PasswordLoginSessionVM } from '../api';
import { InputField } from '../../../shared/ui/InputField';
import { Button } from '../../../shared/ui/Button';
import { useToast } from '../../../shared/ui/ToastProvider';
import { accountErrorMessage } from '../feedback';
import {PasswordVerificationPanel} from './PasswordVerificationPanel';
import {createPortal} from 'react-dom';
import './password-verification.css';

export function PasswordLoginForm({ api, existingAccountId, onCompleted, onClose,initialSession }: { api: AccountsApi; existingAccountId?: string; onCompleted: () => void;onClose?:()=>void;initialSession?:PasswordLoginSessionVM }) {
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false), [acceptTerms, setAcceptTerms] = useState(false);
  const [session, setSession] = useState<PasswordLoginSessionVM|undefined>(initialSession);
  const [savedAvailable,setSavedAvailable]=useState(false);
  const mounted = useRef(true), current = useRef<PasswordLoginSessionVM | undefined>(initialSession);
  const apiRef=useRef(api);apiRef.current=api;
  const hasVerification=useRef(false);
  const completed = useRef(onCompleted); completed.current = onCompleted;
  const closed=useRef(onClose);closed.current=onClose;
  const busy = submitting || !!session && ['logging_in', 'verification_required'].includes(session.status);
  const { showToast, dismissToast } = useToast();
  function report(cause: unknown) { showToast({ id: 'account-password-login', tone: 'error', message: accountErrorMessage(cause, '账号密码登录失败，请稍后重试。') }); }
  useEffect(()=>{let live=true;if(existingAccountId&&api.getSavedPasswordAvailable)void api.getSavedPasswordAvailable(existingAccountId).then(value=>{if(live)setSavedAvailable(value);}).catch(()=>undefined);return()=>{live=false;};},[api,existingAccountId]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; const s = current.current; queueMicrotask(()=>{if(!mounted.current&&s&&!s.automatic&&['logging_in','verification_required'].includes(s.status))void apiRef.current.cancelPasswordSession?.(s.id).catch(()=>undefined);}); };
  }, []);
  useEffect(() => {
    if (!session || !['logging_in', 'verification_required'].includes(session.status)) return;
    let stopped = false, errors=0; let timer: ReturnType<typeof setTimeout>;
    const fail=(cause:unknown)=>{const next={...session,status:'failed' as const};current.current=next;setSession(next);report(cause);if(initialSession?.automatic)closed.current?.();};
    const poll = async () => {
      if(Date.parse(session.expiresAt)<=Date.now()){fail(new Error('PASSWORD_LOGIN_EXPIRED'));void apiRef.current.cancelPasswordSession?.(session.id).catch(()=>undefined);return;}
      try {
        const next = await apiRef.current.getPasswordSession!(session.id);
        if (stopped || !mounted.current) return;
        current.current = next; setSession(next);
        if (next.status === 'succeeded') { setPassword(''); completed.current(); return; }
        if (['failed', 'expired'].includes(next.status)) { report(new Error(next.errorCode));if(initialSession?.automatic)closed.current?.();return; }
        if (next.status === 'cancelled'){if(initialSession?.automatic)closed.current?.();return;}
        errors=0;
      } catch (cause) { if (!stopped && mounted.current) {
        const status=cause&&typeof cause==='object'&&'status' in cause?Number(cause.status):undefined;
        if([401,403,404,410].includes(status??0)||++errors>=3){fail(cause);return;}report(cause);
      } }
      if (!stopped) timer = setTimeout(() => void poll(), 1500);
    };
    timer = setTimeout(() => void poll(), 700);
    return () => { stopped = true; clearTimeout(timer); };
  }, [session?.id, session?.status]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setSubmitting(true);
    dismissToast('account-password-login');
    try {
      if (!api.createPasswordSession || !api.getPasswordSession) throw new Error('PASSWORD_LOGIN_UNAVAILABLE');
      const next = await api.createPasswordSession({ account: account.trim(), password, accountId: existingAccountId, acceptTerms,
        clientInfo:{userAgent:navigator.userAgent,platform:navigator.platform,language:navigator.language,screenPixel:`${screen.width}x${screen.height}`} });
      if (!mounted.current) { await api.cancelPasswordSession?.(next.id); return; }
      current.current = next; setSession(next); setPassword('');
    } catch (cause) {
      if (mounted.current) report(cause);
    } finally { if (mounted.current) setSubmitting(false); }
  }
  async function cancel() {
    if (!session) return false;
    try { await api.cancelPasswordSession?.(session.id); current.current = { ...session, status: 'cancelled' }; setSession(current.current);return true; }
    catch (cause) { report(cause);return false; }
  }
  async function retrySaved(){
    if(busy||!existingAccountId||!api.retrySavedPassword)return;
    setSubmitting(true);dismissToast('account-password-login');
    try{const next=await api.retrySavedPassword(existingAccountId);if(mounted.current){current.current=next;setSession(next);setPassword('');}}
    catch(cause){if(mounted.current)report(cause);}finally{if(mounted.current)setSubmitting(false);}
  }

  if(session?.status==='verification_required'&&session.verificationPresentation==='http')hasVerification.current=true;
  if(session&&(hasVerification.current||session.automatic)&&['verification_required','logging_in'].includes(session.status))return <>
    <span className="password-verification-active" hidden />
    {createPortal(<div className="modal-backdrop password-verification-backdrop">
      <section className="modal-card password-verification-dialog" role="dialog" aria-modal="true" aria-labelledby="password-verification-title">
        <header className="modal-head"><div><p className="eyebrow">Xianyu Verification</p><h2 id="password-verification-title">{session.automatic?'闲鱼自动登录安全验证':'闲鱼官方安全验证'}</h2></div>
          <button className="icon-button" type="button" aria-label="关闭安全验证" onClick={()=>void cancel().then(ok=>{if(ok)onClose?.();})}>×</button></header>
        <div className="password-verification-content">{session.automatic&&<p className="account-login-hint">{session.accountDisplayName??'闲鱼账号'}已使用保存的账密发起登录，请完成官方验证，无需重新填写密码。</p>}{session.status==='verification_required'?<PasswordVerificationPanel api={api} session={session} />:<p role="status">正在确认官方登录和消息授权，请稍候…</p>}</div>
        <footer className="modal-actions"><Button type="button" onClick={()=>void cancel().then(ok=>{if(ok)onClose?.();})}>取消登录</Button></footer>
      </section>
    </div>,document.body)}
  </>;

  return (
    <Form className="account-login-form" onSubmit={submit}>
      <InputField label="闲鱼账号" required disabled={busy} value={account} onChange={event => setAccount(event.target.value)} placeholder="手机号或用户名" autoComplete="username" autoFocus />
      <InputField label="密码" required disabled={busy} type="password" value={password} onChange={event => setPassword(event.target.value)} placeholder="请输入密码" autoComplete="current-password" />
      <label className="account-login-hint"><input type="checkbox" checked={acceptTerms} disabled={busy} onChange={event => setAcceptTerms(event.target.checked)} /> 我已阅读并同意闲鱼登录页的服务协议和隐私政策；登录成功后加密保存账密，用于授权过期后的自动登录。</label>
      <p className="account-login-hint">首次登录可能需要安全验证，请按官方提示完成。</p>
      {savedAvailable&&<Button type="button" disabled={busy} onClick={()=>void retrySaved()}>使用已保存账密登录</Button>}
      {session?.status === 'logging_in' && <p role="status">正在登录闲鱼，请稍候…</p>}
      <div className="modal-actions">{busy && session && <Button type="button" onClick={() => void cancel()}>取消登录</Button>}<Button variant="primary" type="submit" disabled={busy || !acceptTerms}>{busy ? '登录中…' : existingAccountId ? '登录并恢复授权' : '登录并添加账号'}</Button></div>
    </Form>
  );
}
