import { Injectable, NotFoundException } from '@nestjs/common';
import type { HiringOutcomeEventType, PerformanceRating } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface RecordOutcomeInput {
  eventType: HiringOutcomeEventType;
  performanceRating?: PerformanceRating;
  notes?: string;
  occurredAt?: Date;
}

/**
 * §3.5 / §9 Learning Engine — schema-only phase. This service is
 * deliberately just create + list: no aggregation, no scoring, no feedback
 * into anything else. The doc is explicit that the retraining loop
 * ("Decision Graph → Hiring Outcome → Model Improvement") is a later
 * milestone — this is only the write/read path a future job would build on.
 */
@Injectable()
export class HiringOutcomeService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertSessionExists(sessionId: string) {
    const session = await this.prisma.hyrteSession.findUnique({ where: { id: sessionId }, select: { id: true } });
    if (!session) throw new NotFoundException('Session not found');
  }

  async record(sessionId: string, recordedBy: string, input: RecordOutcomeInput) {
    await this.assertSessionExists(sessionId);
    return this.prisma.hyrteHiringOutcomeEvent.create({
      data: {
        sessionId,
        recordedBy,
        eventType: input.eventType,
        performanceRating: input.performanceRating,
        notes: input.notes,
        ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
      },
    });
  }

  async list(sessionId: string) {
    await this.assertSessionExists(sessionId);
    return this.prisma.hyrteHiringOutcomeEvent.findMany({ where: { sessionId }, orderBy: { occurredAt: 'asc' } });
  }
}
