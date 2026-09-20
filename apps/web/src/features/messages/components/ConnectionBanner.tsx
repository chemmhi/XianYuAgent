import type { RealtimePhase } from '../types';

export function ConnectionBanner({ phase, onRetry }: { phase: RealtimePhase; onRetry: () => void }) {
  if (phase === 'connected' || phase === 'closed') return null;
  const copy = phase === 'connecting' ? '正在连接实时消息…' : phase === 'reconnecting' ? '连接已断开，正在按游标补回消息…' : phase === 'timeout' ? '实时连接超时，当前仅显示历史消息。' : phase === 'forbidden' ? '无权建立该会话的实时连接。' : '实时连接已关闭。';
  return <div className={`messages-connection-banner ${phase}`} role="status"><span>{copy}</span>{phase === 'timeout' && <button className="btn ghost" type="button" onClick={onRetry}>重新连接</button>}</div>;
}
