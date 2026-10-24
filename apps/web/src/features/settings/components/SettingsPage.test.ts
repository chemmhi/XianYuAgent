import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const settingsPageSource = readFileSync(fileURLToPath(new URL('./SettingsPage.tsx', import.meta.url)), 'utf8');

describe('SettingsPage default tab', () => {
  it('removes the deprecated tabs and keeps invite management admin-only', () => { expect(settingsPageSource).not.toContain("id: 'credentials'"); expect(settingsPageSource).not.toContain("id: 'safety'"); expect(settingsPageSource).not.toContain("id: 'outbox'"); expect(settingsPageSource).not.toContain("id: 'plugins'"); expect(settingsPageSource).toContain("id: 'invites'"); expect(settingsPageSource).toContain("adminRole === 'admin'"); });

  it('opens on the Auto Reply Agent tab', () => {
    expect(settingsPageSource).toContain("useState<TabKey>('autoReply')");
    expect(settingsPageSource).not.toContain("useState<TabKey>('credentials')");
  });
});
