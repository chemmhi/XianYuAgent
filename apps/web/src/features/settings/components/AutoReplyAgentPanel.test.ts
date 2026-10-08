import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(fileURLToPath(new URL('./AutoReplyAgentPanel.tsx', import.meta.url)), 'utf8');
const css = readFileSync(fileURLToPath(new URL('./settings.css', import.meta.url)), 'utf8');

describe('Auto Reply Agent settings surface', () => {
  it('restores every editable Auto Reply Agent setting', () => {
    for (const label of ['系统提示词', '用户提示词模板', '最大循环次数', '工具调用上限', '工具超时（毫秒）', '总超时（毫秒）', '上下文历史条数', '最大回复长度', '分段发送间隔（毫秒）', '自动回复接管等待时间（秒）', '发送模式']) {
      expect(source).toContain(label);
    }
    expect(source).toContain('fieldset className="auto-reply-agent-fields"');
    expect(source).toContain('shared/ui/TextAreaField');
    expect(source).toContain('shared/ui/SelectField');
    expect(source).toContain('patch: draft');
    expect(source).toContain('InfoTooltip');
  });

  it('uses an accessible hover and keyboard-focus tooltip', () => {
    expect(source).toContain('role="tooltip"');
    expect(source).toContain('aria-describedby');
    expect(css).toContain('.settings-info-tooltip:hover>span:last-child');
    expect(css).toContain('.settings-info-tooltip:focus-visible>span:last-child');
  });
});
