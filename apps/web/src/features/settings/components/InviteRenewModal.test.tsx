import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { InviteRenewModal } from './InviteRenewModal';
import { ToastProvider } from '../../../shared/ui/ToastProvider';

describe('InviteRenewModal', () => {
  it('identifies the invite and presents renewal in an accessible form using shared controls', () => {
    const html = renderToStaticMarkup(createElement(ToastProvider, { children: createElement(InviteRenewModal, {
      invite: { id: 'invite-one', code: 'Abc12345', codePrefix: 'Abc12345', status: 'active', createdAt: '2026-10-25T00:00:00Z', expiresAt: '2026-10-28T00:00:00Z' },
      onClose: vi.fn(), onRenew: vi.fn(),
    }) }));
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="invite-renew-title"');
    expect(html).toContain('card modal-card settings-editor invite-renew-modal');
    expect(html).toContain('Abc12345');
    expect(html).toContain('当前到期日期');
    expect(html).toContain('从今天起的有效天数');
    expect(html).toContain('ui-input-control');
    expect(html).toContain('min="1"');
    expect(html).toContain('max="365"');
    expect(html).toContain('确认续期');
    expect(html).toContain('取消');
  });
});
