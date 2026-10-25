/** Match owned references, not administrator IDs or arbitrary business text. */
export function purgeMemoryAccount(maps: Record<string, unknown>, accountId: string): void {
  const ids = new Set([accountId]);
  const references = new Set(['id', 'accountId', 'productId', 'batchId', 'couponBatchId', 'couponItemId', 'conversationId', 'runId', 'sessionId', 'reservationId', 'itemId', 'assetId', 'aggregateId', 'targetRef']);
  const owned = (value: unknown): boolean => {
    if (typeof value === 'string') return ids.has(value);
    if (Array.isArray(value)) return value.some(owned);
    if (!value || typeof value !== 'object') return false;
    return Object.entries(value).some(([key, field]) => references.has(key) && typeof field === 'string' && ids.has(field));
  };
  const keyOwned = (key: unknown) => typeof key === 'string' && [...ids].some(id => key === id || key.split(/[:/]/).includes(id));
  const candidates = new Map<Map<unknown, unknown>, Set<unknown>>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, map] of Object.entries(maps)) {
      if (!(map instanceof Map)) continue;
      for (const [key, value] of map) {
        const cached = name === 'idempotency' && [...ids].some(id => JSON.stringify(value).includes(id));
        if (!keyOwned(key) && !owned(value) && !cached) continue;
        const selected = candidates.get(map) ?? new Set();
        if (selected.has(key)) continue;
        selected.add(key); candidates.set(map, selected); changed = true;
        for (const row of Array.isArray(value) ? value : [value]) {
          if (row && typeof row === 'object') for (const name of ['id', 'reservationId', 'executionKey']) {
            if (typeof row[name] === 'string') ids.add(row[name]);
          }
        }
      }
    }
  }
  for (const [map, keys] of candidates) for (const key of keys) map.delete(key);
  const audits = maps.audits;
  if (Array.isArray(audits)) for (let i = audits.length - 1; i >= 0; i--) if (owned(audits[i])) audits.splice(i, 1);
}
