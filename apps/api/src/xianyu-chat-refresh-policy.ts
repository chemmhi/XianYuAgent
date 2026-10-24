const MINUTE = 60_000;
const SHANGHAI_OFFSET = 8 * 60 * MINUTE;

/** A boundary wakeup only recalculates the plan; it does not refresh the page. */
export function planXianyuChatRefresh(now = Date.now(), random = Math.random): {
  delayMs: number; refresh: boolean; period: 'day' | 'evening' | 'night';
} {
  if (!Number.isFinite(now) || !Number.isFinite(new Date(now).getTime())) throw new RangeError('Invalid refresh time');
  const sample = random();
  if (!Number.isFinite(sample) || sample < 0 || sample >= 1) throw new RangeError('Invalid random sample');
  const local = new Date(now + SHANGHAI_OFFSET);
  const hour = local.getUTCHours();
  const period = hour >= 9 && hour < 21 ? 'day' : hour < 7 ? 'night' : 'evening';
  const [min, max] = period === 'day' ? [25, 45] : period === 'night' ? [90, 180] : [45, 90];
  const nextHour = hour < 7 ? 7 : hour < 9 ? 9 : hour < 21 ? 21 : 24;
  const boundary = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), nextHour) - SHANGHAI_OFFSET;
  const interval = Math.round((min + sample * (max - min)) * MINUTE);
  return { delayMs: Math.min(interval, boundary - now), refresh: now + interval < boundary, period };
}
