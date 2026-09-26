import { useEffect, useState, type FormEvent } from 'react';
import { SelectField } from '../../../shared/ui/SelectField';
import { Button } from '../../../shared/ui/Button';
import { InputField } from '../../../shared/ui/InputField';
import { TextAreaField } from '../../../shared/ui/TextAreaField';
import type { AutoReplyAgentSettingsController } from '../agent-settings-controller';
import type { AutoReplyAgentConfigVM } from '../types';

type EditableConfig = Omit<AutoReplyAgentConfigVM, 'accountId' | 'updatedByAdminId' | 'configVersion' | 'configDigest' | 'createdAt' | 'updatedAt' | 'debounceMs'>;

export function AutoReplyAgentPanel({ controller, accountName, accountId }: { controller: AutoReplyAgentSettingsController; accountName?: string; accountId?: string }) {
  const { state } = controller;
  const [draft, setDraft] = useState<EditableConfig | null>(null);

  useEffect(() => {
    if (state.data) {
      const { accountId: _accountId, updatedByAdminId, configVersion, configDigest, createdAt, updatedAt, debounceMs: _legacyDebounceMs, ...editable } = state.data;
      void _accountId; void updatedByAdminId; void configVersion; void configDigest; void createdAt; void updatedAt; void _legacyDebounceMs;
      setDraft(editable);
    }
  }, [state.data]);

  function setField<K extends keyof EditableConfig>(field: K, value: EditableConfig[K]) {
    setDraft((current) => current ? { ...current, [field]: value } : current);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft || !state.data) return;
    await controller.update({ expectedVersion: state.data.configVersion, patch: draft });
  }

  if (!accountId) return <div className="settings-state empty"><strong>请先在账号管理中设置当前账号</strong><span>自动回复 Agent 配置按闲鱼账号隔离，未选择账号时不会读取或编辑配置。</span></div>;
  if (state.phase === 'loading' || state.phase === 'idle') return <div className="settings-state loading"><span className="settings-spinner" />正在读取自动回复 Agent 配置…</div>;
  if (state.phase === 'error' && !state.data) return <div className="settings-state error" role="alert"><strong>{state.error}</strong><Button variant="ghost" type="button" onClick={() => void controller.reload()}>重试</Button></div>;
  if (!draft || !state.data) return null;

  return <div className="settings-content" data-auto-reply-agent-panel>
    <article className="card panel settings-hero"><div><p className="eyebrow">自动回复 Agent</p><h2>自动回复 Agent 配置</h2><p>配置只作用于买家侧自动回复 Agent，不进入 Workspace Agent 链路。</p></div><span className="settings-scope-chip">{accountName ?? accountId} · v{state.data.configVersion}</span></article>
    {state.error && <div className="settings-state error" role="alert"><strong>{state.error}</strong><Button variant="ghost" type="button" onClick={() => void controller.reload()}>刷新配置</Button></div>}
    {state.phase === 'saved' && <div className="settings-save-toast" role="status">自动回复 Agent 配置已保存，下一条消息将读取新配置。</div>}
    <form className="card panel settings-editor auto-reply-agent-editor" onSubmit={(event) => void submit(event)}>
      <div className="settings-form-grid">
        <label className="settings-checkbox full"><input type="checkbox" checked={draft.enabled} onChange={(event) => setField('enabled', event.target.checked)} />启用自动回复 Agent</label>
        <fieldset className="auto-reply-agent-fields" disabled={!draft.enabled} aria-label="自动回复 Agent 配置项">
          <TextAreaField fieldClassName="full" label="系统提示词" value={draft.systemPrompt} onChange={(event) => setField('systemPrompt', event.target.value)} rows={5} maxLength={20000} required />
          <TextAreaField fieldClassName="full" label="用户提示词模板" value={draft.userPromptTemplate} onChange={(event) => setField('userPromptTemplate', event.target.value)} rows={4} maxLength={20000} required />
          <InputField label="最大循环次数" type="number" min={1} max={12} value={draft.maxLoops} onChange={(event) => setField('maxLoops', Number(event.target.value))} required />
          <InputField label="工具调用上限" type="number" min={1} max={32} value={draft.maxToolCalls} onChange={(event) => setField('maxToolCalls', Number(event.target.value))} required />
          <InputField label="工具超时（毫秒）" type="number" min={100} max={120000} value={draft.toolTimeoutMs} onChange={(event) => setField('toolTimeoutMs', Number(event.target.value))} required />
          <InputField label="总超时（毫秒）" type="number" min={1000} max={300000} value={draft.totalTimeoutMs} onChange={(event) => setField('totalTimeoutMs', Number(event.target.value))} required />
          <InputField label="上下文历史条数" type="number" min={0} max={100} value={draft.maxHistory} onChange={(event) => setField('maxHistory', Number(event.target.value))} required />
          <InputField label="最大回复长度" type="number" min={30} max={4000} value={draft.maxReplyLength} onChange={(event) => setField('maxReplyLength', Number(event.target.value))} required />
          <InputField label="分段发送间隔（毫秒）" type="number" min={0} max={30000} value={draft.replySegmentDelayMs} onChange={(event) => setField('replySegmentDelayMs', Number(event.target.value))} required />
          <InputField label="自动回复延迟发送时间（秒）" type="number" min={0} max={86400} value={draft.sendDelaySeconds} onChange={(event) => setField('sendDelaySeconds', Number(event.target.value))} required />
          <SelectField label="发送模式" value={draft.sendMode} onChange={(event) => setField('sendMode', event.target.value as EditableConfig['sendMode'])} options={[{ value: 'simulate', label: '模拟发送' }, { value: 'live', label: '真实发送（受白名单约束）' }]} />
        </fieldset>
      </div>
      <div className="settings-editor-note"><strong>配置审计</strong><span>当前版本 v{state.data.configVersion} · 摘要 {state.data.configDigest} · Prompt 原文不会写入审计日志。</span></div>
      <div className="modal-actions"><Button variant="primary" type="submit" disabled={state.phase === 'submitting'}>{state.phase === 'submitting' ? '保存中…' : '保存自动回复 Agent 配置'}</Button></div>
    </form>
  </div>;
}
