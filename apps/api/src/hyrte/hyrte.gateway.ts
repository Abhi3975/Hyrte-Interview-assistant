import { Injectable, Logger } from '@nestjs/common';
import { OnGatewayConnection, OnGatewayDisconnect, WebSocketGateway } from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import type { WebSocket } from 'ws';

const RECRUITER_ROLES = new Set(['RECRUITER', 'ORG_ADMIN', 'SUPER_ADMIN']);

/**
 * Realtime push for the workplace shell.
 *
 * Protocol (JSON text frames over `/ws/hyrte`):
 *   client → server:
 *     { type: 'subscribe', sessionId }
 *   server → client (candidate channel):
 *     { type: 'inbox:new', message }
 *     { type: 'slack:new', message }
 *     { type: 'task:update', task }
 *     { type: 'company_state:update', state }
 *     { type: 'stakeholder:update', stakeholder }  — trust/emotion fields scrubbed (Hard Rule #5)
 *   server → client (recruiter channel — Part G7/F10):
 *     { type: 'stakeholder:update', stakeholder }  — full fidelity, no scrubbing
 *
 * Which channel a connection lands on is derived from the verified JWT's
 * `role` claim at `subscribe` time, never from anything the client declares
 * — a candidate token cannot request the recruiter channel. Two separate
 * subscriber sets per session, not one set with per-message filtering, so a
 * recruiter and candidate open tab for the SAME session can never cross-leak
 * by construction. Full parity with the candidate channel's other event
 * types (inbox:new/slack:new/task:update/company_state:update) is a
 * deliberate scope cut for this pass — the recruiter console polls REST for
 * those instead of a push; only stakeholder:update (the spec's own "card
 * flash on Decision Engine touch" example) gets the live recruiter push.
 *
 * Mirrors the auth/connection pattern in voice/voice.gateway.ts. Content
 * mutations happen over REST (hyrte-workplace.controller.ts); this gateway
 * only pushes — HyrteWorkplaceService calls `broadcast()` after every write,
 * including the fixture's delayed "messages arrive later" seed drip.
 */
@Injectable()
@WebSocketGateway({ path: '/ws/hyrte' })
export class HyrteGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(HyrteGateway.name);
  private readonly subscribers = new Map<string, Set<WebSocket>>();
  private readonly recruiterSubscribers = new Map<string, Set<WebSocket>>();
  private readonly clientRoles = new WeakMap<WebSocket, string>();

  constructor(private readonly jwt: JwtService) {}

  async handleConnection(client: WebSocket, req: any): Promise<void> {
    try {
      const url = new URL(req.url, 'http://localhost');
      const token = url.searchParams.get('token') ?? '';
      const payload = await this.jwt.verifyAsync(token, { secret: process.env.JWT_ACCESS_SECRET });
      if (typeof payload?.role === 'string') this.clientRoles.set(client, payload.role);
    } catch {
      this.send(client, { type: 'error', message: 'Unauthorized' });
      client.close();
      return;
    }

    client.on('message', (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'subscribe' && typeof msg.sessionId === 'string') {
          this.subscribe(client, msg.sessionId);
        }
      } catch (e) {
        this.logger.warn(e);
      }
    });
  }

  handleDisconnect(client: WebSocket): void {
    for (const set of this.subscribers.values()) set.delete(client);
    for (const set of this.recruiterSubscribers.values()) set.delete(client);
  }

  private subscribe(client: WebSocket, sessionId: string): void {
    const isRecruiter = RECRUITER_ROLES.has(this.clientRoles.get(client) ?? '');
    const map = isRecruiter ? this.recruiterSubscribers : this.subscribers;
    if (!map.has(sessionId)) map.set(sessionId, new Set());
    map.get(sessionId)!.add(client);
  }

  /** Candidate channel — payload must already be scrubbed by the caller where relevant (Hard Rule #5). */
  broadcast(sessionId: string, payload: unknown): void {
    this.send_(this.subscribers.get(sessionId), payload);
  }

  /** Recruiter channel — full fidelity, never sent to the candidate's connection. */
  broadcastRecruiter(sessionId: string, payload: unknown): void {
    this.send_(this.recruiterSubscribers.get(sessionId), payload);
  }

  private send_(set: Set<WebSocket> | undefined, payload: unknown): void {
    if (!set) return;
    const data = JSON.stringify(payload);
    for (const client of set) {
      if (client.readyState === client.OPEN) client.send(data);
    }
  }

  private send(client: WebSocket, payload: unknown): void {
    if (client.readyState === client.OPEN) client.send(JSON.stringify(payload));
  }
}
