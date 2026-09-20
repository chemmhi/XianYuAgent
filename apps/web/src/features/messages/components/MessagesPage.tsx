import { useMemo, useState } from 'react';
import { useAccountContext } from '../../../app/account-context';
import { createMessagesApi, type MessagesApi } from '../api';
import { useMessagesController } from '../controller';
import { filterConversations } from '../model';
import { ConnectionBanner } from './ConnectionBanner';
import { ConversationList } from './ConversationList';
import { MessageTimeline } from './MessageTimeline';
import './messages.css';

export function MessagesPage({ api: providedApi }: { api?: MessagesApi }) {
  const { accounts, currentAccountId, currentAccount, accountsLoading, accountsError } = useAccountContext();
  const api = useMemo(() => providedApi ?? createMessagesApi({ get: async () => { throw new Error('messages api unavailable'); } }), [providedApi]);
  const controller = useMessagesController({ api, accountId: currentAccountId });
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const activeConversation = controller.state.conversations.find((conversation) => conversation.conversationId === controller.state.activeConversationId);
  const visibleConversations = useMemo(() => filterConversations(controller.state.conversations, search, unreadOnly), [controller.state.conversations, search, unreadOnly]);

  if (accountsLoading) return <section className="page-stack messages-domain"><div className="messages-state">正在加载账号范围…</div></section>;
  if (accountsError) return <section className="page-stack messages-domain"><div className="messages-state messages-error" role="alert">{accountsError}</div></section>;
  if (accounts.length === 0) return <section className="page-stack messages-domain"><div className="messages-state"><strong>请先连接闲鱼账号</strong><span>在线聊天需要先在账号管理中连接至少一个可用账号。</span><a className="btn ghost" href="/accounts">前往账号管理</a></div></section>;
  if (!currentAccountId || !currentAccount) return <section className="page-stack messages-domain"><div className="messages-state"><strong>请先设置当前账号</strong><span>聊天页沿用账号管理中的全局账号上下文，不在此处切换账号。</span><a className="btn ghost" href="/accounts">前往账号管理</a></div></section>;

  return <section className="page-stack messages-domain" data-messages-domain>
    <div className="page-title">
      <div><p className="eyebrow">Messages / Realtime</p><h1>在线聊天</h1><p>沿用账号管理中的当前账号，读取真实闲鱼会话并实时回复。</p></div>
      <div className="page-title-actions"><span className="messages-account-context">当前账号：{currentAccount.displayName || currentAccount.sellerRef || currentAccountId}</span><span className="messages-live-badge">真实连接</span></div>
    </div>
    <ConnectionBanner phase={controller.state.realtimePhase} onRetry={controller.retryRealtime} />
    <div className="messages-layout card panel">
      <aside className="messages-sidebar">
        <div className="messages-sidebar-header"><div><strong>会话</strong><small>{controller.state.conversations.length} 个已加载</small></div><button className="btn ghost" type="button" onClick={() => void controller.reload()} aria-label="刷新会话">刷新</button></div>
        <div className="messages-sidebar-tools">
          <label className="messages-search"><span aria-hidden="true">⌕</span><input aria-label="搜索会话" placeholder="搜索用户、商品或消息" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
          <div className="messages-filter-tabs" aria-label="会话筛选"><button type="button" aria-pressed={!unreadOnly} className={!unreadOnly ? 'active' : ''} onClick={() => setUnreadOnly(false)}>全部会话</button><button type="button" aria-pressed={unreadOnly} className={unreadOnly ? 'active' : ''} onClick={() => setUnreadOnly(true)}>未读{controller.state.conversations.filter((item) => item.unreadCount > 0).length ? ` (${controller.state.conversations.filter((item) => item.unreadCount > 0).length})` : ''}</button></div>
        </div>
        {controller.state.listPhase === 'loading' && <div className="messages-state">正在加载会话…</div>}
        {controller.state.listPhase === 'empty' && <div className="messages-state">当前账号暂无会话。</div>}
        {controller.state.listPhase === 'forbidden' && <div className="messages-state messages-error" role="alert">无权读取该账号会话。</div>}
        {controller.state.listPhase === 'error' && <div className="messages-state messages-error" role="alert">{controller.state.error?.message}<button className="btn ghost" type="button" onClick={() => void controller.reload()}>重试</button></div>}
        {controller.state.listPhase === 'success' && visibleConversations.length === 0 && <div className="messages-state"><strong>没有匹配的会话</strong><span>试试用户昵称、商品标题或最后一条消息。</span></div>}
        {controller.state.listPhase === 'success' && visibleConversations.length > 0 && <ConversationList conversations={visibleConversations} activeConversationId={controller.state.activeConversationId} onSelect={controller.setActiveConversation} hasMore={Boolean(search.trim() === '' && !unreadOnly && controller.state.hasMore)} loadingMore={controller.state.loadingMore} onLoadMore={() => void controller.loadMoreConversations()} />}
      </aside>
      <main className="messages-main">
        <header className="messages-main-header">
          <div className="messages-main-identity">
            <span className="messages-main-avatar">{activeConversation?.buyerAvatarUrl ? <img src={activeConversation.buyerAvatarUrl} alt="" /> : (activeConversation?.buyerDisplayName || activeConversation?.buyerRef || '会').slice(0, 1)}</span>
            <div><strong>{activeConversation?.buyerDisplayName || activeConversation?.buyerRef || '选择会话'}</strong><small>{activeConversation ? `用户 ID：${activeConversation.buyerRef}` : '从左侧选择一个会话'}</small></div>
          </div>
          <div className="messages-main-header-meta"><span>{activeConversation?.itemTitle || '未关联商品'}</span><span className={`messages-connection-dot ${controller.state.realtimePhase}`} /></div>
        </header>
        {controller.state.activeConversationId ? <><MessageTimeline messages={controller.state.messages} phase={controller.state.timelinePhase} /><form className="messages-composer" onSubmit={(event) => { event.preventDefault(); if (!draft.trim() || controller.state.sendPhase === 'submitting') return; void controller.sendMessage(draft).then(() => setDraft('')).catch(() => undefined); }}><textarea aria-label="消息内容" value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} placeholder="输入回复，Enter 发送，Shift+Enter 换行" rows={2} /><div className="messages-composer-footer"><span className={controller.state.sendPhase === 'error' ? 'messages-send-error' : 'messages-send-status'}>{controller.state.sendPhase === 'submitting' ? '正在发送…' : controller.state.sendPhase === 'sent' ? '已发送' : controller.state.sendError ?? '发送给当前会话'}</span><button className="btn primary" type="submit" disabled={!draft.trim() || controller.state.sendPhase === 'submitting'}>发送</button></div></form></> : <div className="messages-state messages-empty-main"><strong>选择一个会话开始查看</strong><span>左侧可搜索、筛选并选择全部会话。</span></div>}
      </main>
    </div>
  </section>;
}
