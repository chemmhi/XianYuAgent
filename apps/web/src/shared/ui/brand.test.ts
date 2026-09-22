import { describe, expect, it } from 'vitest';
import { DEFAULT_LOGO_VARIANT, logoAssetPath, resolveLogoVariant } from './brand';

describe('brand logo selection', () => {
  it('defaults to Agent Fish', () => {
    expect(resolveLogoVariant()).toBe(DEFAULT_LOGO_VARIANT);
    expect(resolveLogoVariant('')).toBe('agent-fish');
  });

  it('accepts only the five shipped logo variants', () => {
    expect(resolveLogoVariant('signal-grid')).toBe('signal-grid');
    expect(resolveLogoVariant('gateway_check')).toBe('gateway-check');
    expect(resolveLogoVariant('legacy-logo')).toBe('agent-fish');
    expect(resolveLogoVariant('unknown')).toBe('agent-fish');
  });

  it('builds public asset paths', () => {
    expect(logoAssetPath('agent-fish')).toBe('/brand/agent-fish.svg');
  });
});
