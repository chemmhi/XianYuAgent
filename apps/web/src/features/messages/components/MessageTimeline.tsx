import type { MessageVM } from '../types';

export function MessageTimeline({ messages, phase }: { messages: MessageVM[]; phase: string }) {
  if (phase === 'loading') return <div className="messages-timeline-state" aria-live="polite">正在加载消息时间线…</div>;
  if (phase === 'empty') return <div className="messages-timeline-state">暂无历史消息</div>;
  if (phase === 'forbidden') return <div className="messages-timeline-state messages-error" role="alert">无权查看该会话消息。</div>;
  if (phase === 'error') return <div className="messages-timeline-state messages-error" role="alert">消息时间线加载失败。</div>;
  return <div className="messages-timeline" aria-live="polite">
    {messages.map((message) => <div key={message.messageId} className={`messages-bubble-row ${message.direction === 'outbound' ? 'outbound' : 'inbound'}`}><div className={`messages-bubble ${message.direction === 'outbound' ? 'outbound' : 'inbound'}`}><span>{message.bodyText || (message.bodyType === 'image' ? '[图片]' : '[系统消息]')}</span><small>{formatTime(message.createdAt)}{message.source === 'ai' ? ' · AI' : message.source === 'human' ? ' · 人工' : ''}</small></div></div>)}
  </div>;
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
