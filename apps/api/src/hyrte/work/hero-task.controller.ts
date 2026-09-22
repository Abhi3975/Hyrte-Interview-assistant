import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { HyrteHeroTaskService } from './hero-task.service';
import { SaveHeroTaskDraftDto } from '../dto/hyrte.dto';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';

/**
 * Refinements doc §10/§11 — "My Tasks tells you WHAT needs to be done. Opening
 * the task gives you the actual tools to DO it."
 */
@ApiTags('hyrte')
@ApiBearerAuth()
@Controller('hyrte/sessions/:sessionId/my-tasks')
@UseGuards(RolesGuard)
@Roles('CANDIDATE')
export class HyrteHeroTaskController {
  constructor(private readonly heroTasks: HyrteHeroTaskService) {}

  @Get()
  list(@Param('sessionId') sessionId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.heroTasks.listMyTasks(sessionId, user.id);
  }

  @Get(':taskId')
  workspace(@Param('sessionId') sessionId: string, @Param('taskId') taskId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.heroTasks.getTaskWorkspace(sessionId, taskId, user.id);
  }

  @Patch(':taskId/draft')
  saveDraft(
    @Param('sessionId') sessionId: string,
    @Param('taskId') taskId: string,
    @Body() dto: SaveHeroTaskDraftDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.heroTasks.saveDraft(sessionId, taskId, user.id, dto);
  }

  @Post(':taskId/submit')
  submit(@Param('sessionId') sessionId: string, @Param('taskId') taskId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.heroTasks.submit(sessionId, taskId, user.id);
  }
}
