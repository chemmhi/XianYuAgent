import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SessionRow } from './WorkspacePage';
import type { WorkspaceSessionVM } from '../types';

const workspaceCss = readFileSync(fileURLToPath(new URL('./workspace.css', import.meta.url)), 'utf8');

const session: WorkspaceSessionVM = {
  id: 'session-1',
  accountId: 'account-1',
  title: '检查当前 Workspace 状态',
  status: 'active',
  summary: '返回摘要',
  lastActiveAt: '2026-09-21T23:18:00.000Z',
  updatedAt: '2026-09-21T23:18:00.000Z',
};

describe('Workspace SessionRow', () => {
  it('renders a semantic icon archive action with an auditable target', () => {
    const html = renderToStaticMarkup(createElement(SessionRow, {
      session,
      active: true,
      busy: false,
      onSwitch: vi.fn(),
      onArchive: vi.fn(),
    }));

    expect(html).toContain('data-testid="workspace-session-archive"');
    expect(html).toContain('aria-label="归档 检查当前 Workspace 状态"');
    expect(html).toContain('class="workspace-session-action-icon"');
    expect(html).not.toContain('>•••</button>');
    expect(workspaceCss).toContain('.workspace-session-action:focus-visible');
  });
});
