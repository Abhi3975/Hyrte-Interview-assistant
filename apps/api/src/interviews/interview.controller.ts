import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { InterviewService } from './interview.service';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import {
  CreateInterviewDto,
  InviteCandidateDto,
  StartSessionDto,
  SubmitAnswerDto,
  VerifyIdentityDto,
} from './dto/interview.dto';

@ApiTags('interviews')
@ApiBearerAuth()
@Controller('interviews')
@UseGuards(RolesGuard)
export class InterviewController {
  constructor(private readonly interviews: InterviewService) {}

  // Recruiter authoring
  @Post()
  @Roles('RECRUITER', 'ORG_ADMIN')
  create(@Body() dto: CreateInterviewDto, @CurrentUser() user: AuthenticatedUser) {
    return this.interviews.create(dto, user);
  }

  @Get()
  @Roles('RECRUITER', 'ORG_ADMIN')
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.interviews.listForOrg(user.organizationId!);
  }

  @Post(':id/invite')
  @Roles('RECRUITER', 'ORG_ADMIN')
  invite(
    @Param('id') id: string,
    @Body() dto: InviteCandidateDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.interviews.inviteCandidate(id, dto.candidateId, user);
  }

  // Admin exam control
  @Post('sessions/:sessionId/approve')
  @Roles('RECRUITER', 'ORG_ADMIN')
  approve(@Param('sessionId') sessionId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.interviews.approveAndIssueToken(sessionId, user);
  }

  @Post('sessions/:sessionId/reset-warnings')
  @Roles('ORG_ADMIN')
  resetWarnings(@Param('sessionId') sessionId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.interviews.resetWarnings(sessionId, user);
  }

  @Post('sessions/:sessionId/reopen')
  @Roles('ORG_ADMIN')
  reopen(@Param('sessionId') sessionId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.interviews.reopen(sessionId, user);
  }

  // Candidate exam flow
  @Get('my-sessions')
  @Roles('CANDIDATE')
  mySessions(@CurrentUser() user: AuthenticatedUser) {
    return this.interviews.listCandidateSessions(user.id);
  }

  @Post('sessions/:sessionId/verify-identity')
  @Roles('CANDIDATE')
  verifyIdentity(
    @Param('sessionId') sessionId: string,
    @Body() dto: VerifyIdentityDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.interviews.markIdentityVerified(sessionId, dto.passed ?? true, user);
  }

  @Post('sessions/:sessionId/start')
  @Roles('CANDIDATE')
  start(
    @Param('sessionId') sessionId: string,
    @Body() dto: StartSessionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.interviews.startSession(sessionId, dto.sessionToken, user);
  }

  @Post('sessions/:sessionId/answers')
  @Roles('CANDIDATE')
  submitAnswer(
    @Param('sessionId') sessionId: string,
    @Body() dto: SubmitAnswerDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.interviews.submitAnswer(sessionId, dto, user);
  }

  @Post('sessions/:sessionId/complete')
  @Roles('CANDIDATE')
  complete(@Param('sessionId') sessionId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.interviews.complete(sessionId, user);
  }
}
