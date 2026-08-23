import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { HyrteWorkplaceService } from './hyrte-workplace.service';
import {
  AddInboxNoteDto,
  ArchiveInboxDto,
  CommandBarDto,
  FlagInboxDto,
  ForwardInboxDto,
  MarkInboxReadDto,
  ReplyInboxDto,
  ScheduleReminderDto,
  SendMeetingMessageDto,
  SendSlackMessageDto,
  UpdateWorkItemDto,
  WorkItemReviewDto,
} from './dto/hyrte.dto';
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
    @Body() dto: MarkInboxReadDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.workplace.markInboxRead(sessionId, messageId, user.id, dto.read ?? true);
  }

  @Post('inbox/:messageId/forward')
  forwardInbox(
    @Param('sessionId') sessionId: string,
    @Param('messageId') messageId: string,
    @Body() dto: ForwardInboxDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.workplace.forwardInbox(sessionId, messageId, dto, user.id);
  }

  @Patch('inbox/:messageId/flag')
  flagInbox(
    @Param('sessionId') sessionId: string,
    @Param('messageId') messageId: string,
    @Body() dto: FlagInboxDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.workplace.setInboxFlag(sessionId, messageId, dto, user.id);
  }

  @Patch('inbox/:messageId/archive')
  archiveInbox(
    @Param('sessionId') sessionId: string,
    @Param('messageId') messageId: string,
    @Body() dto: ArchiveInboxDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.workplace.setInboxArchived(sessionId, messageId, dto, user.id);
  }

  @Post('inbox/:messageId/notes')
  addInboxNote(
    @Param('sessionId') sessionId: string,
    @Param('messageId') messageId: string,
    @Body() dto: AddInboxNoteDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.workplace.addInboxNote(sessionId, messageId, dto, user.id);
  }

  @Post('inbox/:messageId/convert-to-task')
  convertInboxToTask(
    @Param('sessionId') sessionId: string,
    @Param('messageId') messageId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.workplace.convertInboxToTask(sessionId, messageId, user.id);
  }

  @Post('inbox/:messageId/reminder')
  scheduleInboxReminder(
    @Param('sessionId') sessionId: string,
    @Param('messageId') messageId: string,
    @Body() dto: ScheduleReminderDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.workplace.scheduleInboxReminder(sessionId, messageId, dto, user.id);
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
    @Body() dto: UpdateWorkItemDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.workplace.updateTask(sessionId, taskId, dto, user.id);
  }

  @Get('needs-review')
  listNeedsReview(@Param('sessionId') sessionId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.workplace.listNeedsReview(sessionId, user.id);
  }

  @Post('work-items/:workItemId/review')
  submitWorkItemReview(
    @Param('sessionId') sessionId: string,
    @Param('workItemId') workItemId: string,
    @Body() dto: WorkItemReviewDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.workplace.submitWorkItemReview(sessionId, workItemId, dto, user.id);
  }

  @Post('command')
  submitCommand(
    @Param('sessionId') sessionId: string,
    @Body() dto: CommandBarDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.workplace.submitCommand(sessionId, user.id, dto);
  }

  @Get('calendar')
  listCalendar(@Param('sessionId') sessionId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.workplace.listCalendar(sessionId, user.id);
  }

  @Post('calendar/:eventId/attend')
  attendMeeting(
    @Param('sessionId') sessionId: string,
    @Param('eventId') eventId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.workplace.attendMeeting(sessionId, eventId, user.id);
  }

  @Get('calendar/:eventId/messages')
  listMeetingMessages(
    @Param('sessionId') sessionId: string,
    @Param('eventId') eventId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.workplace.listMeetingMessages(sessionId, eventId, user.id);
  }

  @Post('calendar/:eventId/messages')
  sendMeetingMessage(
    @Param('sessionId') sessionId: string,
    @Param('eventId') eventId: string,
    @Body() dto: SendMeetingMessageDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.workplace.sendMeetingMessage(sessionId, eventId, dto, user.id);
  }

  @Get('knowledge-base')
  listKnowledgeBase(@Param('sessionId') sessionId: string, @Query('q') q: string | undefined, @CurrentUser() user: AuthenticatedUser) {
    return this.workplace.listKnowledgeBase(sessionId, user.id, q);
  }

  @Get('stakeholders')
  listStakeholders(@Param('sessionId') sessionId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.workplace.listStakeholders(sessionId, user.id);
  }

  @Get('system-map')
  getSystemMap(@Param('sessionId') sessionId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.workplace.getSystemMap(sessionId, user.id);
  }

  @Get('decision-log')
  listDecisionLog(@Param('sessionId') sessionId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.workplace.listDecisionLog(sessionId, user.id);
  }
}
