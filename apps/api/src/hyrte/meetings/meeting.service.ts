import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AIService } from '../../ai/ai.service';
import { HyrteGateway } from '../hyrte.gateway';
import { EvidenceGraphService } from '../dig/evidence-graph.service';
import { DecisionGraphService } from '../dig/decision-graph.service';
import {
  MeetingAttendee,
  PriorStatement,
  buildAttendeeCard,
  buildRealityLayerDirective,
  formatCandidateRecord,
  formatPriorStatements,
} from './meeting-context';

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
  /** §6 — set when this turn pushed back on something the candidate claimed. Recorded as real evidence. */
  challengedCandidate?: boolean;
  challengeBasis?: string;
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

  /**
   * §6's "that's not what I told you this morning" — what these specific
   * people actually said to the candidate before the meeting, drawn from the
   * real inbox and Slack history rather than invented.
   */
  private async getPriorStatements(sessionId: string, attendees: { id: string; name: string }[], topic: string): Promise<PriorStatement[]> {
    const ids = attendees.map((a) => a.id);
    if (ids.length === 0) return [];
    const nameById = new Map(attendees.map((a) => [a.id, a.name]));
    const [inbox, slack] = await Promise.all([
      this.prisma.hyrteInboxMessage.findMany({
        where: { sessionId, fromStakeholderId: { in: ids } },
        orderBy: { createdAt: 'desc' },
        take: 8,
        select: { fromStakeholderId: true, subject: true, body: true, createdAt: true },
      }),
      this.prisma.hyrteSlackMessage.findMany({
        where: { sessionId, fromStakeholderId: { in: ids } },
        orderBy: { createdAt: 'desc' },
        take: 8,
        select: { fromStakeholderId: true, body: true, createdAt: true },
      }),
    ]);
    const all = [
      ...inbox.map((m) => ({ speaker: nameById.get(m.fromStakeholderId!) ?? 'A colleague', at: m.createdAt, body: `${m.subject} — ${m.body}` })),
      ...slack.map((m) => ({ speaker: nameById.get(m.fromStakeholderId!) ?? 'A colleague', at: m.createdAt, body: m.body })),
    ];

    // Rank by how much each statement actually bears on THIS meeting, not raw
    // recency. Caught live: the world's ambient-chatter generator
    // (generator/ambient-noise.ts) deliberately produces filler — a snacks
    // survey, a coffee run, a timesheet reminder — and a recency-only window
    // let that crowd out the statements that mattered. §7's own worked example
    // is entirely substantive.
    const topicWords = new Set(
      `${topic}`
        .toLowerCase()
        .split(/\W+/)
        .filter((w) => w.length > 4),
    );
    const score = (body: string) => {
      const words = body.toLowerCase().split(/\W+/);
      return words.filter((w) => topicWords.has(w)).length;
    };
    return all
      .map((s) => ({ s, relevance: score(s.body) }))
      // Relevance first, recency as the tiebreak — so a topical message from
      // an hour ago beats "coffee run in 10" from a minute ago.
      .sort((a, b) => b.relevance - a.relevance || b.s.at.getTime() - a.s.at.getTime())
      .slice(0, 6)
      .map((x) => x.s)
      .sort((a, b) => a.at.getTime() - b.at.getTime());
  }

  /**
   * §6's "Yesterday you said we'd prioritize enterprise customers. Are we
   * changing that?" — the candidate's own on-record positions this session, so
   * the room can hold them to their own words rather than only to the facts.
   */
  private async getCandidateRecord(sessionId: string): Promise<string[]> {
    const entries = await this.prisma.hyrteDecisionLogEntry.findMany({
      where: { sessionId, outcome: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: 8,
      select: { outcome: true, reasoning: true },
    });
    return entries
      .map((e) => (e.reasoning ? `${e.outcome} (their stated reasoning: ${e.reasoning})` : e.outcome))
      .filter((s): s is string => !!s)
      .reverse();
  }

  /**
   * Refinements doc §7 — "Team messages should appear BEFORE the meeting.
   * The sequence should be: Incoming context → Messages → Documents → Meeting
   * → Decision → Execution. Not: Meeting → AI explains everything. Because
   * real work doesn't work like that."
   *
   * Everything the candidate should have read before walking in: who is
   * attending, what those people have already said about it, and the documents
   * that bear on it. Candidate-facing, so private stakeholder internals are
   * omitted — this is the same data the Reality Layer uses, minus everything
   * the candidate is not supposed to know.
   */
  async getPreMeetingBrief(sessionId: string, eventId: string) {
    const event = await this.prisma.hyrteCalendarEvent.findFirst({ where: { id: eventId, sessionId } });
    if (!event) throw new NotFoundException('Meeting not found');

    const attendees = await this.prisma.hyrteStakeholder.findMany({
      where: { id: { in: event.attendeeStakeholderIds } },
      select: { id: true, name: true, role: true, department: true },
    });
    const statements = await this.getPriorStatements(sessionId, attendees, `${event.title} ${event.agenda ?? ''}`);

    // Documents that bear on this meeting — matched on real title/agenda word
    // overlap rather than an LLM call, so the brief loads instantly and is
    // the same every time the candidate opens it.
    const docs = await this.prisma.hyrteKnowledgeDoc.findMany({
      where: { sessionId },
      select: { id: true, title: true, category: true },
    });
    const topicWords = new Set(
      `${event.title} ${event.agenda ?? ''}`
        .toLowerCase()
        .split(/\W+/)
        .filter((w) => w.length > 4),
    );
    const related = docs
      .map((d) => ({ doc: d, score: d.title.toLowerCase().split(/\W+/).filter((w) => topicWords.has(w)).length }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 4)
      .map((x) => x.doc);

    return {
      id: event.id,
      title: event.title,
      agenda: event.agenda,
      startAt: event.startAt,
      endAt: event.endAt,
      alreadyStarted: !!event.startedAt,
      concluded: !!event.notesGeneratedAt,
      attendees,
      // §7's worked example: "Engineering — 10:02 AM: we cannot ship the
      // analytics dashboard this week", etc. The candidate enters knowing
      // what is happening.
      recentStatements: statements.map((s) => ({ speaker: s.speaker, at: s.at, body: s.body })),
      relatedDocs: related,
    };
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

    const transcript = priorMessages.map(
      (m) => `${m.fromStakeholderId ? (attendees.find((a) => a.id === m.fromStakeholderId)?.name ?? 'Someone') : 'Candidate'}: ${m.body}`,
    );

    // Refinements doc §6 — the Reality Layer. Every attendee's real stakes,
    // authority, workload, private knowledge and motive, plus what they
    // actually said to the candidate before this meeting and what the
    // candidate has already committed to. Before this the prompt received
    // `{key, name, role}` and nothing else, which is precisely why meetings
    // read as "another chatbot conversation": nobody in the room had anything
    // of their own to defend.
    const [priorStatements, candidateRecord] = await Promise.all([
      this.getPriorStatements(sessionId, attendees, `${event.title} ${event.agenda ?? ''}`),
      this.getCandidateRecord(sessionId),
    ]);
    const attendeeCards = attendees.map((a) => buildAttendeeCard(a as MeetingAttendee, companyState)).join('\n\n');
    const realityLayer =
      buildRealityLayerDirective(priorStatements.length > 0, candidateRecord.length > 0) +
      formatPriorStatements(priorStatements) +
      formatCandidateRecord(candidateRecord);

    const result = await this.ai.completeJson<MeetingTurnResult>(
      [
        {
          role: 'system',
          content:
            'You are running ONE turn of a live multi-stakeholder workplace meeting. Given the meeting agenda, ' +
            'the attendee roster, and the transcript so far, pick ONE attendee (by "key") who would naturally ' +
            'speak next and write their contribution — a real point, question, disagreement, or decision that ' +
            'moves the discussion forward, never restating what was already said. If the candidate has spoken, ' +
            'respond to what they ACTUALLY said — agreeing, pressing, or disagreeing as that character genuinely ' +
            'would. Return ONLY JSON: {"stakeholderKey": string (must match an attendee key), "body": string ' +
            '(1-3 sentences, natural meeting speech), "concludeAfterThis": boolean (true ONLY if the discussion ' +
            'has genuinely reached a decision and should end now — most turns are false), "challengedCandidate": ' +
            'boolean (true only when this turn directly pushed back on something the candidate claimed), ' +
            '"challengeBasis": string (only when challengedCandidate — one short phrase naming what it ' +
            'contradicted, e.g. "engineering capacity stated this morning")}.' +
            realityLayer,
        },
        {
          role: 'user',
          content:
            `Company: ${session.companyName}. Meeting: "${event.title}"${event.agenda ? ` — agenda: ${event.agenda}` : ''}. ` +
            `\n\nWHO IS IN THE ROOM (each person's own stakes, authority and knowledge — speak only from the ` +
            `character you pick):\n${attendeeCards}\n\n` +
            `Transcript so far:\n${transcript.join('\n') || '(nothing said yet — this is the opening turn)'}`,
        },
      ],
      { temperature: 0.85, maxTokens: 350 },
    );

    // Live-verified bug: the model picked the same attendee for two
    // consecutive turns and the second turn largely restated the first, while
    // the person whose own capacity had just been misrepresented never got to
    // answer. A real room does not work that way. Deterministic guard rather
    // than a prompt plea — whoever spoke last cannot take the next turn while
    // anyone else is in the room.
    const lastSpeakerId = [...priorMessages].reverse().find((m) => m.fromStakeholderId)?.fromStakeholderId ?? null;
    const eligible = attendees.length > 1 ? attendees.filter((a) => a.id !== lastSpeakerId) : attendees;
    const picked = eligible.find((a) => a.id === result.stakeholderKey);
    const speaker = picked ?? eligible[turnNumber % eligible.length];
    const body = result.body?.trim();
    if (body) {
      const created = await this.prisma.hyrteMeetingMessage.create({ data: { sessionId, eventId, fromStakeholderId: speaker.id, body } });
      this.gateway.broadcast(sessionId, { type: 'meeting:new', message: created });
    }

    // §6 — a stakeholder genuinely pushing back on a candidate's claim is a
    // real behavioural signal (did the claim survive contact with someone who
    // knew better?), so it becomes evidence rather than just dialogue.
    if (result.challengedCandidate && body) {
      this.evidence
        .createEvidence({
          hyrteSessionId: sessionId,
          candidateId: session.candidateId,
          source: 'SIMULATION',
          type: 'SIMULATION_ACTION',
          rawText:
            `In the meeting "${event.title}", ${speaker.name} (${speaker.role}) challenged something the candidate ` +
            `claimed${result.challengeBasis ? ` — it contradicted ${result.challengeBasis}` : ''}: "${body}"`,
          metadata: { eventId, challengedBy: speaker.id },
        })
        .catch((e) => this.logger.warn(e));
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
