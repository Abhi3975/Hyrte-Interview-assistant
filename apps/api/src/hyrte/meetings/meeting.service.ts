import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AIService } from '../../ai/ai.service';
import { HyrteGateway } from '../hyrte.gateway';
import { EvidenceGraphService } from '../dig/evidence-graph.service';
import { DecisionGraphService } from '../dig/decision-graph.service';

/**
 * Refinements doc §7 — "Live AI Meetings... Discussions evolve naturally,
 * with participants asking questions, debating decisions, assigning
 * actions, and reaching conclusions" + "Persistent Meeting Memory... all
 * notes are automatically saved... and remain accessible throughout the
 * simulation." Before this, HyrteCalendarEvent was write-once at world
 * generation and "attend" only logged a decision — no live content, nothing
 * to revisit. This service turns joining a meeting into a real, bounded,
 * self-rescheduling multi-turn LLM discussion (same pattern as
 * HyrteConsequenceService's chaos wave / ambient chatter), followed by a
 * real generated summary persisted on the event so it can be recalled later
 * without replaying the transcript.
 *
 * Scope note (honest, not silently dropped): this makes EXISTING
 * world-generated meetings come alive with real content — it does not yet
 * build new meetings being spawned mid-session by business events (the
 * doc's other §7 claim, "meetings triggered naturally by business events,
 * not fixed timers"). That's a separate, larger piece of work.
 */
const MEETING_TURN_MIN_GAP_MS = 6_000;
const MEETING_TURN_MAX_GAP_MS = 14_000;
/** A meeting is a bounded chunk of a 30-40min session, not a standing chatroom — same "periodic, not forever" reasoning as every other capped cycle in this codebase. */
const MAX_LIVE_TURNS = 6;
/** Live-verified bug: the LLM will happily call concludeAfterThis by turn 3-4, which — combined with the
 * turn-to-turn gap above — can wrap the whole meeting up in well under a minute, before a candidate has a
 * realistic chance to read, think, and type a contribution. Doc §7 is explicit the candidate should be able to
 * contribute "throughout the discussion." Honor an early conclusion only once the candidate has actually spoken
 * at least once; otherwise require the full turn budget, which buys real wall-clock time via the gaps above. */
const MIN_TURNS_BEFORE_UNPROMPTED_CONCLUDE = MAX_LIVE_TURNS;

interface MeetingTurnResult {
  stakeholderKey?: string;
  body?: string;
  concludeAfterThis?: boolean;
}

interface MeetingNotesResult {
  notes?: string;
}

@Injectable()
export class HyrteMeetingService {
  private readonly logger = new Logger(HyrteMeetingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AIService,
    private readonly gateway: HyrteGateway,
    private readonly evidence: EvidenceGraphService,
    private readonly decisionGraph: DecisionGraphService,
  ) {}

  /** Call the first time a candidate joins a given meeting — starts the live discussion. Rejoining does nothing (idempotent at the call site via event.startedAt). */
  startDiscussion(sessionId: string, eventId: string): void {
    this.runTurn(sessionId, eventId, 1).catch((e) => this.logger.warn(errMsg(e)));
  }

  /** Call whenever the candidate speaks during a live meeting — persists their turn; the discussion's own next scheduled turn reads the transcript and can react to it. */
  async recordCandidateTurn(sessionId: string, eventId: string, candidateId: string, body: string): Promise<void> {
    const trimmed = body.trim();
    if (!trimmed) return;
    const created = await this.prisma.hyrteMeetingMessage.create({
      data: { sessionId, eventId, fromStakeholderId: null, body: trimmed },
    });
    this.gateway.broadcast(sessionId, { type: 'meeting:new', message: created });

    await this.decisionGraph.recordDecision({
      sessionId,
      actor: candidateId,
      actionType: 'meeting.contribute',
      payload: { eventId, body: trimmed },
      outcome: `Spoke up in the meeting: "${trimmed}"`,
    });
    this.evidence
      .createEvidence({
        hyrteSessionId: sessionId,
        candidateId,
        source: 'SIMULATION',
        type: 'SIMULATION_ACTION',
        rawText: `Contributed in a live meeting: "${trimmed}"`,
      })
      .catch((e) => this.logger.warn(e));
  }

  private async runTurn(sessionId: string, eventId: string, turnNumber: number): Promise<void> {
    const [session, event] = await Promise.all([
      this.prisma.hyrteSession.findUnique({ where: { id: sessionId }, select: { phase: true, companyName: true, candidateId: true } }),
      this.prisma.hyrteCalendarEvent.findUnique({ where: { id: eventId } }),
    ]);
    // Same "world may have moved on" guard as every other self-rescheduling
    // chain in this codebase — stop quietly rather than talking into a
    // finished session, and never re-run an already-concluded meeting.
    if (!session || !event || session.phase !== 'WORKSPACE_ACTIVE' || event.notesGeneratedAt) return;

    if (turnNumber > MAX_LIVE_TURNS) {
      await this.concludeMeeting(sessionId, eventId, session.candidateId);
      return;
    }

    const [attendees, companyState, priorMessages] = await Promise.all([
      this.prisma.hyrteStakeholder.findMany({ where: { id: { in: event.attendeeStakeholderIds } } }),
      this.prisma.hyrteCompanyState.findUnique({ where: { sessionId } }),
      this.prisma.hyrteMeetingMessage.findMany({ where: { eventId }, orderBy: { createdAt: 'asc' }, take: 20 }),
    ]);
    if (attendees.length === 0) {
      await this.concludeMeeting(sessionId, eventId, session.candidateId);
      return;
    }

    const roster = attendees.map((s) => ({ key: s.id, name: s.name, role: s.role }));
    const transcript = priorMessages.map(
      (m) => `${m.fromStakeholderId ? (attendees.find((a) => a.id === m.fromStakeholderId)?.name ?? 'Someone') : 'Candidate'}: ${m.body}`,
    );

    const result = await this.ai.completeJson<MeetingTurnResult>(
      [
        {
          role: 'system',
          content:
            'You are running ONE turn of a live multi-stakeholder workplace meeting. Given the meeting agenda, ' +
            'the attendee roster, and the transcript so far, pick ONE attendee (by "key") who would naturally ' +
            'speak next and write their contribution — a real point, question, disagreement, or decision that ' +
            'moves the discussion forward, never restating what was already said. If the candidate has spoken, ' +
            'you may respond to them directly by name. Return ONLY JSON: {"stakeholderKey": string (must match ' +
            'a roster key), "body": string (1-3 sentences, natural meeting speech), "concludeAfterThis": boolean ' +
            '(true ONLY if the discussion has genuinely reached a decision and should end now — most turns are false)}.',
        },
        {
          role: 'user',
          content:
            `Company: ${session.companyName}. Meeting: "${event.title}"${event.agenda ? ` — agenda: ${event.agenda}` : ''}. ` +
            `Attendees: ${JSON.stringify(roster)}. Current company state: ${JSON.stringify(omitMeta(companyState ?? {}))}. ` +
            `Transcript so far:\n${transcript.join('\n') || '(nothing said yet — this is the opening turn)'}`,
        },
      ],
      { temperature: 0.85, maxTokens: 350 },
    );

    const speaker = attendees.find((a) => a.id === result.stakeholderKey) ?? attendees[turnNumber % attendees.length];
    const body = result.body?.trim();
    if (body) {
      const created = await this.prisma.hyrteMeetingMessage.create({ data: { sessionId, eventId, fromStakeholderId: speaker.id, body } });
      this.gateway.broadcast(sessionId, { type: 'meeting:new', message: created });
    }

    const candidateHasSpoken = priorMessages.some((m) => m.fromStakeholderId === null);
    const canConcludeEarly = candidateHasSpoken || turnNumber >= MIN_TURNS_BEFORE_UNPROMPTED_CONCLUDE;
    if ((result.concludeAfterThis && canConcludeEarly) || turnNumber >= MAX_LIVE_TURNS) {
      await this.concludeMeeting(sessionId, eventId, session.candidateId);
      return;
    }

    const delay = MEETING_TURN_MIN_GAP_MS + Math.floor(Math.random() * (MEETING_TURN_MAX_GAP_MS - MEETING_TURN_MIN_GAP_MS));
    setTimeout(() => {
      this.runTurn(sessionId, eventId, turnNumber + 1).catch((e) => this.logger.warn(errMsg(e)));
    }, delay);
  }

  private async concludeMeeting(sessionId: string, eventId: string, candidateId: string): Promise<void> {
    const [event, messages] = await Promise.all([
      this.prisma.hyrteCalendarEvent.findUnique({ where: { id: eventId } }),
      this.prisma.hyrteMeetingMessage.findMany({ where: { eventId }, orderBy: { createdAt: 'asc' } }),
    ]);
    if (!event || event.notesGeneratedAt || messages.length === 0) return;

    const attendees = await this.prisma.hyrteStakeholder.findMany({ where: { id: { in: event.attendeeStakeholderIds } } });
    const transcript = messages.map(
      (m) => `${m.fromStakeholderId ? (attendees.find((a) => a.id === m.fromStakeholderId)?.name ?? 'Someone') : 'Candidate'}: ${m.body}`,
    );

    const result = await this.ai.completeJson<MeetingNotesResult>(
      [
        {
          role: 'system',
          content:
            'Summarize this workplace meeting transcript into real meeting notes — what was discussed, what was ' +
            'decided, and any action items — in 2-4 sentences, written as a colleague would jot them down ' +
            'afterward for someone who missed it. Return ONLY JSON: {"notes": string}.',
        },
        { role: 'user', content: `Meeting: "${event.title}". Transcript:\n${transcript.join('\n')}` },
      ],
      { temperature: 0.5, maxTokens: 300 },
    );

    const notes = result.notes?.trim() || 'No clear decisions were reached in this meeting.';
    const updated = await this.prisma.hyrteCalendarEvent.update({ where: { id: eventId }, data: { notes, notesGeneratedAt: new Date() } });
    this.gateway.broadcast(sessionId, { type: 'meeting:concluded', event: updated });

    this.evidence
      .createEvidence({
        hyrteSessionId: sessionId,
        candidateId,
        source: 'SIMULATION',
        type: 'SIMULATION_ACTION',
        rawText: `Meeting "${event.title}" concluded. Notes: ${notes}`,
      })
      .catch((e) => this.logger.warn(e));
  }
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Strips Prisma's own bookkeeping fields so the prompt only sees KPI values. */
function omitMeta(state: Record<string, unknown>): Record<string, unknown> {
  const { sessionId: _s, updatedAt: _u, ...rest } = state;
  return rest;
}
