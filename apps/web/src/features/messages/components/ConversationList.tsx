import type { ConversationVM } from '../types';

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
        <span className="messages-conversation-avatar" aria-hidden="true">
          {conversation.buyerAvatarUrl ? <img src={conversation.buyerAvatarUrl} alt="" /> : <span>{(conversation.buyerDisplayName || conversation.buyerRef).slice(0, 1)}</span>}
        </span>
        <span className="messages-conversation-copy">
          <strong>{conversation.buyerDisplayName || conversation.buyerRef}</strong>
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
    {hasMore && <button className="messages-load-more" type="button" onClick={onLoadMore} disabled={loadingMore}>{loadingMore ? '正在加载…' : '加载更多会话'}</button>}
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
