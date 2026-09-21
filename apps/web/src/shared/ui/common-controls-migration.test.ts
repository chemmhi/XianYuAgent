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

  it('keeps page CSS from overriding shared control tokens', () => {
    const forbiddenSelectors: Array<[string, RegExp[]]> = [
      ['features/auth/auth.css', [/\.auth-form\s+label\s*\{/, /\.auth-form\s+input\b/]],
      ['features/accounts/components/accounts.css', [/\.account-login-form\s+label\b/, /\.account-login-form\s+input\b/, /\.account-login-form\s+textarea\b/]],
      ['features/products/components/products.css', [/\.product-basic-form\s+label\b/, /\.product-basic-form\s+input\b/, /\.product-basic-form\s+textarea\b/]],
      ['features/coupons/components/coupons.css', [/\.coupons-drawer-section\s+textarea\b/, /\.coupons-inline-form\s+input\b/, /\.coupons-form-grid\s+(?:label|input|textarea)\b/]],
      ['features/workspace/components/workspace.css', [/\.workspace-search\s+input\b/]],
      ['features/messages/components/messages.css', [/\.messages-search\s+input\b/]],
      ['features/agent-dynamics/components/agent-dynamics.css', [/\.agent-dynamics-app\s+(?:button,\s*)?input\b/, /\.agent-dynamics-app\s+input:focus-visible\b/]],
      ['features/settings/components/settings.css', [
        /\.settings-form-grid\s+(?:label|input|textarea)\b/,
        /\.openai-form-rows\s+label\b/,
        /\.openai-form-rows\s+input\b/,
      ]],
    ];

    for (const [relativePath, selectors] of forbiddenSelectors) {
      const css = source(relativePath);
      for (const selector of selectors) expect(css).not.toMatch(selector);
    }
  });

  it('keeps the two approved page-specific textarea exceptions explicit', () => {
    expect(source('features/messages/components/messages.css')).toContain('.messages-composer textarea');
    expect(source('features/workspace/components/workspace.css')).toContain('.workspace-composer textarea');
  });
});
