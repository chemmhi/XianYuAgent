import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectivityLabel, connectivitySummary, normalizeModelOptions, reasoningOptionsFor } from './OpenAISettingsPanel';

const settingsDir = dirname(fileURLToPath(import.meta.url));

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

  it('anchors the OpenAI model select to the shared field geometry', () => {
    const source = readFileSync(join(settingsDir, 'OpenAISettingsPanel.tsx'), 'utf8');
    const css = readFileSync(join(settingsDir, 'settings.css'), 'utf8');
    expect(source).toContain('className="openai-model-field"');
    expect(source).toContain('data-openai-model-select="true"');
    expect(css).toMatch(/\.openai-model-field\s*\.ui-select-control/);
    expect(css).toMatch(/\.openai-model-field\s+\.ui-select-control\s+select/);
  });

  it('renders runtime provider status and manual routing actions', () => {
    const source = readFileSync(join(settingsDir, 'OpenAISettingsPanel.tsx'), 'utf8');
    expect(source).toContain('data-openai-runtime');
    expect(source).toContain('当前生效 Provider');
    expect(source).toContain('>自动</Button>');
    expect(source).toContain('>主优先</Button>');
    expect(source).toContain('>备优先</Button>');
    expect(source).toContain('feature_enabled');
    expect(source).toContain('兼容模式');
    expect(source).toContain('用于 OpenAI API 兼容 ModelClient；主配置失败时可切换备用 Provider。');
    expect(source).toContain('className="openai-advanced-settings"');
    expect(source).not.toContain('DeepSeek Harness');
  });

  it('keeps provider fields in the approved single-column order', () => {
    const source = readFileSync(join(settingsDir, 'OpenAISettingsPanel.tsx'), 'utf8');
    const providerIndex = source.indexOf('<InputField label="Provider"');
    const baseUrlIndex = source.indexOf('<InputField label="Base URL"');
    const apiKeyIndex = source.indexOf('<InputField label="API Key"');
    const modelIndex = source.indexOf('<SelectField label="Model"');
    expect(providerIndex).toBeGreaterThan(-1);
    expect(baseUrlIndex).toBeGreaterThan(providerIndex);
    expect(apiKeyIndex).toBeGreaterThan(baseUrlIndex);
    expect(modelIndex).toBeGreaterThan(apiKeyIndex);
  });
});
