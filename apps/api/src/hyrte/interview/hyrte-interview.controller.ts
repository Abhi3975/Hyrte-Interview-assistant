import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { HyrteInterviewService } from './hyrte-interview.service';
import { InterviewTurnDto, StartInterviewDto } from '../dto/hyrte.dto';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';

@ApiTags('hyrte')
@ApiBearerAuth()
@Controller('hyrte/sessions/:sessionId/interview')
@UseGuards(RolesGuard)
@Roles('CANDIDATE')
export class HyrteInterviewController {
  constructor(private readonly interview: HyrteInterviewService) {}

  @Get()
  getTranscript(@Param('sessionId') sessionId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.interview.getTranscript(sessionId, user.id);
  }

  @Post('start')
  start(
    @Param('sessionId') sessionId: string,
    @Body() dto: StartInterviewDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.interview.startInterview(sessionId, user.id, dto.bossMode ?? false);
  }

  @Post('turn')
  turn(
    @Param('sessionId') sessionId: string,
    @Body() dto: InterviewTurnDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.interview.turn(sessionId, user.id, dto.message);
  }

  @Get('report')
  getReport(@Param('sessionId') sessionId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.interview.getReport(sessionId, user.id);
  }
}
