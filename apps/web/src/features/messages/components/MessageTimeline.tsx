import type { ReactNode } from 'react';
import type { MessageVM } from '../types';
import { renderXianyuText } from '../xianyu-emojis';

export function MessageTimeline({ messages, phase, hasMoreHistory = false, loadingMoreHistory = false, onLoadMore, onOpenImage }: { messages: MessageVM[]; phase: string; hasMoreHistory?: boolean; loadingMoreHistory?: boolean; onLoadMore?: () => void; onOpenImage?: (url: string) => void }) {
  if (phase === 'loading') return <div className="messages-timeline-state" aria-live="polite">正在加载消息时间线…</div>;
  if (phase === 'empty') return <div className="messages-timeline-state">暂无历史消息</div>;
  if (phase === 'forbidden') return <div className="messages-timeline-state messages-error" role="alert">无权查看该会话消息。</div>;
  if (phase === 'error') return <div className="messages-timeline-state messages-error" role="alert">消息时间线加载失败。</div>;
  return <div className="messages-timeline" aria-live="polite">
    {hasMoreHistory && onLoadMore && <button className="messages-history-load-more" type="button" onClick={onLoadMore} disabled={loadingMoreHistory}>{loadingMoreHistory ? '正在加载更早消息…' : '加载更早消息'}</button>}
    {messages.map((message) => {
      const imageUrl = message.bodyType === 'image' ? safeUrl(message.bodyRef) : undefined;
      return <div key={message.messageId} className={`messages-bubble-row ${message.direction === 'outbound' ? 'outbound' : 'inbound'}`}>
        <div className={`messages-bubble ${message.direction === 'outbound' ? 'outbound' : 'inbound'}`}>
          {imageUrl ? <button className="messages-image-button" type="button" aria-label="查看聊天图片" onClick={() => onOpenImage?.(imageUrl)}><img className="messages-image" src={imageUrl} alt="聊天图片" loading="lazy" /></button> : <span>{renderMessageText(message.bodyText || (message.bodyType === 'image' ? '[图片]' : '[系统消息]'))}</span>}
          <small>{formatTime(message.createdAt)}{message.source === 'ai' ? ' · AI' : message.source === 'human' ? ' · 人工' : ''}</small>
        </div>
      </div>;
    })}
  </div>;
}

function renderMessageText(value: string): ReactNode {
  const parts = value.split(/(https?:\/\/[^\s<]+)/gi);
  if (parts.length === 1) return renderXianyuText(value);
  return parts.map((part, index) => {
    const match = part.match(/^([\s\S]*?)([),.!?，。！？、]+)$/);
    const candidate = match?.[1] ?? part;
    const trailing = match?.[2] ?? '';
    const url = safeUrl(candidate);
    if (!url) return <span key={`${index}-${part}`}>{renderXianyuText(part)}</span>;
    return <span key={`${index}-${part}`}><a className="messages-link" href={url} target="_blank" rel="noreferrer noopener">{candidate}</a>{trailing}</span>;
  });
}

function safeUrl(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : undefined;
  } catch { return undefined; }
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
