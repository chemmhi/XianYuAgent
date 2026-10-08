import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(fileURLToPath(new URL('./AutoReplyAgentPanel.tsx', import.meta.url)), 'utf8');
const css = readFileSync(fileURLToPath(new URL('./settings.css', import.meta.url)), 'utf8');

describe('Auto Reply Agent settings surface', () => {
  it('restores every editable Auto Reply Agent setting', () => {
    for (const label of ['系统提示词', '用户提示词模板', '最大循环次数', '工具调用上限', '工具超时（秒）', '总超时（秒）', '上下文历史条数', '最大回复长度', '分段发送间隔（秒）', '自动回复接管等待时间（秒）']) {
      expect(source).toContain(label);
    }
    expect(source).toContain('fieldset className="auto-reply-agent-fields"');
    expect(source).toContain('shared/ui/TextAreaField');
    expect(source).toContain('patch: draft');
    expect(source).toContain("shared/ui/Toast");
    expect(source).toContain('tone="success"');
    expect(source).not.toContain('settings-save-toast');
    expect(source).not.toContain('InfoTooltip');
    expect(source).not.toContain('发送模式');
    expect(source).not.toContain('配置审计');
  });

  it('does not retain the removed tooltip styles', () => {
    expect(source).not.toContain('role="tooltip"');
    expect(css).not.toContain('.settings-info-tooltip');
  });
});
