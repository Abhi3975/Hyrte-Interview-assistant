import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EvidenceGraphService } from '../dig/evidence-graph.service';
import { HyrteSessionsService } from '../hyrte-sessions.service';

/**
 * Master Build Prompt Part E3/G7 — Recruiter Live Console's data source.
 * Deliberately separate from HyrteWorkplaceService/HyrteSessionsService's
 * candidate-facing methods, not a role branch inside them: every method here
 * is unredacted by construction (no OMIT_CANDIDATE_INTERNALS, no ownership
 * check tied to candidateId — mirrors CouncilController's existing
 * role-only gate, since HYRTE has no recruiter/session assignment model
 * yet, a documented pre-existing gap, not something this pass introduces).
 */
@Injectable()
export class HyrteRecruiterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly evidence: EvidenceGraphService,
    private readonly sessions: HyrteSessionsService,
  ) {}

  private async assertExists(sessionId: string) {
    const session = await this.prisma.hyrteSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('Session not found');
    return session;
  }

  /** Session orchestrator card — seed summary, clock, counters. */
  async getOverview(sessionId: string) {
    const session = await this.assertExists(sessionId);
    const [eventsFired, eventsPending, evidenceCount, actionCount] = await Promise.all([
      this.prisma.hyrteWorldEvent.count({ where: { sessionId, status: 'FIRED' } }),
      this.prisma.hyrteWorldEvent.count({ where: { sessionId, status: 'PENDING' } }),
      this.prisma.evidenceObject.count({ where: { hyrteSessionId: sessionId } }),
      this.prisma.hyrteDecisionLogEntry.count({ where: { sessionId } }),
    ]);
    return {
      companyName: session.companyName,
      role: session.role,
      experienceLevel: session.experienceLevel,
      industry: session.industry,
      companyType: session.companyType,
      difficulty: session.difficulty,
      culture: session.culture,
      phase: session.phase,
      startedAt: session.startedAt,
      eventsFired,
      eventsPending,
      evidenceCount,
      actionCount,
    };
  }

  /** Full-fidelity stakeholder rows — trust/frustration/hiddenIntention all included (Part E3 "internals allowed"). */
  async getStakeholders(sessionId: string) {
    await this.assertExists(sessionId);
    return this.prisma.hyrteStakeholder.findMany({ where: { sessionId }, orderBy: { name: 'asc' } });
  }

  async getCompanyState(sessionId: string) {
    await this.assertExists(sessionId);
    const state = await this.prisma.hyrteCompanyState.findUnique({ where: { sessionId } });
    if (!state) throw new NotFoundException('Company state not found');
    return state;
  }

  async getCompanyStateHistory(sessionId: string) {
    await this.assertExists(sessionId);
    return this.prisma.hyrteCompanyStateHistory.findMany({ where: { sessionId }, orderBy: { createdAt: 'asc' } });
  }

  async getWhatChanged(sessionId: string) {
    await this.assertExists(sessionId);
    return this.sessions.computeWhatChanged(sessionId);
  }

  async getEvidence(sessionId: string) {
    await this.assertExists(sessionId);
    return this.evidence.getForSession(sessionId);
  }

  async getWorkItems(sessionId: string) {
    await this.assertExists(sessionId);
    return this.prisma.hyrteWorkItem.findMany({ where: { sessionId }, include: { ownerStakeholder: true }, orderBy: { updatedAt: 'desc' } });
  }

  /**
   * Part E3 "candidate focus map (surface time, first-opened/ignored)" —
   * scoped to what's actually instrumented today (inbox readAt/urgent).
   * Per-surface dwell-time tracking doesn't exist anywhere in this codebase
   * and would need new frontend instrumentation — out of scope for this
   * pass, not silently faked here.
   */
  async getFocusMap(sessionId: string) {
    await this.assertExists(sessionId);
    const messages = await this.prisma.hyrteInboxMessage.findMany({
      where: { sessionId },
      include: { fromStakeholder: { select: { name: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return messages.map((m) => ({
      id: m.id,
      subject: m.subject,
      from: m.fromStakeholder?.name ?? null,
      urgent: m.urgent,
      arrivedAt: m.createdAt,
      firstOpenedAt: m.readAt,
      ignored: m.urgent && !m.readAt,
    }));
  }

  async getDecisionLog(sessionId: string) {
    await this.assertExists(sessionId);
    return this.prisma.hyrteDecisionLogEntry.findMany({ where: { sessionId }, orderBy: { createdAt: 'desc' }, take: 30 });
  }
}
