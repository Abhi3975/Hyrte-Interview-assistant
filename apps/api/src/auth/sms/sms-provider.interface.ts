/**
 * P1 — provider-agnostic SMS abstraction ("Twilio/MSG91/etc. as config").
 * Every concrete provider (TwilioSmsProvider today, an MSG91 provider later)
 * implements this and nothing else in the codebase talks to a vendor SDK/API
 * directly — OtpService only ever calls `SMS_PROVIDER.send()`. Swapping
 * providers is a DI-wiring change in auth.module.ts, not a call-site change.
 */
export interface SmsProvider {
  /** Human-readable name for logs ("twilio", "msg91", ...). */
  readonly name: string;
  /** True when this provider has real credentials configured via env. */
  isConfigured(): boolean;
  /** `phone` must be full E.164 (e.g. +919905270822). Returns delivery success. */
  send(phone: string, message: string): Promise<boolean>;
}

export const SMS_PROVIDER = Symbol('SMS_PROVIDER');
