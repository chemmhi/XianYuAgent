export const XIANYU_COOKIE_SNAPSHOT_KEY = 'cookies_refresh_snapshot';
export const XIANYU_COOKIE_SNAPSHOT_LEGACY_KEY = 'cookie_refresh_snapshot';
export const XIANYU_COOKIE_SNAPSHOT_CAMEL_KEY = 'cookieSnapshot';
export const XIANYU_TOP_SITE = 'https://goofish.com';

export interface XianyuBrowserCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: string;
  partitionKey?: string;
}

export type XianyuCookieSnapshot = XianyuBrowserCookie[];

export function normalizeCookieSnapshot(snapshot: XianyuCookieSnapshot | undefined): XianyuCookieSnapshot | undefined {
  if (snapshot === undefined) return undefined;
  return snapshot.filter((cookie) => typeof cookie?.name === 'string' && cookie.name.trim()).map((cookie) => ({
    ...cookie,
    name: cookie.name.trim(),
    value: String(cookie.value ?? ''),
    domain: cookie.domain?.trim().toLowerCase() || undefined,
    path: cookie.path?.trim() || '/',
  }));
}

export function cookieSnapshotFromMetadata(metadata: Record<string, string> | undefined): XianyuCookieSnapshot | undefined {
  const raw = metadata?.[XIANYU_COOKIE_SNAPSHOT_KEY] ?? metadata?.[XIANYU_COOKIE_SNAPSHOT_LEGACY_KEY] ?? metadata?.[XIANYU_COOKIE_SNAPSHOT_CAMEL_KEY];
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? normalizeCookieSnapshot(parsed as XianyuCookieSnapshot) ?? [] : undefined;
  } catch {
    return undefined;
  }
}

export function metadataWithCookieSnapshot(metadata: Record<string, string> | undefined, snapshot: XianyuCookieSnapshot): Record<string, string> {
  const next = { ...(metadata ?? {}) };
  delete next[XIANYU_COOKIE_SNAPSHOT_LEGACY_KEY];
  delete next[XIANYU_COOKIE_SNAPSHOT_CAMEL_KEY];
  next[XIANYU_COOKIE_SNAPSHOT_KEY] = JSON.stringify(normalizeCookieSnapshot(snapshot) ?? []);
  return next;
}

export function cookieHeaderForUrl(snapshot: XianyuCookieSnapshot | undefined, rawUrl: string, now = Date.now(), partitionKey?: string): string {
  if (!snapshot) return '';
  const target = parseUrl(rawUrl);
  const hostname = target?.hostname.toLowerCase() ?? '';
  const pathname = target?.pathname || '/';
  if (!target || !hostname) return '';
  return (normalizeCookieSnapshot(snapshot) ?? [])
    .map((cookie, index) => ({ cookie, index }))
    .filter(({ cookie }) => {
      if (cookie.expires !== undefined && cookie.expires > 0 && cookie.expires <= Math.floor(now / 1000)) return false;
      if (cookie.secure && target.protocol !== 'https:' && target.protocol !== 'wss:') return false;
      if (cookie.partitionKey && cookie.partitionKey !== partitionKey) return false;
      if (!cookieDomainMatches(hostname, cookie.domain ?? '')) return false;
      return cookiePathMatches(pathname, cookie.path ?? '/');
    })
    .sort((left, right) => {
      const leftLength = (left.cookie.path ?? '/').length;
      const rightLength = (right.cookie.path ?? '/').length;
      return rightLength === leftLength ? left.index - right.index : rightLength - leftLength;
    })
    .map(({ cookie }) => `${cookie.name}=${cookie.value}`)
    .join('; ');
}

export function cookieHeaderForSigning(snapshot: XianyuCookieSnapshot | undefined, documentUrl: string, partitionKey?: string): string {
  if (!snapshot) return '';
  return cookieHeaderForUrl((normalizeCookieSnapshot(snapshot) ?? []).filter((cookie) => !cookie.httpOnly), documentUrl, Date.now(), partitionKey);
}

export function cookieHeaderFromSnapshot(snapshot: XianyuCookieSnapshot | undefined): string {
  if (!snapshot) return '';
  const names = new Set<string>();
  const result: string[] = [];
  for (const cookie of normalizeCookieSnapshot(snapshot) ?? []) {
    if (names.has(cookie.name)) continue;
    names.add(cookie.name);
    result.push(`${cookie.name}=${cookie.value}`);
  }
  return result.join('; ');
}

export function cookieValue(snapshot: XianyuCookieSnapshot | undefined, name: string, rawUrl?: string): string {
  const header = rawUrl ? cookieHeaderForUrl(snapshot, rawUrl) : cookieHeaderFromSnapshot(snapshot);
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return '';
}

export function applySetCookies(snapshot: XianyuCookieSnapshot, requestUrl: string, setCookies: string[], now = Date.now(), partitionKey?: string): XianyuCookieSnapshot {
  const target = parseUrl(requestUrl);
  const hostname = target?.hostname.toLowerCase() ?? '';
  if (!hostname) return normalizeCookieSnapshot(snapshot) ?? [];
  const state = normalizeCookieSnapshot(snapshot) ?? [];
  for (const raw of setCookies) {
    // `set-cookie` values are already separated into individual headers by
    // setCookieValues/getSetCookie. Split each header into its cookie pair and
    // semicolon-delimited attributes; treating the whole header as the value
    // silently leaves stale cookies in the snapshot.
    const parts = raw.split(/;\s*/).map((part) => part.trim()).filter(Boolean);
    const first = parts.shift() ?? '';
    const separator = first.indexOf('=');
    if (separator <= 0) continue;
    const name = first.slice(0, separator).trim();
    const value = first.slice(separator + 1).trim();
    const attrs = new Map<string, string>();
    for (const part of parts) {
      const index = part.indexOf('=');
      const key = (index >= 0 ? part.slice(0, index) : part).trim().toLowerCase();
      if (!key) continue;
      attrs.set(key, index >= 0 ? part.slice(index + 1).trim() : '');
    }
    const domainAttribute = attrs.get('domain')?.toLowerCase();
    let domain = domainAttribute || hostname;
    if (domainAttribute && !domain.startsWith('.')) domain = `.${domain}`;
    const path = attrs.get('path') || defaultCookiePath(target?.pathname || '/');
    const expiresAt = parseCookieExpiry(attrs.get('max-age'), attrs.get('expires'), now);
    const identity = (cookie: XianyuBrowserCookie) => `${cookie.name}\u0000${(cookie.domain ?? '').toLowerCase()}\u0000${cookie.path ?? '/'}\u0000${cookie.partitionKey ?? ''}`;
    const isPartitioned = parts.some((part) => part.trim().toLowerCase() === 'partitioned');
    if (isPartitioned && !partitionKey) continue;
    const next: XianyuBrowserCookie = {
      name,
      value,
      domain,
      path,
      ...(expiresAt === undefined ? {} : { expires: expiresAt }),
      httpOnly: parts.some((part) => part.trim().toLowerCase() === 'httponly'),
      secure: parts.some((part) => part.trim().toLowerCase() === 'secure'),
      sameSite: parts.find((part) => /^samesite=/i.test(part))?.split('=').slice(1).join('='),
      ...(isPartitioned ? { partitionKey } : {}),
    };
    const key = identity(next);
    const existingIndex = state.findIndex((cookie) => identity(cookie) === key);
    const shouldDelete = expiresAt === 0;
    if (shouldDelete) {
      if (existingIndex >= 0) state.splice(existingIndex, 1);
    } else if (existingIndex >= 0) {
      state[existingIndex] = next;
    } else {
      state.push(next);
    }
  }
  return normalizeCookieSnapshot(state) ?? [];
}

export function setCookieValues(headers: Headers): string[] {
  const withGetSetCookie = headers as Headers & { getSetCookie?: () => string[] };
  const values = withGetSetCookie.getSetCookie?.();
  if (values && values.length > 0) return values;
  const fallback = headers.get('set-cookie');
  return fallback ? splitSetCookie(fallback) : [];
}

function splitSetCookie(value: string): string[] {
  return value.split(/,(?=\s*[^;,=\s]+\s*=)/g).map((part) => part.trim()).filter(Boolean);
}

function parseUrl(rawUrl: string): URL | undefined {
  try { return new URL(rawUrl); } catch { return undefined; }
}

function parseCookieExpiry(maxAge: string | undefined, expires: string | undefined, now: number): number | undefined {
  if (maxAge !== undefined) {
    const seconds = Number(maxAge);
    if (Number.isFinite(seconds)) return seconds <= 0 ? 0 : Math.floor(now / 1000) + Math.trunc(seconds);
  }
  if (expires) {
    const timestamp = Date.parse(expires);
    if (Number.isFinite(timestamp)) return Math.floor(timestamp / 1000);
  }
  return undefined;
}

function cookieDomainMatches(hostname: string, domain: string): boolean {
  const normalized = domain.toLowerCase();
  if (!normalized) return false;
  if (!normalized.startsWith('.')) return hostname === normalized;
  const base = normalized.startsWith('.') ? normalized.slice(1) : normalized;
  return hostname === base || hostname.endsWith(`.${base}`);
}

function cookiePathMatches(requestPath: string, cookiePath: string): boolean {
  if (requestPath === cookiePath) return true;
  if (!requestPath.startsWith(cookiePath)) return false;
  return cookiePath.endsWith('/') || requestPath[cookiePath.length] === '/';
}

function defaultCookiePath(requestPath: string): string {
  if (!requestPath || requestPath === '/' || !requestPath.startsWith('/')) return '/';
  const index = requestPath.lastIndexOf('/');
  return index <= 0 ? '/' : requestPath.slice(0, index);
}
