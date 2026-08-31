import { Injectable, Logger } from '@nestjs/common';
import type { CouncilStance, Recommendation } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AIService } from '../../ai/ai.service';
import { COUNCIL_AGENTS } from '../../hyrte/council/council-agents.config';

interface AgentResponse {
  stance?: CouncilStance;
  reasoning?: string;
  keyPoints?: string[];
  confidencePercent?: number;
  nextStepRecommendation?: string;
  citedEvidenceIds?: string[];
}

interface DiscussionResponse {
  entries?: { agentKey: string; statement: string; respondingToAgentKey?: string }[];
}

export interface ConveneResult {
  recommendation: Recommendation;
  confidencePercent: number | null;
  nextStepRecommendation: string | null;
}

const STANCE_SCORE: Record<CouncilStance, number> = { HIRE: 2, LEAN_HIRE: 1, LEAN_NO_HIRE: -1, NO_HIRE: -2 };
const VALID_STANCES = new Set<CouncilStance>(['HIRE', 'LEAN_HIRE', 'LEAN_NO_HIRE', 'NO_HIRE']);

/**
 * AI interviewer checklist / multi-agent panel doc — Ally's own Decision
 * Council, ported from HYRTE's proven DecisionCouncilService
 * (hyrte/council/decision-council.service.ts). Same 9 agents (COUNCIL_AGENTS
 * is reused directly, not duplicated), same "9 concurrent independent LLM
 * calls + one synthesis-discussion call" shape, same "the candidate never
 * sees this — only the recruiter, after the interview" design the doc
 * explicitly calls for. Deliberately NOT wired to AuditLogService/
 * HyrteAiAuditLog (FK'd to HyrteSession) — see schema.prisma's comment on
 * InterviewCouncilAgentReport for that scope cut.
 *
 * The one real difference from HYRTE's version: Evaluation.recommendation is
 * a strict Prisma enum (STRONG_HIRE..STRONG_NO_HIRE), not a free string, so
 * the deterministic vote-tally maps to that scale instead of HYRTE's
 * "Strong Fit"/"Fit"/"Weak Fit"/"Not a Fit". No Prediction Engine input yet
 * (HYRTE's Decision Cortex consumes one) — Decision Cortex here reasons from
 * the evidence brief and transcript alone, same as every other agent.
 */
@Injectable()
export class InterviewCouncilService {
  private readonly logger = new Logger(InterviewCouncilService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AIService,
  ) {}

  async convene(sessionId: string, brief: string, transcriptText: string): Promise<ConveneResult> {
    const agentResults = await Promise.all(
      COUNCIL_AGENTS.map(async (agent) => {
        try {
          const result = await this.ai.completeJson<AgentResponse>(
            [
              { role: 'system', content: this.buildAgentPrompt(agent) },
              { role: 'user', content: `${brief}\n\nFull interview transcript:\n${transcriptText}` },
            ],
            { temperature: 0.5, maxTokens: 400 },
          );
          return { agent, result };
        } catch (e) {
          this.logger.warn(`Council agent "${agent.key}" failed (session ${sessionId}): ${errMsg(e)}`);
          return { agent, result: {} as AgentResponse };
        }
      }),
    );

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

    await this.runDiscussion(sessionId, agentResults);

    const voters = agentResults.filter((r) => r.agent.votes && r.result.stance && VALID_STANCES.has(r.result.stance));
    const avg = voters.length
      ? voters.reduce((sum, r) => sum + STANCE_SCORE[r.result.stance as CouncilStance], 0) / voters.length
      : 0;
    const recommendation: Recommendation = avg >= 1.5 ? 'STRONG_HIRE' : avg >= 0.5 ? 'HIRE' : avg >= -0.5 ? 'LEAN_HIRE' : avg >= -1.5 ? 'NO_HIRE' : 'STRONG_NO_HIRE';

    const cortex = agentResults.find((r) => r.agent.key === 'decisionCortex')?.result;
    const confidencePercent =
      typeof cortex?.confidencePercent === 'number' ? Math.max(0, Math.min(100, Math.round(cortex.confidencePercent))) : null;
    const nextStepRecommendation = cortex?.nextStepRecommendation ?? null;

    return { recommendation, confidencePercent, nextStepRecommendation };
  }

  private buildAgentPrompt(agent: (typeof COUNCIL_AGENTS)[number]): string {
    const citedEvidenceField =
      '"citedEvidenceIds": string[] (short quoted excerpts from the evidence brief/transcript your reasoning ' +
      'is actually grounded in; empty array if none apply)';
    const responseShape = agent.votes
      ? `{"stance": "HIRE"|"LEAN_HIRE"|"LEAN_NO_HIRE"|"NO_HIRE", "reasoning": string (2-3 sentences, ` +
        `evidence-grounded, plain English — no jargon), "keyPoints": string[] (2-3 short evidence citations), ` +
        `${citedEvidenceField}}`
      : agent.key === 'decisionCortex'
        ? `{"reasoning": string (2-3 sentences), "keyPoints": string[] (missing signals or evidence gaps), ` +
          `"confidencePercent": int (0-100), "nextStepRecommendation": string (one short phrase, e.g. ` +
          `"proceed to next round" | "targeted follow-up on X" | "additional interview recommended"), ` +
          `${citedEvidenceField}}`
        : `{"reasoning": string (2-3 sentences), "keyPoints": string[] (2-3 specific findings per your mandate), ` +
          `${citedEvidenceField}}`;

    return (
      `You are the "${agent.name}" on a hiring decision committee reviewing a candidate's interview. Your ` +
      `mandate: ${agent.mandate} You are one of several committee members working independently — you have ` +
      'not seen the others\' notes yet. Ground everything in the evidence brief and transcript below; never ' +
      'invent a claim not supported by them. Other committee members are separately assessing execution/' +
      'ownership, role-specific technical depth, collaboration/coachability, and long-term growth potential — ' +
      'stay strictly inside YOUR mandate above rather than restating a generic reliability/communication ' +
      "concern every member could equally make; if the evidence's most obvious angle belongs to someone " +
      "else's mandate, find the specific angle on it that only your mandate would surface, or say plainly " +
      "that this evidence doesn't speak to your mandate rather than repeating another agent's likely " +
      `conclusion. Return ONLY JSON: ${responseShape}.`
    );
  }

  private async runDiscussion(
    sessionId: string,
    agentResults: { agent: (typeof COUNCIL_AGENTS)[number]; result: AgentResponse }[],
  ): Promise<void> {
    const summary = agentResults
      .map(({ agent, result }) => `${agent.name}${result.stance ? ` [${result.stance}]` : ''}: ${result.reasoning ?? '(no response)'}`)
      .join('\n');

    try {
      const result = await this.ai.completeJson<DiscussionResponse>(
        [
          {
            role: 'system',
            content:
              'You are simulating a hiring committee\'s discussion from their individual notes below. Devil\'s ' +
              "Advocate should challenge at least one specific voter's conclusion by name; Bias Auditor should " +
              'flag a pattern in the reasoning if one exists (or explicitly say it found none); Evidence Auditor ' +
              'should flag any claim not clearly evidence-backed (or say it found none); at least one voting ' +
              'agent should respond to a challenge. Return ONLY JSON: {"entries": [{"agentKey": string (one of: ' +
              `${COUNCIL_AGENTS.map((a) => a.key).join(', ')}), "statement": string (1-2 sentences), ` +
              '"respondingToAgentKey": string (optional, another agentKey this is responding to)}] (5-7 entries).',
          },
          { role: 'user', content: summary },
        ],
        { temperature: 0.6, maxTokens: 900 },
      );

      const validKeys = new Set(COUNCIL_AGENTS.map((a) => a.key));
      const entries = (result.entries ?? []).filter((e) => validKeys.has(e.agentKey)).slice(0, 8);

      await this.prisma.interviewCouncilDiscussionEntry.deleteMany({ where: { sessionId } });
      if (entries.length > 0) {
        await this.prisma.interviewCouncilDiscussionEntry.createMany({
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

  async getReport(sessionId: string) {
    const [agentReports, discussion] = await Promise.all([
      this.prisma.interviewCouncilAgentReport.findMany({ where: { sessionId }, orderBy: { createdAt: 'asc' } }),
      this.prisma.interviewCouncilDiscussionEntry.findMany({ where: { sessionId }, orderBy: { ordinal: 'asc' } }),
    ]);
    return { agentReports, discussion };
  }
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
