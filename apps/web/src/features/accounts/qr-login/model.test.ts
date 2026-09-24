import { describe, expect, it } from 'vitest';
import { isTerminalQrStatus, phaseForQrStatus, qrStatusLabel, secondsUntilQrExpiry } from './model';

describe('qr login model', () => {
  it('maps terminal and polling states without exposing credential values', () => {
    expect(phaseForQrStatus('waiting')).toBe('polling');
    expect(phaseForQrStatus('scanned')).toBe('polling');
    expect(phaseForQrStatus('succeeded')).toBe('succeeded');
    expect(isTerminalQrStatus('expired')).toBe(true);
    expect(isTerminalQrStatus('waiting')).toBe(false);
    expect(isTerminalQrStatus('verification_required')).toBe(true);
    expect(isTerminalQrStatus('verification_required', { verificationAutoLaunch: true })).toBe(false);
  });

  it('provides stable labels and expiry countdowns', () => {
    const now = Date.parse('2026-09-19T00:00:00.000Z');
    expect(qrStatusLabel('scanned')).toBe('已扫码，等待确认');
    expect(secondsUntilQrExpiry('2026-09-19T00:00:12.100Z', now)).toBe(13);
    expect(secondsUntilQrExpiry('2026-09-18T23:59:00.000Z', now)).toBe(0);
  });
});

