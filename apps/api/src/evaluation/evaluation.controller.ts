import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { EvaluationService } from './evaluation.service';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@ApiTags('evaluation')
@ApiBearerAuth()
@Controller('evaluation')
@UseGuards(RolesGuard)
export class EvaluationController {
  constructor(private readonly evaluation: EvaluationService) {}

  /** Trigger (or re-run) evaluation for a completed session. */
  @Post('sessions/:sessionId')
  @Roles('RECRUITER', 'ORG_ADMIN')
  run(@Param('sessionId') sessionId: string) {
    return this.evaluation.evaluateSession(sessionId);
  }

  @Get('sessions/:sessionId')
  get(@Param('sessionId') sessionId: string) {
    return this.evaluation.getBySession(sessionId);
  }
}
