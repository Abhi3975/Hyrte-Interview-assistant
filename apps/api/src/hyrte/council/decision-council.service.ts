import { Injectable, Logger } from '@nestjs/common';
import type { CouncilStance } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AIService } from '../../ai/ai.service';
import { AuditLogService } from '../dig/audit-log.service';
import { COUNCIL_AGENTS } from './council-agents.config';

interface AgentResponse {
  stance?: CouncilStance;
  reasoning?: string;
  keyPoints?: string[];
  confidencePercent?: number;
  nextStepRecommendation?: string;
  citedEvidenceIds?: string[];
}

interface EvidenceRef {
  label: string;
  id: string;
}

/** Shape of one Prediction Engine entry (see ReportIntelligenceService) — duplicated here to avoid a cross-module type import for one small interface. */
export interface PredictionEntry {
  dimension: string;
  likelihood: string;
  reasoning: string;
}

interface DiscussionResponse {
  entries?: { agentKey: string; statement: string; respondingToAgentKey?: string }[];
}

const STANCE_SCORE: Record<CouncilStance, number> = { HIRE: 2, LEAN_HIRE: 1, LEAN_NO_HIRE: -1, NO_HIRE: -2 };
const VALID_STANCES = new Set<CouncilStance>(['HIRE', 'LEAN_HIRE', 'LEAN_NO_HIRE', 'NO_HIRE']);

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
 * The 9 agents run as 9 concurrent LLM calls (`Promise.all`), each seeing the
 * same evidence brief + transcript but reasoning through its own mandate —
 * "independently and simultaneously," per §6.3.1, not one call with a persona
 * list appended. The discussion layer (§6.3.2) is a single synthesis call
 * over the 9 outputs rather than genuine multi-turn agent-to-agent calls —
 * an explicit, documented scope cut for cost/latency (see ARCHITECTURE.md).
 *
 * §6.4/Decision Cortex note (resolved): the doc's instruction is for Decision
 * Cortex to be a *consumer* of the DIG's Prediction Engine rather than
 * computing predicted success independently. `HyrteInterviewService.
 * generateReport` now runs `ReportIntelligenceService.compute()` (the
 * Prediction Engine, Phase 7) BEFORE calling `convene()`, and passes the
 * resulting `predictions` in here — the Decision Cortex agent's prompt is
 * given that data directly and told to derive `confidencePercent` /
 * `nextStepRecommendation` from it, not estimate independently. The other 8
 * agents are unaffected; only Decision Cortex's mandate involves predicted
 * success.
 */
@Injectable()
export class DecisionCouncilService {
  private readonly logger = new Logger(DecisionCouncilService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AIService,
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

    const agentResults = await Promise.all(
      COUNCIL_AGENTS.map(async (agent) => {
        try {
          // §8 — every agent call is audit-logged (success/failure/duration),
          // independent of what it concluded. This is how "did the Bias
          // Auditor actually run for this session" gets answered later.
          const userContent =
            agent.key === 'decisionCortex' && predictionsText
              ? `${brief}\n\nFull interview transcript:\n${transcriptText}\n\n` +
                `Prediction Engine output (§3.5 — derive your confidencePercent and ` +
                `nextStepRecommendation from this, do not estimate independently):\n${predictionsText}`
              : `${brief}\n\nFull interview transcript:\n${transcriptText}`;
          const result = await this.auditLog.run(sessionId, `council.${agent.key}`, () =>
            this.ai.completeJson<AgentResponse>(
              [
                { role: 'system', content: this.buildAgentPrompt(agent, Boolean(agent.key === 'decisionCortex' && predictionsText)) },
                { role: 'user', content: userContent },
              ],
              { temperature: 0.5, maxTokens: 400 },
            ),
          );
          return { agent, result };
        } catch (e) {
          this.logger.warn(`Council agent "${agent.key}" failed (session ${sessionId}): ${errMsg(e)}`);
          return { agent, result: {} as AgentResponse };
        }
      }),
    );

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
            stance: agent.votes && result.stance && VALID_STANCES.has(result.stance) ? result.stance : null,
            reasoning: result.reasoning ?? '(no response)',
            keyPoints: result.keyPoints ?? [],
            citedEvidenceIds,
          },
          update: {
            stance: agent.votes && result.stance && VALID_STANCES.has(result.stance) ? result.stance : null,
            reasoning: result.reasoning ?? '(no response)',
            keyPoints: result.keyPoints ?? [],
            citedEvidenceIds,
          },
        });
      }),
    );

    await this.runDiscussion(sessionId, agentResults);

    // Deterministic vote tally — more defensible than asking an LLM to "tally
    // the votes," and matches the doc's own "Decision Cortex... predicted
    // success... derived from patterns... not from a single rubric" framing.
    const voters = agentResults.filter((r) => r.agent.votes && r.result.stance && VALID_STANCES.has(r.result.stance));
    const avg = voters.length
      ? voters.reduce((sum, r) => sum + STANCE_SCORE[r.result.stance as CouncilStance], 0) / voters.length
      : 0;
    const recommendation = avg >= 1.5 ? 'Strong Fit' : avg >= 0.25 ? 'Fit' : avg >= -1 ? 'Weak Fit' : 'Not a Fit';

    const cortex = agentResults.find((r) => r.agent.key === 'decisionCortex')?.result;
    const confidencePercent =
      typeof cortex?.confidencePercent === 'number' ? Math.max(0, Math.min(100, Math.round(cortex.confidencePercent))) : null;
    const nextStepRecommendation = cortex?.nextStepRecommendation ?? null;

    await this.prisma.hyrteInterviewReport.update({
      where: { sessionId },
      data: { recommendation, confidencePercent, nextStepRecommendation },
    });

    return { recommendation, confidencePercent, nextStepRecommendation };
  }

  private buildAgentPrompt(agent: (typeof COUNCIL_AGENTS)[number], hasPredictions = false): string {
    const citedEvidenceField =
      '"citedEvidenceIds": string[] (the EVn labels from the evidence brief above that your reasoning is ' +
      'actually grounded in — e.g. ["EV2","EV5"]; at least one if any evidence brief entries exist; never a ' +
      "label you didn't see in the brief)";
    const responseShape = agent.votes
      ? `{"stance": "HIRE"|"LEAN_HIRE"|"LEAN_NO_HIRE"|"NO_HIRE", "reasoning": string (2-3 sentences, ` +
        `evidence-grounded, plain English — no jargon), "keyPoints": string[] (2-3 short evidence citations), ` +
        `${citedEvidenceField}}`
      : agent.key === 'decisionCortex'
        ? `{"reasoning": string (2-3 sentences), "keyPoints": string[] (missing signals or evidence gaps), ` +
          `"confidencePercent": int (0-100), "nextStepRecommendation": string (one short phrase, e.g. ` +
          `"proceed to next round" | "targeted follow-up on X" | "additional simulation recommended"), ` +
          `${citedEvidenceField}}`
        : `{"reasoning": string (2-3 sentences), "keyPoints": string[] (2-3 specific findings per your mandate), ` +
          `${citedEvidenceField}}`;

    // §6.4 (resolved) — Decision Cortex consumes the DIG's Prediction Engine
    // instead of estimating predicted success independently, when it's
    // available (it's computed earlier in the same report-generation flow).
    const cortexDirective =
      agent.key === 'decisionCortex' && hasPredictions
        ? ' A Prediction Engine output is included below — derive confidencePercent as a reasoned ' +
          "synthesis of those per-dimension likelihoods weighted toward this candidate's actual target " +
          'role/environment, and keep nextStepRecommendation consistent with what those predictions show. ' +
          'Do not produce a confidence number that contradicts the Prediction Engine data.'
        : '';

    return (
      `You are the "${agent.name}" on a hiring decision committee reviewing a candidate's workplace ` +
      `simulation and reflection interview. Your mandate: ${agent.mandate}${cortexDirective} ` +
      'You are one of several committee members working independently — you have not seen the others\' ' +
      'notes yet. Ground everything in the evidence brief and transcript below; never invent a claim not ' +
      'supported by them. Other committee members are separately assessing execution/ownership, ' +
      'role-specific technical depth, collaboration/coachability, and long-term growth potential — stay ' +
      'strictly inside YOUR mandate above rather than restating a generic reliability/communication concern ' +
      "every member could equally make; if the evidence's most obvious angle belongs to someone else's " +
      "mandate, find the specific angle on it that only your mandate would surface, or say plainly that " +
      "this evidence doesn't speak to your mandate rather than repeating another agent's likely conclusion. " +
      `Return ONLY JSON: ${responseShape}.`
    );
  }

  private async runDiscussion(
    sessionId: string,
    agentResults: { agent: (typeof COUNCIL_AGENTS)[number]; result: AgentResponse }[],
  ): Promise<void> {
    const summary = agentResults
      .map(
        ({ agent, result }) =>
          `${agent.name}${result.stance ? ` [${result.stance}]` : ''}: ${result.reasoning ?? '(no response)'}`,
      )
      .join('\n');

    try {
      const result = await this.auditLog.run(sessionId, 'council.discussion', () =>
        this.ai.completeJson<DiscussionResponse>(
          [
            {
              role: 'system',
              content:
                'You are simulating a hiring committee\'s discussion (§6.3.2) from their individual notes below. ' +
                "Devil's Advocate should challenge at least one specific voter's conclusion by name; Bias Auditor " +
                'should flag a pattern in the reasoning if one exists (or explicitly say it found none); Evidence ' +
                'Auditor should flag any claim not clearly evidence-backed (or say it found none); at least one ' +
                'voting agent should respond to a challenge. Return ONLY JSON: {"entries": [{"agentKey": string ' +
                `(one of: ${COUNCIL_AGENTS.map((a) => a.key).join(', ')}), "statement": string (1-2 sentences), ` +
                '"respondingToAgentKey": string (optional, another agentKey this is responding to)}] (5-7 entries).',
            },
            { role: 'user', content: summary },
          ],
          { temperature: 0.6, maxTokens: 900 },
        ),
      );

      const validKeys = new Set(COUNCIL_AGENTS.map((a) => a.key));
      const entries = (result.entries ?? []).filter((e) => validKeys.has(e.agentKey)).slice(0, 8);

      await this.prisma.hyrteCouncilDiscussionEntry.deleteMany({ where: { sessionId } });
      if (entries.length > 0) {
        await this.prisma.hyrteCouncilDiscussionEntry.createMany({
          data: entries.map((e, i) => ({
            sessionId,
            agentKey: e.agentKey,
            statement: e.statement,
            respondingToAgentKey: validKeys.has(e.respondingToAgentKey ?? '') ? e.respondingToAgentKey : null,
            ordinal: i,
          })),
        });
      }
    } catch (e) {
      this.logger.warn(`Council discussion synthesis failed (session ${sessionId}): ${errMsg(e)}`);
    }
  }
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
