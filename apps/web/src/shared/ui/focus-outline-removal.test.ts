import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const runtimeCss = [
  new URL('../../styles.css', import.meta.url),
  new URL('./select-field.css', import.meta.url),
  new URL('../../features/workspace/components/workspace.css', import.meta.url),
].map((url) => readFileSync(fileURLToPath(url), 'utf8'));

describe('focus outline cleanup', () => {
  it('does not emit the removed blue focus-visible outline token', () => {
    const removedOutline = /outline:\s*2px solid rgba\(36,\s*90,\s*141,\s*\.35\)/;

    for (const css of runtimeCss) {
      expect(css).not.toMatch(removedOutline);
    }
  });
});
