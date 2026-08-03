import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AIService } from '../../ai/ai.service';
import { HyrteGateway } from '../hyrte.gateway';
import { CompanyStateDelta, COMPANY_STATE_KEYS, HyrteConsequenceService } from '../consequences/consequence.service';
import { EvidenceGraphService } from '../dig/evidence-graph.service';
import { DecisionGraphService } from '../dig/decision-graph.service';
import { inferContextFromRole } from '../dig/behavior-context.util';
import { getVisibleStateKeys } from '../dig/info-scope.util';
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
    private readonly decisionGraph: DecisionGraphService,
  ) {}

  async respond(
    sessionId: string,
    stakeholderId: string,
    candidateMessage: string,
    target: AgentReplyTarget,
    decisionId?: string,
  ): Promise<void> {
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

      // §3.5 Decision Graph — enrich the candidate's original decision node
      // (already written synchronously when they sent the message) with the
      // same benefit/cost reasoning the reply itself is grounded in, so
      // reasoning/riskAssessment/outcome aren't left null for this action
      // type either.
      if (decisionId && (result.benefit || result.cost)) {
        this.decisionGraph
          .recordOutcome(decisionId, {
            outcome: `${stakeholder.name} replied: "${reply}" (trust ${trustShift >= 0 ? '+' : ''}${trustShift}).`,
            riskAssessment: result.cost,
          })
          .catch((e) => this.logger.warn(e));
      }

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

  /**
   * §4.12 Layers 5/9/11 — a stakeholder who was NOT talked to independently
   * reacts to something the candidate just did with someone else, from their
   * own goals/personality/relationship, with no visibility into what (if
   * anything) the first stakeholder said. Two calls that never see each
   * other's output is what makes divergence (agree / object / indifferent)
   * genuine rather than scripted — previously every stakeholder only ever
   * replied 1:1 to whoever the candidate addressed directly.
   */
  async reactIndependently(sessionId: string, aboutStakeholderId: string, candidateAction: string): Promise<void> {
    try {
      const [session, others] = await Promise.all([
        this.prisma.hyrteSession.findUnique({ where: { id: sessionId } }),
        this.prisma.hyrteStakeholder.findMany({ where: { sessionId, id: { not: aboutStakeholderId } } }),
      ]);
      if (!session || others.length === 0) return;

      const reactor = others[Math.floor(Math.random() * others.length)];
      const companyState = await this.prisma.hyrteCompanyState.findUnique({ where: { sessionId } });

      const result = await this.ai.completeJson<AgentJsonResponse>(
        [
          { role: 'system', content: this.buildSystemPrompt(reactor, companyState, session.companyName, reactor.hiddenIntention) },
          {
            role: 'user',
            content:
              `You just heard, secondhand (not from the candidate directly), that they did this: "${candidateAction}". ` +
              'You were not consulted and have not discussed it with anyone else on the team yet — this is your ' +
              'own unprompted, independent take, posted as a proactive message. You might agree with it, object ' +
              "to it, or feel indifferent — react as yourself, from your own goals, not as a company consensus.",
          },
        ],
        { temperature: 0.9, maxTokens: 300 },
      );

      const reply = (result.reply ?? '').trim();
      if (!reply) return;

      const updated = await this.applyDeltas(reactor, result);
      this.gateway.broadcast(sessionId, { type: 'stakeholder:update', stakeholder: updated });
      if (result.companyStateDelta) {
        await this.consequences.applyCompanyStateDelta(sessionId, result.companyStateDelta);
      }

      const channel = /engineer|technical/i.test(reactor.role) ? '#engineering' : /sales/i.test(reactor.role) ? '#sales' : '#product';
      const created = await this.prisma.hyrteSlackMessage.create({
        data: { sessionId, channel, fromStakeholderId: reactor.id, body: reply },
      });
      this.gateway.broadcast(sessionId, { type: 'slack:new', message: created });

      this.evidence
        .createEvidence({
          hyrteSessionId: sessionId,
          candidateId: session.candidateId,
          source: 'STAKEHOLDER_INTERACTION',
          type: 'STAKEHOLDER_INTERACTION',
          rawText: `${reactor.name} (${reactor.role}), unprompted, reacted independently to the candidate's action ("${candidateAction}"): "${reply}"`,
          behaviorContext: inferContextFromRole(reactor.role),
          metadata: { independentReaction: true },
        })
        .catch((e) => this.logger.warn(e));
    } catch (e) {
      this.logger.warn(`reactIndependently failed (session ${sessionId}): ${errMsg(e)}`);
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
    // §4.13 Hidden Information System / §4.12 Layer 2 — scoped: each
    // stakeholder only sees the company-state fields plausible for their
    // role, not the full 16-variable object every agent used to receive
    // identically (which meant no agent's information was actually distinct
    // from any other's — see ARCHITECTURE.md).
    const visibleKeys = getVisibleStateKeys(stakeholder.role);
    const scopedState = companyState
      ? Object.fromEntries(Object.entries(omitMeta(companyState)).filter(([k]) => visibleKeys.includes(k as never)))
      : {};
    const stateJson = JSON.stringify(scopedState);
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
      `Company metrics YOU can see from your role (others may know different things you don't — if asked ` +
      `about a metric not listed here, say you'd need to check with the right team rather than guessing a ` +
      `number): ${stateJson}. ` +
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

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
