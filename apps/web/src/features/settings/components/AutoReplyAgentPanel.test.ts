import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(fileURLToPath(new URL('./AutoReplyAgentPanel.tsx', import.meta.url)), 'utf8');
const css = readFileSync(fileURLToPath(new URL('./settings.css', import.meta.url)), 'utf8');

describe('Auto Reply Agent settings surface', () => {
  it('exposes only the enable toggle and total timeout budget', () => {
    expect(source).toContain('总超时（毫秒）');
    expect(source).toContain('InfoTooltip');
    expect(source).not.toContain('系统提示词');
    expect(source).not.toContain('最大循环次数');
    expect(source).not.toContain('工具调用上限');
    expect(source).not.toContain('工具超时（毫秒）');
    expect(source).not.toContain('分段发送间隔（毫秒）');
    expect(source).not.toContain('自动回复接管等待时间（秒）');
    expect(source).not.toContain('发送模式');
  });

  it('uses an accessible hover and keyboard-focus tooltip', () => {
    expect(source).toContain('role="tooltip"');
    expect(source).toContain('aria-describedby');
    expect(css).toContain('.settings-info-tooltip:hover>span:last-child');
    expect(css).toContain('.settings-info-tooltip:focus-visible>span:last-child');
  });
});
