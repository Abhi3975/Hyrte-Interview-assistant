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
    this.logger.log(`OTP for ${key}: ${code} (demo mode)`);
    return code;
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
