import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const sharedUiRoot = dirname(fileURLToPath(import.meta.url));
const featuresRoot = join(sharedUiRoot, '..', '..', 'features');

function listSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return listSourceFiles(path);
    return /\.(tsx|ts)$/.test(entry.name) ? [path] : [];
  });
}

describe('select usage architecture', () => {
  it('keeps native select markup inside shared SelectField only', () => {
    const violations = listSourceFiles(featuresRoot)
      .filter((file) => !/\.test\.(tsx|ts)$/.test(file))
      .flatMap((file) => {
        const source = readFileSync(file, 'utf8');
        return /<select\b/.test(source) ? [relative(featuresRoot, file)] : [];
      });

    expect(violations).toEqual([]);
  });

  it('keeps the shared SelectField implementation as the sole native-select owner', () => {
    const source = readFileSync(join(sharedUiRoot, 'SelectField.tsx'), 'utf8');
    expect((source.match(/<select\b/g) ?? []).length).toBe(1);
  });

  it('uses the Xianyu admin design tokens for the shared control surface', () => {
    const css = readFileSync(join(sharedUiRoot, 'select-field.css'), 'utf8');
    expect(css).toContain('border-radius: 7px');
    expect(css).toContain('background: var(--bg)');
    expect(css).toContain('color: var(--text)');
    expect(css).toContain('font-size: 12px');
    expect(css).toContain('appearance: none');
  });
});
