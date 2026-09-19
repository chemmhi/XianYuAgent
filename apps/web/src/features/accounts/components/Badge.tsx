type BadgeTone = 'ok' | 'gray' | 'warn' | 'danger' | 'info';

export function Badge({ tone, children }: { tone: BadgeTone; children: string }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}
