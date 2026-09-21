import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const sharedUiRoot = dirname(fileURLToPath(import.meta.url));
const webRoot = join(sharedUiRoot, '..', '..');

function source(relativePath: string) {
  return readFileSync(join(webRoot, relativePath), 'utf8');
}

describe('common controls migration guardrails', () => {
  it('routes Auth and Settings short fields/actions through shared controls', () => {
    expect(source('features/auth/components/AdminLoginForm.tsx')).toContain("shared/ui/InputField");
    expect(source('features/auth/components/AdminBootstrapForm.tsx')).toContain("shared/ui/Button");
    expect(source('features/settings/components/SettingsPage.tsx')).toContain("shared/ui/InputField");
    expect(source('features/settings/components/OpenAISettingsPanel.tsx')).toContain("shared/ui/Button");
    expect(source('features/settings/components/AutoReplyAgentPanel.tsx')).toContain("shared/ui/TextAreaField");
  });

  it('keeps the MessagesPage online composer as a page-specific textarea', () => {
    const messagesPage = source('features/messages/components/MessagesPage.tsx');
    expect(messagesPage).toContain('messages-composer-input');
    expect(messagesPage).not.toContain('TextAreaField');
  });

  it('uses PlaceholderCell only for explicit ProductTable empty values', () => {
    const productTable = source('features/products/components/ProductTable.tsx');
    expect(productTable).toContain("shared/ui/PlaceholderCell");
    expect(productTable).toContain('未关联卡券');
    expect(productTable).toContain('<PlaceholderCell');
  });
});
