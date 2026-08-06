import { OtpService } from '../src/auth/otp.service';
import { SmsProvider } from '../src/auth/sms/sms-provider.interface';

function fakeSms(): SmsProvider {
  return { name: 'fake', isConfigured: () => false, send: async () => false };
}

describe('OtpService (P1 §2 — phone-primary OTP)', () => {
  it('verifies by phone when phone was the request identifier — not silently keyed to email', () => {
    const otp = new OtpService(fakeSms());
    const code = otp.request('Cavan', '+919905270822', undefined, '+919905270822');
    expect(otp.verify('+919905270822', code)).toEqual({ fullName: 'Cavan', email: undefined, phone: '+919905270822' });
  });

  it('rejects verification by the wrong identifier (e.g. email, when the code was requested by phone)', () => {
    const otp = new OtpService(fakeSms());
    const code = otp.request('Cavan', '+919905270822', 'cavan@example.com', '+919905270822');
    expect(otp.verify('cavan@example.com', code)).toBeNull();
    expect(otp.verify('+919905270822', code)).not.toBeNull();
  });

  it('enforces the resend cooldown — a second request for the same identifier within the window is rejected', () => {
    const otp = new OtpService(fakeSms());
    expect(otp.checkRateLimit('+919905270822').ok).toBe(true);
    otp.request('Cavan', '+919905270822', undefined, '+919905270822');
    const second = otp.checkRateLimit('+919905270822');
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.reason).toBe('resend_cooldown');
      expect(second.retryAfterSec).toBeGreaterThan(0);
    }
  });

  it('enforces the per-IP rate limit independent of identifier', () => {
    const otp = new OtpService(fakeSms());
    for (let i = 0; i < 10; i++) {
      const id = `+9199000000${i.toString().padStart(2, '0')}`;
      expect(otp.checkRateLimit(id, '1.2.3.4').ok).toBe(true);
      otp.request('Cavan', id, undefined, id, '1.2.3.4');
    }
    const eleventh = otp.checkRateLimit('+919900000099', '1.2.3.4');
    expect(eleventh.ok).toBe(false);
    if (!eleventh.ok) expect(eleventh.reason).toBe('too_many_requests_ip');
  });
});
