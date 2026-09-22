import { Injectable, NotFoundException } from '@nestjs/common';
import type { HiringOutcomeEventType, PerformanceRating } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CalibrationService } from './calibration.service';

export interface RecordOutcomeInput {
  eventType: HiringOutcomeEventType;
  performanceRating?: PerformanceRating;
  notes?: string;
  occurredAt?: Date;
}

/**
 * §3.5 / §9 Learning Engine, write path — recruiters attach what actually
 * happened to a candidate after the interview.
 *
 * This used to be the whole engine: create + list, feeding nothing. It now
 * feeds CalibrationService, which is what makes the loop a loop — every
 * outcome recorded here changes how much each council member's vote counts
 * on the next session, once there are enough of them to justify it.
 */
@Injectable()
export class HiringOutcomeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly calibration: CalibrationService,
  ) {}

  private async assertSessionExists(sessionId: string) {
    const session = await this.prisma.hyrteSession.findUnique({ where: { id: sessionId }, select: { id: true } });
    if (!session) throw new NotFoundException('Session not found');
  }

  async record(sessionId: string, recordedBy: string, input: RecordOutcomeInput) {
    await this.assertSessionExists(sessionId);
    // New evidence — the next council run should see it rather than a
    // ten-minute-old picture of what the committee had learned.
    this.calibration.invalidate();
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
