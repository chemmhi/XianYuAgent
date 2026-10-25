import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { inviteAccessStatus, InviteTable } from './InviteTable';
import type { InviteVM } from '../api';

const invite: InviteVM = { id: 'one', code: 'Abc12345', codePrefix: 'Abc12345', status: 'active', createdAt: '2026-10-25T00:00:00Z', expiresAt: '2026-11-01T00:00:00Z' };
function render(item: InviteVM, pending = false) {
  return renderToStaticMarkup(createElement(InviteTable, { items: [item], newIds: new Set(['one']), pending: pending ? { id: 'one', action: 'disable' } : null, onCopy: vi.fn(), onStatus: vi.fn(), onRenew: vi.fn(), onDelete: vi.fn() }));
}

describe('InviteTable actions', () => {
  it('offers copying and the correct status action including controls for activated user access', () => {
    const active = render(invite);
    expect(active).toContain('aria-label="复制邀请码 Abc12345"');
    expect(active).toContain('>禁用</button>');
    expect(render({ ...invite, status: 'disabled' })).toContain('>启用</button>');
    const used = render({ ...invite, status: 'used', usedAt: '2026-10-25T01:00:00Z' });
    expect(used).toContain('>禁用</button>');
    expect(used).toContain('>续期</button>');
    expect(used).toContain('>删除</button>');
  });
  it('locks mutation controls while pending and communicates the active operation', () => {
    const html = render(invite, true);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('处理中…');
    expect(html.match(/disabled=""/g)).toHaveLength(3);
  });
  it('keeps activated username and email in separate columns', () => {
    const html = render({ ...invite, status: 'used', usedAt: '2026-10-25T01:00:00Z', usedByDisplayName: '测试用户', usedByEmail: 'person@example.com' });
    expect(html).toContain('<th>用户名</th><th>邮箱</th>');
    expect(html).toContain('class="invite-user-cell" title="测试用户">测试用户</td>');
    expect(html).toContain('class="invite-email-cell" title="person@example.com">person@example.com</td>');
    expect(html.match(/<th>/g)).toHaveLength(6);
  });

  it('keeps activation identity while access is disabled or expired', () => {
    const used: InviteVM = { ...invite, status: 'used', usedAt: '2026-10-25T00:00:00Z', usedByDisplayName: '用户', usedByEmail: 'user@example.com', accessStatus: 'disabled' };
    const html = render(used);
    expect(html).toContain('>已禁用</span>');
    expect(html).toContain('>启用</button>');
    expect(html).toContain('>续期</button>');
    expect(html).toContain('user@example.com');
    expect(render({ ...used, accessStatus: 'expired' })).toContain('>已过期</span>');
    expect(render({ ...used, accessStatus: 'active' })).toContain('>已激活</span>');
  });
  it('computes a compatible fallback and does not offer restoring deleted records', () => {
    expect(inviteAccessStatus({ ...invite, disabledAt: '2026-10-25T00:00:00Z' })).toBe('disabled');
    expect(inviteAccessStatus({ ...invite, expiresAt: '2000-01-01T00:00:00Z', usedAt: '1999-01-01T00:00:00Z' })).toBe('expired');
    expect(inviteAccessStatus({ ...invite, expiresAt: 'invalid-date' })).toBe('expired');
    const deleted = render({ ...invite, status: 'deleted' });
    expect(deleted).not.toMatch(/>禁用<|>启用<|>续期</);
  });

});
