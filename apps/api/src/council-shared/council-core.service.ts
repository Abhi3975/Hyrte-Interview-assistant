import { Injectable, Logger } from '@nestjs/common';
import type { CouncilStance } from '@prisma/client';
import { AIService } from '../ai/ai.service';
import { COUNCIL_AGENTS, CouncilAgentDef } from './council-agents.config';

export interface PredictionEntry {
  dimension: string;
  likelihood: string;
  reasoning: string;
}

export interface AgentResponse {
  stance?: CouncilStance;
  reasoning?: string;
  keyPoints?: string[];
  confidencePercent?: number;
  nextStepRecommendation?: string;
  predictions?: PredictionEntry[];
  citedEvidenceIds?: string[];
}

export interface AgentResult {
  agent: CouncilAgentDef;
  result: AgentResponse;
}

export interface DiscussionEntryResult {
  agentKey: string;
  statement: string;
  respondingToAgentKey: string | null;
}

interface DiscussionResponse {
  entries?: { agentKey: string; statement: string; respondingToAgentKey?: string }[];
}

export const STANCE_SCORE: Record<CouncilStance, number> = { HIRE: 2, LEAN_HIRE: 1, LEAN_NO_HIRE: -1, NO_HIRE: -2 };
export const VALID_STANCES = new Set<CouncilStance>(['HIRE', 'LEAN_HIRE', 'LEAN_NO_HIRE', 'NO_HIRE']);

/**
 * "Decision Cortex consumes" (HYRTE): a Prediction Engine already computed
 * predictions elsewhere in the flow — Cortex is told to derive its
 * confidence/next-step from that data, not to produce a predictions array
 * itself. "Decision Cortex generates" (Ally): no separate Prediction Engine
 * exists for Ally sessions, so Cortex produces the same
 * {dimension, likelihood, reasoning}[] shape directly as part of its own
 * single call — real output parity without a second subsystem.
 */
export type PredictionMode = 'consume' | 'generate';

/**
 * Shared orchestration for both Decision Councils in the product (HYRTE's
 * workplace-simulation council and Ally's direct-interview council). Two
 * genuinely different services still exist on top of this — they persist to
 * different tables (HyrteCouncilAgentReport vs InterviewCouncilAgentReport),
 * resolve evidence citations differently, and map the committee's vote
 * average onto different recommendation scales (a free string on
 * HyrteInterviewReport vs a strict Prisma enum on Evaluation) — deliberately
 * NOT merged into one data model (that migration is real risk for no
 * candidate-facing benefit). What WAS genuinely duplicated — the 9-agent
 * prompt construction, the concurrent-call/error-isolation pattern, and the
 * discussion-synthesis call — lives here once, shared.
 */
@Injectable()
export class CouncilCoreService {
  private readonly logger = new Logger(CouncilCoreService.name);

  constructor(private readonly ai: AIService) {}

  async runAgents(params: {
    contextId: string;
    brief: string;
    transcriptText: string;
    predictionMode: PredictionMode;
    predictionsText?: string | null;
    /** Lets HYRTE route each call through AuditLogService.run(...) without this module knowing about audit logging. */
    callWrapper?: (agentKey: string, fn: () => Promise<AgentResponse>) => Promise<AgentResponse>;
  }): Promise<AgentResult[]> {
    const { contextId, brief, transcriptText, predictionMode, predictionsText, callWrapper } = params;
    const hasPredictions = predictionMode === 'consume' && Boolean(predictionsText);

    return Promise.all(
      COUNCIL_AGENTS.map(async (agent) => {
        try {
          const userContent =
            agent.key === 'decisionCortex' && hasPredictions
              ? `${brief}\n\nFull interview transcript:\n${transcriptText}\n\n` +
                `Prediction Engine output (§3.5 — derive your confidencePercent and ` +
                `nextStepRecommendation from this, do not estimate independently):\n${predictionsText}`
              : `${brief}\n\nFull interview transcript:\n${transcriptText}`;

          const call = () =>
            this.ai.completeJson<AgentResponse>(
              [
                { role: 'system', content: this.buildAgentPrompt(agent, predictionMode, hasPredictions) },
                { role: 'user', content: userContent },
              ],
              { temperature: 0.5, maxTokens: agent.key === 'decisionCortex' && predictionMode === 'generate' ? 900 : 400 },
            );

          const result = callWrapper ? await callWrapper(agent.key, call) : await call();
          return { agent, result };
        } catch (e) {
          this.logger.warn(`Council agent "${agent.key}" failed (${contextId}): ${errMsg(e)}`);
          return { agent, result: {} as AgentResponse };
        }
      }),
    );
  }

  private buildAgentPrompt(agent: CouncilAgentDef, predictionMode: PredictionMode, hasPredictions: boolean): string {
    const citedEvidenceField =
      predictionMode === 'consume'
        ? '"citedEvidenceIds": string[] (the EVn labels from the evidence brief above that your reasoning is ' +
          'actually grounded in — e.g. ["EV2","EV5"]; at least one if any evidence brief entries exist; never a ' +
          "label you didn't see in the brief)"
        : '"citedEvidenceIds": string[] (short quoted excerpts from the evidence brief/transcript your reasoning ' +
          'is actually grounded in; empty array if none apply)';

    const predictionsField =
      predictionMode === 'generate'
        ? `"predictions": [{"dimension": string (a specific role-shape or environment, e.g. "Startup ` +
          '(fast-moving, ambiguous)", "Enterprise (structured, process-heavy)", "Individual contributor role", ' +
          '"Leadership/mentoring role", "High-ambiguity environments", "Customer-facing roles" — pick 4-6 ' +
          'that are actually relevant given this candidate\'s target role, not a fixed list), "likelihood": ' +
          'string (qualitative-plus-percentage, e.g. "Strong (78%)", "Moderate (55%)", "Limited (30%)"), ' +
          '"reasoning": string (one sentence, grounded in the evidence/transcript above — never a generic ' +
          `restatement of the dimension name)}] (4-6 entries, genuinely derived from what this specific ` +
          `candidate showed, not a boilerplate set), `
        : '';

    const responseShape = agent.votes
      ? `{"stance": "HIRE"|"LEAN_HIRE"|"LEAN_NO_HIRE"|"NO_HIRE", "reasoning": string (2-3 sentences, ` +
        `evidence-grounded, plain English — no jargon), "keyPoints": string[] (2-3 short evidence citations), ` +
        `${citedEvidenceField}}`
      : agent.key === 'decisionCortex'
        ? `{"reasoning": string (2-3 sentences), "keyPoints": string[] (missing signals or evidence gaps), ` +
          `"confidencePercent": int (0-100), "nextStepRecommendation": string (one short phrase, e.g. ` +
          `"proceed to next round" | "targeted follow-up on X" | "additional interview recommended"), ` +
          `${predictionsField}${citedEvidenceField}}`
        : `{"reasoning": string (2-3 sentences), "keyPoints": string[] (2-3 specific findings per your mandate), ` +
          `${citedEvidenceField}}`;

    const cortexDirective =
      agent.key === 'decisionCortex' && hasPredictions
        ? ' A Prediction Engine output is included below — derive confidencePercent as a reasoned ' +
          "synthesis of those per-dimension likelihoods weighted toward this candidate's actual target " +
          'role/environment, and keep nextStepRecommendation consistent with what those predictions show. ' +
          'Do not produce a confidence number that contradicts the Prediction Engine data.'
        : '';

    return (
      `You are the "${agent.name}" on a hiring decision committee reviewing a candidate's interview. Your ` +
      `mandate: ${agent.mandate}${cortexDirective} You are one of several committee members working ` +
      'independently — you have not seen the others\' notes yet. Ground everything in the evidence brief and ' +
      'transcript below; never invent a claim not supported by them. Other committee members are separately ' +
      'assessing execution/ownership, role-specific technical depth, collaboration/coachability, and long-term ' +
      'growth potential — stay strictly inside YOUR mandate above rather than restating a generic reliability/' +
      "communication concern every member could equally make; if the evidence's most obvious angle belongs to " +
      "someone else's mandate, find the specific angle on it that only your mandate would surface, or say " +
      "plainly that this evidence doesn't speak to your mandate rather than repeating another agent's likely " +
      `conclusion. Return ONLY JSON: ${responseShape}.`
    );
  }

  async runDiscussion(params: {
    contextId: string;
    agentResults: AgentResult[];
    callWrapper?: (fn: () => Promise<unknown>) => Promise<unknown>;
  }): Promise<DiscussionEntryResult[]> {
    const { contextId, agentResults, callWrapper } = params;
    const summary = agentResults
      .map(({ agent, result }) => `${agent.name}${result.stance ? ` [${result.stance}]` : ''}: ${result.reasoning ?? '(no response)'}`)
      .join('\n');

    try {
      const call = () =>
        this.ai.completeJson<DiscussionResponse>(
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

      const result = (callWrapper ? await callWrapper(call) : await call()) as DiscussionResponse;
      const validKeys = new Set(COUNCIL_AGENTS.map((a) => a.key));
      return (result.entries ?? [])
        .filter((e) => validKeys.has(e.agentKey))
        .slice(0, 8)
        .map((e) => ({
          agentKey: e.agentKey,
          statement: e.statement,
          respondingToAgentKey: validKeys.has(e.respondingToAgentKey ?? '') ? (e.respondingToAgentKey as string) : null,
        }));
    } catch (e) {
      this.logger.warn(`Council discussion synthesis failed (${contextId}): ${errMsg(e)}`);
      return [];
    }
  }

  tallyVotes(agentResults: AgentResult[]): { avg: number; voterCount: number } {
    const voters = agentResults.filter((r) => r.agent.votes && r.result.stance && VALID_STANCES.has(r.result.stance));
    const avg = voters.length
      ? voters.reduce((sum, r) => sum + STANCE_SCORE[r.result.stance as CouncilStance], 0) / voters.length
      : 0;
    return { avg, voterCount: voters.length };
  }

  getCortexResult(agentResults: AgentResult[]): AgentResponse | undefined {
    return agentResults.find((r) => r.agent.key === 'decisionCortex')?.result;
  }
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
