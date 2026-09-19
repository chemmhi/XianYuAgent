export interface ConversationCursor {
  updatedAt: string;
  id: string;
}

/** Opaque cursor for the stable conversation ordering: updatedAt DESC, id DESC. */
export function encodeConversationCursor(cursor: ConversationCursor): string {
  return `${cursor.updatedAt}|${cursor.id}`;
}

export function decodeConversationCursor(value: string): ConversationCursor | undefined {
  const separator = value.lastIndexOf('|');
  if (separator <= 0 || separator === value.length - 1) return undefined;
  const updatedAt = value.slice(0, separator);
  const id = value.slice(separator + 1);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(updatedAt) || !id) return undefined;
  return { updatedAt, id };
}

export function isAfterConversationCursor(updatedAt: string, id: string, cursor: ConversationCursor): boolean {
  return updatedAt < cursor.updatedAt || (updatedAt === cursor.updatedAt && id < cursor.id);
}
