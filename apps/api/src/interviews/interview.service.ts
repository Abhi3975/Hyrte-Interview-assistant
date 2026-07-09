import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { ExamState, InterviewStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { CreateInterviewDto, SubmitAnswerDto } from './dto/interview.dto';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';

@Injectable()
export class InterviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ── Recruiter: authoring ──

  async create(dto: CreateInterviewDto, user: AuthenticatedUser) {
    if (!user.organizationId) throw new ForbiddenException('User has no organization');

    const interview = await this.prisma.interview.create({
      data: {
        organizationId: user.organizationId,
        title: dto.title,
        jobRole: dto.jobRole,
        category: dto.category,
        difficulty: dto.difficulty ?? 'MEDIUM',
        mode: dto.mode ?? 'MIXED',
        durationMins: dto.durationMins ?? 45,
        questionSetId: dto.questionSetId,
        config: (dto.config ?? {}) as object,
        createdById: user.id,
        status: 'DRAFT',
      },
    });

    if (dto.questionIds?.length) {
      await this.prisma.interviewQuestion.createMany({
        data: dto.questionIds.map((questionId, ordinal) => ({
          interviewId: interview.id,
          questionId,
          ordinal,
        })),
        skipDuplicates: true,
      });
    }

    await this.audit.record({
      actorId: user.id,
      organizationId: user.organizationId,
      action: 'interview.create',
      targetType: 'Interview',
      targetId: interview.id,
    });
    return interview;
  }

  async listForOrg(organizationId: string) {
    return this.prisma.reader.interview.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { sessions: true, questions: true } } },
    });
  }

  /** A candidate's own sessions across all interviews. */
  async listCandidateSessions(candidateId: string) {
    return this.prisma.reader.interviewSession.findMany({
      where: { candidateId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        examState: true,
        status: true,
        warningCount: true,
        startedAt: true,
        completedAt: true,
        identityVerified: true,
        interview: { select: { title: true, jobRole: true, category: true, durationMins: true } },
        evaluation: { select: { overallScore: true, recommendation: true } },
      },
    });
  }

  /** Create a session for a candidate. Starts in WAITING_APPROVAL — the
   * candidate cannot begin until an admin/recruiter unlocks it. */
  async inviteCandidate(interviewId: string, candidateId: string, user: AuthenticatedUser) {
    const interview = await this.assertOwnedInterview(interviewId, user);
    const session = await this.prisma.interviewSession.create({
      data: {
        interviewId: interview.id,
        candidateId,
        status: 'SCHEDULED',
        examState: 'WAITING_APPROVAL',
      },
    });
    await this.audit.record({
      actorId: user.id,
      organizationId: user.organizationId,
      action: 'session.invite',
      targetType: 'InterviewSession',
      targetId: session.id,
      metadata: { candidateId },
    });
    return session;
  }

  // ── Admin: exam control ──

  /**
   * Unlock the assessment and mint a single-use, time-boxed session token.
   * Returns the raw token exactly once (only its hash is persisted).
   */
  async approveAndIssueToken(sessionId: string, user: AuthenticatedUser, ttlMinutes = 60) {
    const session = await this.assertOwnedSession(sessionId, user);
    if (session.disqualified || session.examState === 'TERMINATED') {
      throw new BadRequestException('Session is terminated and cannot be reopened here');
    }

    const rawToken = randomBytes(24).toString('hex');
    await this.prisma.interviewSession.update({
      where: { id: sessionId },
      data: {
        examState: 'SCHEDULED',
        approvedById: user.id,
        approvedAt: new Date(),
        sessionTokenHash: this.hash(rawToken),
        tokenExpiresAt: new Date(Date.now() + ttlMinutes * 60_000),
      },
    });

    await this.audit.record({
      actorId: user.id,
      organizationId: user.organizationId,
      action: 'session.approve',
      targetType: 'InterviewSession',
      targetId: sessionId,
    });
    // The raw token is returned to the admin to hand to the candidate.
    return { sessionToken: rawToken, expiresInMinutes: ttlMinutes };
  }

  // ── Candidate: taking the exam ──

  /** Validate the one-time token. Identity must be verified before ACTIVE. */
  async startSession(sessionId: string, rawToken: string, candidate: AuthenticatedUser) {
    const session = await this.prisma.interviewSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('Session not found');
    if (session.candidateId !== candidate.id) throw new ForbiddenException('Not your session');
    if (session.lockedAt || session.examState === 'TERMINATED') {
      throw new ForbiddenException('Session is locked');
    }
    if (!session.sessionTokenHash || session.sessionTokenHash !== this.hash(rawToken)) {
      throw new ForbiddenException('Invalid session token');
    }
    if (session.tokenExpiresAt && session.tokenExpiresAt < new Date()) {
      throw new ForbiddenException('Session token expired');
    }
    if (!session.identityVerified) {
      throw new BadRequestException('Identity verification required before starting');
    }

    // Consume the token (single-use) and go ACTIVE.
    const updated = await this.prisma.interviewSession.update({
      where: { id: sessionId },
      data: {
        examState: 'ACTIVE',
        status: 'IN_PROGRESS',
        startedAt: new Date(),
        sessionTokenHash: null,
      },
    });
    await this.audit.record({
      actorId: candidate.id,
      action: 'session.start',
      targetType: 'InterviewSession',
      targetId: sessionId,
    });
    return updated;
  }

  async markIdentityVerified(sessionId: string, passed: boolean, candidate: AuthenticatedUser) {
    const session = await this.prisma.interviewSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('Session not found');
    if (session.candidateId !== candidate.id) throw new ForbiddenException('Not your session');
    return this.prisma.interviewSession.update({
      where: { id: sessionId },
      data: { identityVerified: passed },
    });
  }

  async submitAnswer(sessionId: string, dto: SubmitAnswerDto, candidate: AuthenticatedUser) {
    const session = await this.prisma.interviewSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('Session not found');
    if (session.candidateId !== candidate.id) throw new ForbiddenException('Not your session');
    // Auto-termination guard: a locked/terminated session rejects submissions.
    if (session.examState !== 'ACTIVE' && session.examState !== 'WARNING_ISSUED') {
      throw new ForbiddenException(`Cannot submit — exam is ${session.examState}`);
    }

    return this.prisma.answer.create({
      data: {
        sessionId,
        interviewQuestionId: dto.interviewQuestionId,
        responseText: dto.responseText,
        code: dto.code,
        language: dto.language,
        timeSpentSec: dto.timeSpentSec,
      },
    });
  }

  async complete(sessionId: string, candidate: AuthenticatedUser) {
    const session = await this.prisma.interviewSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('Session not found');
    if (session.candidateId !== candidate.id) throw new ForbiddenException('Not your session');
    return this.prisma.interviewSession.update({
      where: { id: sessionId },
      data: { examState: 'COMPLETED', status: 'COMPLETED', completedAt: new Date() },
    });
  }

  // ── Admin override ──

  async resetWarnings(sessionId: string, user: AuthenticatedUser) {
    await this.assertOwnedSession(sessionId, user);
    await this.audit.record({
      actorId: user.id,
      organizationId: user.organizationId,
      action: 'session.reset_warnings',
      targetType: 'InterviewSession',
      targetId: sessionId,
    });
    return this.prisma.interviewSession.update({
      where: { id: sessionId },
      data: { warningCount: 0, examState: 'ACTIVE', riskScore: 0 },
    });
  }

  async reopen(sessionId: string, user: AuthenticatedUser) {
    await this.assertOwnedSession(sessionId, user);
    await this.audit.record({
      actorId: user.id,
      organizationId: user.organizationId,
      action: 'session.reopen',
      targetType: 'InterviewSession',
      targetId: sessionId,
    });
    return this.prisma.interviewSession.update({
      where: { id: sessionId },
      data: { examState: 'SCHEDULED', disqualified: false, lockedAt: null, warningCount: 0 },
    });
  }

  // ── helpers ──

  private async assertOwnedInterview(interviewId: string, user: AuthenticatedUser) {
    const interview = await this.prisma.interview.findUnique({ where: { id: interviewId } });
    if (!interview) throw new NotFoundException('Interview not found');
    if (user.role !== 'SUPER_ADMIN' && interview.organizationId !== user.organizationId) {
      throw new ForbiddenException('Not your interview');
    }
    return interview;
  }

  private async assertOwnedSession(sessionId: string, user: AuthenticatedUser) {
    const session = await this.prisma.interviewSession.findUnique({
      where: { id: sessionId },
      include: { interview: true },
    });
    if (!session) throw new NotFoundException('Session not found');
    if (user.role !== 'SUPER_ADMIN' && session.interview.organizationId !== user.organizationId) {
      throw new ForbiddenException('Not your session');
    }
    return session;
  }

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}

// Keep enum imports referenced for downstream typing/extension.
export type _ExamStates = ExamState | InterviewStatus;
