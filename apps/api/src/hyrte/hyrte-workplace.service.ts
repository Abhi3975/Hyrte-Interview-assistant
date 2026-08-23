import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { BehaviorContext, EvidenceType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { HyrteGateway } from './hyrte.gateway';
import {
  AddInboxNoteDto,
  ArchiveInboxDto,
  CommandBarDto,
  FlagInboxDto,
  ForwardInboxDto,
  ReplyInboxDto,
  ScheduleReminderDto,
  SendMeetingMessageDto,
  SendSlackMessageDto,
  UpdateWorkItemDto,
  WorkItemReviewDto,
} from './dto/hyrte.dto';
import { HyrteStakeholderAgentService } from './agents/stakeholder-agent.service';
import { HyrteConsequenceService } from './consequences/consequence.service';
import { DecisionGraphService } from './dig/decision-graph.service';
import { EvidenceGraphService } from './dig/evidence-graph.service';
import { inferContextFromRole } from './dig/behavior-context.util';
import { OMIT_CANDIDATE_INTERNALS } from './dig/hidden-intention.util';
import { HyrteWorkTickService } from './work/work-tick.service';
import { HyrteCommandBarService, CommandBarResult } from './work/command-bar.service';
import { HyrteMeetingService } from './meetings/meeting.service';

/** §4.12 Layers 5/9/11 — chance a stakeholder NOT party to an exchange independently reacts to it. Not 100%: constant chatter reads as noise, not signal. */
const INDEPENDENT_REACTION_PROBABILITY = 0.5;
/** Doc §3 "Schedule reminder" — default when the candidate doesn't pick a specific time. */
const DEFAULT_REMINDER_MS = 5 * 60_000;

@Injectable()
export class HyrteWorkplaceService {
  private readonly logger = new Logger(HyrteWorkplaceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: HyrteGateway,
    private readonly agent: HyrteStakeholderAgentService,
    private readonly consequences: HyrteConsequenceService,
    private readonly decisionGraph: DecisionGraphService,
    private readonly evidence: EvidenceGraphService,
    private readonly workTicks: HyrteWorkTickService,
    private readonly commandBar: HyrteCommandBarService,
    private readonly meetings: HyrteMeetingService,
  ) {}

  private async assertOwnership(sessionId: string, candidateId: string): Promise<void> {
    const session = await this.prisma.hyrteSession.findFirst({
      where: { id: sessionId, candidateId },
      select: { id: true },
    });
    if (!session) throw new NotFoundException('Session not found');
  }

  /**
   * Every workplace action writes a DIG Decision Graph node (write-path
   * contract) AND a Candidate Evidence Graph object (§3.1) describing what
   * happened — Phase 2's "writing every action into the Evidence Graph".
   * Evidence writes are fire-and-forget: a failed evidence write should never
   * block the candidate's action from completing.
   */
  private async logDecision(
    sessionId: string,
    candidateId: string,
    actionType: string,
    payload: Record<string, unknown>,
    evidenceText: string,
    options?: { type?: EvidenceType; behaviorContext?: BehaviorContext; recoveryOfId?: string },
  ) {
    const entry = await this.decisionGraph.recordDecision({ sessionId, actor: candidateId, actionType, payload, recoveryOfId: options?.recoveryOfId });
    this.evidence
      .createEvidence({
        hyrteSessionId: sessionId,
        candidateId,
        source: 'SIMULATION',
        type: options?.type ?? 'SIMULATION_ACTION',
        rawText: evidenceText,
        behaviorContext: options?.behaviorContext,
      })
      .catch((e) => this.logger.warn(e));
    return entry;
  }

  // ── Inbox ──

  async listInbox(sessionId: string, candidateId: string) {
    await this.assertOwnership(sessionId, candidateId);
    return this.prisma.hyrteInboxMessage.findMany({
      where: { sessionId },
      include: { fromStakeholder: { omit: OMIT_CANDIDATE_INTERNALS } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async replyInbox(sessionId: string, messageId: string, dto: ReplyInboxDto, candidateId: string) {
    await this.assertOwnership(sessionId, candidateId);
    const message = await this.prisma.hyrteInboxMessage.findFirst({
      where: { id: messageId, sessionId },
      include: { fromStakeholder: { select: { role: true } } },
    });
    if (!message) throw new NotFoundException('Message not found');

    await this.prisma.hyrteInboxMessage.update({ where: { id: messageId }, data: { readAt: new Date() } });

    // Upgrade §5/Step 19 — Recovery Phase. If this message IS an escalation
    // (created by HyrteConsequenceService.escalateIgnoredMessage after an
    // earlier ignored message), replying to it is a real recovery attempt:
    // link this decision node back to the original "inbox.message_ignored"
    // node via recoveryOfId, built in Phase 1 but never populated until now.
    let recoveryOfId: string | undefined;
    if (message.escalatesMessageId) {
      const originalMistake = await this.prisma.hyrteDecisionLogEntry.findFirst({
        where: { sessionId, actionType: 'inbox.message_ignored', payload: { path: ['messageId'], equals: message.escalatesMessageId } },
        select: { id: true },
      });
      recoveryOfId = originalMistake?.id;
    }

    // §4.20 Ethical Gray Zones: a message flagged at generation time gets its
    // own evidence type instead of a generic action, never a "correct"/"wrong"
    // tag — only that it happened. §4.18: otherwise infer peer/manager context.
    const entry = await this.logDecision(
      sessionId,
      candidateId,
      'email.reply',
      { messageId, body: dto.body },
      `Replied to an email ("${message.subject}"): "${dto.body}"${recoveryOfId ? ' — a recovery attempt after an earlier ignored message' : ''}`,
      message.ethicalDilemma
        ? { type: 'ETHICAL_DECISION', behaviorContext: 'PRESSURE', recoveryOfId }
        : { behaviorContext: message.fromStakeholder ? inferContextFromRole(message.fromStakeholder.role) : undefined, recoveryOfId },
    );

    if (message.fromStakeholderId) {
      this.agent
        .respond(sessionId, message.fromStakeholderId, dto.body, { kind: 'inbox', subject: message.subject }, entry.id)
        .catch((e) => this.logger.warn(e));
      // §4.12 Layers 5/9/11 — someone NOT party to this exchange independently
      // reacts, probabilistically (not every message, to avoid noise).
      if (Math.random() < INDEPENDENT_REACTION_PROBABILITY) {
        this.agent
          .reactIndependently(sessionId, message.fromStakeholderId, `replied to an email: "${dto.body}"`)
          .catch((e) => this.logger.warn(e));
      }
    }

    // Refinements doc §3 — CC, made real rather than cosmetic: each CC'd
    // stakeholder gets an actual chance to weigh in via the same agent
    // pipeline the primary recipient uses, not just a label on the message.
    if (dto.ccStakeholderIds?.length) {
      const validCcs = await this.prisma.hyrteStakeholder.findMany({
        where: { sessionId, id: { in: dto.ccStakeholderIds } },
        select: { id: true },
      });
      for (const cc of validCcs) {
        if (cc.id === message.fromStakeholderId) continue; // already the primary recipient
        this.agent
          .respond(
            sessionId,
            cc.id,
            `(You were CC'd on a reply about "${message.subject}".) ${dto.body}`,
            { kind: 'inbox', subject: `Re: ${message.subject}` },
            entry.id,
          )
          .catch((e) => this.logger.warn(e));
      }
    }

    // Refinements doc §6 — Intelligent Delegation: this reply is the answer
    // to a stakeholder's "ask for clarification" — the work item has been
    // sitting paused (stage NEW, no tick scheduled) since the delegation
    // itself. Resume it now, same tick pipeline as a fresh delegation.
    if (message.blocksWorkItemId) {
      const paused = await this.prisma.hyrteWorkItem.findUnique({ where: { id: message.blocksWorkItemId }, select: { id: true, stage: true, history: true } });
      if (paused && paused.stage === 'NEW') {
        const history = Array.isArray(paused.history) ? (paused.history as Prisma.JsonArray) : [];
        const resumed = await this.prisma.hyrteWorkItem.update({
          where: { id: paused.id },
          data: {
            history: [
              ...history,
              { at: new Date().toISOString(), actor: candidateId, action: 'clarified', note: `Clarified: "${dto.body}"` },
            ] as unknown as Prisma.InputJsonValue,
          },
        });
        this.gateway.broadcast(sessionId, { type: 'task:update', task: resumed });
        this.workTicks.scheduleStart(paused.id);
      }
    }

    return entry;
  }

  /** Doc §3 — Forward: the receiving stakeholder gets a genuine in-character reaction, not a silent copy. */
  async forwardInbox(sessionId: string, messageId: string, dto: ForwardInboxDto, candidateId: string) {
    await this.assertOwnership(sessionId, candidateId);
    const message = await this.prisma.hyrteInboxMessage.findFirst({
      where: { id: messageId, sessionId },
      include: { fromStakeholder: { select: { name: true, role: true } } },
    });
    if (!message) throw new NotFoundException('Message not found');
    const target = await this.prisma.hyrteStakeholder.findFirst({ where: { id: dto.toStakeholderId, sessionId } });
    if (!target) throw new NotFoundException('Stakeholder not found');

    const entry = await this.logDecision(
      sessionId,
      candidateId,
      'email.forward',
      { messageId, toStakeholderId: dto.toStakeholderId, note: dto.note },
      `Forwarded an email ("${message.subject}") to ${target.name}${dto.note ? ` with note: "${dto.note}"` : ''}`,
    );

    const forwardedContent =
      `(This was forwarded to you from ${message.fromStakeholder?.name ?? 'someone'}` +
      `${message.fromStakeholder?.role ? ` (${message.fromStakeholder.role})` : ''}: "${message.body}")` +
      (dto.note ? `\n\nNote from the candidate: "${dto.note}"` : '');
    this.agent
      .respond(sessionId, target.id, forwardedContent, { kind: 'inbox', subject: `Fwd: ${message.subject}` }, entry.id)
      .catch((e) => this.logger.warn(e));

    return entry;
  }

  /** Explicit read/unread toggle — was hardcoded to always mark read regardless of the DTO's `read` field. */
  async markInboxRead(sessionId: string, messageId: string, candidateId: string, read = true) {
    await this.assertOwnership(sessionId, candidateId);
    const message = await this.prisma.hyrteInboxMessage.findFirst({ where: { id: messageId, sessionId } });
    if (!message) throw new NotFoundException('Message not found');
    return this.prisma.hyrteInboxMessage.update({ where: { id: messageId }, data: { readAt: read ? new Date() : null } });
  }

  async setInboxFlag(sessionId: string, messageId: string, dto: FlagInboxDto, candidateId: string) {
    await this.assertOwnership(sessionId, candidateId);
    const message = await this.prisma.hyrteInboxMessage.findFirst({ where: { id: messageId, sessionId } });
    if (!message) throw new NotFoundException('Message not found');
    return this.prisma.hyrteInboxMessage.update({ where: { id: messageId }, data: { flagged: dto.flagged ?? !message.flagged } });
  }

  async setInboxArchived(sessionId: string, messageId: string, dto: ArchiveInboxDto, candidateId: string) {
    await this.assertOwnership(sessionId, candidateId);
    const message = await this.prisma.hyrteInboxMessage.findFirst({ where: { id: messageId, sessionId } });
    if (!message) throw new NotFoundException('Message not found');
    const archived = dto.archived ?? !message.archivedAt;
    return this.prisma.hyrteInboxMessage.update({ where: { id: messageId }, data: { archivedAt: archived ? new Date() : null } });
  }

  async addInboxNote(sessionId: string, messageId: string, dto: AddInboxNoteDto, candidateId: string) {
    await this.assertOwnership(sessionId, candidateId);
    const message = await this.prisma.hyrteInboxMessage.findFirst({ where: { id: messageId, sessionId } });
    if (!message) throw new NotFoundException('Message not found');
    const notes = Array.isArray(message.internalNotes) ? message.internalNotes : [];
    const updatedNotes = [...notes, { text: dto.text, createdAt: new Date().toISOString() }];
    return this.prisma.hyrteInboxMessage.update({
      where: { id: messageId },
      data: { internalNotes: updatedNotes as unknown as Prisma.InputJsonValue },
    });
  }

  /** Doc §3 — Convert to task: a real HyrteWorkItem, candidate-owned, reusing the exact same Work Pipeline everything else lands in. */
  async convertInboxToTask(sessionId: string, messageId: string, candidateId: string) {
    await this.assertOwnership(sessionId, candidateId);
    const message = await this.prisma.hyrteInboxMessage.findFirst({ where: { id: messageId, sessionId } });
    if (!message) throw new NotFoundException('Message not found');
    if (message.convertedToWorkItemId) {
      const existing = await this.prisma.hyrteWorkItem.findUnique({ where: { id: message.convertedToWorkItemId } });
      if (existing) return existing;
    }

    const workItem = await this.prisma.hyrteWorkItem.create({
      data: {
        sessionId,
        title: message.subject,
        type: 'REPLY',
        priority: message.urgent ? 'HIGH' : 'MEDIUM',
        origin: 'EVENT',
        ownerIsCandidate: true,
        history: [
          { at: new Date().toISOString(), actor: 'You', action: 'created', note: `Converted from email "${message.subject}"` },
        ] as unknown as Prisma.InputJsonValue,
      },
    });
    await this.prisma.hyrteInboxMessage.update({ where: { id: messageId }, data: { convertedToWorkItemId: workItem.id } });
    this.gateway.broadcast(sessionId, { type: 'task:update', task: workItem });

    await this.logDecision(
      sessionId,
      candidateId,
      'email.convert_to_task',
      { messageId, workItemId: workItem.id },
      `Converted an email ("${message.subject}") into a task`,
    );
    return workItem;
  }

  /** Doc §3 — Schedule reminder: a real timer that genuinely re-surfaces the message (bumps it back to unread) at the chosen time, not a UI-only label. */
  async scheduleInboxReminder(sessionId: string, messageId: string, dto: ScheduleReminderDto, candidateId: string) {
    await this.assertOwnership(sessionId, candidateId);
    const message = await this.prisma.hyrteInboxMessage.findFirst({ where: { id: messageId, sessionId } });
    if (!message) throw new NotFoundException('Message not found');

    const remindAt = dto.remindAt ? new Date(dto.remindAt) : new Date(Date.now() + DEFAULT_REMINDER_MS);
    const delayMs = Math.max(5_000, remindAt.getTime() - Date.now());
    const updated = await this.prisma.hyrteInboxMessage.update({ where: { id: messageId }, data: { reminderAt: remindAt } });

    setTimeout(() => {
      this.fireInboxReminder(sessionId, messageId).catch((e) => this.logger.warn(e));
    }, delayMs);

    await this.logDecision(
      sessionId,
      candidateId,
      'email.schedule_reminder',
      { messageId, remindAt: remindAt.toISOString() },
      `Scheduled a reminder for an email ("${message.subject}") at ${remindAt.toISOString()}`,
    );
    return updated;
  }

  private async fireInboxReminder(sessionId: string, messageId: string): Promise<void> {
    const [message, session] = await Promise.all([
      this.prisma.hyrteInboxMessage.findUnique({ where: { id: messageId } }),
      this.prisma.hyrteSession.findUnique({ where: { id: sessionId }, select: { phase: true } }),
    ]);
    // Same "world may have moved on" guard as every other self-scheduling
    // timer in this codebase — don't remind into a finished session.
    if (!message || !session || session.phase !== 'WORKSPACE_ACTIVE') return;
    const updated = await this.prisma.hyrteInboxMessage.update({ where: { id: messageId }, data: { readAt: null } });
    this.gateway.broadcast(sessionId, { type: 'inbox:new', message: updated });
  }

  // ── Slack ──

  async listSlack(sessionId: string, candidateId: string, channel?: string) {
    await this.assertOwnership(sessionId, candidateId);
    return this.prisma.hyrteSlackMessage.findMany({
      where: { sessionId, ...(channel ? { channel } : {}) },
      include: { fromStakeholder: { omit: OMIT_CANDIDATE_INTERNALS } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async sendSlack(sessionId: string, dto: SendSlackMessageDto, candidateId: string) {
    await this.assertOwnership(sessionId, candidateId);
    const created = await this.prisma.hyrteSlackMessage.create({
      data: { sessionId, channel: dto.channel, body: dto.body, fromStakeholderId: null },
    });
    this.gateway.broadcast(sessionId, { type: 'slack:new', message: created });

    // DMs address one stakeholder — infer peer/manager context (§4.18) from
    // their role; public-channel posts don't target anyone specific.
    let behaviorContext: BehaviorContext | undefined;
    if (dto.channel.startsWith('dm:')) {
      const target = await this.prisma.hyrteStakeholder.findUnique({
        where: { id: dto.channel.slice(3) },
        select: { role: true },
      });
      behaviorContext = target ? inferContextFromRole(target.role) : undefined;
    }
    const entry = await this.logDecision(
      sessionId,
      candidateId,
      'slack.send',
      { channel: dto.channel, body: dto.body },
      `Sent a Slack message in ${dto.channel}: "${dto.body}"`,
      { behaviorContext },
    );

    // Only DMs get an in-character reply — public-channel chatter belongs to
    // the future chaos engine, which decides who (if anyone) jumps in.
    if (dto.channel.startsWith('dm:')) {
      const stakeholderId = dto.channel.slice(3);
      this.agent
        .respond(sessionId, stakeholderId, dto.body, { kind: 'slack', channel: dto.channel }, entry.id)
        .catch((e) => this.logger.warn(e));
      if (Math.random() < INDEPENDENT_REACTION_PROBABILITY) {
        this.agent
          .reactIndependently(sessionId, stakeholderId, `sent a Slack DM: "${dto.body}"`)
          .catch((e) => this.logger.warn(e));
      }
    }
    return created;
  }

  // ── Tasks (Work Items — Part C3) ──

  async listTasks(sessionId: string, candidateId: string) {
    await this.assertOwnership(sessionId, candidateId);
    return this.prisma.hyrteWorkItem.findMany({ where: { sessionId }, orderBy: { createdAt: 'asc' } });
  }

  async updateTask(sessionId: string, taskId: string, dto: UpdateWorkItemDto, candidateId: string) {
    await this.assertOwnership(sessionId, candidateId);
    const task = await this.prisma.hyrteWorkItem.findFirst({ where: { id: taskId, sessionId } });
    if (!task) throw new NotFoundException('Task not found');

    const history = Array.isArray(task.history) ? task.history : [];
    const updated = await this.prisma.hyrteWorkItem.update({
      where: { id: taskId },
      data: {
        stage: dto.stage ?? task.stage,
        ...(dto.stage && dto.stage !== task.stage
          ? {
              history: [
                ...history,
                { at: new Date().toISOString(), actor: candidateId, action: 'stage_change', note: `${task.stage} → ${dto.stage}` },
              ] as unknown as Prisma.InputJsonValue,
            }
          : {}),
      },
    });
    this.gateway.broadcast(sessionId, { type: 'task:update', task: updated });
    let decisionEntry: { id: string } | undefined;
    if (dto.stage) {
      // Part F7 Recovery — if this item was spawned by a rejection and is now
      // done, link this decision back to that rejection via recoveryOfId, the
      // same DIG chain replyInbox uses for escalation follow-ups.
      const recoveryOfEntry = (history as { action?: string; note?: string }[]).find((h) => h.action === 'recovery_of');
      decisionEntry = await this.logDecision(
        sessionId,
        candidateId,
        'task.stage_change',
        { taskId, stage: dto.stage },
        `Changed task "${task.title}" stage to "${dto.stage}"${dto.stage === 'DONE' && recoveryOfEntry ? ' — a recovery attempt after an earlier rejection' : ''}`,
        recoveryOfEntry && dto.stage === 'DONE' ? { recoveryOfId: recoveryOfEntry.note } : undefined,
      );
    }
    if (dto.stage === 'DONE' && task.stage !== 'DONE') {
      this.consequences
        .reasonTaskConsequence(sessionId, updated, candidateId, decisionEntry?.id)
        .catch((e) => this.logger.warn(e));

      // Doc §22 — "AI stakeholders review it, request revisions, challenge
      // assumptions, approve or reject it." The candidate's manager (same
      // deterministic highest-authority derivation used everywhere else in
      // this codebase) gives real, in-character feedback on the signature
      // artifact specifically — not just the generic company-state
      // consequence every other completed task gets.
      if (task.isSignatureArtifact) {
        this.reactToSignatureArtifact(sessionId, updated.id, updated.title, candidateId).catch((e) => this.logger.warn(e));
      }
    }
    return updated;
  }

  /** Doc §22 — the manager (same deterministic highest-authority derivation as the Mission Brief / hop-3 escalations) gives real, in-character feedback on a completed signature artifact. */
  private async reactToSignatureArtifact(sessionId: string, taskId: string, taskTitle: string, candidateId: string): Promise<void> {
    const stakeholders = await this.prisma.hyrteStakeholder.findMany({ where: { sessionId } });
    if (stakeholders.length === 0) return;
    const manager = stakeholders.reduce((a, b) => ((b.authorityLevel ?? 50) > (a.authorityLevel ?? 50) ? b : a));
    await this.agent.respond(
      sessionId,
      manager.id,
      `(The candidate just completed their signature deliverable, "${taskTitle}" — give real, substantive feedback: what's strong, what you'd push back on or want revised, and whether you'd sign off on it as-is.)`,
      { kind: 'inbox', subject: `Re: ${taskTitle}` },
    );
  }

  // ── Needs Review (Part F5) ──

  async listNeedsReview(sessionId: string, candidateId: string) {
    await this.assertOwnership(sessionId, candidateId);
    const items = await this.prisma.hyrteWorkItem.findMany({
      where: { sessionId, stage: 'WAITING_REVIEW' },
      include: { ownerStakeholder: { omit: OMIT_CANDIDATE_INTERNALS } },
      orderBy: { updatedAt: 'asc' },
    });
    // review is a Json field (requiredFrom/requestedAt/decidedAt/decision) —
    // filtered in application code rather than a Prisma JSON path query,
    // deliberately: the row count per session is small (single digits), and
    // an in-memory filter is simpler and more portable than DB-specific JSON
    // predicate syntax for "decidedAt is null".
    return items.filter((i) => {
      const review = i.review as { decidedAt?: string | null } | null;
      return review && !review.decidedAt;
    });
  }

  async submitWorkItemReview(sessionId: string, workItemId: string, dto: WorkItemReviewDto, candidateId: string) {
    await this.assertOwnership(sessionId, candidateId);
    const item = await this.prisma.hyrteWorkItem.findFirst({ where: { id: workItemId, sessionId }, include: { ownerStakeholder: true } });
    if (!item) throw new NotFoundException('Work item not found');
    if (item.stage !== 'WAITING_REVIEW') throw new NotFoundException('This work item is not awaiting review');

    const review = (item.review ?? {}) as { requiredFrom?: string; requestedAt?: string; decidedAt?: string | null; decision?: string | null };
    const latencyMs = review.requestedAt ? Date.now() - new Date(review.requestedAt).getTime() : null;
    const history = Array.isArray(item.history) ? item.history : [];
    const decidedReview = { ...review, decidedAt: new Date().toISOString(), decision: dto.decision, note: dto.note ?? null };

    let stage: 'DONE' | 'IN_PROGRESS' | 'BLOCKED' | 'NEW' = item.stage as never;
    let nextOwnerId: string | null | undefined;
    let nextOwnerIsCandidate: boolean | undefined;
    let clearReview = false;

    switch (dto.decision) {
      case 'approve':
        stage = 'DONE';
        break;
      case 'request_changes':
        stage = 'IN_PROGRESS';
        break;
      case 'reject':
        stage = 'BLOCKED';
        break;
      case 'reassign': {
        stage = 'NEW';
        clearReview = true;
        const alt = item.ownerStakeholder?.department
          ? await this.prisma.hyrteStakeholder.findFirst({
              where: { sessionId, department: item.ownerStakeholder.department, id: { not: item.ownerStakeholderId ?? undefined } },
            })
          : null;
        if (alt) {
          nextOwnerId = alt.id;
          nextOwnerIsCandidate = false;
        } else {
          nextOwnerId = null;
          nextOwnerIsCandidate = true;
        }
        break;
      }
    }

    const updated = await this.prisma.hyrteWorkItem.update({
      where: { id: workItemId },
      data: {
        stage,
        ...(nextOwnerId !== undefined ? { ownerStakeholderId: nextOwnerId } : {}),
        ...(nextOwnerIsCandidate !== undefined ? { ownerIsCandidate: nextOwnerIsCandidate } : {}),
        review: (clearReview ? null : decidedReview) as unknown as Prisma.InputJsonValue,
        history: [
          ...history,
          { at: new Date().toISOString(), actor: candidateId, action: `review_${dto.decision}`, note: dto.note },
        ] as unknown as Prisma.InputJsonValue,
      },
    });
    this.gateway.broadcast(sessionId, { type: 'task:update', task: updated });

    const decisionEntry = await this.logDecision(
      sessionId,
      candidateId,
      `work_item.review_${dto.decision}`,
      { workItemId, decision: dto.decision, note: dto.note, latencyMs },
      `Reviewed "${item.title}" — ${dto.decision}${dto.note ? `: "${dto.note}"` : ''}`,
    );
    this.evidence
      .createEvidence({
        hyrteSessionId: sessionId,
        candidateId,
        source: 'SIMULATION',
        type: 'SIMULATION_DECISION',
        rawText: `Review decision on "${item.title}": ${dto.decision}${dto.note ? ` — note: "${dto.note}"` : ' — no note'}. Latency: ${latencyMs ? Math.round(latencyMs / 1000) : '?'}s.`,
        metadata: { latencyMs, hadNote: !!dto.note?.trim() },
      })
      .catch((e) => this.logger.warn(e));

    if (dto.decision === 'approve') {
      this.consequences.reasonTaskConsequence(sessionId, updated, candidateId, decisionEntry.id).catch((e) => this.logger.warn(e));
      // Part F7 — approving a customer-facing commitment can land on a
      // different department later (cross-functional cascade chains).
      this.consequences.scheduleCascadeCheck(sessionId, updated);
    } else if (dto.decision === 'request_changes') {
      this.workTicks.scheduleRevision(workItemId, dto.note ?? 'Please revise.');
    } else if (dto.decision === 'reassign' && nextOwnerId) {
      this.workTicks.scheduleStart(workItemId);
    } else if (dto.decision === 'reject') {
      // Part F7 — "mistakes never end the session; they spawn recovery work,
      // and recovery quality is its own evaluated dimension." A rejected item
      // otherwise dead-ends at BLOCKED with nothing to do about it — this is
      // the candidate's own recovery attempt, not another auto-tick, so it's
      // theirs to own. `recovery_of` in history is how completing it later
      // (in updateTask, below) finds its way back to this decision via
      // recoveryOfId — the exact same DIG chain replyInbox already uses for
      // escalation follow-ups.
      const recovery = await this.prisma.hyrteWorkItem.create({
        data: {
          sessionId,
          title: `Recover: ${item.title}`,
          type: item.type,
          priority: item.priority,
          origin: 'EVENT',
          ownerIsCandidate: true,
          history: [
            { at: new Date().toISOString(), actor: 'system', action: 'recovery_of', note: decisionEntry.id },
          ] as unknown as Prisma.InputJsonValue,
        },
      });
      this.gateway.broadcast(sessionId, { type: 'task:update', task: recovery });
    }

    return updated;
  }

  // ── Command bar (Part F6) ──

  async submitCommand(sessionId: string, candidateId: string, dto: CommandBarDto): Promise<CommandBarResult> {
    await this.assertOwnership(sessionId, candidateId);
    return this.commandBar.submit(sessionId, candidateId, dto.instruction);
  }

  // ── Calendar ──

  async listCalendar(sessionId: string, candidateId: string) {
    await this.assertOwnership(sessionId, candidateId);
    return this.prisma.hyrteCalendarEvent.findMany({ where: { sessionId }, orderBy: { startAt: 'asc' } });
  }

  /** Part E2 Meetings — "join" is a real logged action, same pattern as listKnowledgeBase's KB-consultation evidence. */
  async attendMeeting(sessionId: string, eventId: string, candidateId: string) {
    await this.assertOwnership(sessionId, candidateId);
    const event = await this.prisma.hyrteCalendarEvent.findFirst({ where: { id: eventId, sessionId } });
    if (!event) throw new NotFoundException('Meeting not found');
    await this.logDecision(sessionId, candidateId, 'meeting.attend', { eventId }, `Attended the meeting "${event.title}"`);

    // Refinements doc §7 — "Live AI Meetings". Joining starts the real
    // discussion the FIRST time only (guarded by startedAt); rejoining an
    // already-started meeting just resumes watching the same transcript.
    if (!event.startedAt) {
      await this.prisma.hyrteCalendarEvent.update({ where: { id: eventId }, data: { startedAt: new Date() } });
      this.meetings.startDiscussion(sessionId, eventId);
    }
    return { attended: true };
  }

  async listMeetingMessages(sessionId: string, eventId: string, candidateId: string) {
    await this.assertOwnership(sessionId, candidateId);
    return this.prisma.hyrteMeetingMessage.findMany({
      where: { sessionId, eventId },
      include: { fromStakeholder: { omit: OMIT_CANDIDATE_INTERNALS } },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** The candidate speaking during a live meeting — doc §7 "the candidate can contribute, ask questions, make decisions." */
  async sendMeetingMessage(sessionId: string, eventId: string, dto: SendMeetingMessageDto, candidateId: string) {
    await this.assertOwnership(sessionId, candidateId);
    const event = await this.prisma.hyrteCalendarEvent.findFirst({ where: { id: eventId, sessionId } });
    if (!event) throw new NotFoundException('Meeting not found');
    await this.meetings.recordCandidateTurn(sessionId, eventId, candidateId, dto.body);
    return { sent: true };
  }

  // ── Knowledge base ──

  async listKnowledgeBase(sessionId: string, candidateId: string) {
    await this.assertOwnership(sessionId, candidateId);
    const docs = await this.prisma.hyrteKnowledgeDoc.findMany({ where: { sessionId }, orderBy: { title: 'asc' } });
    // Proactively consulting the KB is itself a measured behavior (doc §3).
    await this.logDecision(sessionId, candidateId, 'knowledge_base.view', {}, 'Consulted the knowledge base');
    return docs;
  }

  // ── Stakeholders ──

  async listStakeholders(sessionId: string, candidateId: string) {
    await this.assertOwnership(sessionId, candidateId);
    return this.prisma.hyrteStakeholder.findMany({ where: { sessionId }, orderBy: { name: 'asc' }, omit: OMIT_CANDIDATE_INTERNALS });
  }

  /**
   * Part E2 Command Center "System Map" — real department clusters, each
   * with a deterministic head (highest authorityLevel, same derivation as
   * the Mission Brief's manager, never LLM-guessed) and a real message-
   * volume count. Deliberately does NOT invent cross-department
   * relationship edges — there's no real data behind those yet, and a fake
   * graph would violate "no placeholder content anywhere."
   */
  async getSystemMap(sessionId: string, candidateId: string) {
    await this.assertOwnership(sessionId, candidateId);
    const [companyState, stakeholders, inbox, slack] = await Promise.all([
      this.prisma.hyrteCompanyState.findUnique({ where: { sessionId }, select: { departments: true } }),
      this.prisma.hyrteStakeholder.findMany({ where: { sessionId }, omit: OMIT_CANDIDATE_INTERNALS }),
      this.prisma.hyrteInboxMessage.findMany({ where: { sessionId }, select: { fromStakeholderId: true } }),
      this.prisma.hyrteSlackMessage.findMany({ where: { sessionId }, select: { fromStakeholderId: true } }),
    ]);
    const departments = Array.isArray(companyState?.departments) ? (companyState!.departments as { name?: string }[]) : [];
    const messageCountByStakeholder = new Map<string, number>();
    for (const m of [...inbox, ...slack]) {
      if (!m.fromStakeholderId) continue;
      messageCountByStakeholder.set(m.fromStakeholderId, (messageCountByStakeholder.get(m.fromStakeholderId) ?? 0) + 1);
    }

    return departments
      .filter((d): d is { name: string } => typeof d.name === 'string')
      .map((d) => {
        const members = stakeholders.filter((s) => s.department === d.name);
        const head = members.reduce<(typeof members)[number] | null>(
          (a, b) => (!a || (b.authorityLevel ?? 50) > (a.authorityLevel ?? 50) ? b : a),
          null,
        );
        return {
          name: d.name,
          headStakeholderId: head?.id ?? null,
          messageCount: members.reduce((sum, s) => sum + (messageCountByStakeholder.get(s.id) ?? 0), 0),
          stakeholders: members.map((s) => ({ id: s.id, name: s.name, role: s.role })),
        };
      });
  }

  // ── Decision log ──

  async listDecisionLog(sessionId: string, candidateId: string) {
    await this.assertOwnership(sessionId, candidateId);
    // Newest-first for the candidate-facing log — DecisionGraphService.getGraph
    // returns chronological (oldest-first) order for graph-consumption instead.
    return this.prisma.hyrteDecisionLogEntry.findMany({ where: { sessionId }, orderBy: { createdAt: 'desc' } });
  }
}
