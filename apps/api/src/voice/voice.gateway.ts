import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import type { WebSocket } from 'ws';
import { Difficulty } from '@prisma/client';
import {
  ConversationTurn,
  FollowUpEngine,
} from './follow-up-engine.service';

/**
 * Realtime voice interview gateway.
 *
 * Protocol (JSON text frames over `/ws/voice`):
 *   client → server:
 *     { type: 'start', jobRole, category, language, resumeSummary, skills, projects }
 *     { type: 'candidate_final', text }        // final transcript of the candidate turn
 *     { type: 'proctoring_notice', text }      // forwarded from the proctoring channel
 *   server → client:
 *     { type: 'interviewer', text, action, nextDifficulty, assessment }
 *     { type: 'end' }
 *
 * Audio streaming (mic frames → STT, TTS → speaker) is handled by the STT/TTS
 * adapters in `speech/` and layered on top of this control channel; this
 * gateway owns the *conversation* logic so it is testable without audio.
 * Per-connection turn state lives in-memory here; in production it is mirrored
 * to Redis so any gateway pod can resume a dropped socket (see docs).
 */
@WebSocketGateway({ path: '/ws/voice' })
export class VoiceGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(VoiceGateway.name);
  private readonly sessions = new Map<
    WebSocket,
    { context: SessionContext; transcript: ConversationTurn[]; difficulty: Difficulty }
  >();

  constructor(
    private readonly engine: FollowUpEngine,
    private readonly jwt: JwtService,
  ) {}

  async handleConnection(client: WebSocket, req: any): Promise<void> {
    // Authenticate from the access token in the query string.
    try {
      const url = new URL(req.url, 'http://localhost');
      const token = url.searchParams.get('token') ?? '';
      await this.jwt.verifyAsync(token, { secret: process.env.JWT_ACCESS_SECRET });
    } catch {
      this.send(client, { type: 'error', message: 'Unauthorized' });
      client.close();
      return;
    }

    client.on('message', (raw: Buffer) => this.onMessage(client, raw).catch((e) => this.logger.warn(e)));
  }

  handleDisconnect(client: WebSocket): void {
    this.sessions.delete(client);
  }

  private async onMessage(client: WebSocket, raw: Buffer): Promise<void> {
    let msg: any;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return this.send(client, { type: 'error', message: 'Invalid JSON' });
    }

    switch (msg.type) {
      case 'start': {
        const context: SessionContext = {
          jobRole: msg.jobRole ?? 'Software Engineer',
          category: msg.category ?? 'Backend',
          language: msg.language ?? 'English',
          resumeSummary: msg.resumeSummary,
          skills: msg.skills,
          projects: msg.projects,
        };
        const intro = await this.engine.introduction(context);
        this.sessions.set(client, {
          context,
          transcript: [{ role: 'interviewer', content: intro }],
          difficulty: 'MEDIUM',
        });
        return this.send(client, { type: 'interviewer', text: intro, action: 'next_question' });
      }

      case 'candidate_final': {
        const state = this.sessions.get(client);
        if (!state) return this.send(client, { type: 'error', message: 'Call start first' });
        state.transcript.push({ role: 'candidate', content: String(msg.text ?? '') });

        const turn = await this.engine.nextTurn(state.context, state.transcript, state.difficulty);
        state.transcript.push({ role: 'interviewer', content: turn.interviewerText });
        state.difficulty = turn.nextDifficulty;

        this.send(client, {
          type: 'interviewer',
          text: turn.interviewerText,
          action: turn.action,
          nextDifficulty: turn.nextDifficulty,
          assessment: turn.assessment,
        });
        if (turn.action === 'conclude') this.send(client, { type: 'end' });
        return;
      }

      case 'proctoring_notice': {
        // The interviewer verbally addresses a live proctoring flag.
        const state = this.sessions.get(client);
        if (state) {
          state.transcript.push({ role: 'interviewer', content: `[proctoring] ${msg.text}` });
        }
        return this.send(client, { type: 'interviewer', text: msg.text, action: 'follow_up' });
      }

      default:
        return this.send(client, { type: 'error', message: `Unknown type: ${msg.type}` });
    }
  }

  private send(client: WebSocket, payload: unknown): void {
    if (client.readyState === client.OPEN) client.send(JSON.stringify(payload));
  }
}

interface SessionContext {
  jobRole: string;
  category: string;
  language: string;
  resumeSummary?: string;
  skills?: string[];
  projects?: string[];
}
