import { describe, expect, it } from 'vitest';
import { normalizeModelOptions, reasoningOptionsFor } from './OpenAISettingsPanel';

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
});
