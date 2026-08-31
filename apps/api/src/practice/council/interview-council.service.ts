import { Injectable } from '@nestjs/common';
import type { Recommendation } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CouncilCoreService, PredictionEntry, VALID_STANCES } from '../../council-shared/council-core.service';

export interface ConveneResult {
  recommendation: Recommendation;
  confidencePercent: number | null;
  nextStepRecommendation: string | null;
  predictions: PredictionEntry[];
}

/**
 * AI interviewer checklist / multi-agent panel doc — Ally's own Decision
 * Council. The actual 9-agent orchestration (prompt construction, concurrent
 * calls, discussion synthesis) lives in the shared CouncilCoreService — this
 * class is now the Ally-specific adapter on top, mirroring HYRTE's
 * DecisionCouncilService (hyrte/council/decision-council.service.ts): same
 * 9 agents (COUNCIL_AGENTS, shared not duplicated), same "9 concurrent
 * independent LLM calls + one synthesis-discussion call" shape, same "the
 * candidate never sees this — only the recruiter, after the interview"
 * design the doc explicitly calls for. Deliberately NOT wired to
 * AuditLogService/HyrteAiAuditLog (FK'd to HyrteSession) — see
 * schema.prisma's comment on InterviewCouncilAgentReport for that scope cut.
 *
 * Two real differences from HYRTE's adapter remain, both by necessity rather
 * than duplication: Evaluation.recommendation is a strict Prisma enum
 * (STRONG_HIRE..STRONG_NO_HIRE), not a free string, so the vote tally maps to
 * that scale instead of HYRTE's "Strong Fit"/"Fit"/"Weak Fit"/"Not a Fit".
 * And Ally has no separate Prediction Engine (HYRTE's is fed by a Decision
 * Graph accumulated over a simulated workday, which Ally sessions don't
 * have) — CouncilCoreService's "generate" prediction mode has Decision
 * Cortex produce the same {dimension, likelihood, reasoning}[] shape
 * directly as part of its own single call instead.
 */
@Injectable()
export class InterviewCouncilService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly core: CouncilCoreService,
  ) {}

  async convene(sessionId: string, brief: string, transcriptText: string): Promise<ConveneResult> {
    const agentResults = await this.core.runAgents({
      contextId: `session ${sessionId}`,
      brief,
      transcriptText,
      predictionMode: 'generate',
    });

    await Promise.all(
      agentResults.map(({ agent, result }) =>
        this.prisma.interviewCouncilAgentReport.upsert({
          where: { sessionId_agentKey: { sessionId, agentKey: agent.key } },
          create: {
            sessionId,
            agentKey: agent.key,
            agentName: agent.name,
            stance: agent.votes && result.stance && VALID_STANCES.has(result.stance) ? result.stance : null,
            reasoning: result.reasoning ?? '(no response)',
            keyPoints: result.keyPoints ?? [],
            citedEvidenceIds: result.citedEvidenceIds ?? [],
          },
          update: {
            stance: agent.votes && result.stance && VALID_STANCES.has(result.stance) ? result.stance : null,
            reasoning: result.reasoning ?? '(no response)',
            keyPoints: result.keyPoints ?? [],
            citedEvidenceIds: result.citedEvidenceIds ?? [],
          },
        }),
      ),
    );

    const entries = await this.core.runDiscussion({ contextId: `session ${sessionId}`, agentResults });
    await this.prisma.interviewCouncilDiscussionEntry.deleteMany({ where: { sessionId } });
    if (entries.length > 0) {
      await this.prisma.interviewCouncilDiscussionEntry.createMany({
        data: entries.map((e, i) => ({ sessionId, ...e, ordinal: i })),
      });
    }

    const { avg } = this.core.tallyVotes(agentResults);
    const recommendation: Recommendation =
      avg >= 1.5 ? 'STRONG_HIRE' : avg >= 0.5 ? 'HIRE' : avg >= -0.5 ? 'LEAN_HIRE' : avg >= -1.5 ? 'NO_HIRE' : 'STRONG_NO_HIRE';

    const cortex = this.core.getCortexResult(agentResults);
    const confidencePercent =
      typeof cortex?.confidencePercent === 'number' ? Math.max(0, Math.min(100, Math.round(cortex.confidencePercent))) : null;
    const nextStepRecommendation = cortex?.nextStepRecommendation ?? null;
    const predictions = Array.isArray(cortex?.predictions)
      ? cortex.predictions.filter((p): p is PredictionEntry => Boolean(p?.dimension && p?.likelihood)).slice(0, 6)
      : [];

    return { recommendation, confidencePercent, nextStepRecommendation, predictions };
  }

  async getReport(sessionId: string) {
    const [agentReports, discussion] = await Promise.all([
      this.prisma.interviewCouncilAgentReport.findMany({ where: { sessionId }, orderBy: { createdAt: 'asc' } }),
      this.prisma.interviewCouncilDiscussionEntry.findMany({ where: { sessionId }, orderBy: { ordinal: 'asc' } }),
    ]);
    return { agentReports, discussion };
  }
}
