export type ExternalRefreshMode = 'local' | 'background' | 'await';

export function conversationRefreshMode(query: { cursor?: string; refreshExternal?: boolean }): ExternalRefreshMode {
  if (query.cursor !== undefined || query.refreshExternal === false) return 'local';
  if (query.refreshExternal === true) return 'await';
  return 'background';
}

export function messageRefreshMode(query: { cursor?: number; beforeCursor?: string; refreshExternal?: boolean }): ExternalRefreshMode {
  if (query.refreshExternal === false || query.cursor !== undefined) return 'local';
  if (query.beforeCursor !== undefined || query.refreshExternal === true) return 'await';
  return 'background';
}
