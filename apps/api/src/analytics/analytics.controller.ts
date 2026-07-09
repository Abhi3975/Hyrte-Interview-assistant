import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';

@ApiTags('analytics')
@ApiBearerAuth()
@Controller('analytics')
@UseGuards(RolesGuard)
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('overview')
  @Roles('RECRUITER', 'ORG_ADMIN')
  overview(@CurrentUser() user: AuthenticatedUser) {
    return this.analytics.orgOverview(user.organizationId!);
  }

  @Get('me/progress')
  @Roles('CANDIDATE')
  progress(@CurrentUser() user: AuthenticatedUser) {
    return this.analytics.candidateProgress(user.id);
  }
}
