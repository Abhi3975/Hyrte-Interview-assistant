import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { Public } from '../common/decorators/public.decorator';
import { EvaluationService } from './evaluation.service';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

class CreateShareLinkDto {
  /** Optional link lifetime override, defaults to 30 days. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  expiresInDays?: number;
}

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

  /** P5 — full report: evaluation + minimal session context for the report page. */
  @Get('sessions/:sessionId/report')
  getReport(@Param('sessionId') sessionId: string) {
    return this.evaluation.getReport(sessionId);
  }

  /** P5 — mint (or rotate) a public, unauthenticated share link for this report. */
  @Post('sessions/:sessionId/share')
  @Roles('RECRUITER', 'ORG_ADMIN')
  createShareLink(@Param('sessionId') sessionId: string, @Body() dto: CreateShareLinkDto) {
    return this.evaluation.createShareLink(sessionId, dto.expiresInDays);
  }

  /** P5 — revoke the current share link, if any. */
  @Delete('sessions/:sessionId/share')
  @Roles('RECRUITER', 'ORG_ADMIN')
  revokeShareLink(@Param('sessionId') sessionId: string) {
    return this.evaluation.revokeShareLink(sessionId);
  }

  /** P5 — public read by token, no auth. The token itself is the credential. */
  @Public()
  @Get('shared/:token')
  getShared(@Param('token') token: string) {
    return this.evaluation.getByShareToken(token);
  }
}
