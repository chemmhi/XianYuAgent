import { useMemo, useState } from 'react';
import { useAccountContext } from '../../../app/account-context';
import { createMessagesApi, type MessagesApi } from '../api';
import { useMessagesController } from '../controller';
import { ConnectionBanner } from './ConnectionBanner';
import { ConversationList } from './ConversationList';
import { MessageTimeline } from './MessageTimeline';
import './messages.css';

export function MessagesPage({ api: providedApi }: { api?: MessagesApi }) {
  const { accounts, currentAccountId, currentAccount, accountsLoading, accountsError } = useAccountContext();
  const api = useMemo(() => providedApi ?? createMessagesApi({ get: async () => { throw new Error('messages api unavailable'); } }), [providedApi]);
  const controller = useMessagesController({ api, accountId: currentAccountId });
  const [draft, setDraft] = useState('');
  const activeConversation = controller.state.conversations.find((conversation) => conversation.conversationId === controller.state.activeConversationId);

  if (accountsLoading) return <section className="page-stack messages-domain"><div className="messages-state">正在加载账号范围…</div></section>;
  if (accountsError) return <section className="page-stack messages-domain"><div className="messages-state messages-error" role="alert">{accountsError}</div></section>;
  if (accounts.length === 0) return <section className="page-stack messages-domain"><div className="messages-state"><strong>请先连接闲鱼账号</strong><span>在线聊天需要先在账号管理中连接至少一个可用账号。</span><a className="btn ghost" href="/accounts">前往账号管理</a></div></section>;
  if (!currentAccountId || !currentAccount) return <section className="page-stack messages-domain"><div className="messages-state"><strong>请先设置当前账号</strong><span>聊天页面沿用账号管理中的全局账号上下文，不在此处切换账号。</span><a className="btn ghost" href="/accounts">前往账号管理</a></div></section>;

  return <section className="page-stack messages-domain" data-messages-domain>
    <div className="page-title"><div><p className="eyebrow">Messages / Realtime</p><h1>在线聊天</h1><p>沿用账号管理中的当前账号，读取真实闲鱼会话并直接回复。</p></div><div className="page-title-actions"><span className="messages-live-badge">真实连接</span></div></div>
    <ConnectionBanner phase={controller.state.realtimePhase} onRetry={controller.retryRealtime} />
    <div className="messages-layout card panel">
      <aside className="messages-sidebar"><div className="messages-sidebar-header"><strong>会话</strong><button className="btn ghost" type="button" onClick={() => void controller.reload()}>刷新</button></div>{controller.state.listPhase === 'loading' && <div className="messages-state">正在加载会话…</div>}{controller.state.listPhase === 'empty' && <div className="messages-state">当前账号暂无会话。</div>}{controller.state.listPhase === 'forbidden' && <div className="messages-state messages-error" role="alert">无权读取该账号会话。</div>}{controller.state.listPhase === 'error' && <div className="messages-state messages-error" role="alert">{controller.state.error?.message}<button className="btn ghost" type="button" onClick={() => void controller.reload()}>重试</button></div>}{controller.state.listPhase === 'success' && <ConversationList conversations={controller.state.conversations} activeConversationId={controller.state.activeConversationId} onSelect={controller.setActiveConversation} />}</aside>
      <main className="messages-main"><header className="messages-main-header"><div><strong>{activeConversation?.buyerDisplayName || activeConversation?.buyerRef || '选择会话'}</strong><small>{activeConversation?.itemTitle || '未关联商品'}{activeConversation?.handlingMode === 'human' ? ' · 人工处理中' : ''}</small></div><span className={`messages-connection-dot ${controller.state.realtimePhase}`} /></header>{controller.state.activeConversationId ? <><MessageTimeline messages={controller.state.messages} phase={controller.state.timelinePhase} /><form className="messages-composer" onSubmit={(event) => { event.preventDefault(); if (!draft.trim() || controller.state.sendPhase === 'submitting') return; void controller.sendMessage(draft).then(() => setDraft('')).catch(() => undefined); }}><textarea aria-label="消息内容" value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} placeholder="输入回复，Enter 发送，Shift+Enter 换行" rows={2} /><div className="messages-composer-footer"><span className={controller.state.sendPhase === 'error' ? 'messages-send-error' : 'messages-send-status'}>{controller.state.sendPhase === 'submitting' ? '正在发送…' : controller.state.sendPhase === 'sent' ? '已发送' : controller.state.sendError ?? '发送给当前会话'}</span><button className="btn primary" type="submit" disabled={!draft.trim() || controller.state.sendPhase === 'submitting'}>发送</button></div></form></> : <div className="messages-state">从左侧选择一个会话查看消息时间线。</div>}</main>
    </div>
  </section>;
}
