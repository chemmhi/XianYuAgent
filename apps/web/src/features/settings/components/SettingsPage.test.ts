import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const settingsPageSource = readFileSync(fileURLToPath(new URL('./SettingsPage.tsx', import.meta.url)), 'utf8');

describe('SettingsPage default tab', () => {
  it('opens on the Auto Reply Agent tab', () => {
    expect(settingsPageSource).toContain("useState<TabKey>('autoReply')");
    expect(settingsPageSource).not.toContain("useState<TabKey>('credentials')");
  });
});
