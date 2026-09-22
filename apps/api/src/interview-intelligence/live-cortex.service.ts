import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CompetencyDef, competenciesFromJobSuccessModel, resolveCompetencies } from './competency-model';
import {
  CortexDirective,
  EvidenceStrength,
  LiveInterviewState,
  TurnAssessment,
  applyAssessments,
  composeDeliberation,
  initLiveState,
  overallConfidence,
  seedFromPriorEvidence,
  selectNextObjective,
} from './live-interview-state';

/**
 * "Live multi agent Interviewer panel" doc:
 *
 *   "While the candidate talks to a single natural interviewer, an entire AI
 *    hiring committee works invisibly in the background… Don't let the
 *    candidate watch the panel debate live. The panel should observe silently,
 *    occasionally requesting the lead interviewer to probe deeper. Then, after
 *    the interview, the recruiter gets access to the full deliberation."
 *
 * Before this, the committee existed but only convened ONCE, after the
 * interview was already over (DecisionCouncilService / InterviewCouncilService
 * are both called from report generation). Nothing steered the live
 * conversation, and the Investigation Plan — which already computed exactly the
 * evidence-gap map this needs — was generated and then read by nobody, as its
 * own docstring admitted.
 *
 * This service is the missing link. It is shared between HYRTE's reflection
 * interview and Ally's direct interview room, the same way CouncilCoreService
 * is shared between their two post-interview councils.
 *
 * ── Cost and latency ──────────────────────────────────────────────────────
 * Zero extra LLM calls. The per-answer judgment ("how strongly did that
 * evidence stakeholder management?") rides along as extra constrained JSON
 * fields on the turn-generation call that was already happening; the steering
 * decision itself is arithmetic (live-interview-state.ts). That matters: an
 * extra round trip per turn would be plainly audible in a voice interview.
 */

export type SessionKind = 'hyrte' | 'interview';

@Injectable()
export class LiveCortexService {
  private readonly logger = new Logger(LiveCortexService.name);

  constructor(private readonly prisma: PrismaService) {}

  private async load(kind: SessionKind, sessionId: string): Promise<LiveInterviewState | null> {
    const row =
      kind === 'hyrte'
        ? await this.prisma.hyrteSession.findUnique({ where: { id: sessionId }, select: { liveInterviewState: true } })
        : await this.prisma.interviewSession.findUnique({ where: { id: sessionId }, select: { liveInterviewState: true } });
    return (row?.liveInterviewState as unknown as LiveInterviewState | null) ?? null;
  }

  private async save(kind: SessionKind, sessionId: string, state: LiveInterviewState): Promise<void> {
    const data = { liveInterviewState: state as unknown as Prisma.InputJsonValue };
    if (kind === 'hyrte') await this.prisma.hyrteSession.update({ where: { id: sessionId }, data });
    else await this.prisma.interviewSession.update({ where: { id: sessionId }, data });
  }

  /**
   * Competencies come from the recruiter's real JD when one exists (the Job
   * Success Model's weighted capability requirements), and from the role-family
   * table otherwise — see competency-model.ts.
   */
  private async resolveFor(kind: SessionKind, sessionId: string, role: string): Promise<CompetencyDef[]> {
    if (kind !== 'hyrte') return resolveCompetencies(role);
    const model = await this.prisma.jobSuccessModel.findUnique({
      where: { hyrteSessionId: sessionId },
      select: { capabilityRequirements: true },
    });
    const requirements = (model?.capabilityRequirements as unknown as { skill?: unknown; importance?: unknown }[] | null) ?? null;
    return competenciesFromJobSuccessModel(role, requirements);
  }

  /**
   * Called once, before the first question. Builds the hidden state and seeds
   * it from the Investigation Plan so the interview does not re-ask what the
   * simulation already demonstrated — the doc's Step 6 feeding Step 10, which
   * is the connection that was missing entirely.
   */
  async ensureStarted(kind: SessionKind, sessionId: string, role: string): Promise<LiveInterviewState> {
    const existing = await this.load(kind, sessionId);
    if (existing) return existing;

    let state = initLiveState(await this.resolveFor(kind, sessionId, role));

    if (kind === 'hyrte') {
      const plan = await this.prisma.investigationPlan.findUnique({ where: { hyrteSessionId: sessionId }, select: { areas: true } });
      const areas = (plan?.areas as unknown as { area?: string; currentEvidence?: string; priority?: string }[] | null) ?? [];
      const usable = areas.filter((a): a is { area: string; currentEvidence?: string; priority?: string } => typeof a.area === 'string');
      if (usable.length > 0) state = seedFromPriorEvidence(state, usable);
    }

    await this.save(kind, sessionId, state);
    return state;
  }

  /** The block injected into the interviewer's own prompt. The candidate never sees this text. */
  buildDirectiveBlock(state: LiveInterviewState, turnsRemaining?: number): { directive: CortexDirective; promptBlock: string } {
    const directive = selectNextObjective(state, turnsRemaining);
    const covered = state.competencies
      .filter((c) => c.confidence >= 75)
      .map((c) => c.label)
      .join(', ');

    const promptBlock =
      '\n\nPANEL DIRECTIVE (internal — the candidate must never see, hear, or infer that this exists; never ' +
      'mention a panel, committee, confidence score, or "objective", and never explain why you are asking ' +
      'something):\n' +
      (directive.readyToConclude
        ? '- The panel has what it needs. Begin moving toward a natural close rather than opening new ground.'
        : `- Next objective: ${directive.objective}\n- How to get there: ${directive.probeAngle}\n` +
          `- Ask about this NATURALLY, as a genuine follow-up to what they just said wherever possible. If it ` +
          `cannot follow on, transition the way a real interviewer would.`) +
      (covered ? `\n- Already sufficiently evidenced — do NOT spend further questions here: ${covered}.` : '');

    return { directive, promptBlock };
  }

  /**
   * Folds the turn's assessments in, picks the next objective, and records the
   * background deliberation. Returns the directive for the NEXT turn.
   *
   * Never throws into the caller: a failure here must degrade the interview to
   * "unsteered but working", never break the conversation the candidate is
   * actually having.
   */
  async recordTurn(
    kind: SessionKind,
    sessionId: string,
    rawAssessments: { competencyKey?: unknown; strength?: unknown; note?: unknown }[] | undefined,
    targetedKey: string | null,
    turnsRemaining?: number,
  ): Promise<LiveInterviewState | null> {
    try {
      const state = await this.load(kind, sessionId);
      if (!state) return null;

      const validKeys = new Set(state.competencies.map((c) => c.key));
      const assessments: TurnAssessment[] = (rawAssessments ?? [])
        .filter(
          (a): a is { competencyKey: string; strength: EvidenceStrength; note?: string } =>
            typeof a.competencyKey === 'string' &&
            validKeys.has(a.competencyKey) &&
            typeof a.strength === 'string' &&
            ['none', 'weak', 'medium', 'strong', 'conflicting'].includes(a.strength),
        )
        .map((a) => ({ competencyKey: a.competencyKey, strength: a.strength, note: typeof a.note === 'string' && a.note.trim() ? a.note.trim() : 'no detail given' }));

      const updated = applyAssessments(state, assessments, targetedKey);
      const directive = selectNextObjective(updated, turnsRemaining);
      const next: LiveInterviewState = {
        ...updated,
        directives: [...updated.directives, directive].slice(-40),
        deliberation: [...updated.deliberation, ...composeDeliberation(updated, directive, assessments)].slice(-120),
      };
      await this.save(kind, sessionId, next);
      return next;
    } catch (e) {
      this.logger.warn(`Live cortex turn failed for ${kind} session ${sessionId}: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  }

  /** The instruction that makes the turn call return its per-competency judgment alongside the reply. */
  buildAssessmentInstruction(state: LiveInterviewState): string {
    const probed = state.competencies.filter((c) => c.probe);
    const implicit = state.competencies.filter((c) => !c.probe);
    const describe = (c: { key: string; label: string; evidenceLooksLike: string }) => `  "${c.key}" (${c.label}) — real evidence looks like: ${c.evidenceLooksLike}`;
    return (
      '\n\nEVIDENCE ASSESSMENT (internal, returned as JSON alongside your reply — never spoken):\n' +
      'Assess what the candidate\'s LAST answer actually evidenced. Be strict: a confident delivery is not ' +
      'evidence, and a description of how one ought to do something is not evidence of having done it. Use ' +
      '"strong" only for specific, first-hand detail; "weak" for generalities; "conflicting" when it ' +
      'contradicts something they said earlier or something already on record about them.\n' +
      `Competencies under investigation:\n${probed.map(describe).join('\n')}\n` +
      (implicit.length
        ? `Also assess these from HOW they answered, every turn (never ask about them directly):\n${implicit.map(describe).join('\n')}\n`
        : '') +
      'Only include a competency the answer genuinely bears on — omit the rest rather than guessing.'
    );
  }

  /** Recruiter-facing read: the silent committee's actual reasoning during the interview. */
  async getDeliberation(kind: SessionKind, sessionId: string) {
    const state = await this.load(kind, sessionId);
    if (!state) return { competencies: [], deliberation: [], directives: [], overallConfidence: 0 };
    return {
      competencies: state.competencies,
      deliberation: state.deliberation,
      directives: state.directives,
      overallConfidence: overallConfidence(state),
    };
  }
}
