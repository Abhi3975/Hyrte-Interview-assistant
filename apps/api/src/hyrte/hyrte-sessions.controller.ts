import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { HyrteSessionsService } from './hyrte-sessions.service';
import { CreateHyrteSessionDto, SubmitBaselineChallengeDto } from './dto/hyrte.dto';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';

@ApiTags('hyrte')
@ApiBearerAuth()
@Controller('hyrte/sessions')
@UseGuards(RolesGuard)
@Roles('CANDIDATE')
export class HyrteSessionsController {
  constructor(private readonly sessions: HyrteSessionsService) {}

  @Post()
  create(@Body() dto: CreateHyrteSessionDto, @CurrentUser() user: AuthenticatedUser) {
    return this.sessions.create(dto, user.id);
  }

  @Get(':id')
  get(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.sessions.getById(id, user.id);
  }

  @Get(':id/company-state')
  companyState(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.sessions.getCompanyState(id, user.id);
  }

  @Get(':id/company-state/history')
  companyStateHistory(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.sessions.getCompanyStateHistory(id, user.id);
  }

  @Get(':id/what-changed')
  whatChanged(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.sessions.getWhatChanged(id, user.id);
  }

  @Get(':id/world-events')
  worldEvents(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.sessions.getWorldEvents(id, user.id);
  }

  @Get(':id/world-generation-artifacts')
  worldGenerationArtifacts(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.sessions.getWorldGenerationArtifacts(id, user.id);
  }

  // UX flow §8 steps 1-2 — mission brief and baseline challenge content ships
  // as part of the session GET above (`missionBrief`/`baselineChallenge`
  // fields); these two endpoints only handle the phase transitions.

  @Post(':id/mission-brief/continue')
  continueMissionBrief(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.sessions.advancePastMissionBrief(id, user.id);
  }

  @Post(':id/baseline-challenge/submit')
  submitBaselineChallenge(
    @Param('id') id: string,
    @Body() dto: SubmitBaselineChallengeDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sessions.submitBaselineChallenge(id, user.id, dto);
  }
}
