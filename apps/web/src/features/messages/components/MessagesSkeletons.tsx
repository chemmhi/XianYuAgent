export function ConversationListSkeleton() {
  return <div className="messages-sidebar-skeleton" role="status" aria-label="会话列表加载中" aria-busy="true">
    {Array.from({ length: 8 }, (_, index) => <div key={index} className="messages-skeleton-conversation" aria-hidden="true">
      <span className="messages-skeleton-avatar" />
      <span className="messages-skeleton-copy">
        <span className="messages-skeleton-line messages-skeleton-line--name" />
        <span className="messages-skeleton-line messages-skeleton-line--preview" />
        <span className="messages-skeleton-line messages-skeleton-line--item" />
      </span>
      <span className="messages-skeleton-meta">
        <span className="messages-skeleton-line messages-skeleton-line--time" />
        <span className="messages-skeleton-thumb" />
      </span>
    </div>)}
  </div>;
}

export function TimelineSkeleton() {
  return <div className="messages-timeline messages-timeline-skeleton" role="status" aria-label="消息内容加载中" aria-busy="true">
    {Array.from({ length: 6 }, (_, index) => {
      const outbound = index % 3 === 2;
      return <div key={index} className={`messages-skeleton-bubble-row ${outbound ? 'outbound' : 'inbound'}`} aria-hidden="true">
        <span className={`messages-skeleton-avatar messages-skeleton-avatar--message ${outbound ? 'self' : ''}`} />
        <span className="messages-skeleton-bubble-stack">
          <span className={`messages-skeleton-bubble ${outbound ? 'outbound' : 'inbound'} messages-skeleton-bubble--${index % 3}`} />
          <span className="messages-skeleton-line messages-skeleton-line--message-time" />
        </span>
      </div>;
    })}
  </div>;
}
