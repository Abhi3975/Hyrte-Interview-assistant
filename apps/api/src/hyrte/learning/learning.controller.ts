import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { HiringOutcomeService } from './hiring-outcome.service';
import { RecordHiringOutcomeDto } from '../dto/hyrte.dto';

/**
 * §9 Learning Engine — recruiters attach real hiring/performance outcomes to
 * a candidate's Decision Graph over time. Same known scope gap as the
 * Council endpoints (see council.controller.ts): role-gated only, not scoped
 * to "the recruiter who owns this candidate," since HYRTE has no
 * recruiter/organization assignment model yet.
 */
@ApiTags('hyrte-learning')
@ApiBearerAuth()
@Controller('hyrte/sessions/:id/hiring-outcome')
@UseGuards(RolesGuard)
@Roles('RECRUITER', 'ORG_ADMIN', 'SUPER_ADMIN')
export class LearningController {
  constructor(private readonly hiringOutcome: HiringOutcomeService) {}

  @Get()
  list(@Param('id') id: string) {
    return this.hiringOutcome.list(id);
  }

  @Post()
  record(@Param('id') id: string, @Body() dto: RecordHiringOutcomeDto, @CurrentUser() user: AuthenticatedUser) {
    return this.hiringOutcome.record(id, user.id, {
      eventType: dto.eventType,
      performanceRating: dto.performanceRating,
      notes: dto.notes,
      occurredAt: dto.occurredAt ? new Date(dto.occurredAt) : undefined,
    });
  }
}
