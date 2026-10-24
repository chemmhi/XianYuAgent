import fs from 'node:fs';
import { join } from 'node:path';
import { applySetCookies } from '../../apps/api/src/xianyu-cookie-jar.ts';
const root = process.env.XIANYU_COPY_INPUT_DIR;
const folder = process.argv[2];
if (!/^[a-z0-9-]+$/.test(folder)) throw Error('Expected local preflight directory label');
let snapshot = JSON.parse(fs.readFileSync(join(root, 'original-cookie-scope-snapshot.json'), 'utf8'))
  .filter(c => !['x5sec', 'x5secdata', 'x5sectag', 'x5step'].includes(c.name));
const events = fs.readdirSync(join(root, folder)).filter(n => /^events-.*\.ndjson$/.test(n))
  .flatMap(n => fs.readFileSync(join(root, folder, n), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse))
  .sort((a, b) => a.utc.localeCompare(b.utc));
const urls = new Map(), applied = [];
for (const event of events) {
  if (event.type === 'fetch.request') urls.set(event.data.id, event.data.url);
  if (event.type !== 'fetch.response') continue;
  const url = urls.get(event.data.id);
  if (!url) throw Error('Missing originating request URL');
  snapshot = applySetCookies(snapshot, url, event.data.setCookie ?? [], Date.parse(event.utc), 'https://goofish.com');
  applied.push({ url, utc: event.utc, setCookie: event.data.setCookie });
}
const inputPath = join(root, 'latest-challenge-input.json');
const input = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const raw = input.credential.cookieHeader.split(';').flatMap(p => {
  const i = p.indexOf('='); return i < 1 ? [] : [[p.slice(0, i).trim(), p.slice(i + 1).trim()]];
});
const missing = raw.filter(([name, value]) => !snapshot.some(c => c.name === name && c.value === value)).map(([name]) => name);
if (missing.length) throw Error(`Scope/value reconstruction incomplete: ${missing.join(',')}`);
snapshot = snapshot.map(c => ({ ...c,
  // These Partitioned cookies came from first-party Goofish MTOP requests.
  // Patchright defaults its Chromium-only bit to true when omitted, hiding
  // the token on same-site Goofish navigation even though context.cookies lists it.
  ...(c.partitionKey === 'https://goofish.com' ? { _crHasCrossSiteAncestor: false } : {}),
  ...(c.sameSite ? { sameSite: ({ none: 'None', lax: 'Lax', strict: 'Strict' })[c.sameSite.toLowerCase()] } : {}) }));
input.cookieSnapshot = snapshot;
input.scopeSource = 'Original pre-manual snapshot plus the exact recorded Set-Cookie sequence, preserving partitionKey';
fs.writeFileSync(join(root, `${folder}-flat-input.json`), fs.readFileSync(inputPath));
fs.writeFileSync(inputPath, JSON.stringify(input, null, 2));
fs.writeFileSync(join(root, `${folder}-scope-restoration.json`), JSON.stringify({ applied, missing, snapshot }, null, 2));
console.log(JSON.stringify({ restored: snapshot.length, missing }));
