import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../../shared/ui/ToastProvider';
import { InviteDeleteModal } from './InviteDeleteModal';
import type { InviteVM } from '../api';

const invite: InviteVM = { id: 'one', code: 'Abc12345', codePrefix: 'Abc12345', status: 'active', createdAt: '2026-10-25T00:00:00Z', expiresAt: '2026-11-01T00:00:00Z' };
const render = (item: InviteVM) => renderToStaticMarkup(createElement(ToastProvider, { children: createElement(InviteDeleteModal, { invite: item, onClose: vi.fn(), onDelete: vi.fn() }) }));

describe('InviteDeleteModal', () => {
  it('shows an accessible project dialog with a normal confirmation for unused codes', () => {
    const html = render(invite);
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('确认删除');
    expect(html).not.toContain('继续删除');
  });
  it('warns about user data and requires another step for activated codes', () => {
    const html = render({ ...invite, status: 'used', usedByEmail: 'user@example.com' });
    expect(html).toContain('user@example.com');
    expect(html).toContain('该用户的闲鱼账号、商品、卡券、Workspace 会话和个人配置将被清除');
    expect(html).toContain('继续删除');
    expect(html).not.toContain('type="submit" disabled=""');
  });
});
