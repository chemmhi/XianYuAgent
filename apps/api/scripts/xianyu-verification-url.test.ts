import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeXianyuVerificationUrl } from '../src/xianyu-mtop.js';

test('normalizes duplicate path slashes in Xianyu verification URLs', () => {
  assert.equal(
    normalizeXianyuVerificationUrl('https://h5api.m.goofish.com//h5/mtop.taobao.idlemessage.pc.login.token/1.0/_____tmd_____/punish?x5step=2'),
    'https://h5api.m.goofish.com/h5/mtop.taobao.idlemessage.pc.login.token/1.0/_____tmd_____/punish?x5step=2',
  );
});

test('accepts protocol-relative challenge URLs and rejects unrelated URLs', () => {
  assert.equal(
    normalizeXianyuVerificationUrl('//h5api.m.goofish.com//h5/mtop.taobao.idlemessage.pc.login.token/1.0/_____tmd_____/punish?x5step=2'),
    'https://h5api.m.goofish.com/h5/mtop.taobao.idlemessage.pc.login.token/1.0/_____tmd_____/punish?x5step=2',
  );
  assert.equal(normalizeXianyuVerificationUrl('https://www.goofish.com/im'), undefined);
});
