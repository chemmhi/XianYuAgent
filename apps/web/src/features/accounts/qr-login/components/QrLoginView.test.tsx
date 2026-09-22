import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { QrLoginView } from './QrLoginView';
import type { QrLoginModel } from '../model';

describe('QrLoginView', () => {
  it('does not render the redundant profile-waiting block', () => {
    const model: QrLoginModel = { phase: 'idle', session: null, error: null };
    const html = renderToStaticMarkup(<QrLoginView model={model} />);

    expect(html).not.toContain('等待闲鱼返回账号资料');
    expect(html).not.toContain('qr-login-account');
    expect(html).toContain('准备二维码登录');
    expect(html).toContain('qr-login-code-loading');
    expect(html).toContain('qr-login-status-row-placeholder');
  });

  it('keeps QR status and image while removing redundant footer actions', () => {
    const model: QrLoginModel = {
      phase: 'polling',
      session: {
        qrSessionId: 'qr-test',
        status: 'waiting',
        qrImageDataUrl: 'data:image/png;base64,qr',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        pollAfterMs: 1000,
      },
      error: null,
    };
    const html = renderToStaticMarkup(<QrLoginView model={model} />);

    expect(html).toContain('等待扫码');
    expect(html).toContain('闲鱼二维码登录');
    expect(html).toContain('打开闲鱼 App');
    expect(html).toContain('请勿截屏或转发二维码');
    expect(html).not.toContain('立即刷新状态');
    expect(html).not.toContain('取消登录');
  });

  it('centers the QR generation message inside the fixed code region', () => {
    const model: QrLoginModel = { phase: 'creating', session: null, error: null };
    const html = renderToStaticMarkup(<QrLoginView model={model} />);

    expect(html).toContain('qr-login-code-loading');
    expect(html).toContain('qr-login-loading-content');
    expect(html).toContain('qr-login-spinner');
    expect(html).toContain('qr-login-status-row-placeholder');
  });
});
