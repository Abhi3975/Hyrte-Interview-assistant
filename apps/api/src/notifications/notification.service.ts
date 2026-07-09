import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS } from '../redis/redis.module';
import { PrismaService } from '../prisma/prisma.service';

export interface NotificationInput {
  userId: string;
  type: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

/**
 * Notification service.
 *
 * Persists a notification and publishes it on a Redis channel. A WebSocket
 * gateway (or the frontend's SSE/socket connection) subscribes per-user to
 * deliver realtime alerts — the fan-out pattern that scales across many API
 * pods behind a load balancer.
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async notify(input: NotificationInput): Promise<void> {
    // Persist for the notification center / bell icon.
    // (Uses AuditLog-style metadata; a dedicated Notification model can be
    // added — see docs/DATA_MODEL.md for the planned table.)
    const payload = {
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body,
      data: input.data ?? {},
      createdAt: new Date().toISOString(),
    };
    try {
      await this.redis.publish(`notifications:${input.userId}`, JSON.stringify(payload));
      await this.redis.lpush(`notifications:inbox:${input.userId}`, JSON.stringify(payload));
      await this.redis.ltrim(`notifications:inbox:${input.userId}`, 0, 199);
    } catch (err) {
      this.logger.warn(`Failed to publish notification: ${err}`);
    }
  }

  async inbox(userId: string, limit = 50): Promise<unknown[]> {
    const items = await this.redis.lrange(`notifications:inbox:${userId}`, 0, limit - 1);
    return items.map((i) => JSON.parse(i));
  }

  /** Alert every recruiter/admin in an org (e.g. on auto-termination). */
  async alertOrgStaff(organizationId: string, input: Omit<NotificationInput, 'userId'>): Promise<void> {
    const staff = await this.prisma.user.findMany({
      where: { organizationId, role: { in: ['RECRUITER', 'ORG_ADMIN'] } },
      select: { id: true },
    });
    await Promise.all(staff.map((s) => this.notify({ ...input, userId: s.id })));
  }
}
