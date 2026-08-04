import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { BehaviorContext, EvidenceType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { HyrteGateway } from './hyrte.gateway';
import { ReplyInboxDto, SendSlackMessageDto, UpdateTaskDto } from './dto/hyrte.dto';
import { HyrteStakeholderAgentService } from './agents/stakeholder-agent.service';
import { HyrteConsequenceService } from './consequences/consequence.service';
import { DecisionGraphService } from './dig/decision-graph.service';
import { EvidenceGraphService } from './dig/evidence-graph.service';
import { inferContextFromRole } from './dig/behavior-context.util';
import { OMIT_HIDDEN_INTENTION } from './dig/hidden-intention.util';

/** §4.12 Layers 5/9/11 — chance a stakeholder NOT party to an exchange independently reacts to it. Not 100%: constant chatter reads as noise, not signal. */
const INDEPENDENT_REACTION_PROBABILITY = 0.5;

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
      include: { fromStakeholder: { omit: OMIT_HIDDEN_INTENTION } },
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
    return entry;
  }

  async markInboxRead(sessionId: string, messageId: string, candidateId: string) {
    await this.assertOwnership(sessionId, candidateId);
    const message = await this.prisma.hyrteInboxMessage.findFirst({ where: { id: messageId, sessionId } });
    if (!message) throw new NotFoundException('Message not found');
    return this.prisma.hyrteInboxMessage.update({ where: { id: messageId }, data: { readAt: new Date() } });
  }

  // ── Slack ──

  async listSlack(sessionId: string, candidateId: string, channel?: string) {
    await this.assertOwnership(sessionId, candidateId);
    return this.prisma.hyrteSlackMessage.findMany({
      where: { sessionId, ...(channel ? { channel } : {}) },
      include: { fromStakeholder: { omit: OMIT_HIDDEN_INTENTION } },
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

  // ── Tasks ──

  async listTasks(sessionId: string, candidateId: string) {
    await this.assertOwnership(sessionId, candidateId);
    return this.prisma.hyrteTask.findMany({ where: { sessionId }, orderBy: { createdAt: 'asc' } });
  }

  async updateTask(sessionId: string, taskId: string, dto: UpdateTaskDto, candidateId: string) {
    await this.assertOwnership(sessionId, candidateId);
    const task = await this.prisma.hyrteTask.findFirst({ where: { id: taskId, sessionId } });
    if (!task) throw new NotFoundException('Task not found');

    const updated = await this.prisma.hyrteTask.update({
      where: { id: taskId },
      data: { status: dto.status ?? task.status },
    });
    this.gateway.broadcast(sessionId, { type: 'task:update', task: updated });
    let decisionEntry: { id: string } | undefined;
    if (dto.status) {
      decisionEntry = await this.logDecision(
        sessionId,
        candidateId,
        'task.status_change',
        { taskId, status: dto.status },
        `Changed task "${task.title}" status to "${dto.status}"`,
      );
    }
    if (dto.status === 'done' && task.status !== 'done') {
      this.consequences
        .reasonTaskConsequence(sessionId, updated, candidateId, decisionEntry?.id)
        .catch((e) => this.logger.warn(e));
    }
    return updated;
  }

  // ── Calendar ──

  async listCalendar(sessionId: string, candidateId: string) {
    await this.assertOwnership(sessionId, candidateId);
    return this.prisma.hyrteCalendarEvent.findMany({ where: { sessionId }, orderBy: { startAt: 'asc' } });
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
    return this.prisma.hyrteStakeholder.findMany({ where: { sessionId }, orderBy: { name: 'asc' }, omit: OMIT_HIDDEN_INTENTION });
  }

  // ── Decision log ──

  async listDecisionLog(sessionId: string, candidateId: string) {
    await this.assertOwnership(sessionId, candidateId);
    // Newest-first for the candidate-facing log — DecisionGraphService.getGraph
    // returns chronological (oldest-first) order for graph-consumption instead.
    return this.prisma.hyrteDecisionLogEntry.findMany({ where: { sessionId }, orderBy: { createdAt: 'desc' } });
  }
}
