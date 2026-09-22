import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(here, 'accounts.css'), 'utf8');

describe('accounts list layout', () => {
  it('uses stable grid tracks with a fixed operation column', () => {
    expect(css).toContain('minmax(88px, .75fr)');
    expect(css).toContain('minmax(128px, 1fr) 252px');
    expect(css).not.toContain('1fr auto; gap: 12px');
  });

  it('uses a flex state container that fills the panel for four-way centering', () => {
    expect(css).toContain('align-items: center; justify-content: center;');
    expect(css).toContain('.accounts-domain-panel > .accounts-domain-state { flex: 1; min-height: 0; }');
  });
});
