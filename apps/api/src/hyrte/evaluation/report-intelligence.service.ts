import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AIService } from '../../ai/ai.service';
import { DecisionGraphService } from '../dig/decision-graph.service';
import { JobSuccessModelService } from '../dig/job-success-model.service';
import { AuditLogService } from '../dig/audit-log.service';
import { getCultureWeights } from '../dig/culture-weights';
import { DECISION_DNA_TRAITS, METRIC_BUCKETS } from './evaluation-metrics';

interface DnaRecoveryResponse {
  decisionDNA?: { traits?: string[]; reasoning?: string };
  recoveryScore?: { score?: number; descriptor?: string; reasoning?: string };
  counterfactuals?: { decisionPoint: string; alternativePath: string; projectedOutcome: string }[];
}

interface PredictionMetricsResponse {
  predictions?: { dimension: string; likelihood: string; reasoning: string }[];
  metricsBreakdown?: { bucket: string; score: number; explanation: string }[];
}

/**
 * §7 / §3.5 Phase 7 — Decision DNA, Recovery Score, Counterfactual Analysis,
 * the Prediction Engine, and the shared metrics framework, all built as
 * read-models over data already collected in Phases 1-6 (the Decision Graph,
 * Evidence Graph, and Council output) — no new data collection, per the
 * doc's own framing for this phase.
 *
 * Runs as two LLM calls (not five) — Decision DNA/Recovery/Counterfactuals
 * share the same "look at the decision pattern" lens, and
 * Predictions/Metrics share the same "look at role fit + culture weighting"
 * lens, so grouping them keeps this from adding 5 more sequential calls on
 * top of the Council's already-heavy 9+1 to every interview completion.
 */
@Injectable()
export class ReportIntelligenceService {
  private readonly logger = new Logger(ReportIntelligenceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AIService,
    private readonly decisionGraph: DecisionGraphService,
    private readonly jobSuccessModel: JobSuccessModelService,
    private readonly auditLog: AuditLogService,
  ) {}

  /**
   * Returns the computed predictions (in addition to persisting everything)
   * so the caller can hand them to the Decision Council's Decision Cortex
   * agent — closing the doc's "Decision Cortex should consume the DIG's
   * Prediction Engine instead of computing predicted success independently"
   * loop (deferred in Phase 6, resolved here — see
   * `HyrteInterviewService.generateReport`).
   */
  async compute(
    sessionId: string,
    brief: string,
    transcriptText: string,
  ): Promise<{ predictions: PredictionMetricsResponse['predictions'] }> {
    const session = await this.prisma.hyrteSession.findUnique({ where: { id: sessionId } });
    if (!session) return { predictions: [] };

    const decisionNodes = await this.decisionGraph.getGraph(sessionId);
    // Part F9 workflow signals — `payload` carries the structured bits
    // (workItemId, latencyMs, note, decision) for the newer
    // command_bar.*/work_item.review_* action types; rendering only
    // actionType/reasoning/outcome silently dropped them.
    const decisionSummary = decisionNodes.length
      ? decisionNodes
          .map((n) => {
            const payload = n.payload && typeof n.payload === 'object' && Object.keys(n.payload as object).length > 0 ? ` [${JSON.stringify(n.payload)}]` : '';
            return `- ${n.actionType}${payload}${n.reasoning ? ` (reasoning: ${n.reasoning})` : ''}${n.outcome ? ` → outcome: ${n.outcome}` : ''}`;
          })
          .join('\n')
      : '(no decision graph nodes recorded)';

    const [dnaRecovery, jobSuccessModel] = await Promise.all([
      this.auditLog.run(sessionId, 'reportIntelligence.dnaRecovery', () =>
        this.computeDnaRecovery(session.companyName, brief, transcriptText, decisionSummary),
      ),
      this.ensureJobSuccessModel(sessionId),
    ]);

    const predictionMetrics = await this.auditLog.run(sessionId, 'reportIntelligence.predictionsMetrics', () =>
      this.computePredictionsAndMetrics(
        session.culture,
        session.difficulty,
        jobSuccessModel,
        brief,
        transcriptText,
        dnaRecovery.decisionDNA,
      ),
    );

    await this.prisma.hyrteInterviewReport.update({
      where: { sessionId },
      data: {
        decisionDNA: (dnaRecovery.decisionDNA ?? null) as unknown as Prisma.InputJsonValue,
        recoveryScore: (dnaRecovery.recoveryScore ?? null) as unknown as Prisma.InputJsonValue,
        counterfactuals: (dnaRecovery.counterfactuals ?? []) as unknown as Prisma.InputJsonValue,
        predictions: (predictionMetrics.predictions ?? []) as unknown as Prisma.InputJsonValue,
        metricsBreakdown: (predictionMetrics.metricsBreakdown ?? []) as unknown as Prisma.InputJsonValue,
      },
    });

    return { predictions: predictionMetrics.predictions ?? [] };
  }

  private async computeDnaRecovery(
    companyName: string,
    brief: string,
    transcriptText: string,
    decisionSummary: string,
  ): Promise<{
    decisionDNA?: { traits: string[]; reasoning: string };
    recoveryScore?: { score: number; descriptor: string; reasoning: string };
    counterfactuals?: { decisionPoint: string; alternativePath: string; projectedOutcome: string }[];
  }> {
    try {
      const result = await this.ai.completeJson<DnaRecoveryResponse>(
        [
          {
            role: 'system',
            content:
              'You are computing three read-models over a candidate\'s workplace-simulation decision graph ' +
              `at ${companyName}. ` +
              '(1) Decision DNA (§3.5): infer 2-3 dominant decision-making traits from REPEATED behavior — ' +
              `choose ONLY from this fixed vocabulary: ${DECISION_DNA_TRAITS.join(', ')}. Never invent a ` +
              'trait outside this list, and never infer from self-report — only from the decision pattern ' +
              'below. (2) Recovery Score (§3.5): based on how the candidate handled being confronted with a ' +
              'contradiction or mistake during the interview (acknowledged vs. deflected, took ownership vs. ' +
              'blamed, quality of their stated recovery plan) — score 0-100, this is a proxy computed from ' +
              'interview-confrontation moments specifically, not general competence. (3) Counterfactual ' +
              'Analysis (§3.5): pick 1-2 real decision points from the decision graph below and narrate a ' +
              'plausible alternative path and its likely outcome — this is a reasoned narrative, not a ' +
              'literal re-simulation. Return ONLY JSON: {"decisionDNA": {"traits": string[], "reasoning": ' +
              'string}, "recoveryScore": {"score": int, "descriptor": string (e.g. "Strong recovery", ' +
              '"Limited recovery"), "reasoning": string}, "counterfactuals": [{"decisionPoint": string, ' +
              '"alternativePath": string, "projectedOutcome": string}]}. Every reasoning field must be ' +
              'plain English a non-technical reader can follow — never a bare label with no explanation.',
          },
          {
            role: 'user',
            content: `${brief}\n\nDecision graph:\n${decisionSummary}\n\nInterview transcript:\n${transcriptText}`,
          },
        ],
        { temperature: 0.5, maxTokens: 900 },
      );

      const traits = (result.decisionDNA?.traits ?? []).filter((t) =>
        (DECISION_DNA_TRAITS as readonly string[]).includes(t),
      );

      return {
        decisionDNA: traits.length
          ? { traits, reasoning: result.decisionDNA?.reasoning ?? '' }
          : undefined,
        recoveryScore: result.recoveryScore?.score !== undefined
          ? {
              score: Math.max(0, Math.min(100, Math.round(result.recoveryScore.score))),
              descriptor: result.recoveryScore.descriptor ?? '',
              reasoning: result.recoveryScore.reasoning ?? '',
            }
          : undefined,
        counterfactuals: result.counterfactuals?.slice(0, 2) ?? [],
      };
    } catch (e) {
      this.logger.warn(`computeDnaRecovery failed: ${errMsg(e)}`);
      return {};
    }
  }

  private async computePredictionsAndMetrics(
    culture: string,
    difficulty: string,
    jobSuccessModel: { coreOutcomes: string[]; capabilityRequirements: unknown } | null,
    brief: string,
    transcriptText: string,
    decisionDNA?: { traits: string[]; reasoning: string },
  ): Promise<{ predictions: PredictionMetricsResponse['predictions']; metricsBreakdown: PredictionMetricsResponse['metricsBreakdown'] }> {
    const weights = getCultureWeights(culture);
    const dnaText = decisionDNA?.traits.length ? decisionDNA.traits.join(', ') : '(not computed)';
    const jsmText = jobSuccessModel
      ? `Core outcomes: ${jobSuccessModel.coreOutcomes.join(', ')}. Capability requirements: ${JSON.stringify(jobSuccessModel.capabilityRequirements)}.`
      : '(no job success model available)';

    try {
      const result = await this.ai.completeJson<PredictionMetricsResponse>(
        [
          {
            role: 'system',
            content:
              'You are computing two more read-models. (1) Prediction Engine (§3.5): output 4-6 ' +
              'success-likelihood predictions across different environments/role-shapes (e.g. "Startup ' +
              'environments", "Enterprise environments", "Individual contributor role", "Leadership role", ' +
              '"High-ambiguity environments", "Customer-facing roles") — each a qualitative-plus-percentage ' +
              'likelihood (e.g. "Strong (78%)") with one-sentence grounded reasoning, derived from the ' +
              "candidate's Decision DNA and the job success model below, NOT a single fixed rubric. (2) " +
              `Shared Metrics Framework (§7): score these exact ${METRIC_BUCKETS.length} buckets 0-100: ` +
              `${METRIC_BUCKETS.join(', ')}. Weight your interpretation by this company culture's emphasis ` +
              `(0-2 scale per dimension, 1.0 = neutral): ${JSON.stringify(weights)} — e.g. if ` +
              'stakeholderManagement is weighted high, weigh Behavioral evidence about stakeholder handling ' +
              'more heavily in that bucket\'s score. Difficulty tier: ' +
              `${difficulty}. Return ONLY JSON: {"predictions": [{"dimension": string, "likelihood": string, ` +
              '"reasoning": string}], "metricsBreakdown": [{"bucket": string (must be one of the exact bucket ' +
              'names given), "score": int, "explanation": string}]}. Every score MUST ship with a ' +
              'plain-language explanation — never a bare number.',
          },
          {
            role: 'user',
            content:
              `Decision DNA: ${dnaText}\n\nJob Success Model: ${jsmText}\n\n${brief}\n\n` +
              `Interview transcript:\n${transcriptText}`,
          },
        ],
        { temperature: 0.5, maxTokens: 1200 },
      );

      const validBuckets = new Set<string>(METRIC_BUCKETS);
      return {
        predictions: (result.predictions ?? []).slice(0, 6),
        metricsBreakdown: (result.metricsBreakdown ?? []).filter((m) => validBuckets.has(m.bucket)).slice(0, METRIC_BUCKETS.length),
      };
    } catch (e) {
      this.logger.warn(`computePredictionsAndMetrics failed: ${errMsg(e)}`);
      return { predictions: [], metricsBreakdown: [] };
    }
  }

  /** Job Success Model was built in Phase 1 but never auto-triggered anywhere — this is its first real caller. */
  private async ensureJobSuccessModel(sessionId: string) {
    try {
      return await this.jobSuccessModel.getForSession(sessionId);
    } catch (e) {
      if (!(e instanceof NotFoundException)) throw e;
      try {
        return await this.jobSuccessModel.generateForSession(sessionId);
      } catch (genErr) {
        this.logger.warn(`Job Success Model generation failed (session ${sessionId}): ${errMsg(genErr)}`);
        return null;
      }
    }
  }
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
