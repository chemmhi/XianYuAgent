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
