import { useLayoutEffect, useRef, type ReactNode } from 'react';
import type { MessageReadState, MessageVM } from '../types';
import { renderXianyuText } from '../xianyu-emojis';
import { TimelineSkeleton } from './MessagesSkeletons';

type Participant = { displayName: string; avatarUrl?: string };

export function MessageTimeline({ messages, phase, hasMoreHistory = false, loadingMoreHistory = false, onLoadMore, onOpenImage, inboundParticipant, outboundParticipant }: { messages: MessageVM[]; phase: string; hasMoreHistory?: boolean; loadingMoreHistory?: boolean; onLoadMore?: () => void; onOpenImage?: (url: string) => void; inboundParticipant?: Participant; outboundParticipant?: Participant }) {
  const timelineRef = useRef<HTMLDivElement>(null);
  const lastMessageIdRef = useRef<string | undefined>(undefined);

  // Keep the conversation focused on the newest message when a conversation
  // first loads, or when a genuinely new message arrives. Loading older
  // history only prepends rows, so the last message id remains unchanged and
  // the reader's current scroll position is preserved.
  useLayoutEffect(() => {
    if (phase !== 'success' || messages.length === 0) {
      lastMessageIdRef.current = undefined;
      return;
    }
    const lastMessageId = messages[messages.length - 1]?.messageId;
    const shouldScrollToLatest = lastMessageIdRef.current === undefined || lastMessageIdRef.current !== lastMessageId;
    if (shouldScrollToLatest && timelineRef.current) {
      timelineRef.current.scrollTop = timelineRef.current.scrollHeight;
    }
    lastMessageIdRef.current = lastMessageId;
  }, [messages, phase]);

  if (phase === 'loading') return <TimelineSkeleton />;
  if (phase === 'empty') return <div className="messages-timeline-state">暂无历史消息</div>;
  if (phase === 'forbidden') return <div className="messages-timeline-state messages-error" role="alert">无权查看该会话消息。</div>;
  if (phase === 'error') return <div className="messages-timeline-state messages-error" role="alert">消息时间线加载失败。</div>;
  return <div ref={timelineRef} className="messages-timeline" aria-live="polite">
    {hasMoreHistory && onLoadMore && <button className="messages-history-load-more" type="button" onClick={onLoadMore} disabled={loadingMoreHistory} aria-label={loadingMoreHistory ? '正在加载更早消息' : '加载更早消息'}>{loadingMoreHistory ? <><span className="messages-inline-spinner" aria-hidden="true" /><span>加载中</span></> : '加载更早消息'}</button>}
    {messages.map((message) => {
      const isSystem = message.bodyType === 'system' || message.senderRole === 'system' || message.bodyText === '[系统消息]';
      const isOutbound = message.direction === 'outbound';
      const participant = isOutbound ? outboundParticipant : inboundParticipant;
      const fallbackName = isOutbound ? '我' : '买家';
      const imageUrl = message.bodyType === 'image' ? safeUrl(message.bodyRef) : undefined;
      if (isSystem) {
        return <div key={message.messageId} className="messages-system-row">
          <span className="messages-system-dot" aria-hidden="true" />
          <span>{message.bodyText || '系统消息'}</span>
        </div>;
      }
      return <div key={message.messageId} className={`messages-bubble-row ${isOutbound ? 'outbound' : 'inbound'}`}>
        <div className={`messages-message-avatar ${isOutbound ? 'self' : ''}`} aria-hidden="true">
          {participant?.avatarUrl ? <img src={participant.avatarUrl} alt="" /> : <span>{(participant?.displayName || fallbackName).slice(0, 1)}</span>}
        </div>
        <div className="messages-message-stack">
          <div className={`messages-bubble ${isOutbound ? 'outbound' : 'inbound'}`}>
            {imageUrl ? <button className="messages-image-button" type="button" aria-label="查看聊天图片" onClick={() => onOpenImage?.(imageUrl)}><img className="messages-image" src={imageUrl} alt="聊天图片" loading="lazy" /></button> : <span>{renderMessageText(message.bodyText || (message.bodyType === 'image' ? '[图片]' : '[系统消息]'))}</span>}
          </div>
          <div className="messages-message-foot"><time>{formatTime(message.createdAt)}</time>{message.source === 'ai' && <span>AI</span>}{message.source === 'human' && <span>人工</span>}{isOutbound && renderReadState(message)}</div>
        </div>
      </div>;
    })}
  </div>;
}

export function resolveMessageReadState(message: MessageVM): MessageReadState | undefined {
  const candidate = message as MessageVM & { isRead?: unknown; read?: unknown; readStatus?: unknown; readState?: unknown; deliveryStatus?: unknown };
  if (candidate.readState === 'read' || candidate.readState === 'unread') return candidate.readState;
  if (typeof candidate.isRead === 'boolean') return candidate.isRead ? 'read' : 'unread';
  if (typeof candidate.read === 'boolean') return candidate.read ? 'read' : 'unread';
  const rawStatus = [candidate.readStatus, candidate.deliveryStatus, candidate.status].find((value) => typeof value === 'string');
  const normalizedStatus = typeof rawStatus === 'string' ? rawStatus.trim().toLowerCase().replace(/[\s_-]+/g, '') : '';
  if (['read', 'seen', 'opened', 'acknowledged', 'readed'].includes(normalizedStatus)) return 'read';
  if (['unread', 'unseen', 'notread', 'sent', 'delivered'].includes(normalizedStatus)) return 'unread';
  if (message.direction === 'outbound' && normalizedStatus === 'created') return 'unread';
  return undefined;
}

function renderReadState(message: MessageVM): ReactNode {
  // Outbound messages are not considered seen until the adapter supplies an
  // explicit server-side receipt.
  const readState = resolveMessageReadState(message) ?? 'unread';
  return <span className={`messages-read-state ${readState}`}>{readState === 'read' ? '已读' : '未读'}</span>;
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
