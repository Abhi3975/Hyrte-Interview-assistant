import { Injectable, Logger } from '@nestjs/common';
import { SmsProvider } from './sms-provider.interface';

/**
 * Twilio REST API — no SDK, Basic-auth fetch (matches this codebase's
 * existing SendGrid/Resend pattern: plain fetch, no vendor SDKs).
 * NOTE: delivery to Indian numbers additionally requires TRAI DLT
 * registration of the sender/template with Twilio — a real, external
 * prerequisite, not something this code can satisfy on its own.
 */
@Injectable()
export class TwilioSmsProvider implements SmsProvider {
  readonly name = 'twilio';
  private readonly logger = new Logger(TwilioSmsProvider.name);

  isConfigured(): boolean {
    return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM);
  }

  async send(phone: string, message: string): Promise<boolean> {
    if (!this.isConfigured()) return false;
    const sid = process.env.TWILIO_ACCOUNT_SID!;
    const token = process.env.TWILIO_AUTH_TOKEN!;
    const from = process.env.TWILIO_FROM!;
    try {
      const body = new URLSearchParams({ To: phone, From: from, Body: message });
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body,
      });
      if (!res.ok) {
        this.logger.warn(`Twilio SMS failed ${res.status}: ${(await res.text()).slice(0, 150)}`);
        return false;
      }
      return true;
    } catch (err) {
      this.logger.warn(`Twilio SMS error: ${err}`);
      return false;
    }
  }
}
