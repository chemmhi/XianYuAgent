import { useEffect, useState, type ReactNode } from 'react';
import type { ConversationVM } from '../types';

export function conversationDisplayName(conversation: Pick<ConversationVM, 'buyerDisplayName' | 'buyerRef'>): string {
  return conversation.buyerDisplayName?.trim() || conversation.buyerRef?.trim() || '未知买家';
}

export function conversationInitial(conversation: Pick<ConversationVM, 'buyerDisplayName' | 'buyerRef'>): string {
  return conversationDisplayName(conversation).slice(0, 1).toUpperCase();
}

export function ConversationListState({ children, error = false, role }: { children: ReactNode; error?: boolean; role?: 'alert' }) {
  return <div className={`messages-state messages-sidebar-state${error ? ' messages-error' : ''}`} role={role}>{children}</div>;
}

function ConversationAvatar({ conversation }: { conversation: ConversationVM }) {
  const [imageFailed, setImageFailed] = useState(false);
  const displayName = conversationDisplayName(conversation);
  useEffect(() => setImageFailed(false), [conversation.buyerAvatarUrl]);
  const avatarUrl = normalizeAvatarUrl(conversation.buyerAvatarUrl);
  return <span className="messages-conversation-avatar" aria-hidden="true">
    {avatarUrl && !imageFailed
      ? <img src={avatarUrl} alt="" onError={() => setImageFailed(true)} />
      : <span>{conversationInitial(conversation)}</span>}
  </span>;
}

function normalizeAvatarUrl(value?: string): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  return normalized.startsWith('//') ? `https:${normalized}` : normalized;
}

export function ConversationList({ conversations, activeConversationId, onSelect, hasMore, loadingMore, onLoadMore }: {
  conversations: ConversationVM[];
  activeConversationId?: string;
  onSelect: (conversationId: string) => void;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
}) {
  return <div className="messages-conversation-scroll" aria-label="会话列表">
    <div className="messages-conversation-list">
      {conversations.map((conversation) => <button key={conversation.conversationId} type="button" data-conversation-id={conversation.conversationId} className={conversation.conversationId === activeConversationId ? 'active' : ''} onClick={() => onSelect(conversation.conversationId)}>
        <ConversationAvatar conversation={conversation} />
        <span className="messages-conversation-copy">
          <strong>{conversationDisplayName(conversation)}</strong>
          <small>{conversation.lastMessagePreview || '暂无消息'}</small>
          <em>{conversation.itemTitle || '未关联商品'}</em>
        </span>
        <span className="messages-conversation-meta">
          <small>{formatTime(conversation.lastMessageAt)}</small>
          {conversation.unreadCount > 0 && <b aria-label={`${conversation.unreadCount} 条未读`}>{conversation.unreadCount > 99 ? '99+' : conversation.unreadCount}</b>}
          {conversation.itemImageUrl && <img className="messages-conversation-item" src={conversation.itemImageUrl} alt={conversation.itemTitle || '商品缩略图'} />}
        </span>
      </button>)}
    </div>
    {hasMore && <button className="messages-load-more" type="button" onClick={onLoadMore} disabled={loadingMore} aria-label={loadingMore ? '正在加载更多会话' : '加载更多会话'}>{loadingMore ? <><span className="messages-inline-spinner" aria-hidden="true" /><span>加载中</span></> : '加载更多会话'}</button>}
  </div>;
}

function formatTime(value?: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return date.toLocaleDateString([], { month: 'numeric', day: 'numeric' });
}
