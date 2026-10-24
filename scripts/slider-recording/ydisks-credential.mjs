const stale = new Set(['x5secdata', 'x5sectag', 'x5step']);
const goofish = cookie => /(^|\.)goofish\.com$/i.test((cookie.domain ?? '').replace(/^\./, ''));

// The upstream outer handler merges x5 credentials into the existing account
// header. Flattening a redirected browser's entire jar mixes Taobao namesakes.
export function mergeYdisksPass(input, browserCookies) {
  const header = new Map(input.credential.cookieHeader.split(';').flatMap(part => {
    const i = part.indexOf('='); return i < 1 ? [] : [[part.slice(0, i).trim(), part.slice(i + 1).trim()]];
  }));
  if (header.get('unb') !== '1903703477') throw Error('Account identity mismatch');
  const pass = browserCookies.filter(c => goofish(c) && c.name === 'x5sec' && c.value && c.value !== header.get('x5sec'));
  if (!pass.length) throw Error('No fresh Goofish pass cookie');
  for (const name of [...header.keys()]) if (stale.has(name.toLowerCase())) header.delete(name);
  for (const cookie of pass) header.set(cookie.name, cookie.value);
  const snapshot = (input.cookieSnapshot ?? []).filter(c => !stale.has(c.name.toLowerCase()) &&
    c.name !== 'x5sec' && header.get(c.name) === c.value);
  snapshot.push(...pass);
  const missing = [...header].filter(([name, value]) => !snapshot.some(c => c.name === name && c.value === value)).map(([name]) => name);
  if (missing.length) throw Error(`Original cookie scope is incomplete: ${missing.join(',')}`);
  const metadata = { ...input.credential.metadata, cookies_refresh_snapshot: JSON.stringify(snapshot) };
  delete metadata.cookie_refresh_snapshot;
  delete metadata.cookieSnapshot;
  return { ...input, cookieSnapshot: snapshot,
    credential: { ...input.credential, cookieHeader: [...header].map(([name, value]) => `${name}=${value}`).join('; '), metadata },
    source: 'Original Goofish account credential plus fresh Goofish x5sec from a recorded code=0 challenge; no Taobao namesakes' };
}
