import { describe, expect, it } from 'vitest';
import { connectivityLabel, connectivitySummary, normalizeModelOptions, reasoningOptionsFor } from './OpenAISettingsPanel';

describe('OpenAI settings model controls', () => {
  it('preserves provider-owned model metadata without embedding model ids', () => {
    const models = normalizeModelOptions([
      { id: 'provider-reasoning', reasoningEfforts: ['low', 'high'] },
      { id: 'provider-reasoning', reasoningEfforts: ['duplicate'] },
      { id: 'provider-chat' },
    ]);

    expect(models).toEqual([
      { id: 'provider-reasoning', reasoningEfforts: ['low', 'high'] },
      { id: 'provider-chat' },
    ]);
    expect(reasoningOptionsFor('provider-reasoning', models)).toEqual(['low', 'high']);
    expect(reasoningOptionsFor('provider-chat', models)).toEqual([]);
  });

  it('merges provider reasoning and thinking metadata only when supplied', () => {
    const models = normalizeModelOptions([{ id: 'provider-thinking', reasoningEfforts: ['balanced'], thinkingLevels: ['deep', 'balanced'] }]);
    expect(reasoningOptionsFor('provider-thinking', models)).toEqual(['balanced', 'deep']);
    expect(reasoningOptionsFor('missing-model', models)).toEqual([]);
  });

  it('distinguishes saved-but-untested configs from empty cards', () => {
    expect(connectivityLabel('primary', 'unknown', true)).toBe('待测试');
    expect(connectivityLabel('backup', 'unknown', true)).toBe('待测试');
    expect(connectivityLabel('primary', 'unknown', false)).toBe('待配置');
    expect(connectivitySummary('backup', { id: 'backup-1', connectivity: 'unknown', model: 'provider-model' })).toBe('provider-model · 待测试');
    expect(connectivitySummary('backup', { connectivity: 'unknown', model: '' })).toBe('未配置 · 待配置');
  });
});
