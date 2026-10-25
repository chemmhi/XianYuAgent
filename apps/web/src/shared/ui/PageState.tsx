import type { ReactNode } from 'react';
import './page-state.css';

/** A single layout for page-level guidance, loading and recovery states. */
export function PageState({ title, message, action, error = false, loading = false }: {
  title: string;
  message?: string;
  action?: ReactNode;
  error?: boolean;
  loading?: boolean;
}) {
  return <section className="page-state" data-testid="page-state" role={error ? 'alert' : 'status'} aria-busy={loading || undefined}>
    <div className="page-state-content">
      <h2>{title}</h2>
      {message && <p>{message}</p>}
      {action && <div className="page-state-action">{action}</div>}
    </div>
  </section>;
}
