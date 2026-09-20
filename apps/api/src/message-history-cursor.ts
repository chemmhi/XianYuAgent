export interface MessageHistoryCursor {
  externalCursor?: number;
  beforeCreatedAt?: string;
  beforeMessageId?: string;
}

export function encodeMessageHistoryCursor(value: MessageHistoryCursor): string {
  const json = JSON.stringify(value);
  return Buffer.from(json, 'utf8').toString('base64url');
}

export function decodeMessageHistoryCursor(value: string | undefined): MessageHistoryCursor | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid history cursor');
    const record = parsed as Record<string, unknown>;
    const externalCursor = record.externalCursor === undefined ? undefined : Number(record.externalCursor);
    const beforeCreatedAt = record.beforeCreatedAt === undefined ? undefined : String(record.beforeCreatedAt);
    const beforeMessageId = record.beforeMessageId === undefined ? undefined : String(record.beforeMessageId);
    if (externalCursor !== undefined && (!Number.isSafeInteger(externalCursor) || externalCursor < 0)) throw new Error('invalid external cursor');
    if (beforeCreatedAt !== undefined && Number.isNaN(Date.parse(beforeCreatedAt))) throw new Error('invalid history timestamp');
    if (beforeMessageId !== undefined && !beforeMessageId.trim()) throw new Error('invalid history message id');
    if (externalCursor === undefined && beforeCreatedAt === undefined && beforeMessageId === undefined) throw new Error('empty history cursor');
    return { externalCursor, beforeCreatedAt, beforeMessageId };
  } catch {
    return undefined;
  }
}
