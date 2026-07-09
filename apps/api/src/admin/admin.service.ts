import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Super-admin platform operations. Cross-tenant reads (intentionally not
 * org-scoped) — the controller restricts every route to SUPER_ADMIN.
 */
@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async platformStats() {
    const db = this.prisma.reader;
    const [orgs, users, interviews, sessions, terminated] = await Promise.all([
      db.organization.count(),
      db.user.count(),
      db.interview.count(),
      db.interviewSession.count(),
      db.interviewSession.count({ where: { examState: 'TERMINATED' } }),
    ]);
    return { orgs, users, interviews, sessions, terminated };
  }

  listOrganizations(skip = 0, take = 25) {
    return this.prisma.reader.organization.findMany({
      skip,
      take,
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { users: true, interviews: true } },
        subscriptions: { select: { plan: true, status: true }, take: 1, orderBy: { createdAt: 'desc' } },
      },
    });
  }

  listUsers(skip = 0, take = 25, search?: string) {
    return this.prisma.reader.user.findMany({
      skip,
      take,
      where: search
        ? { OR: [{ email: { contains: search, mode: 'insensitive' } }, { fullName: { contains: search, mode: 'insensitive' } }] }
        : undefined,
      orderBy: { createdAt: 'desc' },
      select: { id: true, email: true, fullName: true, role: true, status: true, organizationId: true, createdAt: true, lastLoginAt: true },
    });
  }

  /** Suspend / reactivate a user (account lockout). */
  setUserStatus(userId: string, status: 'ACTIVE' | 'SUSPENDED') {
    return this.prisma.user.update({ where: { id: userId }, data: { status } });
  }

  auditLogs(skip = 0, take = 50, action?: string) {
    return this.prisma.reader.auditLog.findMany({
      skip,
      take,
      where: action ? { action: { contains: action } } : undefined,
      orderBy: { createdAt: 'desc' },
      include: { actor: { select: { email: true } } },
    });
  }

  /** Security center: high-severity proctoring signals across all tenants. */
  securityEvents(skip = 0, take = 50) {
    return this.prisma.reader.proctorEvent.findMany({
      skip,
      take,
      where: { severity: { in: ['HIGH', 'CRITICAL'] } },
      orderBy: { occurredAt: 'desc' },
      include: { session: { select: { id: true, candidateId: true } } },
    });
  }
}
