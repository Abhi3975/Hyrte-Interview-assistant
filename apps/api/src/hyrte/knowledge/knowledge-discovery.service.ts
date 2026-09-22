import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { HyrteGateway } from '../hyrte.gateway';
import { EvidenceGraphService } from '../dig/evidence-graph.service';

/**
 * Refinements doc §8 — "Knowledge Base should be objective-specific. Don't give
 * users a giant wiki… Everything else stays hidden until discovered. This gives
 * you information discovery as part of the evaluation."
 *
 * Before this every generated document was visible from the first second, so
 * "investigating" meant scrolling a list — there was nothing to discover and
 * therefore nothing to evaluate about how someone discovers things.
 *
 * A locked document is NOT invisible. The candidate sees its title and a hint
 * about where it lives; they just cannot read it yet. That distinction matters:
 * a hidden document the candidate cannot know exists makes investigation a
 * guessing game, whereas a visible-but-locked one makes it a choice about where
 * to spend limited time — which is the thing actually worth measuring.
 *
 * Unlocking is driven entirely by REAL events (a meeting concluding, a
 * conversation with a specific person, finishing a piece of work), never by a
 * timer and never by the candidate clicking "unlock".
 */

/** Trigger vocabulary. Kept deliberately small and deterministic — these are matched in code, never interpreted by a model. */
export type UnlockTrigger = `meeting:${string}` | 'meeting:any' | `stakeholder:${string}` | 'task:any';

@Injectable()
export class KnowledgeDiscoveryService {
  private readonly logger = new Logger(KnowledgeDiscoveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: HyrteGateway,
    private readonly evidence: EvidenceGraphService,
  ) {}

  /**
   * Unlocks every still-locked document whose trigger this event satisfies.
   * Safe to call on any real event — a no-op when nothing matches.
   *
   * `reason` becomes the candidate-visible account of how they got to it
   * ("Surfaced in the Product Launch Review"), and the same line is written to
   * the Evidence Graph: HOW someone reached a piece of information is a
   * behavioural signal in its own right.
   */
  async unlock(sessionId: string, candidateId: string, triggers: string[], reason: string): Promise<number> {
    if (triggers.length === 0) return 0;
    const matches = await this.prisma.hyrteKnowledgeDoc.findMany({
      where: { sessionId, locked: true, unlockTrigger: { in: triggers } },
      select: { id: true, title: true },
    });
    if (matches.length === 0) return 0;

    await this.prisma.hyrteKnowledgeDoc.updateMany({
      where: { id: { in: matches.map((m) => m.id) } },
      data: { locked: false, unlockedAt: new Date(), unlockedBy: reason },
    });

    // Reuses the existing knowledge-base surface signal rather than inventing
    // a new websocket event type — the KB list refetches on it already.
    this.gateway.broadcast(sessionId, { type: 'task:update', task: { knowledgeUnlocked: matches.length } });

    this.evidence
      .createEvidence({
        hyrteSessionId: sessionId,
        candidateId,
        source: 'SIMULATION',
        type: 'SIMULATION_ACTION',
        rawText:
          `Uncovered ${matches.length} previously undisclosed document(s) — ${matches.map((m) => `"${m.title}"`).join(', ')} — ` +
          `by ${reason.charAt(0).toLowerCase()}${reason.slice(1)}.`,
        metadata: { unlockedDocIds: matches.map((m) => m.id) },
      })
      .catch((e) => this.logger.warn(e));

    return matches.length;
  }

  /**
   * §9 — "Meeting notes should dynamically update the knowledge base. But only
   * relevant information should enter the active context. This is important
   * because otherwise the simulation becomes a giant information dump."
   *
   * One document per concluded meeting, tagged back to the event. Deliberately
   * not one per decision or per action item: the doc's own warning is about
   * volume, and a meeting that produced nothing worth recording should leave
   * the KB alone rather than adding noise to prove it ran.
   */
  async recordMeetingOutcome(
    sessionId: string,
    candidateId: string,
    event: { id: string; title: string },
    notes: string,
    outcome: { decision?: string; owner?: string | null; deadline?: string | null; dependencies?: string[] } | null,
  ): Promise<void> {
    const hasSubstance = !!outcome?.decision?.trim();
    if (!hasSubstance && notes.trim().length < 40) return;

    const body = [
      outcome?.decision ? `Decision: ${outcome.decision}` : '',
      outcome?.owner ? `Owner: ${outcome.owner}` : '',
      outcome?.deadline ? `Deadline: ${outcome.deadline}` : '',
      outcome?.dependencies?.length ? `Dependencies: ${outcome.dependencies.join(', ')}` : '',
      '',
      notes,
    ]
      .filter((l) => l !== '')
      .join('\n');

    await this.prisma.hyrteKnowledgeDoc.create({
      data: {
        sessionId,
        title: `Meeting notes — ${event.title}`,
        body,
        category: 'meeting_notes',
        relevantRoles: [],
        sourceEventId: event.id,
      },
    });
    this.gateway.broadcast(sessionId, { type: 'task:update', task: { knowledgeAdded: 1 } });

    // A meeting is the doc's own worked example of an unlock route ("Hint: ask
    // during the vendor strategy review"), so concluding one surfaces both its
    // own tied documents and anything gated behind attending a meeting at all.
    await this.unlock(sessionId, candidateId, [`meeting:${event.id}`, 'meeting:any'], `Surfaced in the meeting "${event.title}"`);
  }
}
