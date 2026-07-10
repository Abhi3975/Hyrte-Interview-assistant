import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { InterviewService } from './interview.service';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import {
  AnalyzeResumeDto,
  AssistantDto,
  CreateInterviewDto,
  CreateInviteDto,
  GenerateQuestionsDto,
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

  /** Candidate: resolve an invite code to the assessment config (pre-login OK). */
  @Public()
  @Get('invite/:code')
  resolveInvite(@Param('code') code: string) {
    return this.interviews.resolveInvite(code);
  }

  @Get(':id')
  @Roles('RECRUITER', 'ORG_ADMIN')
  detail(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.interviews.getDetail(id, user);
  }

  @Post(':id/generate-questions')
  @Roles('RECRUITER', 'ORG_ADMIN')
  generateQuestions(@Param('id') id: string, @Body() dto: GenerateQuestionsDto, @CurrentUser() user: AuthenticatedUser) {
    return this.interviews.generateQuestions(id, dto.count, user);
  }

  @Post(':id/analyze-resume')
  @Roles('RECRUITER', 'ORG_ADMIN')
  analyzeResume(@Param('id') id: string, @Body() dto: AnalyzeResumeDto, @CurrentUser() user: AuthenticatedUser) {
    return this.interviews.analyzeResume(id, dto.resumeText, user);
  }

  @Post(':id/assistant')
  @Roles('RECRUITER', 'ORG_ADMIN')
  assistant(@Param('id') id: string, @Body() dto: AssistantDto, @CurrentUser() user: AuthenticatedUser) {
    return this.interviews.assistant(id, dto.message, user);
  }

  @Post(':id/publish')
  @Roles('RECRUITER', 'ORG_ADMIN')
  publish(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.interviews.publish(id, user);
  }

  @Post(':id/invite-link')
  @Roles('RECRUITER', 'ORG_ADMIN')
  inviteLink(@Param('id') id: string, @Body() dto: CreateInviteDto, @CurrentUser() user: AuthenticatedUser) {
    return this.interviews.createInvite(id, dto, user);
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
