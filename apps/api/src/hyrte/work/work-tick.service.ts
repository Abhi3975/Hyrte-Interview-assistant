import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AIService } from '../../ai/ai.service';
import { HyrteGateway } from '../hyrte.gateway';
import { HyrteConsequenceService } from '../consequences/consequence.service';
import { getVisibleStateKeys } from '../dig/info-scope.util';
import { EvidenceGraphService } from '../dig/evidence-graph.service';
import { DecisionGraphService } from '../dig/decision-graph.service';
import { COMPANY_STATE_KEYS } from '../consequences/consequence.service';

const TICK1_BASE_MS = 20_000;
const TICK2_BASE_MS = 45_000;
const ORCHESTRATOR_INTERVAL_MS = 90_000;
/** Deliberate cap, same reasoning as the chaos wave's 2-wave cap — "periodic" for a compressed session, not literally forever. */
const MAX_ORCHESTRATOR_CYCLES = 4;

interface OrchestratorReviewResult {
  needsNewWork?: boolean;
  targetStakeholderKey?: string;
  workItemTitle?: string;
  workItemType?: string;
  priority?: string;
  dueInHours?: number;
  managerNote?: string;
}
/** Higher stress → slower AND, via the prompt, rougher output; higher trust → faster AND more polished — Part F4. */
function speedMultiplier(stress: number, trust: number): number {
  return Math.max(0.5, Math.min(2, 1 + (stress / 100) * 0.5 - (trust / 100) * 0.3));
}

interface WorkArtifactResult {
  artifactType?: string;
  content?: string;
  // Refinements doc §6 — "Delegate part of the work." Optional: only present
  // when the stakeholder genuinely hands off a slice of it to a named
  // colleague rather than doing all of it themselves.
  subDelegateToKey?: string;
  subDelegateTitle?: string;
  subDelegateNote?: string;
}

/** How much workload a stakeholder is realistically willing to sub-delegate under — mirrors the command bar's own reject-on-overload signal. */
const SUB_DELEGATE_ELIGIBLE_MIN_STRESS = 55;

/** Strips Prisma's own bookkeeping fields so the prompt only sees KPI values. */
function omitMeta(state: Record<string, unknown>): Record<string, unknown> {
  const { sessionId: _s, updatedAt: _u, ...rest } = state;
  return rest;
}

type HistoryEntry = { at: string; actor: string; action: string; note?: string };

/**
 * Master Build Prompt Part F4 — Autonomous execution. A stakeholder-owned
 * Work Item (created only via command-bar delegation today — G1's
 * generation-seeded items are still all candidate-owned) progresses on its
 * own in two ticks: NEW → IN_PROGRESS (an ambient "started on it" signal)
 * then IN_PROGRESS → WAITING_REVIEW (a real LLM-produced artifact in that
 * stakeholder's voice, landing in Needs Review). Same bare-setTimeout +
 * persisted-row pattern as every other delayed mechanic in this codebase
 * (HyrteConsequenceService) — no new scheduling infrastructure.
 */
@Injectable()
export class HyrteWorkTickService {
  private readonly logger = new Logger(HyrteWorkTickService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AIService,
    private readonly gateway: HyrteGateway,
    private readonly consequences: HyrteConsequenceService,
    private readonly evidence: EvidenceGraphService,
    private readonly decisionGraph: DecisionGraphService,
  ) {}

  /**
   * Master Build Prompt Part F3 — Orchestrator routing. "The Manager/CEO runs
   * periodic context reviews... routes new work to stakeholders." Everything
   * built through G5 only created work items reactively (candidate delegation
   * via the command bar) — nothing initiated on its own. This is the missing
   * "who/when decides" piece; it reuses the entire existing Work Item +
   * work-tick pipeline for the "what happens next" piece (scheduleStart).
   * Same self-rescheduling, capped-cycle pattern as
   * HyrteConsequenceService.scheduleChaosWave's wave 2.
   */
  scheduleOrchestratorReview(sessionId: string, cycle = 1): void {
    if (cycle > MAX_ORCHESTRATOR_CYCLES) return;
    setTimeout(() => {
      this.runOrchestratorReview(sessionId, cycle).catch((e) => this.logger.warn(e));
    }, ORCHESTRATOR_INTERVAL_MS);
  }

  private async runOrchestratorReview(sessionId: string, cycle: number): Promise<void> {
    const session = await this.prisma.hyrteSession.findUnique({ where: { id: sessionId } });
    // Session may have finished (interview/report) by the time this fires — stop the chain quietly.
    if (!session || session.phase !== 'WORKSPACE_ACTIVE') return;

    const [stakeholders, companyState, openWorkItems] = await Promise.all([
      this.prisma.hyrteStakeholder.findMany({ where: { sessionId } }),
      this.prisma.hyrteCompanyState.findUnique({ where: { sessionId } }),
      this.prisma.hyrteWorkItem.findMany({ where: { sessionId, stage: { in: ['NEW', 'IN_PROGRESS', 'WAITING_REVIEW'] } }, select: { title: true, ownerStakeholderId: true } }),
    ]);
    if (stakeholders.length === 0 || !companyState) {
      this.scheduleOrchestratorReview(sessionId, cycle + 1);
      return;
    }

    // The manager is the highest-authority stakeholder — same deterministic
    // derivation as the Mission Brief's manager and hop-3 escalations, never
    // LLM-guessed.
    const manager = stakeholders.reduce((a, b) => ((b.authorityLevel ?? 50) > (a.authorityLevel ?? 50) ? b : a));
    const roster = stakeholders.filter((s) => s.id !== manager.id).map((s) => ({ key: s.id, name: s.name, role: s.role, department: s.department }));
    const openTitles = openWorkItems.map((w) => w.title);

    const result = await this.ai.completeJson<OrchestratorReviewResult>(
      [
        {
          role: 'system',
          content:
            `You are ${manager.name}, ${manager.role} — doing a periodic context review of the company, not ` +
            'reacting to anything specific. Given the current company state and what is ALREADY in flight (don\'t ' +
            'duplicate it), decide: does something genuinely need to be created and assigned to someone RIGHT NOW, ' +
            'or is everything under control? Be conservative — most reviews should find nothing new is needed. ' +
            'Return ONLY JSON: {"needsNewWork": boolean, "targetStakeholderKey": string (only if true, must match ' +
            'a roster key), "workItemTitle": string (only if true, short and concrete, grounded in a REAL weak ' +
            `spot in the company state below), "workItemType": one of ["document","reply","decision","approval",` +
            `"build","analysis","meeting_outcome"], "priority": one of ["low","medium","high","critical"], ` +
            '"dueInHours": int, "managerNote": string (only if true — 1 sentence, in your voice, telling the ' +
            'candidate what you just assigned and why, as an FYI, not a request for permission).',
        },
        {
          role: 'user',
          content:
            `Company: ${session.companyName}. Current state: ${JSON.stringify(Object.fromEntries(COMPANY_STATE_KEYS.map((k) => [k, companyState[k]])))}. ` +
            `Roster: ${JSON.stringify(roster)}. Already in-flight work: ${JSON.stringify(openTitles)}.`,
        },
      ],
      { temperature: 0.6, maxTokens: 400 },
    );

    if (!result.needsNewWork || !result.targetStakeholderKey) {
      this.scheduleOrchestratorReview(sessionId, cycle + 1);
      return;
    }
    const target = stakeholders.find((s) => s.id === result.targetStakeholderKey);
    if (!target) {
      this.scheduleOrchestratorReview(sessionId, cycle + 1);
      return;
    }

    const priority = (['low', 'medium', 'high', 'critical'].includes((result.priority ?? '').toLowerCase()) ? result.priority!.toUpperCase() : 'MEDIUM') as
      | 'LOW'
      | 'MEDIUM'
      | 'HIGH'
      | 'CRITICAL';
    const type = (['document', 'reply', 'decision', 'approval', 'build', 'analysis', 'meeting_outcome'].includes((result.workItemType ?? '').toLowerCase())
      ? result.workItemType!.toUpperCase()
      : 'DOCUMENT') as 'DOCUMENT' | 'REPLY' | 'DECISION' | 'APPROVAL' | 'BUILD' | 'ANALYSIS' | 'MEETING_OUTCOME';
    const title = result.workItemTitle?.trim() || `Follow up with ${target.name}`;
    const dueInHours = typeof result.dueInHours === 'number' && result.dueInHours > 0 ? result.dueInHours : 24;

    const workItem = await this.prisma.hyrteWorkItem.create({
      data: {
        sessionId,
        title,
        type,
        priority,
        origin: 'ORCHESTRATOR',
        ownerStakeholderId: target.id,
        dueAt: new Date(Date.now() + dueInHours * 3_600_000),
        history: [{ at: new Date().toISOString(), actor: manager.name, action: 'routed', note: `Routed by ${manager.name} during a periodic review` }] as unknown as Prisma.InputJsonValue,
      },
    });
    this.gateway.broadcast(sessionId, { type: 'task:update', task: workItem });

    const managerNote = result.managerNote?.trim() || `Heads up — I've asked ${target.name} to take a look at "${title}".`;
    const created = await this.prisma.hyrteInboxMessage.create({
      data: { sessionId, fromStakeholderId: manager.id, subject: `FYI: ${title}`, body: managerNote, urgent: false },
    });
    this.gateway.broadcast(sessionId, { type: 'inbox:new', message: created });

    await this.decisionGraph.recordDecision({
      sessionId,
      actor: manager.id,
      actionType: 'orchestrator.route',
      payload: { workItemId: workItem.id, targetStakeholderId: target.id },
      outcome: `${manager.name} routed "${title}" to ${target.name}`,
    });
    this.evidence
      .createEvidence({
        hyrteSessionId: sessionId,
        candidateId: session.candidateId,
        source: 'SIMULATION',
        type: 'SIMULATION_ACTION',
        rawText: `${manager.name} (${manager.role}) proactively routed "${title}" to ${target.name} during a periodic review — the candidate did not initiate this.`,
        metadata: { workItemId: workItem.id, origin: 'ORCHESTRATOR' },
      })
      .catch((e) => this.logger.warn(e));

    this.scheduleStart(workItem.id);
    this.scheduleOrchestratorReview(sessionId, cycle + 1);
  }

  /** Call right after a Work Item is delegated to a stakeholder (or reassigned to one). */
  scheduleStart(workItemId: string): void {
    this.prisma.hyrteWorkItem
      .findUnique({ where: { id: workItemId }, include: { ownerStakeholder: true } })
      .then((item) => {
        if (!item?.ownerStakeholder) return;
        const delay = TICK1_BASE_MS * speedMultiplier(item.ownerStakeholder.stress, item.ownerStakeholder.trust);
        setTimeout(() => this.tick1(workItemId).catch((e) => this.logger.warn(e)), delay);
      })
      .catch((e) => this.logger.warn(e));
  }

  /** Call when a "request_changes" review sends a Work Item back for revision. */
  scheduleRevision(workItemId: string, note: string): void {
    this.prisma.hyrteWorkItem
      .findUnique({ where: { id: workItemId }, include: { ownerStakeholder: true } })
      .then((item) => {
        if (!item?.ownerStakeholder) return;
        const delay = TICK2_BASE_MS * speedMultiplier(item.ownerStakeholder.stress, item.ownerStakeholder.trust);
        setTimeout(() => this.tick2(workItemId, note).catch((e) => this.logger.warn(e)), delay);
      })
      .catch((e) => this.logger.warn(e));
  }

  private async appendHistory(workItemId: string, entry: HistoryEntry): Promise<Prisma.JsonArray> {
    const item = await this.prisma.hyrteWorkItem.findUnique({ where: { id: workItemId }, select: { history: true } });
    const history = Array.isArray(item?.history) ? (item!.history as unknown as HistoryEntry[]) : [];
    return [...history, entry] as unknown as Prisma.JsonArray;
  }

  private async tick1(workItemId: string): Promise<void> {
    const item = await this.prisma.hyrteWorkItem.findUnique({ where: { id: workItemId }, include: { ownerStakeholder: true } });
    if (!item || item.stage !== 'NEW' || !item.ownerStakeholder) return;

    const history = await this.appendHistory(workItemId, {
      at: new Date().toISOString(),
      actor: item.ownerStakeholder.name,
      action: 'started',
      note: `Started work on "${item.title}"`,
    });
    const updated = await this.prisma.hyrteWorkItem.update({
      where: { id: workItemId },
      data: { stage: 'IN_PROGRESS', history },
    });
    this.gateway.broadcast(item.sessionId, { type: 'task:update', task: updated });

    // Ambient aliveness (Acceptance Suite #1) — a real, work-item-grounded
    // status ping, not a random idle-chatter timer.
    const dept = item.ownerStakeholder.department;
    const channel = dept ? `#${dept.toLowerCase().replace(/\s+/g, '-')}` : '#product';
    const created = await this.prisma.hyrteSlackMessage.create({
      data: {
        sessionId: item.sessionId,
        channel,
        fromStakeholderId: item.ownerStakeholder.id,
        body: `Starting on "${item.title}" now.`,
      },
    });
    this.gateway.broadcast(item.sessionId, { type: 'slack:new', message: created });

    const delay = TICK2_BASE_MS * speedMultiplier(item.ownerStakeholder.stress, item.ownerStakeholder.trust);
    setTimeout(() => this.tick2(workItemId).catch((e) => this.logger.warn(e)), delay);
  }

  private async tick2(workItemId: string, revisionNote?: string): Promise<void> {
    const item = await this.prisma.hyrteWorkItem.findUnique({ where: { id: workItemId }, include: { ownerStakeholder: true, session: true } });
    if (!item || (item.stage !== 'IN_PROGRESS' && !revisionNote) || !item.ownerStakeholder) return;

    const stakeholder = item.ownerStakeholder;
    const companyState = await this.prisma.hyrteCompanyState.findUnique({ where: { sessionId: item.sessionId } });
    const visibleKeys = getVisibleStateKeys(stakeholder.role);
    const scopedState = companyState
      ? Object.fromEntries(Object.entries(omitMeta(companyState)).filter(([k]) => visibleKeys.includes(k as never)))
      : {};

    // Refinements doc §6 — "Miss the deadline". Two real, deterministic
    // signals, computed up front so the artifact's own voice can acknowledge
    // it (same pattern as revisionNote below) rather than silently attaching
    // a flag nobody in-fiction reacts to: (1) the item's own dueAt, set in
    // real wall-clock hours (same pattern as every other due date in this
    // codebase — tasks, calendar events, signature artifacts) — only fires
    // for a genuinely short-fuse item, since a session runs ~20-40 minutes,
    // but still worth checking honestly. (2) speedMultiplier is the SAME
    // live number that already drives how long tick1/tick2 actually take —
    // a meaningfully-above-baseline value (>1.3, vs. the 0.5-2.0 range)
    // means this stakeholder is genuinely, observably slower than a
    // well-run delegation, which is what "missed the deadline" stands in
    // for at this session's compressed timescale.
    const speedFactor = speedMultiplier(stakeholder.stress, stakeholder.trust);
    const isLate = (!!item.dueAt && new Date() > item.dueAt) || speedFactor > 1.3;

    // Refinements doc §6 — "Delegate part of the work" is only offered as an
    // option to a genuinely stretched stakeholder, and never mid-revision
    // (a revision is already a narrower, near-final ask).
    const subDelegateEligible = !revisionNote && stakeholder.stress >= SUB_DELEGATE_ELIGIBLE_MIN_STRESS;
    const roster = subDelegateEligible
      ? (await this.prisma.hyrteStakeholder.findMany({ where: { sessionId: item.sessionId, id: { not: stakeholder.id } }, select: { id: true, name: true, role: true, department: true } })).map((s) => ({
          key: s.id,
          name: s.name,
          role: s.role,
          department: s.department,
        }))
      : [];

    const result = await this.ai.completeJson<WorkArtifactResult>(
      [
        {
          role: 'system',
          content:
            'You are generating a real work artifact for a workplace simulation — the actual output a ' +
            `stakeholder produces for a work item, in their own voice. Your current stress is ${stakeholder.stress}/100 ` +
            `and trust in the candidate is ${stakeholder.trust}/100 — HIGH stress should read as visibly rushed/terser/less ` +
            `polished, LOW stress and HIGH trust should read as more thorough and considered. ${revisionNote ? `The candidate requested changes: "${revisionNote}" — address this directly in the revision. ` : ''}` +
            `${isLate ? 'This is landing later than you promised — briefly, naturally acknowledge that in your own voice (not a formal apology, just how a real busy colleague would mention it). ' : ''}` +
            'Return ONLY JSON: {"artifactType": "draft_email"|"doc"|"spec"|"report", "content": string (the ' +
            'actual work product text, 3-8 sentences, concrete and specific to the work item — not a summary ' +
            'of what you did, the actual thing itself)' +
            (roster.length
              ? ', "subDelegateToKey": string|omit (OPTIONAL — you\'re stretched thin right now; only include this ' +
                'if a genuine, clearly-separable PART of this work item realistically belongs with a specific ' +
                'colleague on the roster below, e.g. their domain expertise fits it better or it is a natural ' +
                'hand-off — do NOT use this just because you are busy, most of the time you should still do the ' +
                'whole thing yourself), "subDelegateTitle": string (only if subDelegateToKey set — short, concrete ' +
                'title for the sub-task), "subDelegateNote": string (only if subDelegateToKey set — 1 sentence, ' +
                'in your voice, why you\'re handing this slice off)'
              : '') +
            '}.',
        },
        {
          role: 'user',
          content:
            `You are ${stakeholder.name}, ${stakeholder.role}. Work item: "${item.title}" (type: ${item.type}, ` +
            `priority: ${item.priority}). Company: ${item.session.companyName}. What you can see of company state: ` +
            `${JSON.stringify(scopedState)}.` +
            (roster.length ? ` Colleagues you could hand off part of this to: ${JSON.stringify(roster)}.` : ''),
        },
      ],
      { temperature: 0.8, maxTokens: 550 },
    );

    const artifact = {
      type: result.artifactType && typeof result.artifactType === 'string' ? result.artifactType : 'doc',
      content: result.content && typeof result.content === 'string' ? result.content : `${stakeholder.name} completed work on "${item.title}".`,
    };
    const priorArtifacts = Array.isArray(item.artifacts) ? item.artifacts : [];

    const history = await this.appendHistory(workItemId, {
      at: new Date().toISOString(),
      actor: stakeholder.name,
      action: revisionNote ? 'revised' : 'submitted_for_review',
      note:
        (revisionNote ? `Revised per feedback: "${revisionNote}"` : `Submitted "${item.title}" for review`) +
        (isLate ? ' — after the original deadline had already passed' : ''),
    });

    const updated = await this.prisma.hyrteWorkItem.update({
      where: { id: workItemId },
      data: {
        stage: 'WAITING_REVIEW',
        artifacts: [...priorArtifacts, artifact] as unknown as Prisma.InputJsonValue,
        review: { requiredFrom: item.session.candidateId, requestedAt: new Date().toISOString(), decidedAt: null, decision: null, late: isLate } as unknown as Prisma.InputJsonValue,
        history,
      },
    });
    this.gateway.broadcast(item.sessionId, { type: 'task:update', task: updated });

    // Refinements doc §6 — "Delegate part of the work": a real second Work
    // Item, owned by the named colleague, linked back via
    // delegatedFromItemId — not just a mention in the artifact text.
    const subDelegateTarget = result.subDelegateToKey ? roster.find((r) => r.key === result.subDelegateToKey) : undefined;
    if (subDelegateTarget) {
      const subTitle = result.subDelegateTitle?.trim() || `Part of "${item.title}" (handed off by ${stakeholder.name})`;
      const subNote = result.subDelegateNote?.trim() || `${stakeholder.name} handed this off — it fits your area better.`;
      const subItem = await this.prisma.hyrteWorkItem.create({
        data: {
          sessionId: item.sessionId,
          title: subTitle,
          type: item.type,
          priority: item.priority,
          origin: 'CANDIDATE_DELEGATION',
          ownerStakeholderId: subDelegateTarget.key,
          delegatedFromItemId: item.id,
          dueAt: item.dueAt,
          history: [{ at: new Date().toISOString(), actor: stakeholder.name, action: 'sub_delegated', note: subNote }] as unknown as Prisma.InputJsonValue,
        },
      });
      this.gateway.broadcast(item.sessionId, { type: 'task:update', task: subItem });
      this.scheduleStart(subItem.id);

      const subMsg = await this.prisma.hyrteInboxMessage.create({
        data: { sessionId: item.sessionId, fromStakeholderId: stakeholder.id, subject: `Heads up: handed off part of "${item.title}"`, body: `${subNote} I've looped in ${subDelegateTarget.name} for that part — the rest is still on me.` },
      });
      this.gateway.broadcast(item.sessionId, { type: 'inbox:new', message: subMsg });

      await this.decisionGraph.recordDecision({
        sessionId: item.sessionId,
        actor: stakeholder.id,
        actionType: 'work_item.sub_delegate',
        payload: { workItemId: item.id, subItemId: subItem.id, toStakeholderId: subDelegateTarget.key },
        outcome: `${stakeholder.name} sub-delegated part of "${item.title}" to ${subDelegateTarget.name}`,
      });
    }

    // Part F9 — delegated work actually landing (or not) is direct evidence
    // of the candidate's delegation quality/follow-through, but work-tick
    // completions wrote nothing to the Evidence Graph until now — structurally
    // invisible to report generation despite being a real outcome of a real
    // candidate decision (the delegation itself).
    this.evidence
      .createEvidence({
        hyrteSessionId: item.sessionId,
        candidateId: item.session.candidateId,
        source: 'SIMULATION',
        type: 'SIMULATION_ACTION',
        rawText: `${stakeholder.name} ${revisionNote ? 'revised and resubmitted' : 'completed and submitted'} the delegated work item "${item.title}" (priority ${item.priority}), landing in the candidate's Needs Review queue.`,
        metadata: { workItemId, delegated: item.origin === 'CANDIDATE_DELEGATION', revised: !!revisionNote },
      })
      .catch((e) => this.logger.warn(e));

    // Ignoring a critical/high review has the same real consequence shape as
    // ignoring an urgent inbox message (Part F5: "ignored critical reviews
    // fire escalation chains") — reuses the exact HyrteConsequenceService
    // mechanism rather than a parallel one.
    if (item.priority === 'CRITICAL' || item.priority === 'HIGH') {
      this.consequences.scheduleReviewIgnoredCheck(item.sessionId, workItemId, 60_000);
    }
  }
}
