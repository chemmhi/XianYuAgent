import { describe, expect, it } from 'vitest';
import { SettingsPage } from '../features/settings/components/SettingsPage';
import { renderAuthenticatedPage } from './App';

const pageApis = {} as Parameters<typeof renderAuthenticatedPage>[0];

describe('authenticated page routing', () => {
  it('keeps the settings route wired to SettingsPage', () => {
    const element = renderAuthenticatedPage({ ...pageApis, page: 'settings' });

    expect(element.type).toBe(SettingsPage);
  });
});
