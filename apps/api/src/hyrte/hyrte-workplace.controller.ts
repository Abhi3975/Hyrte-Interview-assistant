import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { HyrteWorkplaceService } from './hyrte-workplace.service';
import { ReplyInboxDto, SendSlackMessageDto, UpdateTaskDto } from './dto/hyrte.dto';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';

@ApiTags('hyrte')
@ApiBearerAuth()
@Controller('hyrte/sessions/:sessionId')
@UseGuards(RolesGuard)
@Roles('CANDIDATE')
export class HyrteWorkplaceController {
  constructor(private readonly workplace: HyrteWorkplaceService) {}

  @Get('inbox')
  listInbox(@Param('sessionId') sessionId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.workplace.listInbox(sessionId, user.id);
  }

  @Post('inbox/:messageId/reply')
  replyInbox(
    @Param('sessionId') sessionId: string,
    @Param('messageId') messageId: string,
    @Body() dto: ReplyInboxDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.workplace.replyInbox(sessionId, messageId, dto, user.id);
  }

  @Patch('inbox/:messageId/read')
  markInboxRead(
    @Param('sessionId') sessionId: string,
    @Param('messageId') messageId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.workplace.markInboxRead(sessionId, messageId, user.id);
  }

  @Get('slack')
  listSlack(
    @Param('sessionId') sessionId: string,
    @Query('channel') channel: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.workplace.listSlack(sessionId, user.id, channel);
  }

  @Post('slack')
  sendSlack(
    @Param('sessionId') sessionId: string,
    @Body() dto: SendSlackMessageDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.workplace.sendSlack(sessionId, dto, user.id);
  }

  @Get('tasks')
  listTasks(@Param('sessionId') sessionId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.workplace.listTasks(sessionId, user.id);
  }

  @Patch('tasks/:taskId')
  updateTask(
    @Param('sessionId') sessionId: string,
    @Param('taskId') taskId: string,
    @Body() dto: UpdateTaskDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.workplace.updateTask(sessionId, taskId, dto, user.id);
  }

  @Get('calendar')
  listCalendar(@Param('sessionId') sessionId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.workplace.listCalendar(sessionId, user.id);
  }

  @Get('knowledge-base')
  listKnowledgeBase(@Param('sessionId') sessionId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.workplace.listKnowledgeBase(sessionId, user.id);
  }

  @Get('stakeholders')
  listStakeholders(@Param('sessionId') sessionId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.workplace.listStakeholders(sessionId, user.id);
  }

  @Get('decision-log')
  listDecisionLog(@Param('sessionId') sessionId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.workplace.listDecisionLog(sessionId, user.id);
  }
}
