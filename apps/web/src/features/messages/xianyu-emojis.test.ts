import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { renderXianyuTextWithCaret } from './xianyu-emojis';

describe('xianyu emoji composer rendering', () => {
  it('places the visual caret after the emoji image instead of marker text width', () => {
    const html = renderToStaticMarkup(renderXianyuTextWithCaret('你好[拒绝]世界', 6));
    expect(html.indexOf('class="messages-emoji-inline"')).toBeGreaterThanOrEqual(0);
    expect(html.indexOf('class="messages-composer-caret"')).toBeGreaterThan(html.indexOf('class="messages-emoji-inline"'));
    expect(html).not.toContain('[拒绝]');
  });
});
