import { describe, expect, it } from 'vitest';
import { canSubmitComposer, insertXianyuEmojiMarker, MESSAGES_COMPOSER_PLACEHOLDER, removeXianyuEmojiMarkerAtCursor } from './composer';

describe('message composer model', () => {
  it('keeps the requested placeholder and enables submit for text or attachments', () => {
    expect(MESSAGES_COMPOSER_PLACEHOLDER).toBe('输入回复，Enter 发送，Shift + Enter 换行，Ctrl + V 粘贴图片。');
    expect(canSubmitComposer('', false)).toBe(false);
    expect(canSubmitComposer('   ', false)).toBe(false);
    expect(canSubmitComposer('', true)).toBe(true);
    expect(canSubmitComposer('你好', false)).toBe(true);
  });

  it('inserts an Xianyu marker at the active selection', () => {
    expect(insertXianyuEmojiMarker('你好世界', 2, 4, '尊嘟假嘟')).toEqual({ value: '你好[尊嘟假嘟]', cursor: 8 });
  });

  it('deletes an inserted emoji marker as one token', () => {
    expect(removeXianyuEmojiMarkerAtCursor('你好[拒绝]世界', 6, 6, 'Backspace')).toEqual({ value: '你好世界', cursor: 2, handled: true });
    expect(removeXianyuEmojiMarkerAtCursor('你好[拒绝]世界', 2, 2, 'Delete')).toEqual({ value: '你好世界', cursor: 2, handled: true });
    expect(removeXianyuEmojiMarkerAtCursor('你好[拒绝]世界', 2, 6, 'Backspace')).toEqual({ value: '你好世界', cursor: 2, handled: true });
  });
});
