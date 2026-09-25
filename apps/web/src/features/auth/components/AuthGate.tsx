import type { ReactNode } from 'react';
import type { AdminProfile, AuthApi } from '../api';
import { useAuthController } from '../controller';
import { AdminBootstrapForm } from './AdminBootstrapForm';
import { AdminLoginForm } from './AdminLoginForm';
import { Button } from '../../../shared/ui/Button';
import '../auth.css';

export interface AuthGateActions {
  logout: () => Promise<void>;
  busy: boolean;
}

export function AuthGate({ api, children }: { api: AuthApi; children: ReactNode | ((admin: AdminProfile | null, actions: AuthGateActions) => ReactNode) }) {
  const controller = useAuthController(api);

  // Resolve the session silently; do not flash a standalone checking card.
  if (controller.phase === 'checking') return null;
  if (controller.phase === 'authenticated') return <>{typeof children === 'function' ? children(controller.admin, { logout: controller.logout, busy: controller.busy }) : children}</>;
  if (controller.phase === 'error') return <AuthState title="无法连接管理会话" message={controller.error ?? '请确认 API 服务已启动。'} action={<Button variant="primary" type="button" onClick={() => void controller.refresh()}>重新检查</Button>} />;
  if (controller.phase === 'bootstrap-required') return <AuthFrame><AdminBootstrapForm busy={controller.busy} error={controller.error} onSubmit={controller.bootstrap} /></AuthFrame>;
  return <AuthFrame><AdminLoginForm busy={controller.busy} error={controller.error} onSubmit={controller.login} /></AuthFrame>;
}

function AuthFrame({ children }: { children: ReactNode }) {
  return <main className="auth-gate"><section className="auth-card card">{children}</section></main>;
}

function AuthState({ title, message, action }: { title: string; message: string; action?: ReactNode }) {
  return <AuthFrame><div className="auth-state"><p className="eyebrow">FishAgent</p><h1>{title}</h1><p>{message}</p>{action}</div></AuthFrame>;
}
