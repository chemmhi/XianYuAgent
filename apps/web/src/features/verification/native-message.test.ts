import { describe, expect, it } from 'vitest';
import { nativeCandidateMessage } from './native-message';

const origin = 'https://h5api.m.goofish.com';
const cookie = { value: 'synthetic-only', host: 'h5api.m.goofish.com', expire: String(Date.now() + 60_000) };
const message = (value: unknown = cookie) => JSON.stringify({ type: 'child', content: JSON.stringify({ smToken: 'token', queryToken: 'sm', sm: 'sm', x5sec: JSON.stringify(value) }) });
describe('native platform candidate messages', () => {
  it('accepts only the actual iframe source and exact platform origin, converting SDK milliseconds', () => {
    expect(nativeCandidateMessage(message(), origin, origin, true)).toEqual({ ...cookie, expire: Number(cookie.expire) });
    expect(nativeCandidateMessage(message(), 'https://h5api.m.goofish.com.evil.test', origin, true)).toBeUndefined();
    expect(nativeCandidateMessage(message(), origin, origin, false)).toBeUndefined();
  });
  it('ignores placeholder completion, resize, malformed and oversized messages', () => {
    for (const data of [{ type: 'child' }, '{}', 'x'.repeat(20_001), '{', JSON.stringify({ action: 'resizeIframe', width: 420 }),
      JSON.stringify({ type: 'child', content: JSON.stringify({ smToken: 'token', queryToken: 'sm', sm: 'sm' }) })]) {
      expect(nativeCandidateMessage(data, origin, origin, true)).toBeUndefined();
    }
  });
  it('rejects another host, invalid expiry and cookie injection characters', () => {
    for (const patch of [{ host: 'www.goofish.com' }, { value: 'a;other=b' }, { value: 'a\n' }, { expire: 'NaN' }, { expire: {} }]) {
      expect(nativeCandidateMessage(message({ ...cookie, ...patch }), origin, origin, true)).toBeUndefined();
    }
  });
});
