import { useState } from 'react';
import { Button } from './Button';
import { InputField } from './InputField';
import { PlaceholderCell } from './PlaceholderCell';
import { SearchField } from './SearchField';
import { SelectField } from './SelectField';
import { TextAreaField } from './TextAreaField';
import './controls-preview.css';

const statusOptions = [
  { value: 'all', label: '全部状态' },
  { value: 'connected', label: '已连接' },
  { value: 'pending', label: '待人工' },
];

export function ControlsPreview() {
  const [search, setSearch] = useState('');
  return <main className="controls-preview-page">
    <header className="controls-preview-header"><div><p className="controls-preview-eyebrow">xianyu admin · shared controls</p><h1>搜索与表单控件</h1><p>共享 Search / Select / Input / TextArea / Button / PlaceholderCell 的 1:1 设计实现。</p></div><span className="controls-preview-badge"><i /> Token aligned</span></header>
    <section className="controls-preview-shell">
      <aside className="controls-preview-sidebar"><div className="controls-preview-brand"><span>Y</span><div><strong>闲鱼智能运营</strong><small>seller console</small></div></div><p className="controls-preview-side-label">Preview</p><Button variant="ghost" className="controls-preview-nav active">控件总览</Button><Button variant="ghost" className="controls-preview-nav">筛选工具栏</Button><Button variant="ghost" className="controls-preview-nav">表单状态</Button><div className="controls-preview-side-note"><strong>风格基线</strong><small>#1D2638 shell · #245A8D action · 7px radius</small></div></aside>
      <div className="controls-preview-main"><header className="controls-preview-topbar"><span>设计稿 / Search · Select · Form</span><span className="controls-preview-chip">视觉 token 已对齐</span></header><div className="controls-preview-content">
        <section className="controls-preview-card"><div className="controls-preview-card-head"><div><h2>搜索框 · Search field</h2><p>默认、聚焦、已输入、禁用四种状态。</p></div><code>34px · 7px · #F6F7F9</code></div><div className="controls-preview-card-body controls-preview-row"><div><small>Default</small><SearchField aria-label="默认搜索" placeholder="搜索账号名称或备注" /></div><div><small>Focus</small><SearchField aria-label="聚焦搜索" className="is-focus" value="订单号 20260921" onChange={() => undefined} /></div><div><small>With value</small><SearchField aria-label="已输入搜索" value={search || '买家昵称 / 商品标题'} onChange={(event) => setSearch(event.target.value)} clearable onClear={() => setSearch('')} /></div><div><small>Disabled</small><SearchField aria-label="禁用搜索" placeholder="暂不可搜索" disabled /></div></div></section>
        <section className="controls-preview-card"><div className="controls-preview-card-head"><div><h2>下拉框 · Select field</h2><p>保留原生语义，统一 chevron 与状态。</p></div><code>34px · 7px · native</code></div><div className="controls-preview-card-body controls-preview-row"><div><small>Default</small><SelectField aria-label="默认下拉" value="all" onChange={() => undefined} options={statusOptions} /></div><div><small>Focus</small><SelectField aria-label="聚焦下拉" value="connected" onChange={() => undefined} options={statusOptions} /></div><div><small>Disabled</small><SelectField aria-label="禁用下拉" value="all" disabled onChange={() => undefined} options={statusOptions} /></div></div></section>
        <section className="controls-preview-card"><div className="controls-preview-card-head"><div><h2>输入框 · Text input</h2><p>适合名称、关键词、URL、短文本字段。</p></div><code>12px body · 1px border</code></div><div className="controls-preview-card-body controls-preview-form-grid"><InputField label="商品标题" required placeholder="请输入商品标题" hint="建议控制在 30 个字以内，便于列表扫描。" /><InputField label="商品链接" value="https://2.taobao.com/item.htm?id=..." readOnly hint="浅灰底表示可编辑输入。" /><InputField label="聚焦中的字段" className="is-focus" value="聚焦中的字段" readOnly /><InputField label="禁用字段" placeholder="不可编辑" disabled /></div></section>
        <section className="controls-preview-card"><div className="controls-preview-card-head"><div><h2>文本框 · Textarea</h2><p>适合客服备注、AI 指令、风控说明等多行内容。</p></div><code>84px min-height</code></div><div className="controls-preview-card-body controls-preview-form-grid"><TextAreaField label="处理备注" placeholder="输入本次操作的补充说明，支持换行…" hint="提示文案使用 10px #6B7280。" /><TextAreaField label="AI 回复策略" className="is-focus" value="先识别买家意图，再给出简洁、可执行的回复。" readOnly /></div></section>
        <section className="controls-preview-card controls-preview-card-wide"><div className="controls-preview-card-head"><div><h2>按钮 · Button states</h2><p>默认、主操作、次操作、危险操作和禁用态。</p></div><code>32px · 8px</code></div><div className="controls-preview-card-body controls-preview-buttons"><Button>新建卡券</Button><Button variant="primary">保存设置</Button><Button variant="ghost">刷新列表</Button><Button variant="danger">删除选中</Button><Button disabled>暂不可用</Button></div></section>
        <section className="controls-preview-card controls-preview-card-wide"><div className="controls-preview-card-head"><div><h2>格子 Placeholder</h2><p>空值使用细虚线占位，保留表格节奏。</p></div><code>6px · dashed</code></div><div className="controls-preview-card-body controls-preview-placeholder-grid"><div><strong>商品名称</strong><span>轻奢帆布托特包</span></div><div><strong>库存</strong><span>28</span></div><div><strong>状态</strong><PlaceholderCell tone="tinted">未同步</PlaceholderCell></div><div><strong>最近更新</strong><PlaceholderCell>暂无更新时间</PlaceholderCell></div><div><strong>商品名称</strong><PlaceholderCell>暂无商品标题</PlaceholderCell></div><div><strong>库存</strong><PlaceholderCell>—</PlaceholderCell></div><div><strong>状态</strong><PlaceholderCell>—</PlaceholderCell></div><div><strong>最近更新</strong><PlaceholderCell>等待同步时间</PlaceholderCell></div></div></section>
      </div></div>
    </section>
  </main>;
}
