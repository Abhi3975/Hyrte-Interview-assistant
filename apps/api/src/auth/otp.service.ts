import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { SMS_PROVIDER, SmsProvider } from './sms/sms-provider.interface';

interface OtpEntry {
  code: string;
  expiresAt: number;
  fullName: string;
  email?: string;
  phone?: string;
  attempts: number;
}

const TTL_MS = 10 * 60 * 1000;
// P1 — rate limiting + resend cooldown (per-identifier and per-IP), matching
// the OTP store's own in-memory simplicity (no Redis — see the class comment
// below for why that's a deliberate choice, not a shortcut).
const RESEND_COOLDOWN_MS = 30_000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_PER_IDENTIFIER = 3; // per phone/email, per window
const RATE_LIMIT_MAX_PER_IP = 10; // per IP, per window — covers many identifiers from one source

/**
 * Passwordless phone/email OTP for the "Sign Up to Start" candidate lobby.
 * Upgrade — P1 §2: phone is now the PRIMARY identifier when provided (email
 * is the fallback delivery channel, not the other way around as before).
 *
 * Codes and rate-limit counters live in-memory with a short TTL — no DB
 * migration, no Redis required, matching this deployment's existing scale
 * (single API task, no horizontal scaling today — see deployment notes). If
 * that ever changes, this is the one place to swap for a Redis-backed store;
 * every caller already goes through this service, not a raw Map.
 */
@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);
  private readonly store = new Map<string, OtpEntry>();
  private readonly resetStore = new Map<string, { code: string; expiresAt: number; attempts: number }>();
  // identifier/IP -> timestamps (ms) of recent requests, for rate limiting.
  private readonly requestLog = new Map<string, number[]>();
  private readonly lastSentAt = new Map<string, number>();

  constructor(@Inject(SMS_PROVIDER) private readonly sms: SmsProvider) {}

  /** Generate + store a password-reset code for an email. */
  requestReset(email: string): string {
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    this.resetStore.set(email.toLowerCase(), { code, expiresAt: Date.now() + TTL_MS, attempts: 0 });
    return code;
  }

  /** Verify a password-reset code. */
  verifyReset(email: string, code: string): boolean {
    const key = email.toLowerCase();
    const e = this.resetStore.get(key);
    if (!e || Date.now() > e.expiresAt || e.attempts >= 5) { this.resetStore.delete(key); return false; }
    e.attempts++;
    if (e.code !== code.trim()) return false;
    this.resetStore.delete(key);
    return true;
  }

  /**
   * Checks resend-cooldown + rate limits for a request BEFORE generating a
   * code. `identifier` is whichever of phone/email is primary for this
   * request (see requestOtp in the controller). Returns the reason so the
   * controller can surface a clear "wait Ns" error rather than a generic
   * 429.
   */
  checkRateLimit(identifier: string, ip?: string): { ok: true } | { ok: false; retryAfterSec: number; reason: string } {
    const key = identifier.toLowerCase();
    const now = Date.now();

    const lastSent = this.lastSentAt.get(key);
    if (lastSent && now - lastSent < RESEND_COOLDOWN_MS) {
      return { ok: false, retryAfterSec: Math.ceil((RESEND_COOLDOWN_MS - (now - lastSent)) / 1000), reason: 'resend_cooldown' };
    }

    const prune = (log: number[]) => log.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
    const idLog = prune(this.requestLog.get(key) ?? []);
    if (idLog.length >= RATE_LIMIT_MAX_PER_IDENTIFIER) {
      return { ok: false, retryAfterSec: Math.ceil((RATE_LIMIT_WINDOW_MS - (now - idLog[0])) / 1000), reason: 'too_many_requests' };
    }
    if (ip) {
      const ipKey = `ip:${ip}`;
      const ipLog = prune(this.requestLog.get(ipKey) ?? []);
      if (ipLog.length >= RATE_LIMIT_MAX_PER_IP) {
        return { ok: false, retryAfterSec: Math.ceil((RATE_LIMIT_WINDOW_MS - (now - ipLog[0])) / 1000), reason: 'too_many_requests_ip' };
      }
    }
    return { ok: true };
  }

  /** Records that a request actually went out — call only after checkRateLimit passed. */
  private recordRequest(identifier: string, ip?: string): void {
    const now = Date.now();
    const key = identifier.toLowerCase();
    this.lastSentAt.set(key, now);
    const idLog = (this.requestLog.get(key) ?? []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
    idLog.push(now);
    this.requestLog.set(key, idLog);
    if (ip) {
      const ipKey = `ip:${ip}`;
      const ipLog = (this.requestLog.get(ipKey) ?? []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
      ipLog.push(now);
      this.requestLog.set(ipKey, ipLog);
    }
  }

  /**
   * `identifier` is the primary key for this OTP — phone when given
   * (P1: phone-first), else email. Both are stored on the entry regardless,
   * so verify() can be looked up by whichever the candidate actually used.
   */
  request(fullName: string, identifier: string, email?: string, phone?: string, ip?: string): string {
    const key = identifier.toLowerCase();
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    this.store.set(key, { code, expiresAt: Date.now() + TTL_MS, fullName, email, phone, attempts: 0 });
    this.recordRequest(identifier, ip);
    this.logger.log(`OTP for ${key}: ${code}${this.smsConfigured() || this.emailConfigured() ? '' : ' (demo mode)'}`);
    return code;
  }

  /** True when a real SMS provider is configured via env. */
  smsConfigured(): boolean {
    return this.sms.isConfigured();
  }

  /** True when a real email provider (Resend or SendGrid) is configured. */
  emailConfigured(): boolean {
    return Boolean(process.env.RESEND_API_KEY || process.env.SENDGRID_API_KEY);
  }

  private otpHtml(code: string): string {
    return `<div style="font-family:system-ui,sans-serif;max-width:420px;margin:auto">
      <h2 style="margin:0 0 8px">Verify your HYRTE sign-in</h2>
      <p style="color:#555;margin:0 0 16px">Enter this code to start your interview. It expires in 10 minutes.</p>
      <div style="font-size:32px;font-weight:700;letter-spacing:6px;background:#f4f4f5;padding:16px;text-align:center;border-radius:10px">${code}</div>
      <p style="color:#999;font-size:12px;margin-top:16px">If you didn't request this, you can ignore this email.</p>
    </div>`;
  }

  /** Send via SendGrid (single-sender — no domain needed). Delivers to anyone. */
  async sendViaSendGrid(email: string, code: string): Promise<boolean> {
    const key = process.env.SENDGRID_API_KEY;
    const from = process.env.SENDGRID_FROM;
    if (!key || !from) return false;
    try {
      const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          personalizations: [{ to: [{ email }] }],
          from: { email: from, name: 'HYRTE' },
          subject: `Your HYRTE code is ${code}`,
          content: [{ type: 'text/html', value: this.otpHtml(code) }],
        }),
      });
      if (res.status >= 200 && res.status < 300) return true;
      this.logger.warn(`SendGrid failed ${res.status}: ${(await res.text()).slice(0, 160)}`);
      return false;
    } catch (err) {
      this.logger.warn(`SendGrid error: ${err}`);
      return false;
    }
  }

  /**
   * Send the code by email via Resend's REST API (no SDK — Bearer fetch).
   * No telecom/DLT restrictions; delivers to any inbox including Gmail.
   */
  async sendEmail(email: string, code: string): Promise<boolean> {
    if (!this.emailConfigured()) return false;
    const from = process.env.RESEND_FROM || 'HYRTE <onboarding@resend.dev>';
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          from,
          to: [email],
          subject: `Your HYRTE code is ${code}`,
          html: this.otpHtml(code),
        }),
      });
      if (!res.ok) { this.logger.warn(`Resend email failed ${res.status}: ${(await res.text()).slice(0, 160)}`); return false; }
      return true;
    } catch (err) {
      this.logger.warn(`Resend email error: ${err}`);
      return false;
    }
  }

  /**
   * Send the code by SMS. `phone` must be full E.164 incl. country code,
   * e.g. +919905270822. Delegates to the injected SmsProvider (Twilio today)
   * — this method never talks to a vendor API directly.
   */
  async sendSms(phone: string, code: string): Promise<boolean> {
    return this.sms.send(phone, `Your HYRTE verification code is ${code}. It expires in 10 minutes.`);
  }

  /**
   * Returns the pending signup's name + which identifiers it was requested
   * with on success, or null if invalid/expired. `identifier` must match
   * whatever `request()` was called with (phone if that's what was primary,
   * else email) — this is what makes phone genuinely a login key now, not
   * just an SMS delivery address that verification silently ignored.
   */
  verify(identifier: string, code: string): { fullName: string; email?: string; phone?: string } | null {
    const key = identifier.toLowerCase();
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt || entry.attempts >= 5) {
      this.store.delete(key);
      return null;
    }
    entry.attempts++;
    if (entry.code !== code.trim()) return null;
    this.store.delete(key);
    return { fullName: entry.fullName, email: entry.email, phone: entry.phone };
  }
}
