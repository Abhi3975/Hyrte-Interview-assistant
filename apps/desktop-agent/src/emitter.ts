import { createHmac } from 'node:crypto';

/**
 * Signed event emitter.
 *
 * Posts proctoring events to the backend's external webhook, authenticating
 * with an HMAC-SHA256 signature over the raw JSON body (shared
 * PROCTOR_WEBHOOK_SECRET). This is the same trust model the backend expects
 * from any external proctor provider — no user JWT required.
 */
export interface AgentConfig {
  apiBaseUrl: string;   // e.g. https://app.interviewai.example.com
  webhookSecret: string;
  sessionId: string;
}

export interface AgentEvent {
  type: string;
  severity?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  payload?: Record<string, unknown>;
}

export class EventEmitterClient {
  constructor(private readonly cfg: AgentConfig) {}

  async emit(event: AgentEvent): Promise<boolean> {
    const body = JSON.stringify({
      sessionId: this.cfg.sessionId,
      type: event.type,
      severity: event.severity ?? 'MEDIUM',
      payload: event.payload ?? {},
      provider: 'desktop-agent',
    });
    const signature = createHmac('sha256', this.cfg.webhookSecret).update(body).digest('hex');

    try {
      const res = await fetch(`${this.cfg.apiBaseUrl}/api/proctoring/webhook`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-proctor-signature': `sha256=${signature}`,
        },
        body,
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
