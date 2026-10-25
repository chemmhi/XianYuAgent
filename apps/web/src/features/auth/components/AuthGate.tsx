import React, { useState, type ReactNode } from 'react';
import type { AdminProfile, AuthApi } from '../api';
import { useAuthController } from '../controller';
import { AdminBootstrapForm } from './AdminBootstrapForm';
import { AdminLoginForm } from './AdminLoginForm';
import { UserRegisterForm } from './UserRegisterForm';
import { Button } from '../../../shared/ui/Button';
import { useErrorToast } from '../../../shared/ui/useErrorToast';
import { ToastProvider } from '../../../shared/ui/ToastProvider';
import '../auth.css';

export interface AuthGateActions {
  logout: () => Promise<void>;
  busy: boolean;
}

export function AuthGate({ api, children }: { api: AuthApi; children: ReactNode | ((admin: AdminProfile | null, actions: AuthGateActions) => ReactNode) }) {
  const controller = useAuthController(api);
  const [registerMode, setRegisterMode] = React.useState(false);

  // Resolve the session silently; do not flash a standalone checking card.
  if (controller.phase === 'checking') return null;
  if (controller.phase === 'authenticated') return <>{typeof children === 'function' ? children(controller.admin, { logout: controller.logout, busy: controller.busy }) : children}</>;
  let content: ReactNode;
  if (controller.phase === 'error') content = <AuthState title="无法连接管理会话" message="暂时无法加载会话，请重新检查。" action={<Button variant="primary" type="button" onClick={() => void controller.refresh()}>重新检查</Button>} />;
  else if (controller.phase === 'bootstrap-required') content = <AuthFrame><AdminBootstrapForm busy={controller.busy} onSubmit={controller.bootstrap} /></AuthFrame>;
  else if (registerMode) content = <AuthFrame><UserRegisterForm busy={controller.busy} onSubmit={controller.register} onBack={() => { setRegisterMode(false); void controller.refresh(); }} /></AuthFrame>;
  else content = <AuthFrame><AdminLoginForm busy={controller.busy} onSubmit={controller.login} onRegister={() => setRegisterMode(true)} /></AuthFrame>;
  // This provider unmounts on authentication. Business Toasts retain their
  // existing provider inside the authenticated shell, scoped to that session.
  return <ToastProvider key="auth-feedback"><AuthRequestFeedback error={controller.error} />{content}</ToastProvider>;
}

function AuthRequestFeedback({ error }: { error: string | null }) {
  useErrorToast(error, 'auth-request-error');
  return null;
}

function AuthFrame({ children }: { children: ReactNode }) {
  return <main className="auth-gate"><section className="auth-card card">{children}</section></main>;
}

function AuthState({ title, message, action }: { title: string; message: string; action?: ReactNode }) {
  return <AuthFrame><div className="auth-state"><p className="eyebrow">FishAgent</p><h1>{title}</h1><p>{message}</p>{action}</div></AuthFrame>;
}
