import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { QrLoginView } from './QrLoginView';
import type { QrLoginModel } from '../model';

const callbacks = {
  onStart: vi.fn(),
  onRefresh: vi.fn(),
  onRetry: vi.fn(),
  onCancel: vi.fn(),
};

describe('QrLoginView', () => {
  it('does not render the redundant profile-waiting block', () => {
    const model: QrLoginModel = { phase: 'idle', session: null, error: null };
    const html = renderToStaticMarkup(<QrLoginView model={model} {...callbacks} />);

    expect(html).not.toContain('等待闲鱼返回账号资料');
    expect(html).not.toContain('qr-login-account');
    expect(html).toContain('准备二维码登录');
  });

  it('keeps QR status, image and polling actions intact', () => {
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
    const html = renderToStaticMarkup(<QrLoginView model={model} {...callbacks} />);

    expect(html).toContain('等待扫码');
    expect(html).toContain('闲鱼二维码登录');
    expect(html).toContain('立即刷新状态');
    expect(html).toContain('取消登录');
  });
});
