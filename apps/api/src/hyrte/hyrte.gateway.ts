import { Injectable, Logger } from '@nestjs/common';
import { OnGatewayConnection, OnGatewayDisconnect, WebSocketGateway } from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import type { WebSocket } from 'ws';

/**
 * Realtime push for the workplace shell.
 *
 * Protocol (JSON text frames over `/ws/hyrte`):
 *   client → server:
 *     { type: 'subscribe', sessionId }
 *   server → client:
 *     { type: 'inbox:new', message }
 *     { type: 'slack:new', message }
 *     { type: 'task:update', task }
 *     { type: 'company_state:update', state }
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

  constructor(private readonly jwt: JwtService) {}

  async handleConnection(client: WebSocket, req: any): Promise<void> {
    try {
      const url = new URL(req.url, 'http://localhost');
      const token = url.searchParams.get('token') ?? '';
      await this.jwt.verifyAsync(token, { secret: process.env.JWT_ACCESS_SECRET });
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
  }

  private subscribe(client: WebSocket, sessionId: string): void {
    if (!this.subscribers.has(sessionId)) this.subscribers.set(sessionId, new Set());
    this.subscribers.get(sessionId)!.add(client);
  }

  broadcast(sessionId: string, payload: unknown): void {
    const set = this.subscribers.get(sessionId);
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
