const NATIVE_MTOP_PUNISH = /^\/{1,2}h5\/mtop\.[a-z0-9.]+\/[0-9]+(?:\.[0-9]+)*\/_____tmd_____\/punish\/?$/;
export function isNativeXianyuMtopChallenge(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.port && !url.username && !url.password
      && ['www.goofish.com', 'h5api.m.goofish.com', 'punish.goofish.com', 'captcha.goofish.com'].includes(url.hostname)
      && NATIVE_MTOP_PUNISH.test(url.pathname);
  } catch { return false; }
}

/** Match the native SDK's compact challenge presentation. The raw signed
 * query is preserved byte for byte: URLSearchParams serialization would
 * rewrite spaces/escaping and can invalidate the server-issued challenge. */
export function nativeXianyuChallengePresentationUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { return value; }
  if (!isNativeXianyuMtopChallenge(value) || url.searchParams.has('pureCaptcha')) return value;
  const fragment = value.indexOf('#'), base = fragment < 0 ? value : value.slice(0, fragment), hash = fragment < 0 ? '' : value.slice(fragment);
  return `${base}${base.includes('?') ? /[?&]$/.test(base) ? '' : '&' : '?'}pureCaptcha=${hash}`;
}
