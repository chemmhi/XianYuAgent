import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { VerificationPanel } from './VerificationPanel';
import { QrLoginView } from '../accounts/qr-login/components/QrLoginView';
import { session } from './test-fixtures';
it('disables human claim until a fresh frame and actual ready stream exist', () => {
  const html = renderToStaticMarkup(<VerificationPanel session={session({ state: 'priority_wait', priorityDeadline: Date.now() + 5_000 })} />);
  expect(html).toMatch(/disabled=""[^>]*>我来操作/); expect(html).toContain('30 秒');
  expect(html).not.toContain('<iframe'); expect(html).not.toContain('https://www.goofish');
});
it('settling exposes no new controller and partial completion retains explicit business action', () => {
  const settling = renderToStaticMarkup(<VerificationPanel session={session({ state: 'settling' })} />);
  expect(settling).toContain('等待平台结果'); expect(settling).not.toContain('>我来操作<'); expect(settling).not.toContain('>交给系统<');
  const partial = renderToStaticMarkup(<VerificationPanel session={session({ state: 'completed_partial', sourceResults: [{ source: 'unknown.write', status: 'probe_only' }] })} />);
  expect(partial).toContain('请核对原操作'); expect(partial).toContain('不会自动重放'); expect(partial).not.toContain('账号已连接');
});
it('preserves source results while business rechecking is still in progress', () => {
  const html = renderToStaticMarkup(<VerificationPanel session={session({ state: 'rechecking', sourceResults: [
    { source: 'im_listener', status: 'verified' }, { source: 'item.list', status: 'pending', nextAction: '等待商品检查' },
  ] })} />);
  expect(html).toContain('聊天连接'); expect(html).toContain('已验证'); expect(html).toContain('等待商品检查');
});
it('distinguishes an actual platform rejection from no manual answer and never treats a platform answer as account recovery', () => {
  const rejected = renderToStaticMarkup(<VerificationPanel session={session({state:'human_active',platformResult:{status:'rejected',code:300,sequence:1,challengeGeneration:1,observedAt:Date.now()}})} />);
  expect(rejected).toContain('平台未通过'); expect(rejected).toContain('300'); expect(rejected).not.toContain('账号已连接');
  const failed = renderToStaticMarkup(<VerificationPanel session={session({state:'failed',failureCode:'VERIFICATION_PLATFORM_REJECTED'})} />);
  expect(failed).toContain('平台未通过本次验证'); expect(failed).not.toContain('本轮仅限人工处理');
  const old = renderToStaticMarkup(<VerificationPanel session={session({state:'human_active',challengeGeneration:2,platformResult:{status:'rejected',code:300,sequence:1,challengeGeneration:1,observedAt:Date.now()}})} />);
  expect(old).not.toContain('平台未通过');
});
it('exposes no automatic action or automatic fallback promise when the server disallows auto', () => {
  const html = renderToStaticMarkup(<VerificationPanel session={session({ state: 'priority_wait', autoAllowed: false, priorityDeadline: Date.now() + 5_000 })} />);
  expect(html).not.toContain('交给系统'); expect(html).toContain('仅人工操作'); expect(html).toContain('我来操作');
});
it('remote QR presentation replaces the QR and raw URL and distinguishes explicit cancel', () => {
  const html = renderToStaticMarkup(<QrLoginView model={{ phase: 'verification_required', error: null, session: { qrSessionId: 'login', status: 'verification_required', expiresAt: new Date().toISOString(), pollAfterMs: 1500, verificationPresentation: 'remote', verificationPending: true,
    qrImageDataUrl: 'data:image/png;base64,QR', verificationUrl: 'https://www.goofish.com/punish?secret=value' } }} onCancel={() => undefined} />);
  expect(html).toContain('取消此次登录'); expect(html).toContain('后台继续'); expect(html).not.toContain('secret=value'); expect(html).not.toContain('base64,QR'); expect(html).not.toContain('新窗口');
});
