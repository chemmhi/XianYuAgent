import { type MouseEvent, type ReactNode, useEffect, useMemo, useState } from 'react';
import { api, apiMode } from './api';
import type { DashboardSnapshot } from './api/contracts';
import { navItems, type PageKey } from './app/navigation';
import type { Tone } from './shared/ui/types';
import { AccountsPage as AccountsDomainPage } from './features/accounts';

type ViewMode = 'desktop' | 'mobile' | 'auth';

const kpis = [
  { label: '今日订单金额', value: '¥18,640', delta: '+12.8%', context: '较昨日', tone: 'ok' as Tone },
  { label: '自动处理成功率', value: '96.8%', delta: '+2.1%', context: '7日均值', tone: 'ok' as Tone },
  { label: '待人工处理', value: '3', delta: '-4', context: '风险待办', tone: 'warn' as Tone },
  { label: '可售卡密库存', value: '1,286', delta: '健康', context: '虚拟资源', tone: 'info' as Tone }
];

const trendPoints = [58, 64, 61, 75, 72, 84, 91, 88, 96, 102, 98, 116];
const stockPoints = [52, 57, 63, 66, 68, 73, 75, 79, 83, 86, 88, 93];

function Icon({ name }: { name: string }) {
  if (name === 'grid') return <svg viewBox="0 0 24 24"><rect x="4" y="4" width="6" height="6" rx="1.5"/><rect x="14" y="4" width="6" height="6" rx="1.5"/><rect x="4" y="14" width="6" height="6" rx="1.5"/><rect x="14" y="14" width="6" height="6" rx="1.5"/></svg>;
  if (name === 'message') return <svg viewBox="0 0 24 24"><path d="M5 6.5h14M5 11.5h10M5 16.5h7"/><path d="M4 4h16v13H9l-4 3v-3H4z"/></svg>;
  if (name === 'user') return <svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.5"/><path d="M5.5 20c1.1-3.6 3.2-5.4 6.5-5.4s5.4 1.8 6.5 5.4"/></svg>;
  if (name === 'book') return <svg viewBox="0 0 24 24"><path d="M6 4h9a3 3 0 0 1 3 3v13H8a2 2 0 0 1-2-2z"/><path d="M8 4v14M10 8h5M10 12h5"/></svg>;
  if (name === 'inbox') return <svg viewBox="0 0 24 24"><path d="M4.5 13 7 5h10l2.5 8"/><path d="M4.5 13h4l1.5 3h4l1.5-3h4v6H4.5z"/></svg>;
  if (name === 'box') return <svg viewBox="0 0 24 24"><path d="m12 4 8 4-8 4-8-4 8-4Z"/><path d="m4 8v8l8 4 8-4V8M12 12v8"/></svg>;
  if (name === 'ticket') return <svg viewBox="0 0 24 24"><path d="M4 7.5A2.5 2.5 0 0 0 6.5 5h11A2.5 2.5 0 0 0 20 7.5V9a2 2 0 0 0 0 4v1.5A2.5 2.5 0 0 0 17.5 17h-11A2.5 2.5 0 0 0 4 14.5V13a2 2 0 0 0 0-4V7.5Z"/><path d="M12 7v10"/></svg>;
  if (name === 'cart') return <svg viewBox="0 0 24 24"><path d="M4 5h2l2.1 10.2a2 2 0 0 0 2 1.6h6.8a2 2 0 0 0 1.9-1.4L20 9H7"/><circle cx="10" cy="19" r="1.2"/><circle cx="17" cy="19" r="1.2"/></svg>;
  if (name === 'send') return <svg viewBox="0 0 24 24"><path d="m4 4 16 8-16 8 3.5-8L4 4Z"/><path d="M7.5 12H20"/></svg>;
  if (name === 'trend') return <svg viewBox="0 0 24 24"><path d="M4 18h16"/><path d="M6 15l4-4 3 2 5-7"/><path d="M16 6h2v2"/></svg>;
  if (name === 'gear') return <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M4.2 7.5l2.6 1.5M17.2 15l2.6 1.5M19.8 7.5 17.2 9M6.8 15l-2.6 1.5"/></svg>;
  if (name === 'bell') return <svg viewBox="0 0 24 24"><path d="M7 10a5 5 0 0 1 10 0v4l2 3H5l2-3z"/><path d="M10 19a2 2 0 0 0 4 0"/></svg>;
  return <svg viewBox="0 0 24 24"><path d="M5 12h14"/></svg>;
}

function Logo() { return <div className="logo-mark" aria-label="XianyuSellerAgent"><span/><span/><span/><span/></div>; }
function Badge({ tone = 'gray', children }: { tone?: Tone; children: string }) { return <span className={'badge badge-' + tone}>{children}</span>; }
function KpiCard({ label, value, delta, context, tone }: typeof kpis[number]) { return <article className="card kpi-card"><div className="kpi-label">{label}</div><div className="kpi-value">{value}</div><div className="kpi-delta"><span className={'tone-' + tone}>{delta}</span><small>{context}</small></div></article>; }

function MiniAreaChart({ primary = trendPoints, secondary = stockPoints }: { primary?: number[]; secondary?: number[] }) {
  const makePath = (points: number[]) => {
    const max = Math.max(...points); const min = Math.min(...points); const w = 520; const h = 170;
    return points.map((p, i) => { const x = 18 + (i * (w - 36)) / (points.length - 1); const y = 14 + (h - 34) * (1 - (p - min) / Math.max(1, max - min)); return (i === 0 ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1); }).join(' ');
  };
  const primaryPath = makePath(primary); const secondaryPath = makePath(secondary);
  return <div className="chart-wrap" role="img" aria-label="订单金额与自动处理趋势图"><svg viewBox="0 0 520 188" preserveAspectRatio="none"><defs><linearGradient id="gPrimary" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#245A8D" stopOpacity="0.12"/><stop offset="100%" stopColor="#245A8D" stopOpacity="0.01"/></linearGradient><linearGradient id="gSecondary" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#2E7D5B" stopOpacity="0.10"/><stop offset="100%" stopColor="#2E7D5B" stopOpacity="0.01"/></linearGradient></defs>{[40, 78, 116, 154].map(y => <line key={y} x1="20" x2="500" y1={y} y2={y} className="chart-grid"/>)}<path d={secondaryPath + ' L 502 176 L 18 176 Z'} fill="url(#gSecondary)"/><path d={primaryPath + ' L 502 176 L 18 176 Z'} fill="url(#gPrimary)"/><path d={secondaryPath} className="chart-line chart-line-secondary"/><path d={primaryPath} className="chart-line"/>{['周一','周二','周三','周四','周五','周六'].map((d, i) => <text key={d} x={28 + i * 92} y="184" className="axis-text">{d}</text>)}</svg><div className="chart-legend"><span><i className="legend-line primary"/>订单金额</span><span><i className="legend-line secondary"/>AI 闭环率</span></div></div>;
}

function Sidebar({ page, onPage, collapsed, onToggle }: { page: PageKey; onPage: (p: PageKey) => void; collapsed: boolean; onToggle: () => void }) {
  return <aside className="sidebar">
    <div className="brand-block">
      <Logo/>
      <div className="brand-copy"><strong>Xianyu Agent</strong><span>Agent OS Console</span></div>
      <button className="collapse-button" onClick={onToggle} aria-label={collapsed ? '展开侧边栏' : '收起侧边栏'} title={collapsed ? '展开侧边栏' : '收起侧边栏'}>{collapsed ? '›' : '‹'}</button>
    </div>
    <div className="side-section">Operations</div>
    <nav className="side-nav" aria-label="主导航">
      {navItems.map(item => <button key={item.key} className={page === item.key ? 'active' : ''} onClick={() => onPage(item.key)} title={item.label}><Icon name={item.icon}/><span>{item.label}</span><small>{item.sub}</small></button>)}
    </nav>
    <div className="sidebar-bottom">
      <div className="side-card agent-card"><span className="online-dot"/><b>Agent 运行中</b><small>当前账号：闲鱼账号 A<br/>外部写动作经 Policy Gateway 与 Outbox。</small></div>
      <button className="sidebar-alert" aria-label="通知"><Icon name="bell"/><b>3</b><span>待确认动作</span></button>
      <div className="sidebar-user"><div className="avatar">陈</div><div><strong>运营管理员</strong><span>资料自动发货店</span></div></div>
    </div>
  </aside>;
}


function DashboardPage() {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);

  useEffect(() => {
    let active = true;
    api.dashboard.getSnapshot().then((next) => {
      if (active) setSnapshot(next);
    }).catch(() => {
      if (active) setSnapshot(null);
    });
    return () => { active = false; };
  }, []);

  const dashboardKpis = snapshot ? [
    { label: '今日订单金额', value: `¥${snapshot.todayOrderAmount.toLocaleString('zh-CN')}`, delta: '实时', context: '今日汇总', tone: 'ok' as Tone },
    { label: '自动处理成功率', value: `${snapshot.autoProcessRate}%`, delta: '实时', context: '当前账号', tone: 'ok' as Tone },
    { label: '待人工处理', value: String(snapshot.pendingManualCount), delta: '待处理', context: '风险待办', tone: 'warn' as Tone },
    { label: '可售卡密库存', value: snapshot.availableCouponCount.toLocaleString('zh-CN'), delta: '健康', context: '虚拟资源', tone: 'info' as Tone },
  ] : kpis;
  const primary = snapshot?.trend.map((item) => item.orderAmount) ?? trendPoints;
  const secondary = snapshot?.trend.map((item) => item.autoProcessRate) ?? stockPoints;

  return <section className="page-stack"><div className="page-title"><div><p className="eyebrow">Dashboard Plugin</p><h1>仪表盘</h1><p>承接旧项目订单统计、有效订单、商品库存和趋势图；后续由 Dashboard Plugin Manifest 版本化维护。</p></div><div className="button-row"><Badge tone={apiMode === 'live' ? 'ok' : 'info'}>{apiMode === 'live' ? 'Live API' : 'Mock API'}</Badge><button className="btn primary">打开插件配置</button></div></div><div className="kpi-grid">{dashboardKpis.map(k => <KpiCard key={k.label} {...k}/>)}</div><div className="main-grid"><article className="card panel"><div className="panel-head"><div><h2>订单与 AI 闭环趋势</h2><p>最近 7 天订单金额、自动回复成功率和人工接管变化。</p></div><Badge tone="ok">实时更新</Badge></div><MiniAreaChart primary={primary} secondary={secondary}/></article><article className="card panel compact"><h2>当前账号健康度</h2><div className="health-list"><div><span>监听心跳</span><Badge tone="ok">正常</Badge></div><div><span>自动回复策略</span><Badge tone="info">180 秒</Badge></div><div><span>虚拟发货</span><Badge tone="ok">立即发货</Badge></div><div><span>凭证边界</span><Badge tone="warn">管理员可管理</Badge></div></div><div className="deep-card"><strong>Action Policy Gateway</strong><p>3 个高风险动作等待人工确认；所有发送动作写入 Outbox、幂等键和审计。</p></div></article></div><div className="two-grid"><article className="card panel"><h2>商品排行</h2><div className="data-table products"><div className="table-head"><span>商品</span><span>订单</span><span>库存</span><span>状态</span></div>{['Python 全栈资料包','AI 绘画教程合集','考研英语资料','自动化办公模板'].map((name, i) => <div className="table-row" key={name}><span><b>{name}</b><small>{i < 2 ? '虚拟资源 · 凭证完整' : '知识待补充'}</small></span><span>{[42, 31, 18, 12][i]}</span><span>{[368, 220, 0, 90][i]}</span><Badge tone={i === 2 ? 'warn' : 'ok'}>{i === 2 ? '缺凭证' : '可售'}</Badge></div>)}</div></article><article className="card panel"><h2>最近处理记录</h2><Timeline items={[[ '14:22','小橙子询问付款后发货时间，AI 已引用商品知识 v12 回复。','AI 已回复','ok'],['14:18','订单 XY20260909001 已付款，Outbox 立即发货成功。','已发货','ok'],['14:11','买家索要跨商品资源，系统拦截并通知管理员。','风险待确认','warn'],['13:58','考研英语资料缺 buyer_deliverable 凭证，生成待办。','补凭证','warn']]}/></article></div></section>;
}

function WorkspacePage() {
  const sessions = [['商品发布助手','上传图片并生成发布确认卡','刚刚','active'],['订单查询','查询 XY202609180012 的状态','8 分钟前',''],['卡券生成','为 Python 全栈资料包生成卡密','昨天',''],['账号诊断','闲鱼账号 B 需要重新登录','昨天','']];
  return <section className="page-stack wide-page workspace-page"><div className="page-title"><div><p className="eyebrow">Agent Workspace</p><h1>Workspace</h1><p>在同一条对话里调用商品、账号、卡券和订单能力；所有外部写动作先生成确认卡片。</p></div><div className="workspace-status"><span className="online-dot"/>Agent 在线 · 闲鱼账号 A</div></div><div className="workspace-layout"><aside className="workspace-sidebar"><section className="workspace-panel card workspace-sessions"><div className="panel-head"><div><h2>会话</h2><p>最近的 Agent 任务</p></div><button className="icon-button" aria-label="新建会话">+</button></div><div className="workspace-search">⌕<span>搜索会话</span></div><div className="workspace-session-list">{sessions.map(([title, meta, time, state]) => <button className={'workspace-session ' + state} key={title}><span className="session-icon"><Icon name={title === '订单查询' ? 'cart' : title === '卡券生成' ? 'ticket' : title === '账号诊断' ? 'user' : 'box'}/></span><span className="session-copy"><b>{title}</b><small>{meta}</small></span><time>{time}</time></button>)}</div></section>
<section className="workspace-panel card workspace-context"><div className="panel-head"><div><h2>当前上下文</h2><p>本次对话可直接使用</p></div><Badge tone="ok">已加载</Badge></div><div className="context-account"><div className="avatar">A</div><div><b>闲鱼账号 A</b><small>资料自动发货店 · 在线</small></div></div><div className="context-list"><span><b>商品</b><em>Python 全栈资料包</em></span><span><b>当前订单</b><em>XY202609180012</em></span><span><b>可用能力</b><em>商品 / 图片 / 卡券 / 订单</em></span></div><div className="context-footer"><span className="model-dot"/> <span>Manifest v1.4 已同步</span></div></section></aside><section className="workspace-chat card"><header className="workspace-chat-head"><div><p className="eyebrow">商品发布助手</p><h2>准备发布 Python 全栈资料包</h2><span>当前会话 · 4 个步骤 · 需要 1 次人工确认</span></div><div className="workspace-head-actions"><Badge tone="ok">Agent 在线</Badge><button className="btn ghost">查看 Manifest</button></div></header><div className="workspace-chat-body"><div className="chat-date">今天 14:28</div><div className="bubble user">帮我上传这件商品的 3 张图片，检查卡券库存，然后生成发布确认卡。</div><div className="bubble ai"><b>我会按以下顺序处理：</b><br/>先确认账号和商品上下文，再上传图片、检查卡券库存，最后把商品发布动作放入确认卡。不会直接发布。</div>
<div className="agent-plan"><div className="plan-head"><div><h3>执行计划</h3><p>所有步骤都来自后端 Manifest 能力清单</p></div><Badge tone="info">进行中</Badge></div><div className="agent-steps"><div className="agent-step done"><span>✓</span><div><b>定位商品</b><small>Python 全栈资料包 · ITEM-93821</small></div><em>完成</em></div><div className="agent-step done"><span>✓</span><div><b>校验账号状态</b><small>闲鱼账号 A · 在线</small></div><em>完成</em></div><div className="agent-step current"><span>3</span><div><b>上传商品图片</b><small>已识别 3 张图片，等待写入</small></div><em>进行中</em></div><div className="agent-step"><span>4</span><div><b>生成发布确认卡</b><small>等待图片上传完成</small></div><em>待执行</em></div></div></div><div className="bubble ai">图片已准备好，卡券库存也已校验：可用 368 张。接下来需要你确认商品发布信息。</div><div className="publish-summary"><div className="confirm-head"><div><h2>发布商品确认</h2><p>外部写动作 · 发布到闲鱼账号 A</p></div><Badge tone="warn">需要确认</Badge></div><div className="publish-grid"><span><small>商品标题</small><b>Python 全栈资料包</b></span><span><small>售价</small><b>¥29.90</b></span><span><small>图片</small><b>3 张 · 已上传</b></span><span><small>卡券库存</small><b>368 张可用</b></span></div><div className="publish-audit"><span>policy_ref: product.publish.confirm</span><span>audit: AUD-20260918-1429</span><span>idempotency: ITEM-93821-PUBLISH-01</span></div><div className="card-actions"><button className="btn primary">确认发布</button><button className="btn ghost">修改商品信息</button><button className="btn danger">取消</button></div></div></div><WorkspaceComposer/></section></div></section>;
}
function ConfirmationCard() { return <div className="confirm-card"><div className="confirm-head"><div><h2>虚拟资源商品配置确认</h2><p>商品：Python 全栈资料包｜当前账号：闲鱼账号 A｜审计事件：AUD-20260909-1422</p></div><Badge tone="warn">需要人工确认</Badge></div><div className="diff-grid"><div><h3>修改前</h3><p>is_virtual_resource = false<br/>delivery_trigger = manual<br/>delivery_credential_refs = 空</p></div><div><h3>修改后</h3><p>is_virtual_resource = true<br/>delivery_trigger = paid_order<br/>credential_ref = cred_quark_python_bundle_001<br/>usage_scope = buyer_deliverable</p></div></div><p className="muted-text">确认后通过 Action Policy Gateway 校验，写入商品知识版本并投递 Outbox；不会在对话或 Trace 中记录资源明文。</p><div className="card-actions"><button className="btn primary">确认配置</button><button className="btn ghost">打开全屏 HTML 预览</button><button className="btn danger">取消</button></div></div>; }
function WorkspaceComposer() {
  return <div className="workspace-composer" role="group" aria-label="Workspace 输入框">
    <textarea placeholder="随心输入：例如“补齐考研英语资料的发货凭证，并生成确认卡片”" />
    <div className="composer-bottom">
      <div className="composer-tools"><button aria-label="添加附件">+</button><button aria-label="自定义"><Icon name="gear"/><span>自定义</span></button></div>
      <div className="composer-meta"><span className="model-dot"/> <span>6 Astra</span><span>中</span><button className="send-round" aria-label="发送">&uarr;</button></div>
    </div>
  </div>;
}

function AccountsPage() { return <section className="page-stack"><div className="page-title"><div><p className="eyebrow">Account Context</p><h1>店铺 / 账号管理</h1><p>平台每次只管理一个当前闲鱼账号；Skill 平台通用，商品、订单、消息、知识和凭证按账号隔离。</p></div><button className="btn primary">添加闲鱼账号</button></div><div className="kpi-grid three"><KpiCard label="已绑定账号" value="3" delta="2 个在线" context="多账号隔离" tone="ok"/><KpiCard label="当前账号" value="A" delta="资料自动发货店" context="工作上下文" tone="info"/><KpiCard label="今日账号切换" value="5" delta="已审计" context="权限范围" tone="ok"/></div><article className="card panel"><h2>账号列表</h2><div className="data-table accounts"><div className="table-head"><span>账号</span><span>登录状态</span><span>自动回复</span><span>凭证状态</span><span>操作</span></div>{[['闲鱼账号 A','当前工作账号｜资料自动发货店','在线','启用','完整','current'],['闲鱼账号 B','副店铺｜课程资料','需刷新登录','暂停','待刷新','refresh'],['闲鱼账号 C','测试账号','在线','未启用','完整','normal']].map((r, i) => <div className="table-row" key={r[0]}><span><b>{r[0]}</b><small>{r[1]}</small></span><Badge tone={i === 1 ? 'warn' : 'ok'}>{r[2]}</Badge><Badge tone={r[3] === '启用' ? 'ok' : 'gray'}>{r[3]}</Badge><span>{r[4]}</span><div className="account-actions"><button className={i === 0 ? 'btn ghost' : 'btn primary'}>{i === 0 ? '当前使用中' : '切换到此账号'}</button><button className="btn ghost">重新扫码授权</button><button className="btn danger">删除账号</button></div></div>)}</div></article></section>; }
function CatalogToolbar({ title, subtitle, action }: { title: string; subtitle: string; action: string }) {
  return <div className="catalog-toolbar"><div className="catalog-toolbar-copy"><h2>{title}</h2><p>{subtitle}</p></div><div className="catalog-toolbar-actions"><div className="table-filter">⌕ <span>搜索关键词</span></div><button className="btn ghost">筛选</button><button className="btn primary">{action}</button></div></div>;
}

function ProductsPage() {
  const rows = [
    ['A','ITEM-93821','AI远程办公远程接收致体验接近原生','¥39.90','368','在售','2026-09-18 14:10','是','4','是','是','卡券批次 CP-20260918-001'],
    ['A','ITEM-93817','GitHub下载源码下载免网络终身免费','¥19.90','129','在售','2026-09-18 13:42','否','3','否','是','卡券批次 CP-20260917-004'],
    ['A','ITEM-93792','婚礼视频，AI婚礼视频制作','¥99.00','12','草稿','2026-09-17 18:24','否','6','是','否','未关联'],
    ['B','ITEM-93688','ComfyUI全套系统票基础训练营','¥129.00','0','缺货','2026-09-16 10:18','是','8','是','是','卡券批次 CP-20260916-012'],
    ['A','ITEM-93621','100 个句子记完 7000 个雅思单词','¥29.90','86','在售','2026-09-15 16:08','否','2','否','是','卡券批次 CP-20260915-008'],
    ['C','ITEM-93482','Acrobat DC 最新最低价','¥15.90','46','下架','2026-09-12 09:31','是','1','否','否','未关联'],
    ['A','ITEM-93380','Hermes Agent爱马仕企业级实战','¥59.90','24','在售','2026-09-10 11:20','否','5','是','是','卡券批次 CP-20260912-003'],
    ['B','ITEM-93124','超级个体AI课实现一人即公司完整体','¥69.90','8','草稿','2026-09-08 20:04','否','7','是','否','未关联']
  ];
  return <section className="page-stack wide-page catalog-page"><div className="page-title"><div><p className="eyebrow">Product Catalog</p><h1>商品管理</h1><p>按账号管理商品信息、图片、规格和发布状态；发布动作由 Workspace 生成确认卡。</p></div><Badge tone="info">8 个商品</Badge></div><article className="card panel catalog-panel"><CatalogToolbar title="商品列表" subtitle="当前账号 A · 共 8 条商品记录" action="上传商品"/><div className="catalog-scroll"><div className="data-table catalog-table product-catalog"><div className="table-head"><span>□</span><span>账号 ID</span><span>商品 ID</span><span>商品标题</span><span>价格</span><span>库存</span><span>状态</span><span>上架时间</span><span>擦亮</span><span>规格数</span><span>多规格</span><span>多数量发货</span><span>关联</span><span>操作</span></div>{rows.map((r, index) => <div className="table-row" key={r[1]}><span><input type="checkbox" aria-label={'选择 ' + r[2]}/></span><span>{r[0]}</span><span className="mono-text">{r[1]}</span><span><b>{r[2]}</b><small>{index % 2 === 0 ? '虚拟资源 · 自动发货' : '数字商品 · 手动校验'}</small></span><span className="price-text">{r[3]}</span><span>{r[4]}</span><Badge tone={r[5] === '在售' ? 'ok' : r[5] === '缺货' ? 'warn' : 'gray'}>{r[5]}</Badge><span className="time-text">{r[6]}</span><span>{r[7]}</span><span>{r[8]}</span><span>{r[9]}</span><span>{r[10]}</span><span className="link-text">{r[11]}</span><div className="table-actions"><button className="btn ghost">编辑</button><button className="btn ghost">查看</button></div></div>)}</div></div><div className="table-footer"><span>已选 0 条</span><span>显示 1-8 条，共 8 条</span></div></article></section>;
}

function CouponsPage() {
  const rows = [
    ['CP-20260918-001','Python 全栈资料包','368','可用','368','2026-09-18 14:02','闲鱼账号 A'],
    ['CP-20260917-004','GitHub 源码下载','200','已绑定','129','2026-09-17 10:44','闲鱼账号 A'],
    ['CP-20260916-012','ComfyUI 基础训练营','100','库存预警','12','2026-09-16 09:18','闲鱼账号 B'],
    ['CP-20260915-008','雅思单词 7000 词','120','已交付','0','2026-09-15 16:00','闲鱼账号 A'],
    ['CP-20260912-003','Hermes Agent 企业实战','80','已作废','0','2026-09-12 11:20','闲鱼账号 A']
  ];
  return <section className="page-stack wide-page catalog-page"><div className="page-title"><div><p className="eyebrow">Coupon Inventory</p><h1>卡券管理</h1><p>生成、绑定和交付虚拟商品卡密；卡密正文只在凭证边界内流转。</p></div><Badge tone="ok">1,286 张可用</Badge></div><article className="card panel catalog-panel"><CatalogToolbar title="卡券批次" subtitle="按批次查看库存、绑定商品和交付状态" action="生成卡密"/><div className="catalog-scroll"><div className="data-table catalog-table coupon-catalog"><div className="table-head"><span>批次编号</span><span>绑定商品</span><span>批次</span><span>状态</span><span>可用数量</span><span>生成时间</span><span>所属账号</span><span>操作</span></div>{rows.map(r => <div className="table-row" key={r[0]}><span className="mono-text">{r[0]}</span><span><b>{r[1]}</b><small>凭证范围：buyer_deliverable</small></span><span>{r[2]}</span><Badge tone={r[3] === '可用' ? 'ok' : r[3] === '库存预警' ? 'warn' : r[3] === '已作废' ? 'danger' : 'gray'}>{r[3]}</Badge><span className={r[4] === '0' ? 'danger-text' : 'price-text'}>{r[4]}</span><span className="time-text">{r[5]}</span><span>{r[6]}</span><div className="table-actions"><button className="btn ghost">查看</button><button className="btn ghost">补充</button></div></div>)}</div></div><div className="table-footer"><span>共 5 个批次</span><span>库存预警 1 个批次 · 已作废 1 个批次</span></div></article></section>;
}

function OrdersPage() {
  const rows = [
    ['XY202609180012','陈赟cc','Python 全栈资料包','¥39.90','已付款','待发货','2026-09-18 14:18','闲鱼账号 A'],
    ['XY202609180009','麦麦折扣','GitHub 源码下载','¥19.90','已完成','已发货','2026-09-18 14:05','闲鱼账号 A'],
    ['XY202609180003','梵子BooM','雅思单词 7000 词','¥29.90','退款中','已交付','2026-09-18 13:58','闲鱼账号 A'],
    ['XY202609170088','北海小姐','Hermes Agent 企业实战','¥59.90','已付款','已发货','2026-09-17 19:24','闲鱼账号 A'],
    ['XY202609170061','胡桃夹子','ComfyUI 基础训练营','¥129.00','已付款','发货失败','2026-09-17 16:40','闲鱼账号 B'],
    ['XY202609170032','用户_16254876','婚礼视频制作','¥99.00','已关闭','未发货','2026-09-17 12:22','闲鱼账号 A']
  ];
  return <section className="page-stack wide-page catalog-page"><div className="page-title"><div><p className="eyebrow">Order Center</p><h1>订单管理</h1><p>查询订单、查看发货状态和人工接管原因；订单写动作仍由 Outbox 幂等执行。</p></div><Badge tone="info">今日 18 单</Badge></div><article className="card panel catalog-panel"><CatalogToolbar title="订单列表" subtitle="当前账号 A · 支持按订单号、买家和商品搜索" action="导出订单"/><div className="catalog-scroll"><div className="data-table catalog-table order-catalog"><div className="table-head"><span>订单号</span><span>买家</span><span>商品</span><span>金额</span><span>支付状态</span><span>发货状态</span><span>下单时间</span><span>账号</span><span>操作</span></div>{rows.map(r => <div className="table-row" key={r[0]}><span className="mono-text">{r[0]}</span><span><b>{r[1]}</b><small>买家 ID：buyer_{r[0].slice(-6)}</small></span><span>{r[2]}</span><span className="price-text">{r[3]}</span><Badge tone={r[4] === '已付款' || r[4] === '已完成' ? 'ok' : r[4] === '退款中' ? 'warn' : 'gray'}>{r[4]}</Badge><Badge tone={r[5] === '已发货' || r[5] === '已交付' ? 'ok' : r[5] === '发货失败' ? 'danger' : 'warn'}>{r[5]}</Badge><span className="time-text">{r[6]}</span><span>{r[7]}</span><div className="table-actions"><button className="btn ghost">详情</button><button className={r[5] === '发货失败' ? 'btn primary' : 'btn ghost'}>{r[5] === '发货失败' ? '重试发货' : '查看审计'}</button></div></div>)}</div></div><div className="table-footer"><span>已选 0 条</span><span>显示 1-6 条，共 18 条</span></div></article></section>;
}
function MessagesPage() {
  const conversations = [['陈赟cc','在吗，付款后多久发货？','14:22','陈'],['麦麦折扣','想了解一下课程更新内容','14:16','麦'],['梵子BooM','已付款，请查收','13:58','梵'],['用户_16254876','可以发一下商品详情吗','13:44','用'],['北海小姐','谢谢，已经收到啦','13:21','北'],['胡桃夹子','这个是永久有效的吗？','12:56','胡'],['好奶分享官可儿','有其他资料推荐吗','12:32','好']];
  return <section className="page-stack wide-page messages-page"><div className="page-title"><div><p className="eyebrow">Live Conversation</p><h1>在线聊天</h1><p>实时查看闲鱼会话，AI 自动回复和人工接管在同一条消息流里完成。</p></div><div className="chat-account-state"><span className="online-dot"/>闲鱼账号 A · 在线</div></div><div className="chat-shell card"><aside className="chat-list-panel"><div className="chat-account-bar"><div className="account-large small"><div className="avatar">A</div><div><strong>闲鱼账号 A</strong><span>资料自动发货店</span></div></div><Badge tone="ok">在线</Badge></div><div className="chat-account-tabs"><button className="active">账号 A</button><button>账号 B</button><button>+</button></div><div className="chat-search">⌕<span>搜索买家或会话</span></div><div className="chat-list-head"><b>全部会话</b><span>18</span></div><div className="chat-list">{conversations.map(([name, preview, time, avatar], index) => <button className={'chat-list-item ' + (index === 0 ? 'active' : '')} key={name}><div className="avatar">{avatar}</div><div className="chat-list-copy"><strong>{name}</strong><span>{preview}</span></div><time>{time}</time>{index < 3 && <i/>}</button>)}</div></aside>
<section className="chat-conversation"><header className="conversation-head"><div className="buyer-strip"><div className="avatar">陈</div><div><strong>陈赟cc</strong><span>用户 ID：buyer_983421 · 备注：高意向买家</span></div></div><div className="conversation-actions"><Badge tone="ok">账号在线</Badge><button className="btn ghost">添加备注</button><button className="icon-button" aria-label="更多操作">···</button></div></header><div className="conversation-meta"><span>今日 14:18 接入</span><span>当前商品：Python 全栈资料包</span><span>AI 托管中</span></div><div className="conversation-body"><div className="message-time">14:18</div><div className="message-row incoming"><div className="message-avatar">陈</div><div><div className="message-bubble">你好，付款之后多久可以发货？</div><small>买家</small></div></div><div className="message-row outgoing"><div><div className="message-bubble">你好，虚拟资源商品付款后会立即自动发送，通常几秒内就能收到。若未收到，可以直接在这里回复我。</div><small>AI 自动回复 · 已引用商品知识 v12</small></div></div><div className="message-row incoming"><div className="message-avatar">陈</div><div><div className="message-bubble">好的，我现在付款。</div><small>买家</small></div></div><div className="message-system"><span className="online-dot"/>订单已付款，Outbox 已创建自动发货任务 · XY202609180012</div></div><footer className="chat-composer"><div className="composer-tools"><button aria-label="添加图片">＋</button><button aria-label="添加表情">☺</button><span>AI 建议回复已开启</span></div><textarea placeholder="输入消息，或让 Agent 先生成回复"/><div className="chat-composer-bottom"><span>按 Enter 发送 · Shift + Enter 换行</span><button className="btn primary"><Icon name="send"/>发送</button></div></footer></section></div></section>;
}
function SettingsPage() {
  const tabs = [
    { id: 'autoReply', label: '自动回复策略', meta: 'Policy' },
    { id: 'model', label: 'OpenAI API', meta: 'ModelClient' },
    { id: 'credentials', label: '凭证管理', meta: 'Database' },
    { id: 'safety', label: '安全输出校验', meta: 'Gateway' },
    { id: 'outbox', label: 'Outbox Worker', meta: 'Runtime' },
    { id: 'plugins', label: '插件配置', meta: 'Skill / Plugin' }
  ] as const;
  type SettingsTabKey = typeof tabs[number]['id'];
  const [activeTab, setActiveTab] = useState<SettingsTabKey>('autoReply');
  const panels = {
    autoReply: <div className="settings-content"><article className="card panel"><div className="panel-head"><div><h2>自动回复策略</h2><p>按当前闲鱼账号配置自动回复、人工介入重新计时、风险拦截和虚拟资源立即发货规则。</p></div><Badge tone="ok">当前生效</Badge></div><FormRows rows={[[ '当前账号','闲鱼账号 A · 资料自动发货店'],['默认超时','180 秒；人工介入后重新计时'],['自动发送条件','AI 可确定回答、知识命中、策略通过、未发生人工回复'],['消息托管','能确定则回复；不能确定则通知管理员并生成待办，不回复买家'],['虚拟资源发货','订单已付款即触发；必须命中 buyer_deliverable 凭证和幂等键'],['高风险拦截','退款、投诉、差评、凭证异常、跨商品资源、Prompt Injection、AI 置信度不足']]}/></article><article className="card panel"><h2>策略闭环</h2><Timeline items={[[ '人工介入','运营发送人工回复后，自动回复任务重新计时。','重计时','info'],['知识缺失','生成“补知识”待办并关联商品知识版本。','待处理','warn'],['凭证缺失','虚拟商品付款后不发送明文，转入管理员补凭证。','拦截','warn'],['审计记录','策略命中、跳过、超时和发送结果均写入 Trace / Audit。','已开启','ok']]}/></article></div>,
    model: <div className="settings-content"><article className="card panel"><div className="panel-head"><div><h2>OpenAI API 兼容模型配置</h2><p>用于 DeepSeek Harness / OpenAI API 兼容 ModelClient；当前配置失败时可切换备用 Provider。</p></div><Badge tone="info">ModelClient</Badge></div><div className="two-grid nested"><ModelBox title="当前配置" status="测试通过，已生效" model="deepseek-chat"/><ModelBox title="备用配置" status="备用可用" model="gpt-4.1-mini"/></div><Timeline items={[[ '生效规则','Base URL、API Key、Model 填写完整且连接测试通过后才生效。','强校验','ok'],['故障切换','当前 Provider 失败、超时、认证失败或限流时尝试备用配置。','Fallback','warn'],['审计边界','记录失败原因、provider、trace_id；API Key 仅显示脱敏摘要。','脱敏','info']]}/></article></div>,
    credentials: <div className="settings-content"><article className="card panel"><div className="panel-head"><div><h2>凭证管理</h2><p>管理员可直接查看、编辑和操作；闲鱼买家只能看到符合订单条件的 buyer_deliverable 内容。</p></div><Badge tone="warn">管理员可管理</Badge></div><div className="settings-panel-grid"><div className="model-box"><h3>买家可交付凭证</h3><FormRows rows={[[ 'usage_scope','buyer_deliverable'],['示例引用','cred_quark_python_bundle_001'],['展示方式','管理员可查看、复制和编辑'],['使用条件','订单已付款 + 商品虚拟资源 + Policy Gateway 通过']]}/></div><div className="model-box"><h3>系统凭证</h3><FormRows rows={[[ 'usage_scope','admin_manageable'],['覆盖内容','闲鱼 Cookie、API Key、夸克主账号登录态'],['管理员操作','可查看、编辑、替换和启停'],['买家边界','不得进入闲鱼买家消息或订单交付']]}/></div></div></article><article className="card panel"><h2>凭证操作记录</h2><Timeline items={[[ '读取','管理员可直接查看当前账号凭证并继续后续操作。','可操作','ok'],['新增/替换','管理员可直接新增、编辑和替换凭证。','可操作','ok'],['买家边界','系统凭证不得发送到闲鱼买家可见链路。','拦截','danger']]}/></article></div>,
    safety: <div className="settings-content"><article className="card panel"><div className="panel-head"><div><h2>安全输出校验</h2><p>买家消息、昵称、订单备注和外部链接均按不可信输入处理，不得触发配置、凭证或插件变更。</p></div><Badge tone="danger">高优先级</Badge></div><Timeline items={[[ 'Prompt Injection','买家要求忽略系统规则、泄露配置或修改策略时拦截。','拦截','danger'],['凭证泄露','要求发送 Cookie、Token、API Key、内部链接或 system_only 凭证时拦截。','拦截','danger'],['非订单交付','未付款或未满足发货条件时，不发送夸克链接、提取码或卡密。','校验','warn'],['数据污染','买家输入不得直接写入知识库、Skill 配置、Dashboard 配置或凭证范围。','隔离','info']]}/></article><article className="card panel"><h2>网关优先级</h2><FormRows rows={[[ '最高优先级','系统指令、Policy Gateway、CredentialStore、Skill Manifest'],['确认卡片','高风险外部写动作必须展示修改前后、风险原因、幂等键和审计引用'],['允许输出','只能引用 受控领域数据 或被授权 buyer_deliverable 凭证'],['失败处理','不能闭环时生成管理员待办并保留 Trace / Replay 样本']]}/></article></div>,
    outbox: <div className="settings-content"><article className="card panel"><div className="panel-head"><div><h2>Outbox Worker / Execution Runtime</h2><p>所有发送闲鱼消息、更新知识库、更新 Dashboard Plugin、触发通知等写动作经 Outbox 执行。</p></div><Badge tone="ok">Worker 正常</Badge></div><div className="settings-panel-grid"><div className="model-box"><h3>运行状态</h3><FormRows rows={[[ 'Worker','online · 最近心跳 14:24:08'],['队列深度','7 pending / 128 succeeded today'],['重试策略','超时、限流和可恢复错误进入指数退避'],['超时控制','每个 capability 使用 Manifest 声明的 timeout']]}/></div><div className="model-box"><h3>执行边界</h3><FormRows rows={[[ '幂等键','shop_id + account_id + action_type + business_id'],['审计','记录请求摘要、执行结果、错误原因和 trace_id'],['Replay','默认使用当时捕获的 SkillResult，避免外部状态漂移'],['人工确认','高风险动作确认后才进入执行队列']]}/></div></div></article></div>,
    plugins: <div className="settings-content"><article className="card panel"><div className="panel-head"><div><h2>插件配置</h2><p>V1 通过 Workspace 对话安装、启用、禁用和升级 Skill / Plugin；不建设独立 Marketplace 页面。</p></div><Badge tone="info">平台通用</Badge></div><div className="data-table plugin-settings"><div className="table-head"><span>模块</span><span>职责</span><span>账号隔离</span><span>状态</span></div>{[['Dashboard Plugin','首页仪表盘 widgets / metrics / queries / layout 版本化','数据按账号隔离','已启用'],['Knowledge Plugin','商品知识、通用知识、知识召回、版本管理','知识按店铺和账号隔离','已启用'],['Policy Plugin','自动回复、风险拦截、外部写动作策略','配置按账号隔离','已启用'],['Executor Plugin','发送消息、更新知识库、通知和 Outbox 结果写入','执行记录按账号隔离','已启用'],['夸克交付 Skill','读取 buyer_deliverable 凭证并生成发货文本','凭证引用按账号隔离','需配置']].map((r, i) => <div className="table-row" key={r[0]}><span><b>{r[0]}</b></span><span>{r[1]}</span><span>{r[2]}</span><Badge tone={i === 4 ? 'warn' : 'ok'}>{r[3]}</Badge></div>)}</div></article><article className="card panel"><h2>版本与发布</h2><Timeline items={[[ '修改入口','运营在 Workspace 中提出修改仪表盘、知识或 Skill 配置。','对话','info'],['发布规则','Dashboard Plugin 被 AI 修改后需要人工点击发布。','确认','warn'],['回滚','Manifest、配置和布局变更生成版本记录并支持回滚。','版本化','ok']]}/></article></div>
  };
  return <section className="page-stack settings-page"><div className="settings-grid"><aside className="card settings-tabs" aria-label="设置分类">{tabs.map(tab => <button key={tab.id} className={activeTab === tab.id ? 'active' : ''} onClick={() => setActiveTab(tab.id)}><span>{tab.label}</span><small>{tab.meta}</small></button>)}</aside><div className="settings-active">{panels[activeTab]}</div></div></section>;
}
function ModelBox({ title, status, model }: { title: string; status: string; model: string }) { return <div className="model-box"><h3>{title}</h3><FormRows rows={[[ 'Base URL','https://api.example.com/v1'],['API Key','sk-••••••••••••••••••••A91F'],['Model', model],['连通性', status]]}/></div>; }
function Timeline({ items }: { items: Array<[string, string, string, string]> }) { return <div className="timeline">{items.map(([time, text, tag, tone]) => <div className="timeline-row" key={time + tag}><strong>{time}</strong><span>{text}</span><Badge tone={tone as Tone}>{tag}</Badge></div>)}</div>; }
function FormRows({ rows }: { rows: Array<[string, string]> }) { return <div className="form-rows">{rows.map(([label, value]) => <div key={label}><label>{label}</label><span>{value}</span></div>)}</div>; }

type PrototypeModal = { title: string; tone: Tone; rows: Array<[string, string]>; confirm?: string };
function ModalHost({ modal, onClose, onConfirm }: { modal: PrototypeModal | null; onClose: () => void; onConfirm: () => void }) {
  if (!modal) return null;
  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={modal.title} onMouseDown={onClose}>
    <section className="modal-card card" onMouseDown={e => e.stopPropagation()}>
      <div className="modal-head"><div><p className="eyebrow">Interaction Preview</p><h2>{modal.title}</h2></div><Badge tone={modal.tone}>{modal.tone === 'danger' ? '高风险' : modal.tone === 'warn' ? '需确认' : '模拟执行'}</Badge></div>
      <div className="modal-body"><FormRows rows={modal.rows}/></div>
      <div className="card-actions"><button className="btn ghost" onClick={onClose}>关闭</button>{modal.confirm && <button className={modal.tone === 'danger' ? 'btn danger' : 'btn primary'} onClick={onConfirm}>{modal.confirm}</button>}</div>
    </section>
  </div>;
}
function ToastHost({ items }: { items: Array<{ id: number; text: string; tone: Tone }> }) {
  return <div className="toast-stack" aria-live="polite">{items.map(item => <div className={'toast toast-' + item.tone} key={item.id}>{item.text}</div>)}</div>;
}

function DesktopShell({ page, setPage, collapsed, setCollapsed }: { page: PageKey; setPage: (p: PageKey) => void; collapsed: boolean; setCollapsed: (v: boolean) => void }) { const Page = useMemo(() => ({ dashboard: DashboardPage, workspace: WorkspacePage, accounts: AccountsDomainPage, messages: MessagesPage, products: ProductsPage, coupons: CouponsPage, orders: OrdersPage, settings: SettingsPage }[page]), [page]); return <div className={'desktop-shell ' + (collapsed ? 'sidebar-collapsed' : '')}><Sidebar page={page} onPage={setPage} collapsed={collapsed} onToggle={() => setCollapsed(!collapsed)}/><div className="desktop-body"><main><Page/></main></div></div>; }
function MobileHeroCard() {
  return <section className="card mobile-status-summary">
    <div className="mobile-section-head"><div><h2>Agent 在线 · 闲鱼账号 A</h2><p>180 秒托管策略 · 立即发货已启用 · 心跳 14:24:08</p></div><Badge tone="ok">正常</Badge></div>
    <div className="mobile-health-grid">
      <span><b>凭证边界</b><small>仅 buyer_deliverable</small></span>
      <span><b>Outbox</b><small>7 pending / 128 done</small></span>
    </div>
  </section>;
}

function MobileQuickActions() {
  return <section className="mobile-quick-grid" aria-label="移动端快捷动作">
    {[
      ['补交付凭证', '考研英语资料', 'warn'],
      ['确认风险', '跨商品资源请求', 'danger'],
      ['查看发货', '7 单已执行', 'ok'],
      ['补充知识', '2 条新问题', 'info']
    ].map(([title, meta, tone]) => <button className={'mobile-quick-card tone-card-' + tone} key={title}>
      <span>{title}</span><small>{meta}</small>
    </button>)}
  </section>;
}

function MobileTodoStack() {
  return <section className="card mobile-task-card">
    <div className="mobile-section-head"><div><h2>今天优先处理</h2><p>按风险和时效排序，不展示桌面大表格。</p></div><Badge tone="warn">3 待办</Badge></div>
    <div className="mobile-task-list">
      <button className="mobile-task-row urgent"><i/> <div><strong>付款后未发货</strong><span>考研英语资料缺少 buyer_deliverable 凭证</span></div><Badge tone="warn">补凭证</Badge></button>
      <button className="mobile-task-row"><i/> <div><strong>跨商品资源请求</strong><span>买家索要 Python 资料包，Agent 已拦截</span></div><Badge tone="danger">确认</Badge></button>
      <button className="mobile-task-row"><i/> <div><strong>知识缺口</strong><span>AI 绘画教程新增安装问题，建议补 FAQ</span></div><Badge tone="info">补知识</Badge></button>
    </div>
  </section>;
}

function MobileOrderPulse() {
  return <section className="card mobile-card mobile-pulse-card">
    <div className="mobile-section-head"><div><h2>经营快照</h2><p>只保留移动端可扫读指标。</p></div><button className="text-button">详情</button></div>
    <div className="mobile-mini-chart"><MiniAreaChart primary={[46, 54, 52, 68, 73, 81, 78, 92]} secondary={[42, 48, 55, 58, 61, 70, 76, 82]}/></div>
  </section>;
}

function MobileDashboardView() {
  return <>
    <MobileHeroCard/>
    <MobileQuickActions/>
    <div className="mobile-kpis">{kpis.slice(0,4).map(k => <KpiCard key={k.label} {...k}/>)}</div>
    <MobileTodoStack/>
    <MobileOrderPulse/>
  </>;
}

function MobileWorkspaceView() {
  return <>
    <section className="card mobile-chat-card">
      <div className="mobile-bubble user">把考研英语资料补上交付凭证，先给我看会改什么。</div>
      <div className="mobile-bubble ai">已定位商品和订单异常，只展示 credential_ref 与影响范围。</div>
      <div className="mobile-confirm-compact">
        <div className="confirm-head"><div><h2>补交付凭证确认</h2><p>商品：考研英语资料 · AUD-20260909-1518</p></div><Badge tone="warn">需确认</Badge></div>
        <div className="mobile-before-after"><span><b>修改前</b>无可交付凭证</span><span><b>修改后</b>cred_quark_exam_en_002</span></div>
        <div className="card-actions"><button className="btn primary">确认配置</button><button className="btn ghost">预览买家消息</button></div>
      </div>
      <div className="mobile-composer-bar"><span>输入新的运营指令…</span><button aria-label="发送">&uarr;</button></div>
    </section>
  </>;
}

function MobileMessagesView() {
  return <>
    <section className="mobile-filter-strip"><button className="active">待我处理</button><button>已闭环</button><button>风险</button></section>
    <section className="mobile-deck-card card">
      <div className="mobile-section-head"><div><h2>消息托管卡片</h2><p>移动端按一张张卡片处理，而不是横向表格。</p></div><Badge tone="warn">高</Badge></div>
      <div className="buyer-strip"><div className="avatar">林</div><div><strong>林同学</strong><span>订单 XY20260909003 · 考研英语资料</span></div></div>
      <p className="buyer-message">“我已经付款了，怎么还没收到资料？”</p>
      <div className="mobile-reason-box"><b>Agent 判断</b><span>订单已付款，但商品缺少 buyer_deliverable 凭证，暂不向买家发送任何敏感内容。</span></div>
      <div className="mobile-action-row"><button className="btn primary">补凭证并发货</button><button className="btn ghost">通知管理员</button></div>
    </section>
    <MobileTodoStack/>
  </>;
}

function MobileAccountsView() {
  return <>
    <section className="card mobile-account-card active-account">
      <div className="mobile-section-head"><div><h2>当前工作账号</h2><p>移动端强调“当前上下文”，避免误操作到别的店。</p></div><Badge tone="ok">在线</Badge></div>
      <div className="account-large"><div className="avatar">A</div><div><strong>闲鱼账号 A</strong><span>资料自动发货店 · 180 秒托管策略</span></div></div>
      <button className="btn primary full">切换账号</button>
    </section>
    <section className="mobile-account-list">
      {[
        ['闲鱼账号 B', '课程资料副店', '需刷新登录', 'warn'],
        ['闲鱼账号 C', '测试账号', '在线', 'ok']
      ].map(([name, meta, state, tone]) => <button className="card mobile-account-card" key={name}>
        <div className="account-large small"><div className="avatar">{name.slice(-1)}</div><div><strong>{name}</strong><span>{meta}</span></div></div><Badge tone={tone as Tone}>{state}</Badge>
      </button>)}
    </section>
  </>;
}

function MobileSettingsView() {
  const tabs = [
    { id: 'autoReply', label: '策略', title: '自动回复策略', meta: 'Policy' },
    { id: 'model', label: '模型', title: 'OpenAI API', meta: 'ModelClient' },
    { id: 'credentials', label: '凭证', title: '凭证管理', meta: 'Database' },
    { id: 'safety', label: '安全', title: '安全输出校验', meta: 'Gateway' },
    { id: 'outbox', label: '队列', title: 'Outbox Worker', meta: 'Runtime' },
    { id: 'plugins', label: '插件', title: '插件配置', meta: 'Skill / Plugin' }
  ] as const;
  type MobileSettingsTabKey = typeof tabs[number]['id'];
  const [activeTab, setActiveTab] = useState<MobileSettingsTabKey>('autoReply');
  const current = tabs.find(tab => tab.id === activeTab)!;
  const panels: Record<MobileSettingsTabKey, ReactNode> = {
    autoReply: <section className="card mobile-settings-card">
      <div className="mobile-section-head"><div><h2>自动回复策略</h2><p>按当前闲鱼账号配置自动回复、人工介入重新计时、风险拦截和虚拟资源立即发货规则。</p></div><Badge tone="ok">当前生效</Badge></div>
      <div className="mobile-form-rows"><div><label>当前账号</label><span>闲鱼账号 A · 资料自动发货店</span></div><div><label>默认超时</label><span>180 秒；人工介入后重新计时</span></div><div><label>自动发送条件</label><span>AI 可确定回答、知识命中、策略通过、未发生人工回复</span></div><div><label>高风险拦截</label><span>退款、投诉、差评、凭证异常、跨商品资源、Prompt Injection、置信度不足</span></div></div>
      <div className="mobile-action-row"><button className="btn primary">生成确认卡片</button><button className="btn ghost">查看审计</button></div>
    </section>,
    model: <section className="card mobile-settings-card mobile-api-config-card">
      <div className="mobile-section-head"><div><h2>OpenAI API 兼容模型配置</h2><p>与 PC 的 ModelClient 配置一致，移动端支持快速修改、连接测试和确认生效。</p></div><Badge tone="info">ModelClient</Badge></div>
      <label><span>Provider</span><select defaultValue="deepseek"><option value="deepseek">DeepSeek Harness</option><option value="openai">OpenAI Compatible</option><option value="backup">Backup Provider</option></select></label>
      <label><span>Base URL</span><input defaultValue="https://api.deepseek.com/v1" /></label>
      <label><span>Model</span><input defaultValue="deepseek-chat" /></label>
      <label><span>API Key</span><input defaultValue="sk-••••••••••••A91F" type="password" /></label>
      <div className="mobile-audit-row"><span>secret_store_ref: model_api_key_primary</span><span>policy_ref: settings.model.update</span></div>
      <div className="mobile-before-after"><span><b>当前配置</b>deepseek-chat · 测试通过</span><span><b>备用配置</b>gpt-4.1-mini · 可故障切换</span></div>
      <div className="card-actions"><button className="btn ghost">测试连接</button><button className="btn primary">保存 API 配置</button></div>
    </section>,
    credentials: <section className="card mobile-settings-card">
      <div className="mobile-section-head"><div><h2>凭证管理</h2><p>管理员可直接查看、编辑和操作；闲鱼买家只接收符合订单条件的交付内容。</p></div><Badge tone="warn">管理员可管理</Badge></div>
      <div className="mobile-settings-list readonly"><div><strong>买家可交付凭证</strong><span>usage_scope = buyer_deliverable · cred_quark_python_bundle_001</span><Badge tone="ok">可发货</Badge></div><div><strong>系统凭证</strong><span>cookie_ref_xianyu_a / model_api_key_primary，管理员可查看和编辑</span><Badge tone="warn">管理员可管理</Badge></div><div><strong>买家边界</strong><span>系统凭证不得进入闲鱼买家消息或订单交付</span><Badge tone="info">已确认</Badge></div></div>
      <div className="mobile-action-row"><button className="btn primary">新增 / 编辑凭证</button><button className="btn ghost">凭证操作记录</button></div>
    </section>,
    safety: <section className="card mobile-settings-card">
      <div className="mobile-section-head"><div><h2>安全输出校验</h2><p>买家消息、昵称、订单备注和外部链接均按不可信输入处理。</p></div><Badge tone="danger">高优先级</Badge></div>
      <Timeline items={[[ 'Prompt Injection','买家要求忽略系统规则、泄露配置或修改策略时拦截。','拦截','danger'],['凭证泄露','要求发送 Cookie、Token、API Key、内部链接或 system_only 凭证时拦截。','拦截','danger'],['非订单交付','未付款或未满足发货条件时不发送夸克链接、提取码或卡密。','校验','warn'],['数据污染','买家输入不得直接写入知识库、Skill 配置、Dashboard 配置或凭证范围。','隔离','info']]}/>
    </section>,
    outbox: <section className="card mobile-settings-card">
      <div className="mobile-section-head"><div><h2>Outbox Worker / Execution Runtime</h2><p>所有发送消息、更新知识库、更新插件、触发通知等写动作经 Outbox 执行。</p></div><Badge tone="ok">Worker 正常</Badge></div>
      <div className="mobile-form-rows"><div><label>Worker</label><span>online · 最近心跳 14:24:08</span></div><div><label>队列深度</label><span>7 pending / 128 succeeded today</span></div><div><label>幂等键</label><span>shop_id + account_id + action_type + business_id</span></div><div><label>Replay</label><span>默认使用当时捕获的 SkillResult，避免外部状态漂移</span></div></div>
      <div className="mobile-action-row"><button className="btn primary">查看队列</button><button className="btn ghost">查看 Trace</button></div>
    </section>,
    plugins: <section className="card mobile-settings-card">
      <div className="mobile-section-head"><div><h2>插件配置</h2><p>通过 Workspace 安装、启用、禁用和升级 Skill / Plugin，移动端显示状态摘要和确认入口。</p></div><Badge tone="info">平台通用</Badge></div>
      <div className="mobile-settings-list readonly"><div><strong>Dashboard Plugin</strong><span>widgets / metrics / queries / layout 版本化</span><Badge tone="ok">已启用</Badge></div><div><strong>Knowledge Plugin</strong><span>商品知识、通用知识、知识召回、版本管理</span><Badge tone="ok">已启用</Badge></div><div><strong>Policy Plugin</strong><span>自动回复、风险拦截、外部写动作策略</span><Badge tone="ok">已启用</Badge></div><div><strong>夸克交付 Skill</strong><span>读取 buyer_deliverable 凭证并生成发货文本</span><Badge tone="warn">需配置</Badge></div></div>
      <div className="mobile-action-row"><button className="btn primary">安装 Skill</button><button className="btn ghost">版本记录</button></div>
    </section>
  };
  return <>
    <section className="mobile-settings-header card">
      <div className="mobile-section-head"><div><h2>设置</h2><p>与 PC 设置页同一套分类：{current.title} · {current.meta}</p></div><Badge tone={activeTab === 'safety' ? 'danger' : activeTab === 'credentials' ? 'warn' : activeTab === 'outbox' ? 'ok' : 'info'}>{current.meta}</Badge></div>
      <nav className="mobile-settings-nav" aria-label="设置分类">
        {tabs.map(tab => <button key={tab.id} className={activeTab === tab.id ? 'active' : ''} onClick={() => setActiveTab(tab.id)}><span>{tab.label}</span><small>{tab.meta}</small></button>)}
      </nav>
    </section>
    {panels[activeTab]}
  </>;
}

function MobileFrame({ page, setPage, modal, onCloseModal, onConfirmModal }: { page: PageKey; setPage: (p: PageKey) => void; modal: PrototypeModal | null; onCloseModal: () => void; onConfirmModal: () => void }) {
  const mobilePages: PageKey[] = ['dashboard', 'workspace', 'accounts', 'messages', 'products', 'coupons', 'orders', 'settings'];
  const activePage = mobilePages.includes(page) ? page : 'dashboard';
  const renderMobilePage = () => {
    if (activePage === 'workspace') return <MobileWorkspaceView/>;
    if (activePage === 'messages') return <MobileMessagesView/>;
    if (activePage === 'accounts') return <MobileAccountsView/>;
    if (activePage === 'settings') return <MobileSettingsView/>;
    return <MobileDashboardView/>;
  };
  return <div className="mobile-frame mobile-hifi-frame">
    <div className="mobile-status"><span>9:41</span><span>5G 100%</span></div>
    <header className="mobile-head mobile-hifi-head">
      <div><strong>{activePage === 'workspace' ? '指令' : activePage === 'messages' ? '消息托管' : activePage === 'accounts' ? '账号上下文' : activePage === 'settings' ? '设置' : '今日总览'}</strong></div>
      <div className="mobile-head-actions"><button className="mobile-account-chip">账号 A</button><button className="icon-button" aria-label="通知"><Icon name="bell"/><b>3</b></button></div>
    </header>
    <main className="mobile-main mobile-hifi-main">{renderMobilePage()}</main>
    <nav className="mobile-tabs mobile-hifi-tabs" aria-label="移动端主导航">
      {mobilePages.map(key => {
        const item = navItems.find(n => n.key === key)!;
        const labels: Record<PageKey, string> = { dashboard: '总览', workspace: '工作台', accounts: '账号', messages: '聊天', products: '商品', coupons: '卡券', orders: '订单', settings: '设置' };
        return <button key={key} className={activePage === key ? 'active' : ''} onClick={() => setPage(key)}><Icon name={item.icon}/><span>{labels[key]}</span></button>;
      })}
    </nav>
    <ModalHost modal={modal} onClose={onCloseModal} onConfirm={onConfirmModal}/>
  </div>;
}
function AuthPreview() { return <div className="auth-canvas"><section className="auth-card card"><Logo/><p className="eyebrow">Authentication</p><h1>登录 XianyuSellerAgent</h1><p>所有系统页面先登录后访问；登录、退出、初始化管理员和登录失败均写入审计。</p><label>管理员账号<input value="admin@example.com" readOnly/></label><label>密码<input value="••••••••••" readOnly/></label><button className="btn primary full">登录并进入 Dashboard</button><div className="auth-note"><Badge tone="info">会话保护</Badge><span>登录成功默认进入首页 Dashboard。</span></div></section><section className="auth-card card"><p className="eyebrow">First Run</p><h1>首次启动管理员初始化</h1><p>仅当系统内不存在管理员账号时开放；创建成功后关闭初始化入口。</p><FormRows rows={[[ '用户名','admin'],['显示名称','运营管理员'],['管理员邮箱','admin@example.com'],['密码强度','满足基础强度要求']]}/><div className="audit-strip"><span>INIT_ADMIN_CREATED</span><span>AUD-20260909-0001</span></div></section><section className="auth-card card"><p className="eyebrow">Session State</p><h1>登录失效提示</h1><p>Token 失效或权限异常时引导重新登录，不暴露任何凭证内容。</p><button className="btn ghost full">重新登录</button></section></div>; }
export default function App() {
  const [mode, setMode] = useState<ViewMode>('desktop');
  const [page, setPage] = useState<PageKey>('dashboard');
  const [collapsed, setCollapsed] = useState(false);
  const [modal, setModal] = useState<PrototypeModal | null>(null);
  const [toasts, setToasts] = useState<Array<{ id: number; text: string; tone: Tone }>>([]);
  const [confirmMessage, setConfirmMessage] = useState('模拟动作已通过 Policy Gateway，并写入 Outbox 审计队列');
  const pushToast = (text: string, tone: Tone = 'info') => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev.slice(-3), { id, text, tone }]);
    window.setTimeout(() => setToasts(prev => prev.filter(item => item.id !== id)), 3600);
  };
  const openAction = (title: string, tone: Tone, rows: Array<[string, string]>, confirm?: string, done?: string) => {
    setConfirmMessage(done ?? '模拟动作已完成，结果写入 Trace / Audit');
    setModal({ title, tone, rows, confirm });
  };
  const handlePrototypeClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const button = target.closest('button');
    if (!button || button.closest('[data-accounts-domain]') || button.closest('.segmented') || button.closest('.side-nav') || button.closest('.settings-tabs') || button.closest('.mobile-settings-nav') || button.closest('.mobile-settings-list') || button.closest('.mobile-tabs') || button.closest('.modal-card') || button.classList.contains('collapse-button')) return;
    const label = (button.textContent || button.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
    const aria = button.getAttribute('aria-label') || '';
    if (aria.includes('移除')) {
      button.closest('.attachment-chip')?.remove();
      pushToast('附件已从本次知识识别中移除', 'warn');
      return;
    }
    if (aria.includes('添加') || label === '+') {
      pushToast('已模拟添加一份商品截图，等待 AI OCR 识别', 'info');
      return;
    }
    if (aria.includes('发送') || label === '↑') {
      const composer = button.closest('.workspace-composer');
      const textarea = composer?.querySelector('textarea') as HTMLTextAreaElement | null;
      const value = textarea?.value?.trim() || '检查当前账号 A 的待处理风险，并生成确认卡片';
      if (textarea) textarea.value = '';
      const chat = button.closest('.chat-card');
      if (chat) {
        const user = document.createElement('div');
        user.className = 'bubble user';
        user.textContent = value;
        const ai = document.createElement('div');
        ai.className = 'bubble ai';
        ai.textContent = '已生成模拟执行计划：命中知识库、凭证边界和 Policy Gateway；需要人工确认的动作已放入确认卡片。';
        const composerNode = chat.querySelector('.workspace-composer');
        chat.insertBefore(user, composerNode);
        chat.insertBefore(ai, composerNode);
      }
      pushToast('AI 已生成可确认的模拟执行结果', 'ok');
      return;
    }
    if (aria.includes('通知') || label.includes('待确认动作')) {
      setPage('messages');
      openAction('待确认动作队列', 'warn', [['高优先级', '考研英语资料缺少 buyer_deliverable 凭证，付款后未发货'], ['中优先级', '跨商品资源请求已拦截，等待人工确认'], ['执行边界', '确认后经 Action Policy Gateway、Outbox、Execution Runtime 执行']], '去处理待办', '已进入消息托管待办队列');
      return;
    }
    if (label.includes('打开插件配置')) { setPage('settings'); openAction('Dashboard Plugin 配置', 'info', [['插件', 'dashboard-plugin@1.4.3'], ['数据范围', '当前账号 A 的订单、商品、库存和托管指标'], ['发布规则', 'AI 修改后必须人工点击发布'], ['版本', '支持 Manifest 版本化与回滚']], '查看配置', '已打开插件配置面板'); return; }
    if (label.includes('确认配置')) { openAction('确认虚拟资源商品配置', 'warn', [['影响对象', 'Python 全栈资料包 / 当前账号 A'], ['变更', 'is_virtual_resource=true，delivery_trigger=paid_order'], ['凭证引用', 'cred_quark_python_bundle_001 · buyer_deliverable'], ['幂等键', 'shop_a:account_a:config_virtual:ITEM-93821']], '通过并执行', '虚拟资源配置已确认，商品知识版本更新为 v13'); return; }
    if (label.includes('全屏 HTML 预览')) { openAction('买家侧发货消息预览', 'info', [['发送场景', '订单 XY20260909001 已付款'], ['买家可见', '资源交付说明 + 脱敏凭证引用'], ['敏感处理', '真实链接与提取码由 Runtime 从 CredentialStore 读取'], ['审计', 'AUD-20260909-1422 / TRC-20260909-1422']], undefined); return; }
    if (label.includes('取消')) { pushToast('已取消当前确认卡片，未写入 Outbox', 'warn'); return; }
    if (label.includes('确认安装')) { openAction('安装夸克交付 Skill', 'warn', [['能力', 'quark.delivery.send_buyer_deliverable'], ['风险等级', 'medium / external_write'], ['权限', '读取 buyer_deliverable 凭证、写入 Outbox、记录 SkillResult'], ['账号隔离', 'Skill 平台通用，凭证引用按账号隔离']], '确认安装', '夸克交付 Skill 已安装，等待绑定凭证引用'); return; }
    if (label.includes('Manifest')) { openAction('夸克交付 Skill Manifest', 'info', [['capability', 'quark.delivery.send_buyer_deliverable'], ['input_schema', 'order_id, product_id, credential_ref, idempotency_key'], ['timeout', '12s，失败进入指数退避'], ['audit', '记录 credential_ref、trace_id，不记录明文']], undefined); return; }
    if (label.includes('添加闲鱼账号')) { openAction('添加闲鱼账号', 'info', [['绑定方式', '扫码登录，登录态写入 CredentialStore'], ['模拟账号', '闲鱼账号 D · 图书资料店'], ['默认策略', '继承店铺 180 秒托管策略'], ['隔离范围', '商品、订单、消息、知识、凭证、Trace 按账号隔离']], '生成扫码任务', '已生成闲鱼账号 D 的扫码绑定任务'); return; }
    if (label.includes('切换到此账号') || label === '切换') { openAction('切换当前工作账号', 'info', [['目标账号', label === '切换' ? '闲鱼账号 B · 课程资料副店' : '所选闲鱼账号'], ['影响范围', 'Dashboard、消息、商品、知识、凭证与 Trace 立即切换'], ['Skill / Plugin', '平台通用，不重复安装'], ['审计', 'ACCOUNT_CONTEXT_SWITCHED']], '确认切换', '当前工作上下文已切换，并写入审计记录'); return; }
    if (label.includes('扫码')) { openAction('重新扫码授权', 'warn', [['原因', '登录态过期或运营手动刷新'], ['保存位置', '凭证管理 / cookie_ref_xianyu_account'], ['管理员操作', '可查看、编辑和替换当前账号凭证'], ['买家边界', '系统凭证不得进入闲鱼买家可见链路'], ['审计', 'LOGIN_STATE_REFRESH_REQUESTED']], '创建扫码任务', '扫码授权任务已创建'); return; }
    if (label.includes('删除账号')) { openAction('删除账号确认', 'danger', [['删除范围', '账号绑定关系与当前登录态引用'], ['保留内容', '历史订单、Trace、审计与复盘样本'], ['保护', '当前工作账号需要先切换后再删除'], ['审计', 'ACCOUNT_DELETE_REQUESTED']], '确认删除', '账号删除动作已进入高风险确认队列'); return; }
    if (label.includes('处理待办') || label.includes('补凭证') || label.includes('风险确认') || label.includes('补知识') || label.includes('处理风险') || label.includes('查看对话') || label.includes('查看审计')) { openAction('消息托管处理卡片', label.includes('查看') ? 'info' : 'warn', [['会话', '当前账号 A / 最近一条待办会话'], ['Agent 决策', '能确定则回复；不能确定通知管理员，不回复买家'], ['下一步', label || '处理待办'], ['Trace', 'TRC-20260909-1411，Replay 使用当时 SkillResult']], label.includes('查看') ? undefined : '完成处理', '待办已处理，结果写入 Trace / Audit'); return; }
    if (label.includes('创建回归样本')) { openAction('创建回归样本', 'info', [['样本来源', '近 24 小时风险拦截、发货失败、知识缺失会话'], ['样本数量', '3 条高价值样本'], ['评测规则', '凭证泄露、跨商品资源、未付款诱导发货'], ['版本', 'eval_set_xianyu_20260909']], '创建样本', '回归样本 eval_set_xianyu_20260909 已创建'); return; }
    if (label.includes('标注为正确')) { pushToast('复盘样本已标注为正确，规则评分更新', 'ok'); return; }
    if (label.includes('加入回归集')) { pushToast('已加入回归集 cross_product_resource_block', 'info'); return; }
    if (label.includes('登录并进入 Dashboard')) { setMode('desktop'); setPage('dashboard'); pushToast('登录成功，已进入 Dashboard', 'ok'); return; }
    if (label.includes('重新登录')) { pushToast('已重新发起登录流程，审计事件已记录', 'info'); return; }
    if (label.includes('测试连接')) { pushToast('AI API 连接测试通过：ModelClient 响应正常', 'ok'); return; }
    if (label.includes('保存 API 配置')) { openAction('保存 AI API 配置确认', 'warn', [['Provider', 'DeepSeek Harness'], ['Base URL', 'https://api.deepseek.com/v1'], ['Model', 'deepseek-chat'], ['Secret', 'secret_store_ref: model_api_key_primary'], ['Policy', 'settings.model.update'], ['Audit', 'MODEL_CONFIG_UPDATE_REQUESTED']], '确认保存', 'AI API 配置已更新，ModelClient 连接测试通过'); return; }
    if (label.includes('加载更多商品')) { pushToast('已加载下一批 20 个商品，保持当前筛选条件', 'info'); return; }
    pushToast(label ? '已执行模拟操作：' + label : '已执行模拟操作', 'info');
  };
  return <div className="prototype-root" onClickCapture={handlePrototypeClick}><div className="preview-toolbar"><div><strong>XianyuSellerAgent UI Prototype</strong><span>Figma-ready React / CSS prototype</span></div><div className="segmented"><button className={mode === 'desktop' ? 'active' : ''} onClick={() => setMode('desktop')}>桌面控制台</button><button className={mode === 'mobile' ? 'active' : ''} onClick={() => setMode('mobile')}>移动端</button><button className={mode === 'auth' ? 'active' : ''} onClick={() => setMode('auth')}>登录初始化</button></div></div><div className={'preview-stage mode-' + mode}>{mode === 'desktop' && <DesktopShell page={page} setPage={setPage} collapsed={collapsed} setCollapsed={setCollapsed}/>} {mode === 'mobile' && <MobileFrame page={page} setPage={setPage} modal={modal} onCloseModal={() => setModal(null)} onConfirmModal={() => { pushToast(confirmMessage, modal?.tone === 'danger' ? 'warn' : 'ok'); setModal(null); }}/>} {mode === 'auth' && <AuthPreview/>}</div>{mode !== 'mobile' && <ModalHost modal={modal} onClose={() => setModal(null)} onConfirm={() => { pushToast(confirmMessage, modal?.tone === 'danger' ? 'warn' : 'ok'); setModal(null); }}/>}<ToastHost items={toasts}/></div>;
}
