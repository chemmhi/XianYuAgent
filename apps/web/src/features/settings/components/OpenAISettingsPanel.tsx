import { useEffect, useMemo, useRef, useState } from 'react';
import { SelectField } from '../../../shared/ui/SelectField';
import { Button } from '../../../shared/ui/Button';
import { InputField } from '../../../shared/ui/InputField';
import type { OpenAISettingsApi } from '../api';
import { useOpenAISettingsController } from '../openai-controller';
import type { ModelProviderApi, ProviderModelVM } from '../model-provider-api';
import type { OpenAIConfigRole, OpenAIConfigVM, OpenAIWireApi } from '../types';

export type OpenAIModelOption = {
  id: string;
  reasoningEfforts?: string[];
  thinkingLevels?: string[];
};

type ConfigForm = {
  id?: string;
  version?: number;
  role: OpenAIConfigRole;
  provider: string;
  alias: string;
  baseUrl: string;
  model: string;
  reasoningEffort?: string;
  wireApi: OpenAIWireApi;
  timeoutMs: number;
  apiKey: string;
  apiKeyHint?: string;
  apiKeyMasked: boolean;
  status?: OpenAIConfigVM['status'];
  connectivity: 'unknown' | 'passed' | 'failed';
};

type ModelLoadPhase = 'idle' | 'loading' | 'success' | 'empty' | 'error';

const emptyForm = (role: OpenAIConfigRole): ConfigForm => ({ role, provider: '', alias: role, baseUrl: '', model: '', reasoningEffort: '', wireApi: 'responses', timeoutMs: 60_000, apiKey: '', apiKeyMasked: false, connectivity: 'unknown' });

export function normalizeModelOptions(models: Array<string | ProviderModelVM>): OpenAIModelOption[] {
  const seen = new Set<string>();
  const result: OpenAIModelOption[] = [];
  for (const item of models) {
    const id = typeof item === 'string' ? item.trim() : item.id?.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const reasoningEfforts = typeof item === 'string' ? undefined : cleanOptions(item.reasoningEfforts);
    const thinkingLevels = typeof item === 'string' ? undefined : cleanOptions(item.thinkingLevels);
    result.push({ id, ...(reasoningEfforts?.length ? { reasoningEfforts } : {}), ...(thinkingLevels?.length ? { thinkingLevels } : {}) });
  }
  return result;
}

export function reasoningOptionsFor(model: string, options: OpenAIModelOption[]): string[] {
  const selected = options.find((item) => item.id === model);
  if (!selected) return [];
  return [...new Set([...(selected.reasoningEfforts ?? []), ...(selected.thinkingLevels ?? [])].map((item) => item.trim()).filter(Boolean))];
}

export function connectivityLabel(role: OpenAIConfigRole, state: ConfigForm['connectivity'], configured: boolean, testing = false): string {
  if (testing) return '测试中…';
  if (state === 'passed') return role === 'primary' ? '测试通过，已生效' : '备用可用';
  if (state === 'failed') return '连接失败';
  return configured ? '待测试' : '待配置';
}

export function connectivitySummary(role: OpenAIConfigRole, form: Pick<ConfigForm, 'id' | 'connectivity' | 'model'>): string {
  const state = form.connectivity === 'passed' ? (role === 'primary' ? '测试通过' : '可故障切换') : form.connectivity === 'failed' ? '连接失败' : form.id ? '待测试' : '待配置';
  return `${form.model || '未配置'} · ${state}`;
}

function cleanOptions(values: string[] | undefined): string[] | undefined {
  if (!Array.isArray(values)) return undefined;
  const cleaned = [...new Set(values.map((item) => String(item).trim()).filter(Boolean))];
  return cleaned.length ? cleaned : undefined;
}

export function OpenAISettingsPanel(props: { accountId: string; accountName?: string; api: OpenAISettingsApi; modelApi: ModelProviderApi; accountsLoading: boolean; accountsError: string | null }) {
  const controller = useOpenAISettingsController(props.api, props.accountId);
  const [forms, setForms] = useState<Record<OpenAIConfigRole, ConfigForm>>({ primary: emptyForm('primary'), backup: emptyForm('backup') });
  const [busyRole, setBusyRole] = useState<OpenAIConfigRole | null>(null);
  const [testRole, setTestRole] = useState<OpenAIConfigRole | null>(null);
  const [testError, setTestError] = useState<Record<OpenAIConfigRole, string | null>>({ primary: null, backup: null });
  const [modelOptions, setModelOptions] = useState<Record<OpenAIConfigRole, OpenAIModelOption[]>>({ primary: [], backup: [] });
  const [modelPhase, setModelPhase] = useState<Record<OpenAIConfigRole, ModelLoadPhase>>({ primary: 'idle', backup: 'idle' });
  const modelLoadedKey = useRef<Record<OpenAIConfigRole, string | undefined>>({ primary: undefined, backup: undefined });
  const modelRequestId = useRef<Record<OpenAIConfigRole, number>>({ primary: 0, backup: 0 });
  const modelRequesting = useRef<Record<OpenAIConfigRole, boolean>>({ primary: false, backup: false });

  useEffect(() => {
    // A refreshed account/config list invalidates all provider-derived options.
    // Keeping these arrays across account changes can expose one account's
    // models in the other account's card before the next lazy probe finishes.
    modelRequestId.current = {
      primary: modelRequestId.current.primary + 1,
      backup: modelRequestId.current.backup + 1,
    };
    modelRequesting.current = { primary: false, backup: false };
    modelLoadedKey.current = { primary: undefined, backup: undefined };
    setModelOptions({ primary: [], backup: [] });
    setLocalModelsState({ primary: [], backup: [] });
    setModelPhase({ primary: 'idle', backup: 'idle' });
    setTestError({ primary: null, backup: null });
    setForms((previous) => {
      const next = { primary: emptyForm('primary'), backup: emptyForm('backup') };
      for (const item of controller.state.data?.items ?? []) {
        const view = fromView(item);
        next[item.role] = {
          ...view,
          // Keep the just-verified local state when the save response refreshes
          // the redacted server view, which intentionally has no secret probe.
          connectivity: previous[item.role]?.connectivity === 'passed' ? 'passed' : view.connectivity,
        };
      }
      return next;
    });
  }, [controller.state.data]);

  const configured = useMemo(() => Object.values(forms).filter((item) => item.id), [forms]);

  function update(role: OpenAIConfigRole, patch: Partial<ConfigForm>) {
    setForms((previous) => ({ ...previous, [role]: { ...previous[role], ...patch } }));
    if ('provider' in patch || 'baseUrl' in patch || 'apiKey' in patch) {
      invalidateModelState(role);
    }
  }

  function invalidateModelState(role: OpenAIConfigRole) {
    modelRequestId.current[role] += 1;
    modelRequesting.current[role] = false;
    modelLoadedKey.current[role] = undefined;
    setModelOptions((previous) => ({ ...previous, [role]: [] }));
    setLocalModelsState((previous) => ({ ...previous, [role]: [] }));
    setModelPhase((previous) => ({ ...previous, [role]: 'idle' }));
  }

  async function loadModels(form: ConfigForm) {
    if (modelRequesting.current[form.role]) return;
    if (form.id) {
      const requestKey = `${form.id}:${form.baseUrl}`;
      if (modelLoadedKey.current[form.role] === requestKey && modelPhase[form.role] !== 'error') return;
    }
    if (!form.id && (!form.provider || !form.baseUrl || !form.apiKey)) {
      setTestError((previous) => ({ ...previous, [form.role]: '请先填写 Provider、Base URL 和 API Key，再展开模型列表。' }));
      return;
    }
    const requestId = ++modelRequestId.current[form.role];
    modelRequesting.current[form.role] = true;
    setModelPhase((previous) => ({ ...previous, [form.role]: 'loading' }));
    if (form.id) {
      const requestKey = `${form.id}:${form.baseUrl}`;
      try {
        const result = await props.modelApi.list({ accountId: props.accountId, configId: form.id });
        if (requestId !== modelRequestId.current[form.role]) return;
        const models = normalizeModelOptions(result.models);
        setModelOptions((previous) => ({ ...previous, [form.role]: models }));
        setModelPhase((previous) => ({ ...previous, [form.role]: models.length > 0 ? 'success' : 'empty' }));
        modelLoadedKey.current[form.role] = requestKey;
        setTestError((previous) => ({ ...previous, [form.role]: null }));
      } catch (error) {
        if (requestId !== modelRequestId.current[form.role]) return;
        modelLoadedKey.current[form.role] = undefined;
        setModelPhase((previous) => ({ ...previous, [form.role]: 'error' }));
        setTestError((previous) => ({ ...previous, [form.role]: error instanceof Error ? error.message : '模型列表暂时不可用，请重试。' }));
      } finally {
        if (requestId === modelRequestId.current[form.role]) modelRequesting.current[form.role] = false;
      }
      return;
    }
    try {
      const result = await props.api.test({ accountId: props.accountId, role: form.role, provider: form.provider, alias: form.alias, baseUrl: form.baseUrl, model: form.model || 'pending', reasoningEffort: form.reasoningEffort || undefined, wireApi: form.wireApi, timeoutMs: form.timeoutMs, apiKey: form.apiKey });
      if (requestId !== modelRequestId.current[form.role]) return;
      update(form.role, { connectivity: 'passed' });
      setTestError((previous) => ({ ...previous, [form.role]: null }));
      setLocalModels(form.role, result.models);
      setModelPhase((previous) => ({ ...previous, [form.role]: result.models.length > 0 ? 'success' : 'empty' }));
    } catch (error) {
      if (requestId !== modelRequestId.current[form.role]) return;
      setModelPhase((previous) => ({ ...previous, [form.role]: 'error' }));
      setTestError((previous) => ({ ...previous, [form.role]: error instanceof Error ? error.message : '模型列表暂时不可用，请重试。' }));
    } finally {
      if (requestId === modelRequestId.current[form.role]) modelRequesting.current[form.role] = false;
    }
  }

  const [localModels, setLocalModelsState] = useState<Record<OpenAIConfigRole, OpenAIModelOption[]>>({ primary: [], backup: [] });
  function setLocalModels(role: OpenAIConfigRole, models: Array<string | ProviderModelVM>) { setLocalModelsState((previous) => ({ ...previous, [role]: normalizeModelOptions(models) })); }

  async function test(form: ConfigForm) {
    setBusyRole(form.role); setTestRole(form.role); setTestError((previous) => ({ ...previous, [form.role]: null }));
    try {
      const result = await controller.test({ accountId: props.accountId, configId: form.id, role: form.role, provider: form.provider, alias: form.alias, baseUrl: form.baseUrl, model: form.model, reasoningEffort: form.reasoningEffort || undefined, wireApi: form.wireApi, timeoutMs: form.timeoutMs, apiKey: form.apiKey || undefined });
      update(form.role, { connectivity: 'passed' });
      setLocalModels(form.role, result.models);
      setModelPhase((previous) => ({ ...previous, [form.role]: result.models.length > 0 ? 'success' : 'empty' }));
    } catch (error) {
      update(form.role, { connectivity: 'failed' });
      setTestError((previous) => ({ ...previous, [form.role]: error instanceof Error ? error.message : '连接失败，请检查配置。' }));
    } finally { setBusyRole(null); setTestRole(null); }
  }

  async function save(form: ConfigForm) {
    setBusyRole(form.role); setTestError((previous) => ({ ...previous, [form.role]: null }));
    try {
      const saved = await controller.save({ accountId: props.accountId, configId: form.id, role: form.role, provider: form.provider, alias: form.alias, baseUrl: form.baseUrl, model: form.model, reasoningEffort: form.reasoningEffort || undefined, wireApi: form.wireApi, timeoutMs: form.timeoutMs, apiKey: form.apiKey || undefined, expectedVersion: form.version });
      update(form.role, { id: saved.id, version: saved.version, apiKey: '', apiKeyHint: saved.apiKeyHint, apiKeyMasked: Boolean(saved.apiKeyHint), reasoningEffort: saved.reasoningEffort ?? form.reasoningEffort, connectivity: form.connectivity === 'passed' ? 'passed' : saved.lastConnectivity ?? 'unknown', status: saved.status });
    } catch (error) {
      setTestError((previous) => ({ ...previous, [form.role]: error instanceof Error ? error.message : '保存失败，请重试。' }));
    } finally { setBusyRole(null); }
  }

  return <div className="settings-content openai-settings-content" data-openai-panel>
    <article className="card panel openai-settings-hero">
      <div className="panel-head"><div><p className="eyebrow">ModelClient</p><h2>OpenAI API 兼容模型配置</h2><p>用于 DeepSeek Harness / OpenAI API 兼容 ModelClient；当前配置失败时可切换备用 Provider。</p></div><span className="status-pill info">ModelClient</span></div>
      {props.accountsError && <div className="settings-state error" role="alert">{props.accountsError}</div>}
      {!props.accountId && !props.accountsLoading && <div className="settings-state empty"><strong>请选择明确的闲鱼账号</strong><span>模型配置按账号隔离，未选择账号时不会读取或编辑任何配置。</span></div>}
      {props.accountId && controller.state.phase === 'loading' && <div className="settings-state loading"><span className="settings-spinner" />正在读取 OpenAI API 配置…</div>}
      {props.accountId && controller.state.phase === 'error' && <div className="settings-state error" role="alert"><strong>{controller.state.error}</strong><Button variant="ghost" type="button" onClick={() => void controller.reload()}>重试</Button></div>}
      {props.accountId && <>
        <div className="two-grid nested openai-config-grid">
          {(['primary', 'backup'] as const).map((role) => <OpenAIConfigCard key={role} form={forms[role]} role={role} busy={busyRole === role} testing={testRole === role} error={testError[role]} providerModels={forms[role].id ? modelOptions[role] : localModels[role]} providerPhase={forms[role].id ? modelPhase[role] : modelPhase[role]} onChange={(patch) => update(role, patch)} onTest={() => void test(forms[role])} onSave={() => void save(forms[role])} onLoadModels={() => void loadModels(forms[role])} />)}
        </div>
        <div className="openai-compare-summary"><span><strong>当前配置</strong>{connectivitySummary('primary', forms.primary)}</span><span><strong>备用配置</strong>{connectivitySummary('backup', forms.backup)}</span></div>
        <div className="timeline openai-timeline">
          <div className="timeline-row"><strong>生效规则</strong><span>Base URL、API Key、Model 填写完整且连接测试通过后才生效。</span><span className="status-pill ok">强校验</span></div>
          <div className="timeline-row"><strong>故障切换</strong><span>当前 Provider 失败、超时、认证失败或限流时尝试备用配置。</span><span className="status-pill warn">Fallback</span></div>
          <div className="timeline-row"><strong>审计边界</strong><span>记录失败原因、provider、trace_id；API Key 仅显示脱敏摘要。</span><span className="status-pill info">脱敏</span></div>
        </div>
      </>}
      {controller.state.phase === 'saved' && <div className="settings-save-toast" role="status">{controller.state.lastAction === 'backup' ? '备用 API 配置已保存。' : '当前 API 配置已保存。'}</div>}
    </article>
    {configured.length === 0 && props.accountId && controller.state.phase === 'empty' && <div className="settings-state empty"><strong>尚未配置主/备模型</strong><span>分别填写两张配置卡并点击测试连通性、保存。</span></div>}
  </div>;
}

function OpenAIConfigCard(props: { form: ConfigForm; role: OpenAIConfigRole; busy: boolean; testing: boolean; error: string | null; providerModels: OpenAIModelOption[]; providerPhase: ModelLoadPhase; onChange: (patch: Partial<ConfigForm>) => void; onTest: () => void; onSave: () => void; onLoadModels: () => void }) {
  const title = props.role === 'primary' ? '当前配置' : '备用配置';
  const status = connectivityLabel(props.role, props.form.connectivity, Boolean(props.form.id), props.testing);
  const statusTone = props.form.connectivity === 'passed' ? 'ok' : props.form.connectivity === 'failed' ? 'danger' : 'warn';
  const modelPlaceholder = props.providerPhase === 'loading' ? '正在读取提供商模型…' : props.providerPhase === 'empty' ? '提供商未返回可用模型' : props.providerPhase === 'error' ? '模型读取失败，请重试' : props.providerModels.length > 0 ? '选择提供商模型' : '展开以读取模型';
  const reasoningOptions = reasoningOptionsFor(props.form.model, props.providerModels);
  const modelIds = props.providerModels.map((item) => item.id);
  return <section className="model-box openai-model-box" data-openai-config={props.role}>
    <div className="openai-model-head"><div><h3>{title}</h3><p>{props.role === 'primary' ? '优先使用，失败时自动切换备用 Provider。' : '主配置异常时自动接管请求。'}</p></div><span className={`status-pill ${statusTone}`}>{status}</span></div>
    <div className="openai-form-rows">
      <label><span>Provider</span><InputField value={props.form.provider} onChange={(event) => props.onChange({ provider: event.target.value })} placeholder="OpenAI Compatible" /></label>
      <label><span>Base URL</span><InputField value={props.form.baseUrl} onChange={(event) => props.onChange({ baseUrl: event.target.value })} placeholder="https://api.example.com/v1" /></label>
      <label><span>API Key</span><InputField type={props.form.apiKeyMasked ? 'text' : 'password'} value={props.form.apiKeyMasked ? (props.form.apiKeyHint ?? '') : props.form.apiKey} onFocus={() => { if (props.form.apiKeyMasked) props.onChange({ apiKey: '', apiKeyMasked: false }); }} onChange={(event) => props.onChange({ apiKey: event.target.value, apiKeyMasked: false })} placeholder={props.form.id ? '留空保持当前密钥' : '输入新的 API Key'} autoComplete="new-password" /></label>
      <label><span>Model</span><SelectField value={props.form.model} onFocus={props.onLoadModels} onClick={props.onLoadModels} onChange={(event) => { const model = event.target.value; props.onChange({ model, reasoningEffort: reasoningOptionsFor(model, props.providerModels).includes(props.form.reasoningEffort ?? '') ? props.form.reasoningEffort : '' }); }} options={[{ value: '', label: modelPlaceholder }, ...(props.form.model && !modelIds.includes(props.form.model) ? [{ value: props.form.model, label: props.form.model }] : []), ...props.providerModels.map((model) => ({ value: model.id, label: model.id }))]} /></label>
      {reasoningOptions.length > 0 && <label data-openai-reasoning="true"><span>思考程度</span><SelectField value={props.form.reasoningEffort ?? ''} onChange={(event) => props.onChange({ reasoningEffort: event.target.value })} options={[{ value: '', label: '使用提供商默认' }, ...reasoningOptions.map((option) => ({ value: option, label: option }))]} /></label>}
      {props.error && <div className="openai-inline-error" role="alert">{props.error}</div>}
    </div>
    <div className="card-actions"><Button variant="ghost" type="button" onClick={props.onTest} disabled={props.busy || !props.form.provider || !props.form.baseUrl || !props.form.model || (!props.form.id && !props.form.apiKey)}>{props.testing ? '测试中…' : '测试连通性'}</Button><Button variant="primary" type="button" onClick={props.onSave} disabled={props.busy || !props.form.provider || !props.form.baseUrl || !props.form.model || (!props.form.id && !props.form.apiKey)}>{props.busy ? '保存中…' : '保存'}</Button></div>
  </section>;
}

function fromView(item: OpenAIConfigVM): ConfigForm {
  return { id: item.id, version: item.version, role: item.role, provider: item.provider, alias: item.alias, baseUrl: item.baseUrl, model: item.model, reasoningEffort: item.reasoningEffort ?? '', wireApi: item.wireApi, timeoutMs: item.timeoutMs, apiKey: '', apiKeyHint: item.apiKeyHint, apiKeyMasked: Boolean(item.apiKeyHint), status: item.status, connectivity: item.lastConnectivity ?? 'unknown' };
}
