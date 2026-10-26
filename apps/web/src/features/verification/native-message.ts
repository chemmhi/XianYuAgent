export interface NativeCandidate { value: string; expire: number; host: string }

/** SDK completion placeholders are not credentials or proof of success. */
export function nativeCandidateMessage(data: unknown, origin: string, expectedOrigin: string, sameSource: boolean): NativeCandidate | undefined {
  if (!sameSource || origin !== expectedOrigin || typeof data !== 'string' || data.length > 20_000) return;
  try {
    const outer = JSON.parse(data);
    if (!outer || outer.type !== 'child' || typeof outer.content !== 'string' || outer.content.length > 16_384) return;
    const content = JSON.parse(outer.content);
    if (!content || typeof content.x5sec !== 'string' || content.x5sec.length > 12_288) return;
    const cookie = JSON.parse(content.x5sec);
    const expire = typeof cookie.expire === 'number' ? cookie.expire
      : typeof cookie.expire === 'string' && /^\d{10,17}$/.test(cookie.expire) ? Number(cookie.expire) : NaN;
    if (cookie.host !== new URL(expectedOrigin).host || !Number.isSafeInteger(expire) || typeof cookie.value !== 'string'
      || !/^[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]{1,8192}$/.test(cookie.value)) return;
    return { value: cookie.value, expire, host: cookie.host };
  } catch { return; }
}
