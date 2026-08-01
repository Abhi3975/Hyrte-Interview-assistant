'use client';

/**
 * Realtime client for the workplace shell's `/ws/hyrte` gateway. Mirrors the
 * shape of lib/voice.ts's VoiceClient: transport-only, callback-driven.
 */
export interface HyrteWsEvent {
  type: 'inbox:new' | 'slack:new' | 'task:update' | 'company_state:update' | 'stakeholder:update' | 'error';
  [key: string]: unknown;
}

const WS_BASE = process.env.NEXT_PUBLIC_API_WS ?? 'ws://localhost:4000';

export class HyrteWsClient {
  private ws?: WebSocket;

  connect(accessToken: string, sessionId: string, onEvent: (msg: HyrteWsEvent) => void): void {
    this.ws = new WebSocket(`${WS_BASE}/ws/hyrte?token=${encodeURIComponent(accessToken)}`);
    this.ws.onopen = () => {
      this.ws!.send(JSON.stringify({ type: 'subscribe', sessionId }));
    };
    this.ws.onmessage = (ev) => {
      try {
        onEvent(JSON.parse(ev.data));
      } catch {
        // ignore malformed frames
      }
    };
  }

  close(): void {
    this.ws?.close();
    this.ws = undefined;
  }
}
