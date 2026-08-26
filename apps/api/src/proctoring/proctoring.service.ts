import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type Redis from 'ioredis';
import { Interview, InterviewSession, ProctorSeverity } from '@prisma/client';

// A session with its parent interview eagerly loaded (used by the warning /
// termination paths so we can resolve the owning organization).
type SessionWithInterview = InterviewSession & { interview: Interview | null };

/**
 * P3 §4/§7 — "repeated violations end the session (configurable policy per
 * assessment: warn / pause / terminate)". Read from Interview.config (the
 * existing loose JSON bag — no schema change needed for this part) so a
 * recruiter can eventually set it via a composer UI (P7's job, not built
 * yet). Self-serve practice sessions (Interview.config.selfServe === true,
 * set in PracticeService.startSession) default to WARN — a demo candidate
 * tripping a threshold shouldn't get auto-locked out of a practice run with
 * no recruiter watching, same "never leave a demo candidate stuck"
 * reasoning already used elsewhere in this codebase. Recruiter-created
 * assessments default to TERMINATE, preserving the exact pre-P3 behavior
 * unless a recruiter explicitly configures otherwise.
 */
export type ProctoringPolicy = 'WARN' | 'PAUSE' | 'TERMINATE';
export function resolvePolicy(interview: Interview | null): ProctoringPolicy {
  const config = (interview?.config as { proctoringPolicy?: string; selfServe?: boolean } | null) ?? null;
  if (config?.proctoringPolicy === 'WARN' || config?.proctoringPolicy === 'PAUSE' || config?.proctoringPolicy === 'TERMINATE') {
    return config.proctoringPolicy;
  }
  return config?.selfServe ? 'WARN' : 'TERMINATE';
}
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { NotificationService } from '../notifications/notification.service';
import { REDIS } from '../redis/redis.module';
import { RiskEngine, RiskResult } from './risk-engine.service';
import { WARNING_THRESHOLDS, MAX_WARNINGS } from './risk-weights';
import { IngestEventDto } from './dto/proctoring.dto';
import { RecordingService } from '../recording/recording.service';

/**
 * Lockdown requirements (AI interviewer checklist): leaving fullscreen or
 * switching away from the interview tab must end a real, proctored
 * assessment — not slowly nudge a statistical risk curve. The weighted
 * model in risk-weights.ts is deliberately forgiving (a real design choice
 * for noisy signals like face detection or ambient audio, where one blip
 * shouldn't cost a candidate their interview), so it's the wrong tool for
 * "the candidate left the locked-down environment," which is unambiguous
 * the instant it happens. This is a separate, deterministic strike count
 * for exactly these two signals: 1st occurrence -> the existing warning
 * path fires immediately (bypassing the risk threshold), 2nd -> whatever
 * the session's own policy does at MAX_WARNINGS (terminate/pause) — same
 * codepath every other max-warning trigger already uses, not a parallel
 * termination mechanism.
 */
const HARD_STRIKE_TYPES = new Set(['FULLSCREEN_EXIT', 'TAB_SWITCH']);

/** Pure so the strike math is unit-testable without the Prisma/Redis DI surface. */
export function hardStrikeLevelFor(strikeCount: number, maxWarnings: number): number {
  if (strikeCount <= 0) return 0;
  return strikeCount >= 2 ? maxWarnings : 1;
}

/**
 * Proctoring Service — the orchestration layer of the Zero-Trust engine.
 *
 * On every ingested signal it:
 *   1. persists the raw event (immutable evidence),
 *   2. recomputes the weighted, time-decayed risk score,
 *   3. escalates warnings only when risk crosses configured thresholds,
 *   4. auto-terminates at MAX_WARNINGS — locking the session and alerting staff.
 *
 * It NEVER accuses: it produces risk scores and evidence. Human reviewers make
 * the final call, and admins can reset/override.
 */
@Injectable()
export class ProctoringService {
  private readonly logger = new Logger(ProctoringService.name);
  // Look back this far when computing risk (older events have decayed anyway).
  private readonly WINDOW_SEC = 1800;

  constructor(
    private readonly prisma: PrismaService,
    private readonly riskEngine: RiskEngine,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly recording: RecordingService,
  ) {}

  async ingest(dto: IngestEventDto): Promise<{ risk: RiskResult; warningLevel: number; terminated: boolean; policy: ProctoringPolicy }> {
    const session = await this.prisma.interviewSession.findUnique({
      where: { id: dto.sessionId },
      include: { interview: true },
    });
    if (!session) throw new NotFoundException('Session not found');

    // 1) Persist the raw event as immutable evidence.
    await this.prisma.proctorEvent.create({
      data: {
        sessionId: dto.sessionId,
        type: dto.type,
        severity: dto.severity ?? ProctorSeverity.LOW,
        payload: (dto.payload ?? {}) as object,
        evidenceUrl: dto.evidenceUrl,
        provider: dto.provider ?? 'internal',
      },
    });

    // 2) Recompute risk over the recent window.
    const since = new Date(Date.now() - this.WINDOW_SEC * 1000);
    const events = await this.prisma.proctorEvent.findMany({
      where: { sessionId: dto.sessionId, occurredAt: { gte: since } },
      orderBy: { occurredAt: 'desc' },
      take: 500,
    });
    const risk = this.riskEngine.compute(events);

    await this.prisma.riskAssessment.upsert({
      where: { sessionId: dto.sessionId },
      create: {
        sessionId: dto.sessionId,
        riskScore: risk.riskScore,
        cheatingProbability: risk.cheatingProbability,
        confidenceScore: risk.confidenceScore,
        breakdown: risk.breakdown,
        topSignals: risk.topSignals,
      },
      update: {
        riskScore: risk.riskScore,
        cheatingProbability: risk.cheatingProbability,
        confidenceScore: risk.confidenceScore,
        breakdown: risk.breakdown,
        topSignals: risk.topSignals,
      },
    });
    await this.prisma.interviewSession.update({
      where: { id: dto.sessionId },
      data: { riskScore: risk.riskScore },
    });

    // Publish live risk to the proctoring dashboard (Redis pub/sub fan-out).
    await this.redis
      .publish(`proctoring:${dto.sessionId}`, JSON.stringify({ type: 'risk', ...risk, event: dto.type }))
      .catch(() => undefined);

    // 3) Escalate warnings based on weighted risk, not raw event count.
    const policy = resolvePolicy(session.interview);
    let targetLevel = this.warningLevelForRisk(risk.riskScore);

    // Zero-tolerance override for leaving fullscreen / switching tabs — see
    // HARD_STRIKE_TYPES above. Self-serve WARN sessions are exempt, same
    // "never strand a demo candidate with no recruiter watching" reasoning
    // as resolvePolicy's own default.
    if (policy !== 'WARN' && HARD_STRIKE_TYPES.has(dto.type)) {
      const strikeCount = await this.prisma.proctorEvent.count({
        where: { sessionId: dto.sessionId, type: { in: Array.from(HARD_STRIKE_TYPES) as never[] } },
      });
      targetLevel = Math.max(targetLevel, hardStrikeLevelFor(strikeCount, MAX_WARNINGS));
    }

    let terminated = false;
    let warningLevel = session.warningCount;

    if (targetLevel > session.warningCount) {
      warningLevel = await this.issueWarning(session, targetLevel, dto, risk, policy);
      terminated = warningLevel >= MAX_WARNINGS && policy === 'TERMINATE';
      if (terminated) await this.terminate(session, risk, dto.type);
    }

    return { risk, warningLevel, terminated, policy };
  }

  /** Map a risk score to the highest crossed warning threshold. */
  private warningLevelForRisk(risk: number): number {
    let level = 0;
    WARNING_THRESHOLDS.forEach((t, i) => {
      if (risk >= t) level = i + 1;
    });
    return level;
  }

  private async issueWarning(
    session: SessionWithInterview,
    level: number,
    dto: IngestEventDto,
    risk: RiskResult,
    policy: ProctoringPolicy,
  ): Promise<number> {
    // Persist immutable warning with evidence pointers.
    await this.prisma.warning.create({
      data: {
        sessionId: session.id,
        level,
        triggerType: dto.type,
        screenshotUrl: (dto.payload?.screenshotUrl as string) ?? undefined,
        webcamUrl: dto.evidenceUrl,
        riskScoreAt: risk.riskScore,
        metadata: { topSignals: risk.topSignals, breakdown: risk.breakdown },
      },
    });

    // P3 — policy determines what the max-warnings threshold actually DOES:
    // TERMINATE ends the session (terminate() runs right after, in ingest());
    // PAUSE uses the real (previously dead-code) SUSPENDED exam state, which
    // submitAnswer's own guard already blocks on — an honest MVP of "pause"
    // without building a full resume-workflow UI in this pass; WARN never
    // escalates past WARNING_ISSUED, so it never blocks the candidate.
    const atMax = level >= MAX_WARNINGS;
    const nextState = policy === 'TERMINATE' && atMax ? 'TERMINATED' : policy === 'PAUSE' && atMax ? 'SUSPENDED' : 'WARNING_ISSUED';
    await this.prisma.interviewSession.update({
      where: { id: session.id },
      data: {
        warningCount: level,
        examState: nextState,
      },
    });

    await this.audit.record({
      organizationId: session.interview?.organizationId,
      action: `proctoring.warning.level_${level}`,
      targetType: 'InterviewSession',
      targetId: session.id,
      metadata: { trigger: dto.type, risk: risk.riskScore },
    });

    // Notify candidate (popup) for L1/L2; recruiter is looped in from L2.
    await this.redis
      .publish(
        `proctoring:${session.id}`,
        JSON.stringify({ type: 'warning', level, message: this.warningMessage(level) }),
      )
      .catch(() => undefined);

    if (level >= 2 && session.interview?.organizationId) {
      await this.notifications.alertOrgStaff(session.interview.organizationId, {
        type: 'proctoring.warning',
        title: `Warning L${level} issued`,
        body: `Session ${session.id} crossed risk ${risk.riskScore} (${dto.type}).`,
        data: { sessionId: session.id, level, risk: risk.riskScore },
      });
    }

    return level;
  }

  /** Auto-termination: lock session, disqualify, alert staff, generate report. */
  private async terminate(session: SessionWithInterview, risk: RiskResult, trigger: string): Promise<void> {
    await this.prisma.interviewSession.update({
      where: { id: session.id },
      data: {
        examState: 'TERMINATED',
        status: 'CANCELLED',
        disqualified: true,
        lockedAt: new Date(),
        terminatedReason: `Auto-terminated at risk ${risk.riskScore} (${trigger})`,
        completedAt: new Date(),
      },
    });

    await this.audit.record({
      organizationId: session.interview?.organizationId,
      action: 'proctoring.auto_terminate',
      targetType: 'InterviewSession',
      targetId: session.id,
      metadata: { risk: risk.riskScore, trigger, topSignals: risk.topSignals },
    });

    await this.redis
      .publish(`proctoring:${session.id}`, JSON.stringify({ type: 'terminated', reason: trigger }))
      .catch(() => undefined);

    if (session.interview?.organizationId) {
      await this.notifications.alertOrgStaff(session.interview.organizationId, {
        type: 'proctoring.terminated',
        title: 'Assessment auto-terminated',
        body: `Session ${session.id} was terminated after ${MAX_WARNINGS} warnings (risk ${risk.riskScore}).`,
        data: { sessionId: session.id, risk: risk.riskScore },
      });
    }
    this.logger.warn(`Session ${session.id} auto-terminated (risk ${risk.riskScore}, trigger ${trigger})`);
  }

  private warningMessage(level: number): string {
    if (level === 1) return 'We noticed unusual activity. Please stay focused on the screen.';
    if (level === 2) return 'Final warning: further violations will end your assessment.';
    return 'Your assessment has been terminated due to repeated violations.';
  }

  // ── Dashboard reads ──

  /**
   * P4 — now also returns session timing (so the client can compute a
   * click-a-flag-jump-to-that-moment video offset), a fresh presigned
   * playback URL if a recording exists, and a per-signal summary (count +
   * % of the events in this session, per the spec's own "Integrity summary:
   * per-signal % occurrence and count").
   */
  async sessionTimeline(sessionId: string) {
    const [events, warnings, risk, session] = await Promise.all([
      this.prisma.reader.proctorEvent.findMany({
        where: { sessionId },
        orderBy: { occurredAt: 'asc' },
      }),
      this.prisma.reader.warning.findMany({ where: { sessionId }, orderBy: { createdAt: 'asc' } }),
      this.prisma.reader.riskAssessment.findUnique({ where: { sessionId } }),
      this.prisma.reader.interviewSession.findUnique({
        where: { id: sessionId },
        select: { startedAt: true, completedAt: true, recordingUrl: true },
      }),
    ]);
    if (!session) throw new NotFoundException('Session not found');

    const counts = new Map<string, number>();
    for (const e of events) counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
    const total = events.length;
    const signalSummary = Array.from(counts.entries())
      .map(([type, count]) => ({ type, count, percent: total > 0 ? Math.round((count / total) * 1000) / 10 : 0 }))
      .sort((a, b) => b.count - a.count);

    return {
      events,
      warnings,
      risk,
      session: { startedAt: session.startedAt, completedAt: session.completedAt, hasRecording: Boolean(session.recordingUrl) },
      recordingUrl: session.recordingUrl ? await this.recording.getPlaybackUrl(sessionId) : null,
      signalSummary,
    };
  }

  async liveSessions(organizationId: string) {
    return this.prisma.reader.interviewSession.findMany({
      where: {
        examState: { in: ['ACTIVE', 'WARNING_ISSUED'] },
        interview: { organizationId },
      },
      orderBy: { riskScore: 'desc' },
      include: {
        candidate: { select: { id: true, fullName: true } },
        interview: { select: { title: true, jobRole: true } },
      },
    });
  }
}
