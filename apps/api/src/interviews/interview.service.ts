import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { Category, Difficulty, ExamState, InterviewStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { QuestionService } from '../questions/question.service';
import { AIService } from '../ai/ai.service';
import { CreateInterviewDto, SubmitAnswerDto } from './dto/interview.dto';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';

export interface Invite { code: string; name: string; email?: string; expiresAt: string }

@Injectable()
export class InterviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly questions: QuestionService,
    private readonly ai: AIService,
  ) {}

  /** Recruiter: full assessment view — questions + candidate sessions/results. */
  async getDetail(interviewId: string, user: AuthenticatedUser) {
    const interview = await this.assertOwnedInterview(interviewId, user);
    const [questions, sessions] = await Promise.all([
      this.prisma.interviewQuestion.findMany({
        where: { interviewId },
        orderBy: { ordinal: 'asc' },
        include: { question: { select: { id: true, title: true, prompt: true, type: true, difficulty: true } } },
      }),
      this.prisma.interviewSession.findMany({
        where: { interviewId },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, status: true, examState: true, startedAt: true, completedAt: true, riskScore: true,
          candidate: { select: { fullName: true, email: true } },
          evaluation: { select: { overallScore: true, recommendation: true } },
        },
      }),
    ]);
    const invites = ((interview.config as any)?.invites ?? []) as Invite[];
    const resume = (interview.config as any)?.resume ?? null;
    return { interview, questions, sessions, invites, resume };
  }

  /** Recruiter: AI-generate questions and attach them to the assessment. */
  async generateQuestions(interviewId: string, count: number, user: AuthenticatedUser) {
    const interview = await this.assertOwnedInterview(interviewId, user);
    const topic = (interview.config as any)?.topic ?? interview.jobRole;
    const generated = await this.questions.generate(
      { category: interview.category as Category, topic, difficulty: interview.difficulty as Difficulty, count },
      interview.organizationId,
    );
    const existing = await this.prisma.interviewQuestion.count({ where: { interviewId } });
    await this.prisma.interviewQuestion.createMany({
      data: generated.map((q, i) => ({ interviewId, questionId: q.id, ordinal: existing + i })),
      skipDuplicates: true,
    });
    return { added: generated.length, total: existing + generated.length };
  }

  /**
   * Recruiter: analyze a pasted resume — extract structured facts and generate
   * resume-grounded interview questions. Stored on the assessment so the AI
   * interviewer can probe the candidate's real projects/skills.
   */
  async analyzeResume(interviewId: string, resumeText: string, user: AuthenticatedUser) {
    const interview = await this.assertOwnedInterview(interviewId, user);
    const system = [
      'You are a senior technical recruiter. Read the candidate resume and return ONLY JSON:',
      '{ summary:string; skills:string[]; projects:string[]; experience:string; education:string;',
      'questions:{ title:string; prompt:string }[] }',
      'The questions must be grounded in the ACTUAL resume — probe their real projects, technologies',
      'and claims (e.g. resume says "built a Redis cache" → "Why Redis over Memcached? How did you',
      'handle cache invalidation?"). Generate 5-7 sharp, specific questions. No generic questions.',
    ].join(' ');
    const analysis = await this.ai.completeJson<{
      summary: string; skills: string[]; projects: string[]; experience: string; education: string;
      questions: { title: string; prompt: string }[];
    }>(
      [
        { role: 'system', content: system },
        { role: 'user', content: `Role being hired: ${interview.jobRole} (${interview.category})\n\nRESUME:\n${resumeText.slice(0, 8000)}` },
      ],
      { temperature: 0.3, maxTokens: 1600 },
    );
    const config = (interview.config as any) ?? {};
    config.resume = {
      summary: analysis.summary, skills: analysis.skills ?? [], projects: analysis.projects ?? [],
      experience: analysis.experience, education: analysis.education,
      questions: (analysis.questions ?? []).slice(0, 7), analyzedAt: new Date().toISOString(),
    };
    await this.prisma.interview.update({ where: { id: interviewId }, data: { config: config as Prisma.InputJsonValue } });
    return config.resume;
  }

  /**
   * AI recruiter assistant: interprets a natural-language instruction and edits
   * the assessment (difficulty, duration, focus, generate more questions).
   */
  async assistant(interviewId: string, message: string, user: AuthenticatedUser) {
    const interview = await this.assertOwnedInterview(interviewId, user);
    const plan = await this.ai.completeJson<{
      reply: string; difficulty?: string; durationMins?: number; focusTopic?: string; generateCount?: number;
    }>(
      [
        {
          role: 'system',
          content:
            'You edit a technical interview assessment from the recruiter\'s instruction. Return ONLY JSON ' +
            '{ reply:string; difficulty?:"EASY"|"MEDIUM"|"HARD"|"EXPERT"; durationMins?:number; focusTopic?:string; generateCount?:number }. ' +
            'Include ONLY fields the recruiter wants to change. Set generateCount when they ask to add/generate questions. ' +
            'reply is a short confirmation of what you did.',
        },
        {
          role: 'user',
          content: `Current: role=${interview.jobRole}, category=${interview.category}, difficulty=${interview.difficulty}, duration=${interview.durationMins}min, focus=${(interview.config as any)?.topic ?? interview.jobRole}.\n\nInstruction: ${message}`,
        },
      ],
      { temperature: 0.3, maxTokens: 500 },
    );

    const data: any = {};
    const valid = ['EASY', 'MEDIUM', 'HARD', 'EXPERT'];
    if (plan.difficulty && valid.includes(plan.difficulty)) data.difficulty = plan.difficulty;
    if (plan.durationMins && plan.durationMins >= 5) data.durationMins = plan.durationMins;
    const config = (interview.config as any) ?? {};
    if (plan.focusTopic) config.topic = plan.focusTopic;
    data.config = config as Prisma.InputJsonValue;
    await this.prisma.interview.update({ where: { id: interviewId }, data });

    let generated = 0;
    if (plan.generateCount && plan.generateCount > 0) {
      const g = await this.generateQuestions(interviewId, Math.min(10, plan.generateCount), user);
      generated = g.added;
    }
    return { reply: plan.reply, applied: { ...data, config: undefined, focusTopic: plan.focusTopic, generated } };
  }

  /** Recruiter: publish (make it live for candidates). */
  async publish(interviewId: string, user: AuthenticatedUser) {
    await this.assertOwnedInterview(interviewId, user);
    const interview = await this.prisma.interview.update({
      where: { id: interviewId },
      data: { status: InterviewStatus.SCHEDULED },
    });
    return { status: interview.status };
  }

  /** Recruiter: create a secure invite link for a candidate. */
  async createInvite(
    interviewId: string,
    dto: { name: string; email?: string; expiryHours?: number },
    user: AuthenticatedUser,
  ) {
    const interview = await this.assertOwnedInterview(interviewId, user);
    const code = randomBytes(6).toString('base64url');
    const invite: Invite = {
      code,
      name: dto.name,
      email: dto.email,
      expiresAt: new Date(Date.now() + (dto.expiryHours ?? 168) * 3600_000).toISOString(),
    };
    const config = (interview.config as any) ?? {};
    config.invites = [...(config.invites ?? []), invite];
    await this.prisma.interview.update({
      where: { id: interviewId },
      data: { config: config as Prisma.InputJsonValue, status: InterviewStatus.SCHEDULED },
    });
    return { code, path: `/interview/${code}`, expiresAt: invite.expiresAt };
  }

  /** Candidate: resolve an invite code to the assessment config for the room. */
  async resolveInvite(code: string) {
    const candidates = await this.prisma.interview.findMany({
      where: { status: InterviewStatus.SCHEDULED },
      select: { id: true, title: true, jobRole: true, category: true, difficulty: true, durationMins: true, config: true },
    });
    for (const iv of candidates) {
      const invite = ((iv.config as any)?.invites ?? []).find((i: Invite) => i.code === code);
      if (invite) {
        if (new Date(invite.expiresAt) < new Date()) throw new BadRequestException('This interview link has expired');
        const resume = (iv.config as any)?.resume;
        const resumeContext = resume
          ? `Summary: ${resume.summary}. Skills: ${(resume.skills ?? []).join(', ')}. Projects: ${(resume.projects ?? []).join('; ')}. Suggested resume-grounded questions: ${(resume.questions ?? []).map((q: any) => q.prompt).join(' | ')}`
          : undefined;
        return {
          interviewId: iv.id, title: iv.title, jobRole: iv.jobRole, category: iv.category,
          difficulty: iv.difficulty, durationMins: iv.durationMins,
          topic: (iv.config as any)?.topic ?? iv.jobRole,
          candidateName: invite.name, candidateEmail: invite.email,
          resumeContext,
        };
      }
    }
    throw new NotFoundException('Invalid or expired interview link');
  }

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
