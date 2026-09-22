import type { ReactNode } from 'react';
import type { AdminProfile, AuthApi } from '../api';
import { useAuthController } from '../controller';
import { AdminBootstrapForm } from './AdminBootstrapForm';
import { AdminLoginForm } from './AdminLoginForm';
import { Button } from '../../../shared/ui/Button';
import '../auth.css';

export function AuthGate({ api, children }: { api: AuthApi; children: ReactNode | ((admin: AdminProfile | null) => ReactNode) }) {
  const controller = useAuthController(api);

  if (controller.phase === 'authenticated') return <>{typeof children === 'function' ? children(controller.admin) : children}</>;
  if (controller.phase === 'checking') return <AuthState title="正在检查管理员会话" message="正在确认当前浏览器是否已登录项目管理控制台。" />;
  if (controller.phase === 'error') return <AuthState title="无法连接管理会话" message={controller.error ?? '请确认 API 服务已启动。'} action={<Button variant="primary" type="button" onClick={() => void controller.refresh()}>重新检查</Button>} />;
  if (controller.phase === 'bootstrap-required') return <AuthFrame><AdminBootstrapForm busy={controller.busy} error={controller.error} onSubmit={controller.bootstrap} /></AuthFrame>;
  return <AuthFrame><AdminLoginForm busy={controller.busy} error={controller.error} onSubmit={controller.login} /></AuthFrame>;
}

function AuthFrame({ children }: { children: ReactNode }) {
  return <main className="auth-gate"><section className="auth-card card">{children}</section></main>;
}

function AuthState({ title, message, action }: { title: string; message: string; action?: ReactNode }) {
  return <AuthFrame><div className="auth-state"><p className="eyebrow">XianyuSellerAgent</p><h1>{title}</h1><p>{message}</p>{action}</div></AuthFrame>;
}
