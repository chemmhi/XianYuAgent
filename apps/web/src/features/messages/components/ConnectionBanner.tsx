import type { RealtimePhase } from '../types';

export function ConnectionBanner({ phase, onRetry }: { phase: RealtimePhase; onRetry: () => void }) {
  if (phase === 'connected' || phase === 'closed') return null;
  if (phase === 'connecting') {
    return <span className="messages-connection-status connecting" role="status" aria-label="正在建立实时连接"><span className="messages-connection-spinner" aria-hidden="true" /></span>;
  }
  if (phase === 'reconnecting') {
    return <span className="messages-connection-status reconnecting" role="status" aria-label="正在同步最新消息"><span className="messages-connection-spinner" aria-hidden="true" /></span>;
  }
  if (phase === 'timeout') {
    return <span className="messages-connection-status timeout" role="status"><span className="messages-connection-status-dot" aria-hidden="true" /><span>离线</span><button type="button" onClick={onRetry}>重试</button></span>;
  }
  if (phase === 'forbidden') {
    return <span className="messages-connection-status forbidden" role="status" aria-label="实时连接受限"><span className="messages-connection-status-dot" aria-hidden="true" /><span>连接受限</span></span>;
  }
  return null;
}
