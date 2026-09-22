import { BadRequestException, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { HyrteActivityService, isTimestampSurface } from './activity.service';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';

/** Refinements doc §4 — the unified Activity Center's read path. */
@ApiTags('hyrte')
@ApiBearerAuth()
@Controller('hyrte/sessions/:sessionId/activity')
@UseGuards(RolesGuard)
@Roles('CANDIDATE')
export class HyrteActivityController {
  constructor(private readonly activity: HyrteActivityService) {}

  @Get()
  feed(@Param('sessionId') sessionId: string, @Query('limit') limit: string | undefined, @CurrentUser() user: AuthenticatedUser) {
    const parsed = Number(limit);
    return this.activity.getFeed(sessionId, user.id, Number.isFinite(parsed) && parsed > 0 ? Math.min(100, parsed) : 40);
  }

  /**
   * Marks a surface seen. Inbox is deliberately NOT accepted here — it has real
   * per-message readAt state and marking the whole surface seen would silently
   * clear genuinely unread messages the candidate never opened.
   */
  @Patch('seen/:surface')
  markSeen(@Param('sessionId') sessionId: string, @Param('surface') surface: string, @CurrentUser() user: AuthenticatedUser) {
    if (!isTimestampSurface(surface)) throw new BadRequestException(`Unknown activity surface "${surface}"`);
    return this.activity.markSeen(sessionId, user.id, surface);
  }
}
