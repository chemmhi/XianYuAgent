import { useMemo } from 'react';
import { useAccountContext } from '../../../app/account-context';
import { createMessagesApi, type MessagesApi } from '../api';
import { useMessagesController } from '../controller';
import { AccountTabs } from './AccountTabs';
import { ConnectionBanner } from './ConnectionBanner';
import { ConversationList } from './ConversationList';
import { MessageTimeline } from './MessageTimeline';
import './messages.css';

export function MessagesPage({ api: providedApi }: { api?: MessagesApi }) {
  const { accounts, currentAccountId, setCurrentAccountId, accountsLoading, accountsError } = useAccountContext();
  const api = useMemo(() => providedApi ?? createMessagesApi({ get: async () => { throw new Error('messages api unavailable'); } }), [providedApi]);
  const controller = useMessagesController({ api, accountId: currentAccountId });
  const activeConversation = controller.state.conversations.find((conversation) => conversation.conversationId === controller.state.activeConversationId);

  if (accountsLoading) return <section className="page-stack messages-domain"><div className="messages-state">正在加载账号范围…</div></section>;
  if (accountsError) return <section className="page-stack messages-domain"><div className="messages-state messages-error" role="alert">{accountsError}</div></section>;
  if (accounts.length === 0) return <section className="page-stack messages-domain"><div className="messages-state"><strong>请先连接闲鱼账号</strong><span>在线聊天需要先选择一个可用账号范围。</span></div></section>;

  return <section className="page-stack messages-domain" data-messages-domain>
    <div className="page-title"><div><p className="eyebrow">Messages / Realtime</p><h1>在线聊天</h1><p>按账号查看会话与只读消息时间线，断线后自动按游标补事件。</p></div><div className="page-title-actions"><span className="messages-readonly-badge">只读首片</span></div></div>
    <AccountTabs accounts={accounts} activeAccountId={currentAccountId} onSelect={(accountId) => void setCurrentAccountId(accountId)} />
    <ConnectionBanner phase={controller.state.realtimePhase} onRetry={controller.retryRealtime} />
    <div className="messages-layout card panel">
      <aside className="messages-sidebar"><div className="messages-sidebar-header"><strong>会话</strong><button className="btn ghost" type="button" onClick={() => void controller.reload()}>刷新</button></div>{controller.state.listPhase === 'loading' && <div className="messages-state">正在加载会话…</div>}{controller.state.listPhase === 'empty' && <div className="messages-state">当前账号暂无会话。</div>}{controller.state.listPhase === 'forbidden' && <div className="messages-state messages-error" role="alert">无权读取该账号会话。</div>}{controller.state.listPhase === 'error' && <div className="messages-state messages-error" role="alert">{controller.state.error?.message}<button className="btn ghost" type="button" onClick={() => void controller.reload()}>重试</button></div>}{controller.state.listPhase === 'success' && <ConversationList conversations={controller.state.conversations} activeConversationId={controller.state.activeConversationId} onSelect={controller.setActiveConversation} />}</aside>
      <main className="messages-main"><header className="messages-main-header"><div><strong>{activeConversation?.buyerDisplayName || activeConversation?.buyerRef || '选择会话'}</strong><small>{activeConversation?.itemTitle || '未关联商品'}{activeConversation?.handlingMode === 'human' ? ' · 人工处理中' : ''}</small></div><span className={`messages-connection-dot ${controller.state.realtimePhase}`} /></header>{controller.state.activeConversationId ? <MessageTimeline messages={controller.state.messages} phase={controller.state.timelinePhase} /> : <div className="messages-state">从左侧选择一个会话查看消息时间线。</div>}</main>
    </div>
  </section>;
}
