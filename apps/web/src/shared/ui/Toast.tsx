import type { ReactNode } from 'react';
import './toast.css';

export type ToastTone = 'success' | 'error' | 'info';

export function Toast({ message, tone = 'info', onDismiss }: { message: ReactNode; tone?: ToastTone; onDismiss?: () => void }) {
  return <div className={`app-toast app-toast-${tone}`} role={tone === 'error' ? 'alert' : 'status'} aria-live={tone === 'error' ? 'assertive' : 'polite'}>
    <span>{message}</span>
    {onDismiss && <button type="button" className="app-toast-dismiss" aria-label="关闭提示" onClick={onDismiss}>×</button>}
  </div>;
}
