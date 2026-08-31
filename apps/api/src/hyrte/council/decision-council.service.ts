import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../dig/audit-log.service';
import { CouncilCoreService, AgentResponse, PredictionEntry, VALID_STANCES } from '../../council-shared/council-core.service';

interface EvidenceRef {
  label: string;
  id: string;
}

export type { PredictionEntry };

export interface ConveneResult {
  recommendation: string; // matches HyrteInterviewReport.recommendation's existing "Strong Fit"|"Fit"|"Weak Fit"|"Not a Fit" scale
  confidencePercent: number | null;
  nextStepRecommendation: string | null;
}

/**
 * §6 Decision Council. Runs after the reflection interview's own evidence-
 * grounded synthesis (`HyrteInterviewService.generateReport`) — that call
 * already produces the candidate-facing strengths/developmentAreas/
 * contradictions/summary/evidenceTrail; this service adds the recruiter-
 * facing depth on top and computes `recommendation` deterministically from
 * the committee's actual votes instead of a single LLM's guess.
 *
 * The actual 9-agent orchestration (prompt construction, concurrent calls,
 * discussion synthesis) lives in the shared CouncilCoreService — this class
 * is now the HYRTE-specific adapter on top: audit-logging every call (§8),
 * resolving citedEvidenceIds against the real evidence-brief refs, and
 * persisting to HYRTE's own tables / recommendation scale.
 *
 * §6.4/Decision Cortex note (resolved): the doc's instruction is for Decision
 * Cortex to be a *consumer* of the DIG's Prediction Engine rather than
 * computing predicted success independently. `HyrteInterviewService.
 * generateReport` now runs `ReportIntelligenceService.compute()` (the
 * Prediction Engine, Phase 7) BEFORE calling `convene()`, and passes the
 * resulting `predictions` in here — CouncilCoreService's "consume" mode gives
 * Decision Cortex that data directly instead of letting it estimate.
 */
@Injectable()
export class DecisionCouncilService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly core: CouncilCoreService,
    private readonly auditLog: AuditLogService,
  ) {}

  async convene(
    sessionId: string,
    brief: string,
    transcriptText: string,
    predictions: PredictionEntry[] = [],
    evidenceRefs: EvidenceRef[] = [],
  ): Promise<ConveneResult> {
    const refsByLabel = new Map(evidenceRefs.map((r) => [r.label, r.id]));
    const predictionsText = predictions.length
      ? predictions.map((p) => `- ${p.dimension}: ${p.likelihood} — ${p.reasoning}`).join('\n')
      : null;

    // §8 — every agent call is audit-logged (success/failure/duration),
    // independent of what it concluded. This is how "did the Bias Auditor
    // actually run for this session" gets answered later.
    const agentResults = await this.core.runAgents({
      contextId: `session ${sessionId}`,
      brief,
      transcriptText,
      predictionMode: 'consume',
      predictionsText,
      callWrapper: (agentKey, fn) => this.auditLog.run(sessionId, `council.${agentKey}`, fn),
    });

    await Promise.all(
      agentResults.map(({ agent, result }) => {
        // Never trust the LLM's citation as a real id directly — it only ever
        // sees EVn labels, so resolve those against the same refs map the
        // evidence brief was built from. Anything that doesn't resolve
        // (hallucinated label) is silently dropped rather than stored.
        const citedEvidenceIds = [...new Set(result.citedEvidenceIds ?? [])]
          .map((label) => refsByLabel.get(label))
          .filter((id): id is string => Boolean(id));
        return this.prisma.hyrteCouncilAgentReport.upsert({
          where: { sessionId_agentKey: { sessionId, agentKey: agent.key } },
          create: {
            sessionId,
            agentKey: agent.key,
            agentName: agent.name,
            stance: resolveStance(agent, result),
            reasoning: result.reasoning ?? '(no response)',
            keyPoints: result.keyPoints ?? [],
            citedEvidenceIds,
          },
          update: {
            stance: resolveStance(agent, result),
            reasoning: result.reasoning ?? '(no response)',
            keyPoints: result.keyPoints ?? [],
            citedEvidenceIds,
          },
        });
      }),
    );

    const entries = await this.core.runDiscussion({
      contextId: `session ${sessionId}`,
      agentResults,
      callWrapper: (fn) => this.auditLog.run(sessionId, 'council.discussion', fn),
    });
    await this.prisma.hyrteCouncilDiscussionEntry.deleteMany({ where: { sessionId } });
    if (entries.length > 0) {
      await this.prisma.hyrteCouncilDiscussionEntry.createMany({
        data: entries.map((e, i) => ({ sessionId, ...e, ordinal: i })),
      });
    }

    // Deterministic vote tally — more defensible than asking an LLM to "tally
    // the votes," and matches the doc's own "Decision Cortex... predicted
    // success... derived from patterns... not from a single rubric" framing.
    const { avg } = this.core.tallyVotes(agentResults);
    const recommendation = avg >= 1.5 ? 'Strong Fit' : avg >= 0.25 ? 'Fit' : avg >= -1 ? 'Weak Fit' : 'Not a Fit';

    const cortex = this.core.getCortexResult(agentResults);
    const confidencePercent =
      typeof cortex?.confidencePercent === 'number' ? Math.max(0, Math.min(100, Math.round(cortex.confidencePercent))) : null;
    const nextStepRecommendation = cortex?.nextStepRecommendation ?? null;

    await this.prisma.hyrteInterviewReport.update({
      where: { sessionId },
      data: { recommendation, confidencePercent, nextStepRecommendation },
    });

    return { recommendation, confidencePercent, nextStepRecommendation };
  }
}

function resolveStance(agent: { votes: boolean }, result: AgentResponse) {
  return agent.votes && result.stance && VALID_STANCES.has(result.stance) ? result.stance : null;
}
