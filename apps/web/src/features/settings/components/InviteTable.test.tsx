import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { InviteTable } from './InviteTable';
import type { InviteVM } from '../api';

const invite: InviteVM = { id: 'one', code: 'Abc12345', codePrefix: 'Abc12345', status: 'active', createdAt: '2026-10-25T00:00:00Z', expiresAt: '2026-11-01T00:00:00Z' };
function render(item: InviteVM, pending = false) {
  return renderToStaticMarkup(createElement(InviteTable, { items: [item], newIds: new Set(['one']), pending: pending ? { id: 'one', action: 'disable' } : null, onCopy: vi.fn(), onStatus: vi.fn(), onRenew: vi.fn(), onDelete: vi.fn() }));
}

describe('InviteTable actions', () => {
  it('offers copying and the correct status action while a used invite only permits deletion', () => {
    const active = render(invite);
    expect(active).toContain('aria-label="复制邀请码 Abc12345"');
    expect(active).toContain('>禁用</button>');
    expect(render({ ...invite, status: 'disabled' })).toContain('>启用</button>');
    const used = render({ ...invite, status: 'used', usedAt: '2026-10-25T01:00:00Z' });
    expect(used).not.toMatch(/>禁用<|>启用<|>续期</);
    expect(used).toContain('>删除</button>');
  });
  it('locks mutation controls while pending and communicates the active operation', () => {
    const html = render(invite, true);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('处理中…');
    expect(html.match(/disabled=""/g)).toHaveLength(3);
  });
});
