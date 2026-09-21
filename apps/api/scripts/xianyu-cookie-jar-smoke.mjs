import assert from 'node:assert/strict';
import {
  applySetCookies,
  cookieHeaderForSigning,
  cookieHeaderForUrl,
  cookieSnapshotFromMetadata,
  metadataWithCookieSnapshot,
} from '../dist/xianyu-cookie-jar.js';

const snapshot = [
  { name: 'root', value: '1', domain: '.goofish.com', path: '/', secure: true },
  { name: 'path', value: 'seller', domain: '.goofish.com', path: '/seller', secure: true },
  { name: 'path', value: 'root', domain: '.goofish.com', path: '/', secure: true },
  { name: 'secure', value: '1', domain: '.goofish.com', path: '/', secure: true },
  { name: 'httpOnly', value: '1', domain: '.goofish.com', path: '/', secure: true, httpOnly: true },
];

assert.equal(cookieHeaderForUrl(snapshot, 'https://seller.goofish.com/seller/orders'), 'path=seller; root=1; path=root; secure=1; httpOnly=1');
assert.equal(cookieHeaderForSigning(snapshot, 'https://seller.goofish.com/seller/orders'), 'path=seller; root=1; path=root; secure=1');

const updated = applySetCookies(snapshot, 'https://h5api.m.goofish.com/h5/orders', [
  'root=2; Domain=.goofish.com; Path=/; Secure',
  'gone=; Domain=.goofish.com; Path=/; Max-Age=0',
]);
assert.match(cookieHeaderForUrl(updated, 'https://h5api.m.goofish.com/h5/orders'), /root=2/);
assert.doesNotMatch(cookieHeaderForUrl(updated, 'https://h5api.m.goofish.com/h5/orders'), /partitioned=1/);
assert.equal(updated.find((cookie) => cookie.name === 'root')?.value, '2');
assert.doesNotMatch(cookieHeaderForUrl(updated, 'https://h5api.m.goofish.com/h5/orders'), /Domain=|Path=|Secure=/);

const partitioned = applySetCookies(snapshot, 'https://h5api.m.goofish.com/h5/orders', [
  'partitioned=1; Domain=.goofish.com; Path=/; Secure; SameSite=None; Partitioned',
], Date.now(), 'https://goofish.com');
assert.match(cookieHeaderForUrl(partitioned, 'https://h5api.m.goofish.com/h5/orders', Date.now(), 'https://goofish.com'), /partitioned=1/);

const metadata = metadataWithCookieSnapshot({ unb: 'seller-1', loginMethod: 'qr_http' }, updated);
assert.equal(cookieSnapshotFromMetadata(metadata)?.[0]?.name, 'root');
assert.equal(metadata.unb, 'seller-1');
console.log('xianyu cookie jar smoke passed');
