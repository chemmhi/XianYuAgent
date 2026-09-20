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
    const range = expandRangeAcrossEmojiMarkers(draft, start, end);
    if (range.start === start && range.end === end) {
      return { value: draft, cursor: start, handled: false };
    }
    return { value: `${draft.slice(0, range.start)}${draft.slice(range.end)}`, cursor: range.start, handled: true };
  }

  if (key === 'Backspace') {
    const marker = findEmojiMarkerRange(draft, start, 'backward');
    if (!marker) return { value: draft, cursor: start, handled: false };
    return { value: `${draft.slice(0, marker.start)}${draft.slice(marker.end)}`, cursor: marker.start, handled: true };
  }

  const marker = findEmojiMarkerRange(draft, start, 'forward');
  if (!marker) return { value: draft, cursor: start, handled: false };
  return { value: `${draft.slice(0, marker.start)}${draft.slice(marker.end)}`, cursor: marker.start, handled: true };
}

export function moveXianyuEmojiCursor(draft: string, cursor: number, key: 'ArrowLeft' | 'ArrowRight'): number {
  const marker = findEmojiMarkerRange(draft, cursor, key === 'ArrowLeft' ? 'backward' : 'forward');
  if (!marker) return cursor;
  return key === 'ArrowLeft' ? marker.start : marker.end;
}

type EmojiMarkerRange = { start: number; end: number };

function findEmojiMarkerRange(draft: string, cursor: number, direction: 'backward' | 'forward'): EmojiMarkerRange | undefined {
  const markerPattern = /\[[^\[\]]+\]/g;
  for (const match of draft.matchAll(markerPattern)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const containsCursor = direction === 'backward' ? cursor > start && cursor <= end : cursor >= start && cursor < end;
    if (containsCursor) return { start, end };
  }
  return undefined;
}

function expandRangeAcrossEmojiMarkers(draft: string, start: number, end: number): EmojiMarkerRange {
  let expandedStart = start;
  let expandedEnd = end;
  for (const match of draft.matchAll(/\[[^\[\]]+\]/g)) {
    const markerStart = match.index ?? 0;
    const markerEnd = markerStart + match[0].length;
    if (markerEnd > expandedStart && markerStart < expandedEnd) {
      expandedStart = Math.min(expandedStart, markerStart);
      expandedEnd = Math.max(expandedEnd, markerEnd);
    }
  }
  return { start: expandedStart, end: expandedEnd };
}
