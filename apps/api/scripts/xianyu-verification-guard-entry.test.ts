import assert from 'node:assert/strict';
import test from 'node:test';
import { XianyuMtopClient } from '../src/xianyu-mtop.js';

for (const api of ['mtop.idle.web.xyh.item.list', 'mtop.taobao.idle.trade.merchant.sold.get', 'mtop.idle.web.trade.order.detail']) {
  test(`shared guard retains the original read request for ${api}`, async () => {
    const original = globalThis.fetch;
    let failure: any;
    let sent: any;
    const client = new XianyuMtopClient({ loadCredential: async () => ({ cookieHeader: 'unb=seller; _m_h5_tk=old_suffix' }),
      saveCookie: async () => undefined, onFailure: input => { failure = input; } });
    globalThis.fetch = async (_url, init) => {
      sent = JSON.parse(new URLSearchParams(String(init?.body)).get('data')!);
      return new Response(JSON.stringify({ ret: ['FAIL_SYS_USER_VALIDATE::verify'], data: {} }));
    };
    try {
      const result = await client.callApi('admin', 'account', api, '1.0', { pageNumber: 3, tid: 'order-1' },
        { valueType: 'string' }, { referer: 'https://seller.goofish.com/' });
      assert.equal(result.errorCode, 'ACCOUNT_VALIDATION_REQUIRED');
      assert.equal(failure.recoveryRequest?.kind, 'mtop_read');
      assert.equal(failure.recoveryRequest.api, api);
      assert.deepEqual(failure.recoveryRequest.data, sent);
      assert.deepEqual(failure.recoveryRequest.extraParams, { valueType: 'string' });
      assert.equal(failure.recoveryRequest.referer, 'https://seller.goofish.com/');
    } finally { globalThis.fetch = original; }
  });
}

test('shared guard detects validation beyond the first ret entry', async () => {
  const original = globalThis.fetch;
  const client = new XianyuMtopClient({ loadCredential: async () => ({ cookieHeader: '_m_h5_tk=old_suffix' }), saveCookie: async () => undefined });
  globalThis.fetch = async () => new Response(JSON.stringify({ ret: ['FAIL_SYS_INTERNAL_FAULT::failed', 'FAIL_SYS_USER_VALIDATE::verify'], data: {} }));
  try { assert.equal((await client.fetchItems('admin', 'account')).errorCode, 'ACCOUNT_VALIDATION_REQUIRED'); }
  finally { globalThis.fetch = original; }
});

test('write APIs report validation without a replayable mutation context', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  let failure: any;
  const client = new XianyuMtopClient({ loadCredential: async () => ({ cookieHeader: '_m_h5_tk=old_suffix' }),
    saveCookie: async () => undefined, onFailure: input => { failure = input; } });
  globalThis.fetch = async () => { calls++; return new Response(JSON.stringify({ ret: ['FAIL_SYS_USER_VALIDATE::verify'] })); };
  try {
    await client.confirmShipment('admin', 'account', 'order-1');
    assert.equal(calls, 1);
    assert.equal(failure.errorCode, 'ACCOUNT_VALIDATION_REQUIRED');
    assert.equal(failure.recoveryRequest, undefined);
  } finally { globalThis.fetch = original; }
});

for (const response of [
  { status: 200, body: JSON.stringify({ ret: ['FAIL_SYS_USER_VALIDATE::verify'], data: {} }) },
  { status: 200, body: JSON.stringify({ ret: ['FAIL_SYS_USER_VALIDATE::verify'], data: { url: 'https://www.goofish.com/punish?secret=hidden' } }) },
  { status: 403, body: '<html><div id="captcha">verify</div></html>' },
]) test(`upload shares the validation guard (${response.status}, challenge URL=${response.body.includes('punish')})`, async () => {
  const original = globalThis.fetch;
  let failure: any;
  const client = new XianyuMtopClient({ loadCredential: async () => ({ cookieHeader: 'unb=seller; _m_h5_tk=old_suffix' }),
    saveCookie: async () => undefined, onFailure: input => { failure = input; } });
  globalThis.fetch = async () => new Response(response.body, { status: response.status });
  try {
    const result = await client.uploadChatImage('admin', 'account', 'test.png', 'image/png', Buffer.from('image-fixture'));
    assert.equal(result.success, false);
    assert.equal(result.url, undefined);
    assert.equal(result.errorCode, 'ACCOUNT_VALIDATION_REQUIRED');
    assert.equal(failure.errorCode, 'ACCOUNT_VALIDATION_REQUIRED');
    assert.equal(failure.api, 'stream-upload.goofish.com/api/upload.api');
    assert.equal(failure.recoveryRequest, undefined, 'binary uploads must not be replayed');
  } finally { globalThis.fetch = original; }
});

for (const payload of [{ url: 'https://www.goofish.com/punish?opaque=redacted' },
  { ret: ['SUCCESS::ok'], data: { verificationUrl: 'https://www.goofish.com/punish?opaque=redacted' } },
  '<html><div id="captcha">verify</div></html>']) {
  test('Node transport recognizes URL-only and HTML challenges through the shared guard', async () => {
    const original = globalThis.fetch;
    const client = new XianyuMtopClient({ loadCredential: async () => ({ cookieHeader: '_m_h5_tk=old_suffix' }), saveCookie: async () => undefined });
    globalThis.fetch = async () => new Response(typeof payload === 'string' ? payload : JSON.stringify(payload));
    try { assert.equal((await client.fetchItems('admin', 'account')).errorCode, 'ACCOUNT_VALIDATION_REQUIRED'); }
    finally { globalThis.fetch = original; }
  });
}
