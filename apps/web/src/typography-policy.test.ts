import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const typographyCss = readFileSync(fileURLToPath(new URL('./typography.css', import.meta.url)), 'utf8');
const mainTsx = readFileSync(fileURLToPath(new URL('./main.tsx', import.meta.url)), 'utf8');

describe('platform typography policy', () => {
  it('defines the shared font stack and readable baseline tokens', () => {
    expect(typographyCss).toContain('--font-family-ui:');
    expect(typographyCss).toContain('--font-size-body: 14px;');
    expect(typographyCss).toContain('--font-size-body-compact: 13px;');
    expect(typographyCss).toContain('--font-size-meta: 12px;');
    expect(typographyCss).toContain('--font-line-body: 1.6;');
  });

  it('keeps the typography layer loaded after the existing global/mobile styles', () => {
    expect(mainTsx.indexOf("import './styles.css';")).toBeGreaterThanOrEqual(0);
    expect(mainTsx.indexOf("import './mobile-overrides.css';")).toBeGreaterThan(mainTsx.indexOf("import './styles.css';"));
    expect(mainTsx.indexOf("import './typography.css';")).toBeGreaterThan(mainTsx.indexOf("import './mobile-overrides.css';"));
  });

  it('raises business text while preserving chart-axis exceptions', () => {
    expect(typographyCss).toContain('body .app-viewport button');
    expect(typographyCss).toContain('body .app-viewport .dashboard-chart-axis');
    expect(typographyCss).toContain('font-size: 10px;\n  line-height: 1;');
  });
});
