import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Prisma wrapper.
 *
 * Exposes a primary (writer) client plus an optional read-replica client.
 * Read-heavy paths (question search, analytics dashboards) should call
 * `prisma.reader` so we can offload them to PostgreSQL read replicas —
 * a key lever for scaling to 100k+ concurrent users.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  readonly reader: PrismaClient;

  constructor() {
    super({ log: ['warn', 'error'] });
    const replicaUrl = process.env.DATABASE_REPLICA_URL;
    this.reader = replicaUrl
      ? new PrismaClient({ datasources: { db: { url: replicaUrl } } })
      : this; // fall back to primary if no replica configured
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    if (this.reader !== this) await this.reader.$connect();
    this.logger.log('Prisma connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    if (this.reader !== this) await this.reader.$disconnect();
  }
}
