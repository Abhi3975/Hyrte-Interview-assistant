import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CalibrationService } from './calibration.service';

/**
 * §9 Learning Engine, recruiter view — "what has the committee learned about
 * itself?"
 *
 * Aggregate only: per-agent statistics over past sessions, never a candidate.
 * Same known scope note as the rest of the HYRTE recruiter surface — role-gated
 * rather than organization-scoped, because no organization assignment model
 * exists yet.
 */
@ApiTags('hyrte-learning')
@ApiBearerAuth()
@Controller('hyrte/council-calibration')
@UseGuards(RolesGuard)
@Roles('RECRUITER', 'ORG_ADMIN', 'SUPER_ADMIN')
export class CalibrationController {
  constructor(private readonly calibration: CalibrationService) {}

  @Get()
  @ApiOperation({
    summary: 'How well each council member has predicted real hiring outcomes, and the vote weights that follow',
  })
  get(@Query('refresh') refresh?: string) {
    return this.calibration.getCalibration(refresh === 'true');
  }
}
