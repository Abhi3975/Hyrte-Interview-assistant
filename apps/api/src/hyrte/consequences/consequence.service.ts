import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AIService } from '../../ai/ai.service';
import { HyrteGateway } from '../hyrte.gateway';
import { EvidenceGraphService } from '../dig/evidence-graph.service';
import { DecisionGraphService } from '../dig/decision-graph.service';
import { toCandidateStakeholder } from '../dig/hidden-intention.util';
import { industryGroundingNote } from '../generator/industry-templates';

export const COMPANY_STATE_KEYS = [
  'revenue',
  'customerSatisfaction',
  'engineeringCapacity',
  'technicalDebt',
  'teamMorale',
  'budget',
  'riskLevel',
  'deadlinePressure',
  'marketReputation',
  'cashRunway',
  'complianceRisk',
  // §4.11 Living Organizational World Model — Phase 2 completed the canonical
  // variable list with these five.
  'productQuality',
  'burnout',
  'hiringCapacity',
  'operationalRisk',
  'growth',
] as const;
export type CompanyStateKey = (typeof COMPANY_STATE_KEYS)[number];
export type CompanyStateDelta = Partial<Record<CompanyStateKey, number>>;

const MAX_DELTA = 10;
const MIN_IGNORED_WINDOW_MS = 45_000;
const MAX_IGNORED_WINDOW_MS = 75_000;
/** §4.5 Chaos Engine — wave 1, timed from workspace unlock, not from random ticks. */
const CHAOS_WAVE_DELAY_MS = 100_000;
/**
 * Refinements doc §"Dynamic Difficulty" — "difficulty should evolve
 * throughout the simulation instead of being fixed at the start." Waves 2+
 * used to be capped at exactly one extra wave with a fixed delay — a
 * deliberate scope decision at the time, explicitly NOT the doc's
 * open-ended "multiple waves" ask. This is that gap closed: waves now keep
 * coming (bounded, not literally forever — same "periodic for a compressed
 * session" reasoning as every other capped cycle here) at a cadence AND
 * burst size that adapt to a live, ongoing performance signal — not the
 * one-time Role Calibration score, which only ever reflects the candidate's
 * first two answers before any real work happened.
 */
const CHAOS_WAVE_CADENCE_MS = 150_000;
const MAX_CHAOS_WAVES = 6;
const CHAOS_WAVE_BURST_MIN = 2;
const CHAOS_WAVE_BURST_MAX = 6;
/** Part F7 — "difficulty-scaled bursts of 3-5 simultaneous demands." */
const BURST_SIZE_BY_DIFFICULTY: Record<string, number> = { EASY: 2, MEDIUM: 3, HARD: 4, EXPERT: 5 };
/** Part F7 cross-functional cascade chains. */
const CASCADE_DELAY_MS = 75_000;
const COMMITMENT_DEPARTMENT = /sales|marketing|account executive|business development|\bbd\b/i;
const CAPACITY_DEPARTMENT = /engineer|technical|product|\bqa\b|infra/i;
/**
 * Multi-hop escalation chain (doc's own worked example: sales follow-up →
 * customer escalation → manager question), each hop spaced over time via the
 * same CONDITIONAL-event mechanism as hop 1 — a hop only fires if the
 * PREVIOUS hop was also ignored, so the whole chain only plays out if the
 * candidate genuinely never responds. Capped at 3 hops, matching the doc's
 * own worked example length exactly.
 */
const MAX_ESCALATION_HOPS = 3;
/** Later hops carry more weight — a manager's pointed question should land harder than a peer's nudge. */
const HOP_RELATIONSHIP_DELTA_CAP = [15, 20, 25] as const;
const HOP_STATE_DELTA_CAP = [MAX_DELTA, 14, 18] as const;

/**
 * Simulation refinements doc §4 — "Slack should not imitate WhatsApp. It
 * should behave like the communication layer of a real company... AI
 * stakeholders talk to each other... The candidate is not the center of
 * every conversation." Before this, every hyrteSlackMessage.create call site
 * addressed the candidate directly (a reply, a chaos-wave demand, a
 * work-tick status ping) — there was no stakeholder-to-stakeholder exchange
 * the candidate merely observes. Same self-rescheduling, capped-cycle,
 * session-phase-gated pattern as scheduleChaosWave/scheduleOrchestratorReview
 * — no new scheduling infrastructure.
 */
const AMBIENT_CHATTER_MIN_MS = 40_000;
const AMBIENT_CHATTER_MAX_MS = 75_000;
/** Same "periodic for a compressed 30-40min session, not literally forever" reasoning as the orchestrator's cap. */
const MAX_AMBIENT_CHATTER_CYCLES = 8;
/** Matches the frontend's fixed channel list (apps/web .../slack/page.tsx CHANNELS) — an ambient exchange in a
 * channel the candidate has no way to open would be invisible chatter, not observable world-aliveness. */
const AMBIENT_CHANNELS = ['#product', '#engineering', '#sales', '#leadership'] as const;
/** Stagger between turns of the same exchange so it reads as a real back-and-forth, not a batch dump. */
const AMBIENT_TURN_MIN_GAP_MS = 3_000;
const AMBIENT_TURN_MAX_GAP_MS = 9_000;

export const randomIgnoredWindow = () =>
  MIN_IGNORED_WINDOW_MS + Math.floor(Math.random() * (MAX_IGNORED_WINDOW_MS - MIN_IGNORED_WINDOW_MS));

interface TaskConsequenceResponse {
  companyStateDelta?: CompanyStateDelta;
  /** §4.17 Decision Cost. */
  benefit?: string;
  cost?: string;
}

interface EscalationResponse {
  stakeholderKey?: string;
  message?: string;
  companyStateDelta?: CompanyStateDelta;
  relationshipDelta?: Partial<Record<'trust' | 'respect' | 'cooperation' | 'influence', number>>;
}

interface ChaosWaveEvent {
  channel: 'inbox' | 'slack';
  stakeholderKey: string;
  subject?: string; // inbox only
  slackChannel?: string; // slack only, e.g. "#product" or "dm:<key>"
  body: string;
}

interface ChaosWaveResponse {
  events?: ChaosWaveEvent[];
  companyStateDelta?: CompanyStateDelta;
}

interface AmbientChatterTurn {
  stakeholderKey?: string;
  body?: string;
}

interface AmbientChatterResponse {
  channel?: string;
  exchange?: AmbientChatterTurn[];
}

/**
 * Makes the "no choice is free" and "ignoring things has consequences" parts
 * of doc §6/§4.17 real: task completion and stakeholder-agent exchanges nudge
 * company state and (where a trade-off is plausible) carry a paired
 * benefit/cost; an urgent inbox message nobody responds to within its window
 * triggers a frustrated follow-up from a different stakeholder (§6's own
 * example). `scheduleChaosWave` (§4.5) adds one state-aware wave of 2-3
 * correlated events later in the session. Full multi-department cascade
 * chains beyond these trigger types are still out of scope for this pass —
 * see ARCHITECTURE.md.
 */
@Injectable()
export class HyrteConsequenceService {
  private readonly logger = new Logger(HyrteConsequenceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AIService,
    private readonly gateway: HyrteGateway,
    private readonly evidence: EvidenceGraphService,
    private readonly decisionGraph: DecisionGraphService,
  ) {}

  /**
   * Shared, concurrency-safe path for every company-state mutation in the
   * app. Upgrade §5/Step 14 — every mutation is also appended to
   * HyrteCompanyStateHistory (the delta actually applied, not a full
   * snapshot), so the final report can show real state evolution over time
   * instead of only ever seeing the current values.
   */
  async applyCompanyStateDelta(sessionId: string, delta: CompanyStateDelta, reason?: string, decisionId?: string): Promise<void> {
    const entries = Object.entries(delta).filter(
      ([k, v]) => COMPANY_STATE_KEYS.includes(k as CompanyStateKey) && typeof v === 'number' && v !== 0,
    ) as [string, number][];
    if (entries.length === 0) return;

    try {
      const incrementData = Object.fromEntries(
        entries.map(([k, v]) => [k, { increment: clampDelta(v) }]),
      );
      let state = await this.prisma.hyrteCompanyState.update({ where: { sessionId }, data: incrementData });

      // Atomic increments can push a field outside [0,100]; correct if so.
      const correction: Record<string, number> = {};
      for (const key of COMPANY_STATE_KEYS) {
        const v = state[key] as number;
        if (v < 0) correction[key] = 0;
        else if (v > 100) correction[key] = 100;
      }
      if (Object.keys(correction).length > 0) {
        state = await this.prisma.hyrteCompanyState.update({ where: { sessionId }, data: correction });
      }

      this.gateway.broadcast(sessionId, { type: 'company_state:update', state });
      this.prisma.hyrteCompanyStateHistory
        .create({ data: { sessionId, delta: Object.fromEntries(entries) as Prisma.InputJsonValue, reason, decisionId } })
        .catch((e) => this.logger.warn(`companyStateHistory write failed (session ${sessionId}): ${errMsg(e)}`));
    } catch (e) {
      this.logger.warn(`applyCompanyStateDelta failed (session ${sessionId}): ${errMsg(e)}`);
    }
  }

  async reasonTaskConsequence(
    sessionId: string,
    task: { title: string; priority: string },
    candidateId: string,
    decisionId?: string,
  ): Promise<void> {
    try {
      const [session, companyState] = await Promise.all([
        this.prisma.hyrteSession.findUnique({ where: { id: sessionId } }),
        this.prisma.hyrteCompanyState.findUnique({ where: { sessionId } }),
      ]);
      if (!session || !companyState) return;

      const result = await this.ai.completeJson<TaskConsequenceResponse>(
        [
          {
            role: 'system',
            content:
              'You are a consequence-reasoning engine for a workplace simulation. Given the current ' +
              'company state and a task the candidate just completed, decide the realistic, small ' +
              'knock-on effect on company state. No completed task is free (§4.17 Decision Cost) — ' +
              'completing one thing plausibly delayed or traded off against another. Return ONLY JSON: ' +
              `{"companyStateDelta": {<at most 3 of: ${COMPANY_STATE_KEYS.join(', ')}, each an integer ` +
              '-' +
              `${MAX_DELTA}..${MAX_DELTA}>}, "benefit": string (one short phrase — what improved), ` +
              '"cost": string (one short phrase — what it traded off against)}. Only include ' +
              'companyStateDelta fields that plausibly change; if nothing plausible changes at all, ' +
              'return {}.',
          },
          {
            role: 'user',
            content:
              `Company: ${session.companyName} (${session.role} role). Task completed: "${task.title}" ` +
              `(priority: ${task.priority}). Current state: ${JSON.stringify(omitMeta(companyState))}.`,
          },
        ],
        { temperature: 0.6, maxTokens: 300 },
      );

      await this.applyCompanyStateDelta(sessionId, result.companyStateDelta ?? {}, 'task_completion', decisionId);

      if (result.benefit || result.cost) {
        this.evidence
          .createEvidence({
            hyrteSessionId: sessionId,
            candidateId,
            source: 'SIMULATION',
            type: 'SIMULATION_ACTION',
            rawText: `Completed task "${task.title}". Benefit: ${result.benefit ?? '—'}. Cost: ${result.cost ?? '—'}.`,
            metadata: { benefit: result.benefit, cost: result.cost },
          })
          .catch((e) => this.logger.warn(e));
        // §3.5 Decision Graph — the node was already written synchronously
        // when the task status changed; enrich it now with the same
        // benefit/cost reasoning rather than leaving reasoning/riskAssessment
        // null, which was the case for every action type except the
        // baseline challenge before this fix.
        if (decisionId) {
          this.decisionGraph
            .recordOutcome(decisionId, {
              outcome: `Benefit: ${result.benefit ?? '—'}. Cost: ${result.cost ?? '—'}.`,
              riskAssessment: result.cost,
            })
            .catch((e) => this.logger.warn(e));
        }
      }
    } catch (e) {
      this.logger.warn(`reasonTaskConsequence failed (session ${sessionId}): ${errMsg(e)}`);
    }
  }

  /**
   * Schedules a check; fires an escalation only if the message is still
   * unread. Upgrade §6 — this IS the doc's own worked example of a
   * CONDITIONAL event ("fires only if a trigger condition is met, e.g.
   * candidate_ignored_email > 5min"); persisted as a real HyrteWorldEvent row
   * (PENDING → FIRED if escalated, CANCELLED if read in time) instead of a
   * bare untracked setTimeout.
   *
   * Upgrade — multi-hop chain (doc's own worked example: sales follow-up →
   * customer escalation → manager question). `hop`/`rootMessageId` are only
   * passed by escalateIgnoredMessage when scheduling the NEXT hop; external
   * callers always start a fresh chain at hop 1.
   */
  scheduleIgnoredCheck(sessionId: string, messageId: string, delayMs: number, hop = 1, rootMessageId?: string): void {
    this.prisma.hyrteWorldEvent
      .create({
        data: {
          sessionId,
          kind: 'CONDITIONAL',
          surface: 'inbox',
          triggerCondition: `message_unread:${messageId}`,
          payload: { hop } as unknown as Prisma.InputJsonValue,
        },
      })
      .then((event) => {
        setTimeout(() => {
          this.checkAndEscalate(sessionId, messageId, event.id, hop, rootMessageId ?? messageId).catch((e) => this.logger.warn(errMsg(e)));
        }, delayMs);
      })
      .catch((e) => this.logger.warn(errMsg(e)));
  }

  private async checkAndEscalate(sessionId: string, messageId: string, eventId: string, hop: number, rootMessageId: string): Promise<void> {
    const [message, session] = await Promise.all([
      this.prisma.hyrteInboxMessage.findUnique({ where: { id: messageId } }),
      this.prisma.hyrteSession.findUnique({ where: { id: sessionId }, select: { phase: true } }),
    ]);
    // Same guard as triggerCascade/triggerChaosWave/runOrchestratorReview,
    // which already stop quietly once the session has moved past
    // WORKSPACE_ACTIVE (interview started / report locked in) — this one was
    // missing it, so an in-flight escalation timer would keep firing straight
    // into an already-finished session (the "19 open escalations after the
    // report" bug).
    if (!message || message.readAt || !session || session.phase !== 'WORKSPACE_ACTIVE') {
      await this.prisma.hyrteWorldEvent.update({ where: { id: eventId }, data: { status: 'CANCELLED' } }).catch(() => {});
      return; // acted on in time, or the world has moved on — no consequence
    }
    await this.escalateIgnoredMessage(sessionId, message, hop, rootMessageId);
    await this.prisma.hyrteWorldEvent.update({ where: { id: eventId }, data: { status: 'FIRED', firedAt: new Date() } }).catch(() => {});
  }

  /**
   * Upgrade — each hop is a distinct stage, not a repeat of hop 1 with a new
   * random target: hop 1 is a peer-level nudge, hop 2 reframes the stakes as
   * now visibly affecting a customer/external party (preferring a
   * customer-facing stakeholder if the roster has one), hop 3 goes to the
   * highest-authority stakeholder — computed the same deterministic way as
   * the Mission Brief's manager, never LLM-guessed, since "does escalation
   * actually reach a real manager" is exactly the kind of guarantee that
   * shouldn't depend on the model choosing correctly. If hop < MAX, the next
   * hop is scheduled on THIS escalation message, so the chain only continues
   * if the candidate ignores this one too.
   */
  private async escalateIgnoredMessage(
    sessionId: string,
    message: { id: string; subject: string; body: string; fromStakeholderId: string | null },
    hop: number,
    rootMessageId: string,
  ): Promise<void> {
    try {
      const [session, companyState, stakeholders, originalSender] = await Promise.all([
        this.prisma.hyrteSession.findUnique({ where: { id: sessionId } }),
        this.prisma.hyrteCompanyState.findUnique({ where: { sessionId } }),
        this.prisma.hyrteStakeholder.findMany({ where: { sessionId } }),
        message.fromStakeholderId
          ? this.prisma.hyrteStakeholder.findUnique({ where: { id: message.fromStakeholderId } })
          : null,
      ]);
      if (!session || !companyState || stakeholders.length === 0) return;

      const others = stakeholders.filter((s) => s.id !== message.fromStakeholderId);
      const candidates = others.length > 0 ? others : stakeholders;
      const hopIdx = Math.min(hop, MAX_ESCALATION_HOPS) - 1;
      const stateCap = HOP_STATE_DELTA_CAP[hopIdx];
      const relationshipCap = HOP_RELATIONSHIP_DELTA_CAP[hopIdx];

      // Hop 3 — the manager question — is a deterministic pick, not an LLM
      // choice: the highest-authority stakeholder in the session, same
      // derivation as the Mission Brief's manager.
      const forcedEscalator =
        hop >= MAX_ESCALATION_HOPS ? candidates.reduce((a, b) => ((b.authorityLevel ?? 50) > (a.authorityLevel ?? 50) ? b : a)) : undefined;
      const roster = (forcedEscalator ? [forcedEscalator] : candidates).map((s) => ({ key: s.id, name: s.name, role: s.role }));

      const hopFraming =
        hop === 1
          ? 'This is the FIRST escalation (of up to 3) after the candidate ignored an urgent message — a colleague ' +
            'sends a short, frustrated follow-up about the lack of response, from their own perspective.'
          : hop === 2
            ? 'This is the SECOND escalation — the FIRST follow-up was ALSO ignored. Reframe the stakes as now ' +
              'visibly affecting something external/customer-facing (a customer complaint, an at-risk deal, a ' +
              'visible failure) — noticeably more urgent and higher-stakes than a routine internal nudge. Prefer ' +
              'a customer-facing stakeholder (sales/support/success-flavored role) from the roster if one fits.'
            : 'This is the THIRD and FINAL escalation — TWO prior follow-ups were ignored. The stakeholder in the ' +
              'roster is the most senior person in the company and is now asking a direct, serious question about ' +
              'why this still hasn\'t been handled. This should read as a manager stepping in, not a peer nudging — ' +
              'noticeably more consequential than hops 1-2.';

      const result = await this.ai.completeJson<EscalationResponse>(
        [
          {
            role: 'system',
            content:
              'You are generating a consequence event for a workplace simulation: the candidate ignored an ' +
              `urgent message, now escalating. ${hopFraming} Pick ONE stakeholder from the given roster (by ` +
              '"key"). Return ONLY JSON: {"stakeholderKey": string (must match a roster key), "message": ' +
              'string (2-4 sentences, tone matching the escalation stage described), "companyStateDelta": ' +
              `{<at most 2 of: ${COMPANY_STATE_KEYS.join(', ')}, each -${stateCap}..${stateCap}>}, ` +
              `"relationshipDelta": {"trust": int, "respect": int, "cooperation": int, "influence": int} (each ` +
              `-${relationshipCap}..0, the damage to the ORIGINAL sender's relationship from being ignored this ` +
              'many times).',
          },
          {
            role: 'user',
            content:
              `Company: ${session.companyName}. Ignored message${originalSender ? ` from ${originalSender.name} (${originalSender.role})` : ''}: ` +
              `"${message.subject}" — "${message.body}". Roster: ${JSON.stringify(roster)}. ` +
              `Current company state: ${JSON.stringify(omitMeta(companyState))}.`,
          },
        ],
        { temperature: 0.8, maxTokens: 400 },
      );

      const text = (result.message ?? '').trim();
      if (!text) return;

      const escalator =
        forcedEscalator ??
        candidates.find((s) => s.id === result.stakeholderKey) ??
        candidates[Math.floor(Math.random() * candidates.length)];

      const hopLabel = hop === 1 ? 'still waiting' : hop === 2 ? 'this is now customer-facing' : 'manager follow-up';
      const created = await this.prisma.hyrteInboxMessage.create({
        data: {
          sessionId,
          fromStakeholderId: escalator.id,
          subject: `Re: ${message.subject.replace(/^Re: /, '')} — ${hopLabel}`,
          body: text,
          urgent: true,
          // Upgrade §5/Step 19 — always points at the ROOT of the chain (not
          // the immediately-preceding hop), so replying at ANY hop links
          // recovery back to the original ignored-message decision node.
          escalatesMessageId: rootMessageId,
        },
      });
      this.gateway.broadcast(sessionId, { type: 'inbox:new', message: created });

      // §3.5 Decision Graph — inaction is itself a decision node (the doc's
      // own canonical example: "read customer email → ignored → customer
      // trust decreased → customer escalated"). Awaited (not fire-and-forget)
      // so its real id can tie the company-state delta below directly to
      // THIS decision — Refinements doc §10's "Metrics affected" needs an
      // actual causal link, not just a generic reason label.
      const decisionEntry = await this.decisionGraph
        .recordDecision({
          sessionId,
          actor: session.candidateId,
          actionType: 'inbox.message_ignored',
          payload: { messageId: message.id, escalatorId: escalator.id, hop },
          reasoning: 'No reply sent before the message’s active window elapsed.',
          riskAssessment:
            'Urgent messages from named stakeholders left unanswered risk relationship damage and escalation.',
          outcome: `Escalation hop ${hop}/${MAX_ESCALATION_HOPS} — ${escalator.name} escalated: "${text}"`,
        })
        .catch((e) => {
          this.logger.warn(e);
          return undefined;
        });

      await this.applyCompanyStateDelta(sessionId, result.companyStateDelta ?? {}, `escalation_hop_${hop}`, decisionEntry?.id);

      this.evidence
        .createEvidence({
          hyrteSessionId: sessionId,
          candidateId: session.candidateId,
          source: 'SIMULATION',
          type: 'SIMULATION_ACTION',
          rawText: `Ignored an urgent message${originalSender ? ` from ${originalSender.name}` : ''} — escalation hop ${hop}/${MAX_ESCALATION_HOPS}, ${escalator.name} (${escalator.role}): "${text}"`,
          behaviorContext: 'PRESSURE',
          metadata: { escalationHop: hop },
        })
        .catch((e) => this.logger.warn(e));

      if (originalSender) {
        const clamp = (n: unknown) => Math.max(0, Math.min(100, Math.round(typeof n === 'number' ? n : 0)));
        const rd = result.relationshipDelta ?? {};
        const updated = await this.prisma.hyrteStakeholder.update({
          where: { id: originalSender.id },
          data: {
            trust: clamp(originalSender.trust + clampDelta(rd.trust ?? 0, relationshipCap)),
            respect: clamp(originalSender.respect + clampDelta(rd.respect ?? 0, relationshipCap)),
            cooperation: clamp(originalSender.cooperation + clampDelta(rd.cooperation ?? 0, relationshipCap)),
            influence: clamp(originalSender.influence + clampDelta(rd.influence ?? 0, relationshipCap)),
          },
        });
        this.gateway.broadcast(sessionId, { type: 'stakeholder:update', stakeholder: toCandidateStakeholder(updated) });
        this.gateway.broadcastRecruiter(sessionId, { type: 'stakeholder:update', stakeholder: updated });
      }

      // Chain continues only if this hop also gets ignored — the whole
      // point of "spaced over time, not simultaneous" (doc's acceptance
      // check): the next hop's window doesn't even start until this one's
      // message exists.
      if (hop < MAX_ESCALATION_HOPS) {
        this.scheduleIgnoredCheck(sessionId, created.id, randomIgnoredWindow(), hop + 1, rootMessageId);
      }
    } catch (e) {
      this.logger.warn(`escalateIgnoredMessage failed (session ${sessionId}): ${errMsg(e)}`);
    }
  }

  /**
   * Master Build Prompt Part F5 — "ignored critical reviews fire escalation
   * chains." Mirrors scheduleIgnoredCheck/checkAndEscalate's exact shape
   * (persisted CONDITIONAL HyrteWorldEvent, PENDING → FIRED/CANCELLED) but
   * checks a Work Item's review state instead of a message's readAt, and is
   * deliberately single-hop rather than the inbox chain's 3 hops — a
   * distinct, smaller consequence, not a second full escalation ladder.
   */
  scheduleReviewIgnoredCheck(sessionId: string, workItemId: string, delayMs: number): void {
    this.prisma.hyrteWorldEvent
      .create({
        data: {
          sessionId,
          kind: 'CONDITIONAL',
          surface: 'inbox',
          triggerCondition: `work_item_review:${workItemId}`,
          payload: {} as unknown as Prisma.InputJsonValue,
        },
      })
      .then((event) => {
        setTimeout(() => {
          this.checkAndEscalateReview(sessionId, workItemId, event.id).catch((e) => this.logger.warn(errMsg(e)));
        }, delayMs);
      })
      .catch((e) => this.logger.warn(errMsg(e)));
  }

  private async checkAndEscalateReview(sessionId: string, workItemId: string, eventId: string): Promise<void> {
    const [item, session] = await Promise.all([
      this.prisma.hyrteWorkItem.findUnique({ where: { id: workItemId }, include: { ownerStakeholder: true } }),
      this.prisma.hyrteSession.findUnique({ where: { id: sessionId }, select: { phase: true } }),
    ]);
    const review = item?.review as { decidedAt?: string | null } | null;
    // Same session-has-moved-on guard as checkAndEscalate/triggerCascade/
    // triggerChaosWave/runOrchestratorReview — this one was missing it too.
    if (!item || !item.ownerStakeholder || review?.decidedAt || !session || session.phase !== 'WORKSPACE_ACTIVE') {
      await this.prisma.hyrteWorldEvent.update({ where: { id: eventId }, data: { status: 'CANCELLED' } }).catch(() => {});
      return; // reviewed in time, or the world has moved on — no consequence
    }

    const stakeholder = item.ownerStakeholder;
    const created = await this.prisma.hyrteInboxMessage.create({
      data: {
        sessionId,
        fromStakeholderId: stakeholder.id,
        subject: `Re: ${item.title} — still waiting on your review`,
        body:
          `Hi — I finished "${item.title}" a while ago and it's still sitting in review. Can you take a look ` +
          `when you get a chance? It's blocking me from moving on to the next thing.`,
        urgent: true,
      },
    });
    this.gateway.broadcast(sessionId, { type: 'inbox:new', message: created });

    const clamp = (n: number) => Math.max(0, Math.min(100, n));
    const updated = await this.prisma.hyrteStakeholder.update({
      where: { id: stakeholder.id },
      data: { trust: clamp(stakeholder.trust - 5), patience: clamp(stakeholder.patience - 8) },
    });
    this.gateway.broadcast(sessionId, { type: 'stakeholder:update', stakeholder: toCandidateStakeholder(updated) });
    this.gateway.broadcastRecruiter(sessionId, { type: 'stakeholder:update', stakeholder: updated });

    await this.prisma.hyrteWorldEvent.update({ where: { id: eventId }, data: { status: 'FIRED', firedAt: new Date() } }).catch(() => {});
  }

  /**
   * Master Build Prompt Part F7 — cross-functional cascade chains, the doc's
   * own worked example ("Sales overpromises → Engineering overload → bugs →
   * churn → budget cuts"). Approving a HIGH/CRITICAL commitment from a
   * customer-facing department is the trigger; the consequence lands on a
   * DIFFERENT (capacity-constrained) department after a delay — a real,
   * connected story beat, not a second generic escalation. Same
   * setTimeout+LLM+applyCompanyStateDelta shape as every other delayed
   * mechanic here, just a new triggering condition.
   */
  scheduleCascadeCheck(
    sessionId: string,
    workItem: { id: string; title: string; priority: string; ownerStakeholderId: string | null },
    decisionId?: string,
  ): void {
    if (workItem.priority !== 'HIGH' && workItem.priority !== 'CRITICAL') return;
    if (!workItem.ownerStakeholderId) return;
    this.prisma.hyrteStakeholder
      .findUnique({ where: { id: workItem.ownerStakeholderId } })
      .then((owner) => {
        if (!owner?.department) return;
        const isCommitmentMaker = COMMITMENT_DEPARTMENT.test(owner.department) || COMMITMENT_DEPARTMENT.test(owner.role);
        if (!isCommitmentMaker) return;
        setTimeout(() => {
          this.triggerCascade(sessionId, workItem.id, owner.id, decisionId).catch((e) => this.logger.warn(errMsg(e)));
        }, CASCADE_DELAY_MS);
      })
      .catch((e) => this.logger.warn(errMsg(e)));
  }

  private async triggerCascade(sessionId: string, workItemId: string, originStakeholderId: string, causedByDecisionId?: string): Promise<void> {
    const [session, workItem, origin, stakeholders, companyState] = await Promise.all([
      this.prisma.hyrteSession.findUnique({ where: { id: sessionId } }),
      this.prisma.hyrteWorkItem.findUnique({ where: { id: workItemId } }),
      this.prisma.hyrteStakeholder.findUnique({ where: { id: originStakeholderId } }),
      this.prisma.hyrteStakeholder.findMany({ where: { sessionId } }),
      this.prisma.hyrteCompanyState.findUnique({ where: { sessionId } }),
    ]);
    if (!session || !workItem || !origin || !companyState || stakeholders.length === 0) return;
    // Only cascade while the world it's about is still live and the item is
    // still on track — if it got blocked/reassigned since, the commitment
    // this cascade is about may no longer even be real.
    if (session.phase !== 'WORKSPACE_ACTIVE' || workItem.stage === 'BLOCKED') return;

    const downstream = stakeholders.filter((s) => s.id !== origin.id && (s.department ? CAPACITY_DEPARTMENT.test(s.department) : false));
    const candidates = downstream.length > 0 ? downstream : stakeholders.filter((s) => s.id !== origin.id);
    if (candidates.length === 0) return;
    const roster = candidates.map((s) => ({ key: s.id, name: s.name, role: s.role, department: s.department }));

    const result = await this.ai.completeJson<EscalationResponse>(
      [
        {
          role: 'system',
          content:
            'You are generating a cross-functional cascade consequence for a workplace simulation: the ' +
            `candidate just approved "${workItem.title}" — a commitment made by ${origin.name} (${origin.role}). ` +
            'A DIFFERENT stakeholder, from a DIFFERENT (capacity-constrained) department, is now dealing with the ' +
            'downstream strain of that commitment — a realistic knock-on effect (overloaded capacity, a quality ' +
            'shortcut, a missed deadline elsewhere), not a repeat of the same issue. Pick ONE stakeholder from the ' +
            'given roster (by "key"). Return ONLY JSON: {"stakeholderKey": string (must match a roster key), ' +
            '"message": string (2-3 sentences, concrete, naming the specific strain this commitment caused), ' +
            `"companyStateDelta": {<at most 2 of: ${COMPANY_STATE_KEYS.join(', ')}, each -${MAX_DELTA}..${MAX_DELTA}>}}.`,
        },
        {
          role: 'user',
          content:
            `Company: ${session.companyName}. Approved commitment: "${workItem.title}" (priority ${workItem.priority}), ` +
            `owned by ${origin.name} (${origin.department}). Roster: ${JSON.stringify(roster)}. ` +
            `Current company state: ${JSON.stringify(omitMeta(companyState))}.`,
        },
      ],
      { temperature: 0.8, maxTokens: 400 },
    );

    const target = candidates.find((s) => s.id === result.stakeholderKey) ?? candidates[0];
    const text = result.message?.trim();
    if (!text) return;

    const created = await this.prisma.hyrteInboxMessage.create({
      data: { sessionId, fromStakeholderId: target.id, subject: `Re: ${workItem.title} — downstream impact`, body: text, urgent: workItem.priority === 'CRITICAL' },
    });
    this.gateway.broadcast(sessionId, { type: 'inbox:new', message: created });
    if (created.urgent) this.scheduleIgnoredCheck(sessionId, created.id, randomIgnoredWindow());

    // Refinements doc §10 — awaited so its id ties the company-state delta
    // directly to THIS decision, and causedByDecisionId ties this whole
    // decision back to the candidate's original approval — a real 2-hop
    // causal chain (approve → cascade → metrics), not just a shared reason
    // label.
    const cascadeEntry = await this.decisionGraph
      .recordDecision({
        sessionId,
        actor: target.id,
        actionType: 'cascade.downstream_impact',
        payload: { workItemId, originStakeholderId: origin.id },
        outcome: `${target.name} flagged downstream impact from "${workItem.title}": "${text}"`,
        causedByDecisionId,
      })
      .catch((e) => {
        this.logger.warn(e);
        return undefined;
      });

    await this.applyCompanyStateDelta(sessionId, result.companyStateDelta ?? {}, 'cascade_consequence', cascadeEntry?.id);
    this.evidence
      .createEvidence({
        hyrteSessionId: sessionId,
        candidateId: session.candidateId,
        source: 'SIMULATION',
        type: 'SIMULATION_ACTION',
        rawText: `Cross-functional cascade: approving "${workItem.title}" (${origin.name}, ${origin.department}) landed on ${target.name} (${target.department}) — "${text}"`,
        behaviorContext: 'PRESSURE',
        metadata: { workItemId, cascadeFrom: origin.department, cascadeTo: target.department },
      })
      .catch((e) => this.logger.warn(e));
  }

  /**
   * §4.5 Chaos Engine — schedules one wave of 2-3 near-simultaneous events,
   * timed from when the workspace actually unlocks (called from
   * `submitBaselineChallenge`), not from session creation. "Intelligent, not
   * random" is only partly honored here: the wave's *content* reads live
   * company state so it targets whichever KPI is worst, but the *timing*
   * itself is a fixed delay rather than tracking the candidate's own pace of
   * work (that needs action-count/attention instrumentation this pass
   * doesn't build — see ARCHITECTURE.md).
   *
   * Upgrade §4/Step 9 — `calibrationScore` (0-100, from Role Calibration's
   * two scored questions) adjusts the delay: a stronger calibration means
   * less grace period before the first real pressure test, a weaker one
   * means more runway to get oriented first. This is the concrete "adjust
   * event difficulty weights" the doc asks Role Calibration results to do.
   */
  /**
   * Master Build Prompt Part F7 — "difficulty-scaled bursts... at intelligent
   * intervals" (own §4.5 gap-list item: previously only a single wave ever
   * fired). `wave` defaults to 1 for every external caller; wave 2 is
   * self-scheduled by triggerChaosWave once wave 1 actually fires — capped at
   * 2 waves total, a deliberate scope decision, not the doc's open-ended
   * "multiple waves." Dynamic Difficulty — wave 1's delay is still seeded
   * from the one-time Role Calibration score (that's genuinely about
   * first-contact onboarding grace period); every wave after that reads a
   * LIVE performance score off the session's actual current company state
   * (`livePerformanceScore`) instead, so the cadence keeps adapting to how
   * the candidate is *actually doing*, not a snapshot from before they'd
   * done any real work.
   */
  scheduleChaosWave(sessionId: string, calibrationScore?: number, wave = 1): void {
    if (wave > MAX_CHAOS_WAVES) return;
    if (wave === 1) {
      this.scheduleChaosWaveAt(sessionId, chaosWaveDelayFor(calibrationScore), calibrationScore, wave);
      return;
    }
    this.prisma.hyrteCompanyState
      .findUnique({ where: { sessionId } })
      .then((companyState) => {
        const score = companyState ? livePerformanceScore(companyState) : undefined;
        this.scheduleChaosWaveAt(sessionId, chaosWaveCadenceForLiveScore(score), calibrationScore, wave, score);
      })
      .catch((e) => this.logger.warn(errMsg(e)));
  }

  private scheduleChaosWaveAt(sessionId: string, delayMs: number, calibrationScore: number | undefined, wave: number, liveScore?: number): void {
    this.prisma.hyrteWorldEvent
      .create({
        data: { sessionId, kind: 'SCHEDULED', surface: 'chaos_wave', fireAtOffsetSeconds: Math.round(delayMs / 1000), payload: { wave } as unknown as Prisma.InputJsonValue },
      })
      .then((event) => {
        setTimeout(() => {
          this.triggerChaosWave(sessionId, event.id, calibrationScore, wave, liveScore).catch((e) => this.logger.warn(errMsg(e)));
        }, delayMs);
      })
      .catch((e) => this.logger.warn(errMsg(e)));
  }

  private async triggerChaosWave(sessionId: string, eventId: string, calibrationScore?: number, wave = 1, liveScore?: number): Promise<void> {
    const [session, companyState, stakeholders] = await Promise.all([
      this.prisma.hyrteSession.findUnique({ where: { id: sessionId } }),
      this.prisma.hyrteCompanyState.findUnique({ where: { sessionId } }),
      this.prisma.hyrteStakeholder.findMany({ where: { sessionId }, select: { id: true, name: true, role: true } }),
    ]);
    // Session may have already finished (interview/report) by the time this fires — skip quietly.
    if (!session || !companyState || stakeholders.length === 0 || session.phase !== 'WORKSPACE_ACTIVE') {
      await this.prisma.hyrteWorldEvent.update({ where: { id: eventId }, data: { status: 'CANCELLED' } }).catch(() => {});
      return;
    }

    const roster = stakeholders.map((s) => ({ key: s.id, name: s.name, role: s.role }));
    // Part F7 — burst size scales with difficulty, not a fixed 2-3 regardless
    // of how hard the session was configured. Dynamic Difficulty (waves 2+
    // only — wave 1 has no live signal to react to yet) then adapts that
    // difficulty-scaled base UP if the candidate is doing well or DOWN if
    // they're struggling — density of simultaneous pressure adapts, but the
    // per-event stakes below are untouched, matching the doc's own "without
    // making the underlying business problems easier."
    const baseBurstSize = BURST_SIZE_BY_DIFFICULTY[session.difficulty] ?? 3;
    const burstSize = wave === 1 ? baseBurstSize : burstSizeForLiveScore(baseBurstSize, liveScore);

    const result = await this.ai.completeJson<ChaosWaveResponse>(
      [
        {
          role: 'system',
          content:
            `You are the Chaos Engine for a workplace simulation (§4.5): fire ${burstSize} near-simultaneous ` +
            'demands across different channels, all triggered by whichever part of the current company ' +
            'state looks worst — this should feel like several things going wrong at once, not one ' +
            'isolated event. At least ONE pair of these events MUST be a genuine no-right-answer conflict — ' +
            'two different stakeholders wanting incompatible things from the SAME scarce resource (the ' +
            "candidate's time, a shared engineering slot, a single budget line) — not two unrelated asks. " +
            'Return ONLY JSON: {"events": [{"channel": "inbox"|"slack", "stakeholderKey": ' +
            'string (must match a roster key), "subject": string (inbox only), "slackChannel": string ' +
            '("#product"|"#engineering"|"#sales"|"#leadership"|"dm:<stakeholderKey>", slack only), ' +
            '"body": string (2-3 sentences, concrete stakes)}] (exactly ' +
            `${burstSize} entries, mix of inbox and slack, from at least 2 different stakeholders), ` +
            `"companyStateDelta": {<at most 2 of: ${COMPANY_STATE_KEYS.join(', ')}, each -${MAX_DELTA}..${MAX_DELTA}>} ` +
            '(the ambient cost of this wave happening, independent of how the candidate responds)}.',
        },
        {
          role: 'user',
          content:
            `Company: ${session.companyName} (${session.role} role). Current state: ` +
            `${JSON.stringify(omitMeta(companyState))}. Roster: ${JSON.stringify(roster)}.${industryGroundingNote(session.industry)}`,
        },
      ],
      { temperature: 0.9, maxTokens: 900 },
    );

    const events = (result.events ?? []).filter((e) => stakeholders.some((s) => s.id === e.stakeholderKey)).slice(0, burstSize);
    if (events.length === 0) {
      await this.prisma.hyrteWorldEvent.update({ where: { id: eventId }, data: { status: 'CANCELLED' } }).catch(() => {});
      this.scheduleChaosWave(sessionId, calibrationScore, wave + 1);
      return;
    }

    for (const e of events) {
      if (e.channel === 'inbox') {
        const created = await this.prisma.hyrteInboxMessage.create({
          data: {
            sessionId,
            fromStakeholderId: e.stakeholderKey,
            subject: e.subject || 'Urgent',
            body: e.body,
            urgent: true,
          },
        });
        this.gateway.broadcast(sessionId, { type: 'inbox:new', message: created });
        this.scheduleIgnoredCheck(sessionId, created.id, randomIgnoredWindow());
      } else {
        const created = await this.prisma.hyrteSlackMessage.create({
          data: { sessionId, channel: e.slackChannel || '#product', fromStakeholderId: e.stakeholderKey, body: e.body },
        });
        this.gateway.broadcast(sessionId, { type: 'slack:new', message: created });
      }
    }

    await this.applyCompanyStateDelta(sessionId, result.companyStateDelta ?? {}, 'chaos_wave');

    this.evidence
      .createEvidence({
        hyrteSessionId: sessionId,
        candidateId: session.candidateId,
        source: 'SIMULATION',
        type: 'SIMULATION_ACTION',
        rawText: `Chaos wave ${wave} — ${events.length} near-simultaneous demands hit at once: ${events.map((e) => `"${e.body}"`).join(' / ')}`,
        behaviorContext: 'PRESSURE',
        metadata: { chaosWave: true, wave },
      })
      .catch((e) => this.logger.warn(e));

    await this.prisma.hyrteWorldEvent.update({ where: { id: eventId }, data: { status: 'FIRED', firedAt: new Date() } }).catch(() => {});

    this.scheduleChaosWave(sessionId, calibrationScore, wave + 1);
  }

  /**
   * Refinements doc §4 — "The company never pauses... even when the
   * candidate is reading documents or temporarily inactive, AI employees
   * continue discussing work." Fires a short (2-3 turn) exchange between two
   * DIFFERENT stakeholders, in a public channel, that never addresses or
   * even mentions the candidate — the point is that it happens whether or
   * not anyone is watching.
   */
  scheduleAmbientChatter(sessionId: string, cycle = 1): void {
    if (cycle > MAX_AMBIENT_CHATTER_CYCLES) return;
    const delay = AMBIENT_CHATTER_MIN_MS + Math.floor(Math.random() * (AMBIENT_CHATTER_MAX_MS - AMBIENT_CHATTER_MIN_MS));
    setTimeout(() => {
      this.triggerAmbientChatter(sessionId, cycle).catch((e) => this.logger.warn(errMsg(e)));
    }, delay);
  }

  private async triggerAmbientChatter(sessionId: string, cycle: number): Promise<void> {
    const session = await this.prisma.hyrteSession.findUnique({ where: { id: sessionId }, select: { phase: true, companyName: true, role: true } });
    // Same "world may have moved on" guard as every other self-rescheduling
    // chain here — stop quietly instead of chattering into a finished session.
    if (!session || session.phase !== 'WORKSPACE_ACTIVE') return;

    const [stakeholders, companyState, openWorkItems] = await Promise.all([
      this.prisma.hyrteStakeholder.findMany({ where: { sessionId } }),
      this.prisma.hyrteCompanyState.findUnique({ where: { sessionId } }),
      this.prisma.hyrteWorkItem.findMany({
        where: { sessionId, stage: { in: ['NEW', 'DELEGATED', 'IN_PROGRESS', 'WAITING', 'WAITING_REVIEW'] } },
        select: { title: true },
        take: 5,
      }),
    ]);
    if (stakeholders.length < 2 || !companyState) {
      this.scheduleAmbientChatter(sessionId, cycle + 1);
      return;
    }

    const roster = stakeholders.map((s) => ({ key: s.id, name: s.name, role: s.role, department: s.department }));

    const result = await this.ai.completeJson<AmbientChatterResponse>(
      [
        {
          role: 'system',
          content:
            'You are generating AMBIENT background Slack chatter for a workplace simulation — a short exchange ' +
            'BETWEEN TWO STAKEHOLDERS that the candidate merely happens to observe. This is NOT addressed to the ' +
            'candidate and must not mention or reference them at all — it is two colleagues talking to each other ' +
            'about their own work, exactly as they would whether or not anyone else is reading. Pick two DIFFERENT ' +
            'stakeholders from the roster who would plausibly talk to each other right now (same department, or ' +
            'directly dependent departments). Ground the content in something real: an open work item in flight, ' +
            'or the current company state — not generic small talk. Return ONLY JSON: {"channel": one of ' +
            `["#product","#engineering","#sales","#leadership"] (pick whichever best fits the two speakers), ` +
            '"exchange": [{"stakeholderKey": string (must match a roster key), "body": string (1-2 sentences, ' +
            'casual Slack tone, no @mentions of the candidate)}] (exactly 2-3 turns, alternating between the two ' +
            'chosen stakeholders, reading as a real short back-and-forth)}.',
          },
        {
          role: 'user',
          content:
            `Company: ${session.companyName} (${session.role} role). Roster: ${JSON.stringify(roster)}. ` +
            `Open work in flight: ${JSON.stringify(openWorkItems.map((w) => w.title))}. ` +
            `Current company state: ${JSON.stringify(omitMeta(companyState))}.`,
        },
      ],
      { temperature: 0.9, maxTokens: 500 },
    );

    const turns = (result.exchange ?? [])
      .filter((t): t is Required<AmbientChatterTurn> => !!t.stakeholderKey && stakeholders.some((s) => s.id === t.stakeholderKey) && !!t.body?.trim())
      .slice(0, 3);
    // Fewer than 2 turns isn't a "conversation" — skip this cycle rather than post a lone message.
    if (turns.length < 2) {
      this.scheduleAmbientChatter(sessionId, cycle + 1);
      return;
    }

    const channel = AMBIENT_CHANNELS.includes(result.channel as (typeof AMBIENT_CHANNELS)[number]) ? result.channel! : '#product';
    this.postAmbientTurn(sessionId, channel, turns, 0);
    this.scheduleAmbientChatter(sessionId, cycle + 1);
  }

  /** Posts one turn of an ambient exchange, then schedules the next after a short human-like gap — checking the
   * session is still live before each post, since a candidate could finish mid-exchange. */
  private postAmbientTurn(sessionId: string, channel: string, turns: Required<AmbientChatterTurn>[], idx: number): void {
    if (idx >= turns.length) return;
    const delay = idx === 0 ? 0 : AMBIENT_TURN_MIN_GAP_MS + Math.floor(Math.random() * (AMBIENT_TURN_MAX_GAP_MS - AMBIENT_TURN_MIN_GAP_MS));
    setTimeout(() => {
      this.prisma.hyrteSession
        .findUnique({ where: { id: sessionId }, select: { phase: true } })
        .then((s) => (s && s.phase === 'WORKSPACE_ACTIVE' ? this.prisma.hyrteSlackMessage.create({
          data: { sessionId, channel, fromStakeholderId: turns[idx].stakeholderKey, body: turns[idx].body.trim() },
        }) : null))
        .then((created) => {
          if (created) this.gateway.broadcast(sessionId, { type: 'slack:new', message: created });
          this.postAmbientTurn(sessionId, channel, turns, idx + 1);
        })
        .catch((e) => this.logger.warn(errMsg(e)));
    }, delay);
  }
}

/** Upgrade §4/Step 9 — weaker calibration gets more runway before the first real pressure test; stronger calibration gets less. */
function chaosWaveDelayFor(calibrationScore?: number): number {
  if (typeof calibrationScore !== 'number' || Number.isNaN(calibrationScore)) return CHAOS_WAVE_DELAY_MS;
  const multiplier = calibrationScore < 40 ? 1.5 : calibrationScore > 75 ? 0.6 : 1;
  return Math.round(CHAOS_WAVE_DELAY_MS * multiplier);
}

/** Health-flavored keys count UP as good; the rest count as bad the higher they climb — same split used for Role-Specific reports elsewhere. */
const LIVE_SCORE_POSITIVE_KEYS: CompanyStateKey[] = ['customerSatisfaction', 'revenue', 'teamMorale', 'productQuality', 'marketReputation', 'growth'];
const LIVE_SCORE_NEGATIVE_KEYS: CompanyStateKey[] = ['riskLevel', 'burnout', 'technicalDebt', 'complianceRisk', 'operationalRisk', 'deadlinePressure'];

/**
 * Doc's own "Dynamic Difficulty" — a live, ongoing read of how the
 * candidate is actually doing, derived from the company state they've
 * already been shaping through every decision so far. Deterministic, not
 * LLM-guessed: 0 = things are falling apart, 100 = things are going well.
 */
export function livePerformanceScore(companyState: Partial<Record<CompanyStateKey, number>>): number {
  const avg = (keys: CompanyStateKey[]) => {
    const values = keys.map((k) => (typeof companyState[k] === 'number' ? (companyState[k] as number) : 50));
    return values.reduce((a, b) => a + b, 0) / values.length;
  };
  const positive = avg(LIVE_SCORE_POSITIVE_KEYS);
  const negative = avg(LIVE_SCORE_NEGATIVE_KEYS);
  return Math.max(0, Math.min(100, Math.round((positive + (100 - negative)) / 2)));
}

/** Doing well → shorter cadence (more pressure, "tighter deadlines" per the doc); struggling → longer cadence ("reduces the level of chaos"). */
export function chaosWaveCadenceForLiveScore(liveScore?: number): number {
  if (typeof liveScore !== 'number' || Number.isNaN(liveScore)) return CHAOS_WAVE_CADENCE_MS;
  const multiplier = liveScore < 35 ? 1.6 : liveScore > 70 ? 0.65 : 1;
  return Math.round(CHAOS_WAVE_CADENCE_MS * multiplier);
}

/** Same doing-well/struggling logic applied to simultaneous-demand density instead of timing — "fewer simultaneous interruptions" vs. more, per the doc, never touching the stakes of any individual event. */
export function burstSizeForLiveScore(baseBurstSize: number, liveScore?: number): number {
  if (typeof liveScore !== 'number' || Number.isNaN(liveScore)) return baseBurstSize;
  const adjustment = liveScore < 35 ? -1 : liveScore > 70 ? 1 : 0;
  return Math.max(CHAOS_WAVE_BURST_MIN, Math.min(CHAOS_WAVE_BURST_MAX, baseBurstSize + adjustment));
}

function clampDelta(n: unknown, max = MAX_DELTA): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : 0;
  return Math.max(-max, Math.min(max, v));
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Strips Prisma's sessionId/updatedAt so the prompt only sees KPI values. */
function omitMeta(state: Record<string, unknown>): Record<string, unknown> {
  const { sessionId: _sessionId, updatedAt: _updatedAt, ...rest } = state;
  return rest;
}
