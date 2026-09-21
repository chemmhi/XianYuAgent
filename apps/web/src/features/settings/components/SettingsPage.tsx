import { useMemo, useState, type FormEvent } from 'react';
import { useAccountContext } from '../../../app/account-context';
import { createCredentialApi, createMockAutoReplyAgentSettingsApi, createMockCredentialApi, type AutoReplyAgentSettingsApi, type CredentialApi } from '../api';
import { useAutoReplyAgentSettingsController } from '../agent-settings-controller';
import { AutoReplyAgentPanel } from './AutoReplyAgentPanel';
import { useCredentialController } from '../controller';
import type { CredentialRefVM } from '../types';
import './settings.css';

type TabKey = 'autoReply' | 'model' | 'credentials' | 'safety' | 'outbox' | 'plugins';

const tabs: Array<{ id: TabKey; label: string; mobileLabel: string; meta: string }> = [
  { id: 'autoReply', label: '自动回复 Agent', mobileLabel: 'Agent', meta: 'Buyer Agent' },
  { id: 'model', label: 'OpenAI API', mobileLabel: '模型', meta: 'ModelClient' },
  { id: 'credentials', label: '凭证管理', mobileLabel: '凭证', meta: 'CredentialStore' },
  { id: 'safety', label: '安全输出校验', mobileLabel: '安全', meta: 'Gateway' },
  { id: 'outbox', label: 'Outbox Worker', mobileLabel: '队列', meta: 'Runtime' },
  { id: 'plugins', label: '插件配置', mobileLabel: '插件', meta: 'Skill / Plugin' },
];

export function SettingsPage({ api: providedApi, agentApi: providedAgentApi }: { api?: CredentialApi; agentApi?: AutoReplyAgentSettingsApi }) {
  const { accounts, accountsLoading, accountsError, currentAccountId } = useAccountContext();
  const api = useMemo(() => providedApi ?? createCredentialApiFromRuntime(), [providedApi]);
  const agentApi = useMemo(() => providedAgentApi ?? createMockAutoReplyAgentSettingsApi(), [providedAgentApi]);
  const [activeTab, setActiveTab] = useState<TabKey>('credentials');
  const [editor, setEditor] = useState<'create' | 'edit' | 'rotate' | null>(null);
  const [selectedCredential, setSelectedCredential] = useState<CredentialRefVM | undefined>();
  const controller = useCredentialController({ api, accountId: currentAccountId });
  const agentController = useAutoReplyAgentSettingsController(agentApi, currentAccountId);

  const selectedAccount = accounts.find((account) => account.id === currentAccountId);
  const items = controller.state.data?.items ?? [];

  function openEditor(mode: 'create' | 'edit' | 'rotate', credential?: CredentialRefVM) {
    setSelectedCredential(credential);
    setEditor(mode);
  }

  return (
    <section className="page-stack settings-page" data-settings-page>
      <header className="settings-toolbar">
        <div><p className="eyebrow">System Settings</p><h1>设置</h1><p>管理 Agent 策略与受控凭证引用。</p></div>
        {selectedAccount && <span className="settings-scope-chip">当前账号：{selectedAccount.displayName}</span>}
      </header>
      <div className="settings-grid">
        <aside className="card settings-tabs" aria-label="设置分类">
          {tabs.map((tab) => <button key={tab.id} type="button" className={activeTab === tab.id ? 'active' : ''} onClick={() => setActiveTab(tab.id)}><span className="settings-tab-label">{tab.label}</span><span className="settings-tab-mobile-label">{tab.mobileLabel}</span><small>{tab.meta}</small></button>)}
        </aside>
        <div className="settings-active">
          {activeTab === 'credentials' ? <CredentialStorePanel accountName={selectedAccount?.displayName} accountId={currentAccountId ?? ''} accountsLoading={accountsLoading} accountsError={accountsError} state={controller.state} items={items} onCreate={() => openEditor('create')} onEdit={(item) => openEditor('edit', item)} onRotate={(item) => openEditor('rotate', item)} onStatus={(item, status) => { void controller.setStatus({ credentialId: item.id, expectedVersion: item.version, status }); }} onRetry={controller.reload} /> : activeTab === 'autoReply' ? <AutoReplyAgentPanel controller={agentController} accountName={selectedAccount?.displayName} accountId={currentAccountId} /> : <ReferencePanel tab={activeTab} onOpenCredentials={() => setActiveTab('credentials')} />}
        </div>
      </div>
      {editor && <CredentialEditor mode={editor} accountId={currentAccountId ?? ''} credential={selectedCredential} onClose={() => { setEditor(null); setSelectedCredential(undefined); }} onCreate={controller.create} onUpdate={controller.update} onRotate={controller.rotate} />}
      <nav className="settings-mobile-bottom" aria-label="移动端设置导航">{tabs.slice(0, 4).map((tab) => <button key={tab.id} type="button" className={activeTab === tab.id ? 'active' : ''} onClick={() => setActiveTab(tab.id)}><span>{tab.id === 'credentials' ? '◇' : tab.id === 'model' ? '◌' : tab.id === 'safety' ? '✓' : '≡'}</span><small>{tab.mobileLabel}</small></button>)}</nav>
    </section>
  );
}

function createCredentialApiFromRuntime(): CredentialApi {
  if (import.meta.env.VITE_API_MODE === 'mock') return createMockCredentialApi();
  throw new Error('SETTINGS_API_NOT_PROVIDED');
}

function CredentialStorePanel(props: { accountName?: string; accountId: string; accountsLoading: boolean; accountsError: string | null; state: ReturnType<typeof useCredentialController>['state']; items: CredentialRefVM[]; onCreate: () => void; onEdit: (item: CredentialRefVM) => void; onRotate: (item: CredentialRefVM) => void; onStatus: (item: CredentialRefVM, status: 'active' | 'disabled' | 'revoked') => void; onRetry: () => Promise<void> }) {
  const { state } = props;
  return <div className="settings-content" data-credential-panel>
    <article className="card panel settings-hero"><div><p className="eyebrow">Credential Store</p><h2>凭证管理</h2><p>API Key 只以脱敏引用展示，密钥明文仅在创建或轮换提交边界出现。</p></div><span className="settings-scope-chip">{props.accountName ?? '未选择账号'}</span></article>
    {props.accountsError && <div className="settings-state error" role="alert">{props.accountsError}</div>}
    {!props.accountId && !props.accountsLoading && <div className="settings-state empty"><strong>请选择明确的闲鱼账号</strong><span>凭证按账号隔离，未选择账号时不会读取或编辑任何配置。</span></div>}
    {props.accountId && state.phase === 'loading' && <div className="settings-state loading"><span className="settings-spinner" />正在读取凭证引用…</div>}
    {props.accountId && state.phase === 'error' && <div className="settings-state error" role="alert"><strong>{state.error}</strong><button type="button" className="btn ghost" onClick={() => void props.onRetry()}>重试</button></div>}
    {props.accountId && (state.phase === 'empty' || state.phase === 'saved') && props.items.length === 0 && <div className="settings-state empty"><strong>当前账号还没有模型 API Key</strong><span>新增后会以 provider、alias、状态和指纹摘要展示，密钥不会回显。</span><button type="button" className="btn primary" onClick={props.onCreate}>新增 API Key</button></div>}
    {props.accountId && props.items.length > 0 && <article className="card panel credential-list-card"><div className="panel-head"><div><h2>模型 API Key</h2><p>当前账号 {props.accountName ?? props.accountId} · 共 {props.items.length} 个引用</p></div><button type="button" className="btn primary" onClick={props.onCreate}>新增配置</button></div><div className="credential-list">{props.items.map((item) => <CredentialRow key={item.id} item={item} busy={state.phase === 'submitting'} onEdit={props.onEdit} onRotate={props.onRotate} onStatus={props.onStatus} />)}</div></article>}
    {state.phase === 'saved' && <div className="settings-save-toast" role="status">{state.lastAction === 'rotated' ? 'API Key 已轮换并重新启用。' : state.lastAction === 'revoked' ? '凭证已撤销，旧密钥不会恢复。' : '凭证配置已保存。'}</div>}
  </div>;
}

function CredentialRow({ item, busy, onEdit, onRotate, onStatus }: { item: CredentialRefVM; busy: boolean; onEdit: (item: CredentialRefVM) => void; onRotate: (item: CredentialRefVM) => void; onStatus: (item: CredentialRefVM, status: 'active' | 'disabled' | 'revoked') => void }) {
  const statusLabel = item.status === 'active' ? '已启用' : item.status === 'disabled' ? '已禁用' : item.status === 'rotating' ? '轮换中' : '已撤销';
  const statusTone = item.status === 'active' ? 'ok' : item.status === 'revoked' ? 'danger' : 'warn';
  return <div className="credential-row" data-credential-row={item.id}><div className="credential-mark">{item.provider.slice(0, 1).toUpperCase()}</div><div className="credential-main"><div className="credential-title"><strong>{item.alias}</strong><span className={`status-pill ${statusTone}`}>{statusLabel}</span></div><div className="credential-meta"><span>{item.provider}</span><span>指纹 · {item.fingerprint}</span><span>版本 {item.version}</span><span>不可查看密钥</span></div></div><div className="credential-actions"><button type="button" className="btn ghost" onClick={() => onEdit(item)} disabled={busy || item.status === 'revoked'}>编辑</button><button type="button" className="btn ghost" onClick={() => onRotate(item)} disabled={busy || item.status === 'revoked'}>轮换</button>{item.status === 'active' ? <button type="button" className="btn ghost" onClick={() => onStatus(item, 'disabled')} disabled={busy}>禁用</button> : item.status === 'disabled' ? <button type="button" className="btn ghost" onClick={() => onStatus(item, 'active')} disabled={busy}>启用</button> : null}<button type="button" className="btn danger" onClick={() => { if (window.confirm('撤销后该凭证不可恢复，确认继续？')) onStatus(item, 'revoked'); }} disabled={busy || item.status === 'revoked'}>撤销</button></div></div>;
}

function CredentialEditor({ mode, accountId, credential, onClose, onCreate, onUpdate, onRotate }: { mode: 'create' | 'edit' | 'rotate'; accountId: string; credential?: CredentialRefVM; onClose: () => void; onCreate: (input: { accountId: string; provider: string; alias: string; label?: string; apiKey: string }) => Promise<void>; onUpdate: (input: { credentialId: string; expectedVersion: number; provider?: string; alias?: string; label?: string }) => Promise<void>; onRotate: (input: { credentialId: string; expectedVersion: number; apiKey: string }) => Promise<void> }) {
  const [provider, setProvider] = useState(credential?.provider ?? 'openai-compatible');
  const [alias, setAlias] = useState(credential?.alias ?? 'primary');
  const [label, setLabel] = useState(credential?.label ?? '');
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const title = mode === 'create' ? '新增 API Key' : mode === 'rotate' ? '轮换 API Key' : '编辑凭证引用';

  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      if (mode === 'create') await onCreate({ accountId, provider, alias, label: label || undefined, apiKey });
      else if (mode === 'rotate' && credential) await onRotate({ credentialId: credential.id, expectedVersion: credential.version, apiKey });
      else if (credential) await onUpdate({ credentialId: credential.id, expectedVersion: credential.version, provider, alias, label: label || undefined });
      onClose();
    } catch (err) { setError(err instanceof Error ? err.message : '保存失败，请重试。'); }
    finally { setBusy(false); }
  }

  return <div className="modal-backdrop" role="presentation"><form className="card modal-card settings-editor" onSubmit={(event) => void submit(event)}><div className="modal-head"><div><p className="eyebrow">{mode === 'rotate' ? 'Rotate Secret' : 'Credential Store'}</p><h2>{title}</h2><p>{mode === 'edit' ? '只更新引用元数据，不会读取旧密钥。' : '明文只存在于本次受控提交，不会写入 URL 或本地缓存。'}</p></div><button type="button" className="icon-button" onClick={onClose} aria-label="关闭">×</button></div><div className="settings-form-grid">{mode !== 'rotate' && <><label>Provider<input value={provider} onChange={(event) => setProvider(event.target.value)} required /></label><label>Alias<input value={alias} onChange={(event) => setAlias(event.target.value)} required /></label><label className="full">备注（可选）<input value={label} onChange={(event) => setLabel(event.target.value)} /></label></>}{mode !== 'edit' && <label className="full">API Key<input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} autoComplete="new-password" placeholder="输入新的 API Key" required minLength={8} /></label>}</div>{error && <div className="inline-error" role="alert">{error}</div>}<div className="settings-editor-note"><strong>安全边界</strong><span>服务端只返回指纹摘要（{credential?.fingerprint ?? '保存后生成'}），不会提供 reveal。</span></div><div className="modal-actions"><button type="button" className="btn ghost" onClick={onClose}>取消</button><button type="submit" className="btn primary" disabled={busy || !accountId}>{busy ? '提交中…' : mode === 'rotate' ? '确认轮换' : mode === 'create' ? '保存配置' : '保存修改'}</button></div></form></div>;
}

function ReferencePanel({ tab, onOpenCredentials }: { tab: Exclude<TabKey, 'credentials'>; onOpenCredentials: () => void }) {
  const content: Record<Exclude<TabKey, 'credentials'>, { title: string; description: string; rows: Array<[string, string, string]> }> = {
    autoReply: { title: '自动回复 Agent', description: '买家侧 Agent 配置已独立保存，保存后下一条消息读取最新配置。', rows: [['配置范围', '买家侧自动回复', '独立'], ['工具权限', '四个只读工具', '受控'], ['发送模式', '模拟发送 / 白名单真实发送', '策略'] ] },
    model: { title: 'OpenAI API 兼容模型配置', description: 'ModelClient 只消费 CredentialRef，不在页面回显明文 API Key。', rows: [['当前配置', 'openai-compatible / primary', '已脱敏'], ['Secret', 'secret_store_ref:model_api_key_primary', '不可查看'], ['生效规则', '保存后由运行时读取引用', '受控'] ] },
    safety: { title: '安全输出校验', description: '买家输入按不可信内容处理，凭证、Cookie 和内部配置永不进入买家链路。', rows: [['Prompt Injection', '拦截', '高优先级'], ['凭证泄露', '拦截', '高优先级'], ['非订单交付', '校验 buyer_deliverable', '策略'] ] },
    outbox: { title: 'Outbox Worker / Execution Runtime', description: '执行队列和运行时恢复属于后续切片，本页只保留高保真状态入口。', rows: [['Worker', 'online · 最近心跳 14:24:08', '正常'], ['队列深度', '7 pending / 128 succeeded today', '运行中'], ['人工确认', '高风险动作确认后才执行', '已开启'] ] },
    plugins: { title: '插件配置', description: 'Skill / Plugin 版本化管理保留为后续独立切片。', rows: [['Policy Plugin', '自动回复与风险策略', '已启用'], ['Executor Plugin', '消息与 Outbox 执行', '已启用'], ['夸克交付 Skill', '读取受控凭证引用', '需配置'] ] },
  };
  const panel = content[tab];
  return <div className="settings-content"><article className="card panel"><div className="panel-head"><div><p className="eyebrow">Settings Reference</p><h2>{panel.title}</h2><p>{panel.description}</p></div><span className="settings-scope-chip">后续切片</span></div><div className="settings-reference-list">{panel.rows.map(([label, value, tone]) => <div key={label}><strong>{label}</strong><span>{value}</span><em>{tone}</em></div>)}</div>{tab === 'model' && <button type="button" className="btn primary" onClick={onOpenCredentials}>管理 API Key 凭证</button>}</article></div>;
}
