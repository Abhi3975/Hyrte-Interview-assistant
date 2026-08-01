import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AIService } from '../../ai/ai.service';
import { HyrteGateway } from '../hyrte.gateway';
import { CompanyStateDelta, COMPANY_STATE_KEYS, HyrteConsequenceService } from '../consequences/consequence.service';
import { EvidenceGraphService } from '../dig/evidence-graph.service';
import { inferContextFromRole } from '../dig/behavior-context.util';
import { OMIT_HIDDEN_INTENTION } from '../dig/hidden-intention.util';

/** §4.17 Decision Cost — a relationship shift this negative reframes the exchange as conflict, not routine peer/manager chat. */
const CONFLICT_TRUST_SHIFT_THRESHOLD = -5;

const RELATIONSHIP_KEYS = ['trust', 'respect', 'cooperation', 'influence'] as const;
const EMOTIONAL_KEYS = ['stress', 'urgency', 'patience', 'motivation'] as const;
const MEMORY_TURNS = 10;
const MAX_DELTA = 15;
const MAX_STATE_DELTA = 10;

export type AgentReplyTarget = { kind: 'inbox'; subject: string } | { kind: 'slack'; channel: string };

interface AgentJsonResponse {
  reply?: string;
  relationshipDelta?: Partial<Record<(typeof RELATIONSHIP_KEYS)[number], number>>;
  emotionalDelta?: Partial<Record<(typeof EMOTIONAL_KEYS)[number], number>>;
  companyStateDelta?: CompanyStateDelta;
  /** §4.17 Decision Cost — "no action should be free." */
  benefit?: string;
  cost?: string;
}

/**
 * One stakeholder's reactive turn: reads its own persona, emotional state,
 * relationship with this candidate, live company state, and recent memory,
 * then replies in character and updates its own state (doc §5). Always
 * called fire-and-forget from an already-responded HTTP request — failures
 * are logged, never thrown back at the candidate.
 */
@Injectable()
export class HyrteStakeholderAgentService {
  private readonly logger = new Logger(HyrteStakeholderAgentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AIService,
    private readonly gateway: HyrteGateway,
    private readonly consequences: HyrteConsequenceService,
    private readonly evidence: EvidenceGraphService,
  ) {}

  async respond(sessionId: string, stakeholderId: string, candidateMessage: string, target: AgentReplyTarget): Promise<void> {
    try {
      const [stakeholder, companyState, session, recentMemory] = await Promise.all([
        this.prisma.hyrteStakeholder.findUnique({ where: { id: stakeholderId } }),
        this.prisma.hyrteCompanyState.findUnique({ where: { sessionId } }),
        this.prisma.hyrteSession.findUnique({ where: { id: sessionId } }),
        this.prisma.hyrteStakeholderMemory.findMany({
          where: { sessionId, stakeholderId },
          orderBy: { createdAt: 'desc' },
          take: MEMORY_TURNS,
        }),
      ]);
      if (!stakeholder || !session) return;

      const transcript = recentMemory
        .slice()
        .reverse()
        .map((m) => `${m.speaker === 'candidate' ? 'Candidate' : stakeholder.name}: ${m.content}`)
        .join('\n');

      const result = await this.ai.completeJson<AgentJsonResponse>(
        [
          { role: 'system', content: this.buildSystemPrompt(stakeholder, companyState, session.companyName, stakeholder.hiddenIntention) },
          {
            role: 'user',
            content:
              (transcript ? `Recent conversation:\n${transcript}\n\n` : '') +
              `Candidate just said: "${candidateMessage}"\n\nRespond in character as ${stakeholder.name}.`,
          },
        ],
        { temperature: 0.8, maxTokens: 500 },
      );

      const reply = (result.reply ?? '').trim();
      if (!reply) return;

      await this.prisma.hyrteStakeholderMemory.createMany({
        data: [
          { sessionId, stakeholderId, speaker: 'candidate', content: candidateMessage },
          { sessionId, stakeholderId, speaker: 'stakeholder', content: reply },
        ],
      });

      const updated = await this.applyDeltas(stakeholder, result);
      this.gateway.broadcast(sessionId, { type: 'stakeholder:update', stakeholder: updated });
      if (result.companyStateDelta) {
        await this.consequences.applyCompanyStateDelta(sessionId, result.companyStateDelta);
      }

      const trustShift = updated.trust - stakeholder.trust;
      const tradeoff = result.benefit || result.cost ? ` Benefit: ${result.benefit ?? '—'}. Cost: ${result.cost ?? '—'}.` : '';
      this.evidence
        .createEvidence({
          hyrteSessionId: sessionId,
          candidateId: session.candidateId,
          source: 'STAKEHOLDER_INTERACTION',
          type: 'STAKEHOLDER_INTERACTION',
          rawText:
            `Candidate said to ${stakeholder.name} (${stakeholder.role}): "${candidateMessage}". ` +
            `Reply: "${reply}". Trust ${trustShift >= 0 ? '+' : ''}${trustShift}.${tradeoff}`,
          behaviorContext: trustShift <= CONFLICT_TRUST_SHIFT_THRESHOLD ? 'CONFLICT' : inferContextFromRole(stakeholder.role),
          metadata: result.benefit || result.cost ? { benefit: result.benefit, cost: result.cost } : undefined,
        })
        .catch((e) => this.logger.warn(e));

      if (target.kind === 'inbox') {
        const subject = target.subject.startsWith('Re: ') ? target.subject : `Re: ${target.subject}`;
        const created = await this.prisma.hyrteInboxMessage.create({
          data: { sessionId, fromStakeholderId: stakeholderId, subject, body: reply, urgent: false },
        });
        this.gateway.broadcast(sessionId, { type: 'inbox:new', message: created });
      } else {
        const created = await this.prisma.hyrteSlackMessage.create({
          data: { sessionId, channel: target.channel, fromStakeholderId: stakeholderId, body: reply },
        });
        this.gateway.broadcast(sessionId, { type: 'slack:new', message: created });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`Stakeholder agent turn failed (session ${sessionId}, stakeholder ${stakeholderId}): ${msg}`);
    }
  }

  private buildSystemPrompt(
    stakeholder: {
      name: string;
      role: string;
      personality: unknown;
      trust: number;
      respect: number;
      cooperation: number;
      influence: number;
      stress: number;
      urgency: number;
      patience: number;
      motivation: number;
    },
    companyState: Record<string, unknown> | null,
    companyName: string,
    hiddenIntention: string | null,
  ): string {
    const personality = JSON.stringify(stakeholder.personality ?? {});
    const stateJson = companyState ? JSON.stringify(omitMeta(companyState)) : '{}';
    const hiddenIntentionClause = hiddenIntention
      ? ` PRIVATE MOTIVE (never state this directly — it should only color your tone, urgency, or what ` +
        `you choose to volunteer vs. withhold, and could surface if the candidate specifically investigates ` +
        `or presses on it): ${hiddenIntention}.`
      : '';
    return (
      `You are ${stakeholder.name}, ${stakeholder.role} at ${companyName}, messaging with a candidate ` +
      `in a workplace simulation. Your traits/goals: ${personality}.${hiddenIntentionClause} ` +
      `Your current emotional state (0-100): stress ${stakeholder.stress}, urgency ${stakeholder.urgency}, ` +
      `patience ${stakeholder.patience}, motivation ${stakeholder.motivation}. ` +
      `Your relationship with this candidate (0-100): trust ${stakeholder.trust}, respect ${stakeholder.respect}, ` +
      `cooperation ${stakeholder.cooperation}, influence ${stakeholder.influence}. ` +
      `Current company state: ${stateJson}. ` +
      'Respond naturally and in character — vary tone based on your emotional state and relationship, ' +
      "don't default to uniformly friendly or helpful. Keep it concise (1-4 sentences). " +
      'Return ONLY JSON: {"reply": string, "relationshipDelta": {"trust": int, "respect": int, ' +
      '"cooperation": int, "influence": int}, "emotionalDelta": {"stress": int, "urgency": int, ' +
      `"patience": int, "motivation": int}}, each delta an integer from -${MAX_DELTA} to ${MAX_DELTA} ` +
      'reflecting how this exchange just affected you. You may also add "companyStateDelta": ' +
      `{<at most 2 of: ${COMPANY_STATE_KEYS.join(', ')}, each -${MAX_STATE_DELTA}..${MAX_STATE_DELTA}>} ` +
      'for fields this specific exchange would plausibly move — omit it entirely if nothing plausibly changes. ' +
      'No candidate action is free (§4.17) — if this exchange plausibly helped with one thing at the cost of ' +
      'another (e.g. reassured you but delayed something else, or fixed the immediate issue but ignored the ' +
      'root cause), add "benefit": string and "cost": string (each one short phrase) — omit both if this ' +
      'exchange genuinely had no trade-off.'
    );
  }

  private async applyDeltas(
    stakeholder: {
      id: string;
      trust: number;
      respect: number;
      cooperation: number;
      influence: number;
      stress: number;
      urgency: number;
      patience: number;
      motivation: number;
    },
    result: AgentJsonResponse,
  ) {
    const clampDelta = (n: unknown) => Math.max(-MAX_DELTA, Math.min(MAX_DELTA, typeof n === 'number' && Number.isFinite(n) ? n : 0));
    const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

    const data: Record<string, number> = {};
    for (const key of RELATIONSHIP_KEYS) {
      data[key] = clamp(stakeholder[key] + clampDelta(result.relationshipDelta?.[key]));
    }
    for (const key of EMOTIONAL_KEYS) {
      data[key] = clamp(stakeholder[key] + clampDelta(result.emotionalDelta?.[key]));
    }

    return this.prisma.hyrteStakeholder.update({ where: { id: stakeholder.id }, data, omit: OMIT_HIDDEN_INTENTION });
  }
}

/** Strips Prisma's sessionId/updatedAt so the prompt only sees the KPI values. */
function omitMeta(state: Record<string, unknown>): Record<string, unknown> {
  const { sessionId: _sessionId, updatedAt: _updatedAt, ...rest } = state;
  return rest;
}
