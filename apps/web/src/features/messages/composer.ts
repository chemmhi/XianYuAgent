export const MESSAGES_COMPOSER_PLACEHOLDER = '输入回复，Enter 发送，Shift + Enter 换行，Ctrl + V 粘贴图片。';

export function canSubmitComposer(draft: string, hasAttachment: boolean): boolean {
  return Boolean(draft.trim() || hasAttachment);
}

export function insertXianyuEmojiMarker(draft: string, start: number, end: number, name: string): { value: string; cursor: number } {
  const marker = `[${name}]`;
  return {
    value: `${draft.slice(0, start)}${marker}${draft.slice(end)}`,
    cursor: start + marker.length,
  };
}

export function removeXianyuEmojiMarkerAtCursor(
  draft: string,
  start: number,
  end: number,
  key: 'Backspace' | 'Delete',
): { value: string; cursor: number; handled: boolean } {
  if (start !== end) {
    const selected = draft.slice(start, end);
    if (/^\[[^\[\]]+\]$/.test(selected)) {
      return { value: `${draft.slice(0, start)}${draft.slice(end)}`, cursor: start, handled: true };
    }
    return { value: draft, cursor: start, handled: false };
  }

  if (key === 'Backspace') {
    const match = draft.slice(0, start).match(/\[[^\[\]]+\]$/);
    if (!match) return { value: draft, cursor: start, handled: false };
    const markerStart = start - match[0].length;
    return { value: `${draft.slice(0, markerStart)}${draft.slice(start)}`, cursor: markerStart, handled: true };
  }

  const match = draft.slice(start).match(/^\[[^\[\]]+\]/);
  if (!match) return { value: draft, cursor: start, handled: false };
  return { value: `${draft.slice(0, start)}${draft.slice(start + match[0].length)}`, cursor: start, handled: true };
}
