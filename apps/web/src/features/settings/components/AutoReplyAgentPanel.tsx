import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '../../../shared/ui/Button';
import { InputField } from '../../../shared/ui/InputField';
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
    await controller.update({ expectedVersion: state.data.configVersion, patch: { enabled: draft.enabled, totalTimeoutMs: draft.totalTimeoutMs } });
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
        <InputField
          fieldClassName="full"
          label={<span className="settings-label-with-help">总超时（毫秒）<InfoTooltip id={`auto-reply-timeout-help-${accountId}`} text="自动回复 Agent 一次完整处理的总时间预算。模型生成、工具调用和回复整理共享该预算；增大后复杂问题可以等待更久，Workspace 的超时设置不受影响。" /></span>}
          type="number"
          min={1000}
          max={300000}
          value={draft.totalTimeoutMs}
          onChange={(event) => setField('totalTimeoutMs', Number(event.target.value))}
          disabled={!draft.enabled}
          aria-describedby={`auto-reply-timeout-help-${accountId}`}
          required
        />
      </div>
      <div className="settings-editor-note"><strong>简化配置</strong><span>高级提示词、工具上限和发送策略由系统维护，避免误配；本页只调整自动回复总时间预算。</span></div>
      <div className="modal-actions"><Button variant="primary" type="submit" disabled={state.phase === 'submitting'}>{state.phase === 'submitting' ? '保存中…' : '保存自动回复 Agent 配置'}</Button></div>
    </form>
  </div>;
}

function InfoTooltip({ id, text }: { id: string; text: string }) {
  return <button type="button" className="settings-info-tooltip" aria-describedby={id} aria-label="查看配置说明"><span aria-hidden="true">i</span><span id={id} role="tooltip">{text}</span></button>;
}
