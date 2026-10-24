import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeYdisksPass } from './ydisks-credential.mjs';
const input = { credential: { cookieHeader: 'unb=1903703477; cookie2=original; _m_h5_tk=tk; x5secdata=challenge', metadata: {} },
  cookieSnapshot: [{ name: 'unb', value: '1903703477', domain: '.goofish.com' },
    { name: 'cookie2', value: 'original', domain: '.goofish.com', httpOnly: true, secure: true, sameSite: 'None' },
    { name: '_m_h5_tk', value: 'tk', domain: '.goofish.com', partitionKey: 'https://goofish.com' },
    { name: 'x5secdata', value: 'challenge', domain: '.goofish.com' }] };
const pass = { name: 'x5sec', value: 'fresh-pass', domain: 'h5api.m.goofish.com' };
test('redirected Taobao namesakes cannot replace the original Goofish session', () => {
  const out = mergeYdisksPass(input, [{ name: 'cookie2', value: 'wrong-session', domain: '.taobao.com' }, pass]);
  assert.match(out.credential.cookieHeader, /cookie2=original/);
  assert.doesNotMatch(out.credential.cookieHeader, /wrong-session|x5secdata/);
  assert.match(out.credential.cookieHeader, /x5sec=fresh-pass/);
});
test('pass merge preserves HttpOnly and partitioned token scope', () => {
  const out = mergeYdisksPass(input, [pass]);
  assert.equal(out.cookieSnapshot.find(c => c.name === 'cookie2').httpOnly, true);
  assert.equal(out.cookieSnapshot.find(c => c.name === '_m_h5_tk').partitionKey, 'https://goofish.com');
  assert.deepEqual(JSON.parse(out.credential.metadata.cookies_refresh_snapshot), out.cookieSnapshot);
});
test('foreign-domain or old pass values cannot be accepted', () => {
  assert.throws(() => mergeYdisksPass(input, [{ ...pass, domain: '.taobao.com' }]), /No fresh/);
  assert.throws(() => mergeYdisksPass({ ...input, credential: { ...input.credential, cookieHeader: input.credential.cookieHeader + '; x5sec=fresh-pass' } }, [pass]), /No fresh/);
});
