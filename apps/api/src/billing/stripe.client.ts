import { Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Minimal Stripe client over the REST API (no SDK dependency).
 *
 * Covers what the billing flow needs: creating a Checkout Session and
 * verifying webhook signatures. Kept small and explicit so the surface we
 * depend on is obvious and auditable.
 */
@Injectable()
export class StripeClient {
  private readonly apiKey = process.env.STRIPE_SECRET_KEY;
  private readonly webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  async createCheckoutSession(params: {
    priceId: string;
    quantity: number;
    customerEmail: string;
    clientReferenceId: string; // organizationId
    successUrl: string;
    cancelUrl: string;
  }): Promise<{ id: string; url: string }> {
    if (!this.apiKey) throw new Error('Stripe is not configured');
    // Stripe expects application/x-www-form-urlencoded with bracket notation.
    const body = new URLSearchParams({
      mode: 'subscription',
      'line_items[0][price]': params.priceId,
      'line_items[0][quantity]': String(params.quantity),
      customer_email: params.customerEmail,
      client_reference_id: params.clientReferenceId,
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
    });

    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Stripe checkout error ${res.status}: ${text.slice(0, 300)}`);
    }
    const data = (await res.json()) as any;
    return { id: data.id, url: data.url };
  }

  /**
   * Verify a webhook signature (Stripe's `t=<ts>,v1=<sig>` scheme) and return
   * the parsed event. Throws on any mismatch or replay outside the tolerance.
   */
  verifyWebhook(rawBody: string, signatureHeader: string, toleranceSec = 300): any {
    if (!this.webhookSecret) throw new Error('Stripe webhook secret not configured');
    const parts = Object.fromEntries(
      signatureHeader.split(',').map((kv) => kv.split('=') as [string, string]),
    );
    const timestamp = parts['t'];
    const expectedSig = parts['v1'];
    if (!timestamp || !expectedSig) throw new Error('Malformed Stripe signature');

    // Replay protection.
    if (Math.abs(Date.now() / 1000 - Number(timestamp)) > toleranceSec) {
      throw new Error('Stripe webhook timestamp outside tolerance');
    }

    const signedPayload = `${timestamp}.${rawBody}`;
    const computed = createHmac('sha256', this.webhookSecret).update(signedPayload).digest('hex');
    if (
      computed.length !== expectedSig.length ||
      !timingSafeEqual(Buffer.from(computed), Buffer.from(expectedSig))
    ) {
      throw new Error('Stripe webhook signature mismatch');
    }
    return JSON.parse(rawBody);
  }
}
