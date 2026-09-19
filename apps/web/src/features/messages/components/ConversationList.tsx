import type { ConversationVM } from '../types';

export function ConversationList({ conversations, activeConversationId, onSelect }: { conversations: ConversationVM[]; activeConversationId?: string; onSelect: (conversationId: string) => void }) {
  return <div className="messages-conversation-list" aria-label="会话列表">
    {conversations.map((conversation) => <button key={conversation.conversationId} type="button" className={conversation.conversationId === activeConversationId ? 'active' : ''} onClick={() => onSelect(conversation.conversationId)}>
      <span className="messages-conversation-avatar">{(conversation.buyerDisplayName || conversation.buyerRef).slice(0, 1)}</span>
      <span className="messages-conversation-copy"><strong>{conversation.buyerDisplayName || conversation.buyerRef}</strong><small>{conversation.itemTitle || '未关联商品'}</small><em>{conversation.lastMessagePreview || '暂无消息'}</em></span>
      <span className="messages-conversation-meta">{conversation.unreadCount > 0 && <b>{conversation.unreadCount}</b>}<small>{formatTime(conversation.lastMessageAt)}</small></span>
    </button>)}
  </div>;
}

function formatTime(value?: string): string {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
