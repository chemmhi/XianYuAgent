import { describe, expect, it } from 'vitest';
import { ApiError } from '../../api/http';
import { accountErrorMessage, accountRiskLabel } from './feedback';

describe('account feedback translation', () => {
  it.each([
    ['ACCOUNT_VALIDATION_REQUIRED', '需要安全验证'],
    ['RGV587', '需滑块验证'],
    ['FUTURE_VENDOR_CODE', '需要安全验证'],
    [undefined, '需要安全验证'],
  ])('maps risk %s to a Chinese status', (code, label) => expect(accountRiskLabel(code)).toBe(label));

  it('prioritizes the specific backend reason over the generic HTTP envelope', () => {
    expect(accountErrorMessage(new ApiError('raw vendor diagnostic', 409, { error: { code: 'ACCOUNT_REAUTH_REQUIRED', details: { errorCode: 'ACCOUNT_VALIDATION_REQUIRED' } } }), '操作失败')).toBe('需要安全验证，请在闲鱼完成验证后重新授权。');
  });

  it.each([
    [new Error('ACCOUNT_CONTEXT_INVALID'), '该账号不可用，请刷新列表后重新选择。'],
    [new Error('PASSWORD_VERIFICATION_UNAVAILABLE'), '闲鱼要求安全验证，但本次未能获取可用的验证页面或二维码。请重试登录，或切换扫码登录。'],
    [new ApiError('raw forbidden', 403), '当前账号没有操作权限。'],
    [new ApiError('raw timeout', 504), '请求超时，请稍后重试。'],
    [new TypeError('fetch failed: private host'), '账号服务暂时不可用，请检查连接后重试。'],
  ])('translates recognized failures without displaying diagnostics', (error, message) => {
    expect(accountErrorMessage(error, '操作失败')).toBe(message);
  });

  it.each([new Error('UNKNOWN_VENDOR_CODE'), new Error('SQL failed: secret=value'), new Error('后端异常 RAW_CODE'), new Error('toString'), null, {}])('uses the Chinese fallback for unknown details: %s', (error) => {
    expect(accountErrorMessage(error, '账号操作失败，请稍后重试。')).toBe('账号操作失败，请稍后重试。');
  });
});
