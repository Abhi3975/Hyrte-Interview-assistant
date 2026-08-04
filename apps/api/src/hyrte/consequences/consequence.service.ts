import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AIService } from '../../ai/ai.service';
import { HyrteGateway } from '../hyrte.gateway';
import { EvidenceGraphService } from '../dig/evidence-graph.service';
import { DecisionGraphService } from '../dig/decision-graph.service';
import { OMIT_HIDDEN_INTENTION } from '../dig/hidden-intention.util';

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
/** §4.5 Chaos Engine — a single wave, timed from workspace unlock, not from random ticks. */
const CHAOS_WAVE_DELAY_MS = 100_000;
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
  async applyCompanyStateDelta(sessionId: string, delta: CompanyStateDelta, reason?: string): Promise<void> {
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
        .create({ data: { sessionId, delta: Object.fromEntries(entries) as Prisma.InputJsonValue, reason } })
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

      await this.applyCompanyStateDelta(sessionId, result.companyStateDelta ?? {}, 'task_completion');

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
    const message = await this.prisma.hyrteInboxMessage.findUnique({ where: { id: messageId } });
    if (!message || message.readAt) {
      await this.prisma.hyrteWorldEvent.update({ where: { id: eventId }, data: { status: 'CANCELLED' } }).catch(() => {});
      return; // acted on in time — no consequence
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

      await this.applyCompanyStateDelta(sessionId, result.companyStateDelta ?? {}, `escalation_hop_${hop}`);

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

      // §3.5 Decision Graph — inaction is itself a decision node (the doc's
      // own canonical example: "read customer email → ignored → customer
      // trust decreased → customer escalated"). Nothing wrote this before —
      // only the evidence object above existed, with no corresponding graph
      // node, so reasoning/outcome/riskAssessment were never populated for
      // this trigger type at all.
      this.decisionGraph
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
          omit: OMIT_HIDDEN_INTENTION,
        });
        this.gateway.broadcast(sessionId, { type: 'stakeholder:update', stakeholder: updated });
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
  scheduleChaosWave(sessionId: string, calibrationScore?: number): void {
    const delayMs = chaosWaveDelayFor(calibrationScore);
    this.prisma.hyrteWorldEvent
      .create({
        data: { sessionId, kind: 'SCHEDULED', surface: 'chaos_wave', fireAtOffsetSeconds: Math.round(delayMs / 1000) },
      })
      .then((event) => {
        setTimeout(() => {
          this.triggerChaosWave(sessionId, event.id).catch((e) => this.logger.warn(errMsg(e)));
        }, delayMs);
      })
      .catch((e) => this.logger.warn(errMsg(e)));
  }

  private async triggerChaosWave(sessionId: string, eventId: string): Promise<void> {
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

    const result = await this.ai.completeJson<ChaosWaveResponse>(
      [
        {
          role: 'system',
          content:
            'You are the Chaos Engine for a workplace simulation (§4.5): fire 2-3 near-simultaneous ' +
            'demands across different channels, all triggered by whichever part of the current company ' +
            'state looks worst — this should feel like several things going wrong at once, not one ' +
            'isolated event. Return ONLY JSON: {"events": [{"channel": "inbox"|"slack", "stakeholderKey": ' +
            'string (must match a roster key), "subject": string (inbox only), "slackChannel": string ' +
            '("#product"|"#engineering"|"#sales"|"#leadership"|"dm:<stakeholderKey>", slack only), ' +
            '"body": string (2-3 sentences, concrete stakes)}] (exactly 2-3 entries, mix of inbox and ' +
            'slack, from at least 2 different stakeholders), "companyStateDelta": {<at most 2 of: ' +
            `${COMPANY_STATE_KEYS.join(', ')}, each -${MAX_DELTA}..${MAX_DELTA}>} (the ambient cost of ` +
            'this wave happening, independent of how the candidate responds)}.',
        },
        {
          role: 'user',
          content:
            `Company: ${session.companyName} (${session.role} role). Current state: ` +
            `${JSON.stringify(omitMeta(companyState))}. Roster: ${JSON.stringify(roster)}.`,
        },
      ],
      { temperature: 0.9, maxTokens: 700 },
    );

    const events = (result.events ?? []).filter((e) => stakeholders.some((s) => s.id === e.stakeholderKey)).slice(0, 3);
    if (events.length === 0) {
      await this.prisma.hyrteWorldEvent.update({ where: { id: eventId }, data: { status: 'CANCELLED' } }).catch(() => {});
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
        rawText: `A wave of ${events.length} near-simultaneous demands hit at once: ${events.map((e) => `"${e.body}"`).join(' / ')}`,
        behaviorContext: 'PRESSURE',
        metadata: { chaosWave: true },
      })
      .catch((e) => this.logger.warn(e));

    await this.prisma.hyrteWorldEvent.update({ where: { id: eventId }, data: { status: 'FIRED', firedAt: new Date() } }).catch(() => {});
  }
}

/** Upgrade §4/Step 9 — weaker calibration gets more runway before the first real pressure test; stronger calibration gets less. */
function chaosWaveDelayFor(calibrationScore?: number): number {
  if (typeof calibrationScore !== 'number' || Number.isNaN(calibrationScore)) return CHAOS_WAVE_DELAY_MS;
  const multiplier = calibrationScore < 40 ? 1.5 : calibrationScore > 75 ? 0.6 : 1;
  return Math.round(CHAOS_WAVE_DELAY_MS * multiplier);
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
