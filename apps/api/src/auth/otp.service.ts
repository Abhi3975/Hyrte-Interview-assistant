import { Injectable, Logger } from '@nestjs/common';
import { randomInt } from 'node:crypto';

interface OtpEntry {
  code: string;
  expiresAt: number;
  fullName: string;
  phone?: string;
  attempts: number;
}

/**
 * Passwordless phone/email OTP for the Koyo-style "Sign Up to Start" lobby.
 *
 * Codes live in-memory with a short TTL — no DB migration, no SMS vendor
 * required. Because no SMS/email provider is wired, `request` returns the
 * code so the demo UI can display it ("demo mode"); swap in a provider send
 * and drop the returned code for production.
 */
@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);
  private readonly store = new Map<string, OtpEntry>();
  private readonly TTL_MS = 10 * 60 * 1000;

  request(fullName: string, email: string, phone?: string): string {
    const key = email.toLowerCase();
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    this.store.set(key, { code, expiresAt: Date.now() + this.TTL_MS, fullName, phone, attempts: 0 });
    this.logger.log(`OTP for ${key}: ${code}${this.smsConfigured() ? '' : ' (demo mode)'}`);
    return code;
  }

  /** True when a real SMS provider (Twilio) is configured via env. */
  smsConfigured(): boolean {
    return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM);
  }

  /**
   * Send the code by SMS via Twilio's REST API (no SDK needed — Basic-auth
   * fetch). `phone` must be full E.164 incl. country code, e.g. +919905270822.
   * NOTE: delivery to Indian numbers additionally requires TRAI DLT
   * registration of the sender/template with the provider.
   */
  async sendSms(phone: string, code: string): Promise<boolean> {
    if (!this.smsConfigured()) return false;
    const sid = process.env.TWILIO_ACCOUNT_SID!;
    const token = process.env.TWILIO_AUTH_TOKEN!;
    const from = process.env.TWILIO_FROM!;
    try {
      const body = new URLSearchParams({ To: phone, From: from, Body: `Your InterviewAI verification code is ${code}. It expires in 10 minutes.` });
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body,
      });
      if (!res.ok) { this.logger.warn(`Twilio SMS failed ${res.status}: ${(await res.text()).slice(0, 150)}`); return false; }
      return true;
    } catch (err) {
      this.logger.warn(`Twilio SMS error: ${err}`);
      return false;
    }
  }

  /** Returns the pending signup's name on success, or null if invalid/expired. */
  verify(email: string, code: string): { fullName: string } | null {
    const key = email.toLowerCase();
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt || entry.attempts >= 5) {
      this.store.delete(key);
      return null;
    }
    entry.attempts++;
    if (entry.code !== code.trim()) return null;
    this.store.delete(key);
    return { fullName: entry.fullName };
  }
}
