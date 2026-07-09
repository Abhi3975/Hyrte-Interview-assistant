import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Analytics service. All reads go through the replica (`prisma.reader`) so
 * heavy dashboard aggregation never contends with the write path.
 */
@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Recruiter/org dashboard: pipeline funnel + score & recommendation mix. */
  async orgOverview(organizationId: string) {
    const db = this.prisma.reader;

    const [interviews, sessionsByState, recs, avgScore, flagged] = await Promise.all([
      db.interview.count({ where: { organizationId } }),
      db.interviewSession.groupBy({
        by: ['examState'],
        where: { interview: { organizationId } },
        _count: { _all: true },
      }),
      db.evaluation.groupBy({
        by: ['recommendation'],
        where: { session: { interview: { organizationId } } },
        _count: { _all: true },
      }),
      db.evaluation.aggregate({
        where: { session: { interview: { organizationId } } },
        _avg: { overallScore: true },
      }),
      // Sessions with elevated risk needing review.
      db.interviewSession.count({
        where: { interview: { organizationId }, riskScore: { gte: 40 } },
      }),
    ]);

    return {
      interviews,
      funnel: this.toMap(sessionsByState, 'examState'),
      recommendations: this.toMap(recs, 'recommendation'),
      avgScore: Math.round((avgScore._avg.overallScore ?? 0) * 10) / 10,
      flaggedForReview: flagged,
    };
  }

  /** Candidate progress: attempts + trend of scores over time. */
  async candidateProgress(candidateId: string) {
    const db = this.prisma.reader;
    const sessions = await db.interviewSession.findMany({
      where: { candidateId, examState: 'COMPLETED' },
      orderBy: { completedAt: 'asc' },
      select: {
        id: true,
        completedAt: true,
        riskScore: true,
        interview: { select: { title: true, category: true } },
        evaluation: { select: { overallScore: true, recommendation: true } },
        _count: { select: { proctorEvents: true } },
      },
    });
    const scores = sessions.map((s) => s.evaluation?.overallScore ?? 0);
    return {
      attempts: sessions.length,
      avgScore: scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : 0,
      history: sessions,
    };
  }

  private toMap<T extends Record<string, any>>(rows: T[], key: keyof T): Record<string, number> {
    const out: Record<string, number> = {};
    for (const r of rows) out[String(r[key])] = r._count._all;
    return out;
  }
}
