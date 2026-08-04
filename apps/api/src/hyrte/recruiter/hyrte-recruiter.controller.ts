import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { HyrteRecruiterService } from './hyrte-recruiter.service';

/**
 * Master Build Prompt Part E3/G7 — Recruiter Live Console REST surface.
 * Role-only gate, same as CouncilController, for the same documented reason:
 * no recruiter/session assignment model exists for HYRTE sessions yet.
 */
@ApiTags('hyrte-recruiter')
@ApiBearerAuth()
@Controller('hyrte/sessions/:id/recruiter')
@UseGuards(RolesGuard)
@Roles('RECRUITER', 'ORG_ADMIN', 'SUPER_ADMIN')
export class HyrteRecruiterController {
  constructor(private readonly recruiter: HyrteRecruiterService) {}

  @Get('overview')
  overview(@Param('id') id: string) {
    return this.recruiter.getOverview(id);
  }

  @Get('stakeholders')
  stakeholders(@Param('id') id: string) {
    return this.recruiter.getStakeholders(id);
  }

  @Get('company-state')
  companyState(@Param('id') id: string) {
    return this.recruiter.getCompanyState(id);
  }

  @Get('company-state/history')
  companyStateHistory(@Param('id') id: string) {
    return this.recruiter.getCompanyStateHistory(id);
  }

  @Get('what-changed')
  whatChanged(@Param('id') id: string) {
    return this.recruiter.getWhatChanged(id);
  }

  @Get('evidence')
  evidence(@Param('id') id: string) {
    return this.recruiter.getEvidence(id);
  }

  @Get('work-items')
  workItems(@Param('id') id: string) {
    return this.recruiter.getWorkItems(id);
  }

  @Get('focus-map')
  focusMap(@Param('id') id: string) {
    return this.recruiter.getFocusMap(id);
  }

  @Get('decision-log')
  decisionLog(@Param('id') id: string) {
    return this.recruiter.getDecisionLog(id);
  }
}
