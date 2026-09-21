import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AgentDynamicsDropdown } from './AgentDynamicsDropdown';

describe('AgentDynamicsDropdown', () => {
  it('delegates to the shared SelectField instead of rendering a button menu', () => {
    const html = renderToStaticMarkup(createElement(AgentDynamicsDropdown, {
      value: '24h',
      options: [{ value: '24h', label: '最近 24 小时' }, { value: '7d', label: '最近 7 天' }],
      ariaLabel: '时间范围',
      triggerClassName: 'agent-dynamics-head-range',
      onChange: () => undefined,
    }));

    expect(html.match(/<select /g)).toHaveLength(1);
    expect(html).toContain('aria-label="时间范围"');
    expect(html).toContain('class="ui-select-control agent-dynamics-head-range"');
    expect(html).toContain('class="ui-select-chevron"');
    expect(html).not.toContain('<button');
    expect(html).not.toContain('role="listbox"');
  });
});
