import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsArray, IsEnum, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, Max, Min } from 'class-validator';
import { Category, Difficulty } from '@prisma/client';
import { PracticeService } from './practice.service';
import { InterviewCouncilService } from './council/interview-council.service';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';

class StartPracticeDto {
  @IsEnum(Category) category!: Category;
  @IsEnum(Difficulty) difficulty!: Difficulty;
  @IsOptional() @IsString() topic?: string;
  @IsOptional() @IsInt() @Min(1) @Max(10) count?: number;
}

class AnswerDto {
  @IsString() prompt!: string;
  @IsString() response!: string;
  // P5 — when the client records this moment's wall-clock time, the
  // evaluation report can deep-link into the session recording per question.
  // Optional: the stateless /practice/evaluate endpoint has no recording at
  // all, and older clients won't send it.
  @IsOptional() @IsString() occurredAt?: string;
}

class EvaluatePracticeDto {
  @IsEnum(Category) category!: Category;
  @IsEnum(Difficulty) difficulty!: Difficulty;
  @IsOptional() @IsString() jobRole?: string;
  @IsArray() answers!: AnswerDto[];
}

class StartSessionDto {
  @IsEnum(Category) category!: Category;
  @IsEnum(Difficulty) difficulty!: Difficulty;
  @IsOptional() @IsString() topic?: string;
  @IsOptional() @IsString() jobRole?: string;
  @IsOptional() @IsString() interviewId?: string;
  // P3 §7 — consent screen is mandatory and logged. Required, not optional:
  // the DTO enforces the backend never silently accepts a session with no
  // consent record, even if a client bug ever tried to skip the checkbox.
  @IsString() consentedAt!: string;
}

class CompleteSessionDto {
  @IsEnum(Category) category!: Category;
  @IsEnum(Difficulty) difficulty!: Difficulty;
  @IsOptional() @IsString() jobRole?: string;
  @IsArray() answers!: AnswerDto[];
  @IsOptional() @IsObject() flags?: Record<string, number>;
  @IsOptional() @IsNumber() integrity?: number;
  @IsOptional() @IsObject() behavior?: Record<string, unknown>;
}

class GenerateCodingDto {
  @IsString() topic!: string;
  @IsEnum(Difficulty) difficulty!: Difficulty;
  @IsOptional() @IsIn(['code', 'sql']) kind?: 'code' | 'sql';
}

class TurnMsgDto {
  @IsIn(['interviewer', 'candidate']) role!: 'interviewer' | 'candidate';
  @IsString() content!: string;
}

class CurrentRoundDto {
  @IsString() type!: string;
  @IsString() label!: string;
}

class InterviewTurnDto {
  @IsString() jobRole!: string;
  @IsString() category!: string;
  @IsString() difficulty!: string;
  @IsOptional() @IsString() topic?: string;
  @IsOptional() @IsInt() count?: number;
  @IsOptional() @IsString() candidateName?: string;
  @IsOptional() @IsString() personality?: string;
  @IsOptional() @IsString() behaviorSummary?: string;
  @IsOptional() @IsString() resumeContext?: string;
  @IsOptional() @IsIn(['mixed', 'theory', 'coding']) mode?: 'mixed' | 'theory' | 'coding';
  @IsOptional() @IsString() experience?: string;
  @IsOptional() @IsString() company?: string;
  @IsOptional() @IsString() language?: string;
  @IsOptional() @IsString() style?: string;
  @IsArray() transcript!: TurnMsgDto[];
  @IsOptional() end?: boolean;
  @IsOptional() forceAdvance?: boolean;
  // P2 — round structure.
  @IsOptional() @IsObject() currentRound?: CurrentRoundDto;
  @IsOptional() @IsString() nextRoundLabel?: string;
  @IsOptional() forceRoundAdvance?: boolean;
  // Multi-agent panel doc — reverse interview.
  @IsOptional() reverseInterviewQuestion?: boolean;
}

class TestCaseDto {
  @IsString() input!: string;
  @IsString() output!: string;
  @IsOptional() hidden?: boolean;
}

class RunCodingDto {
  @IsString() language!: string;
  @IsString() code!: string;
  @IsArray() tests!: TestCaseDto[];
}

@ApiTags('practice')
@ApiBearerAuth()
@Controller('practice')
@UseGuards(RolesGuard)
export class PracticeController {
  constructor(
    private readonly practice: PracticeService,
    private readonly council: InterviewCouncilService,
  ) {}

  /** Any candidate can start a mock interview themselves — no approval needed. */
  @Post('start')
  @Roles('CANDIDATE', 'RECRUITER', 'ORG_ADMIN')
  start(@Body() dto: StartPracticeDto) {
    return this.practice.start(dto.category, dto.difficulty, dto.count ?? 5, dto.topic);
  }

  @Post('evaluate')
  @Roles('CANDIDATE', 'RECRUITER', 'ORG_ADMIN')
  evaluate(@Body() dto: EvaluatePracticeDto) {
    return this.practice.evaluate(dto);
  }

  /** Begin a PROCTORED, recorded room session — returns a sessionId to attach flags to. */
  @Post('session')
  @Roles('CANDIDATE', 'RECRUITER', 'ORG_ADMIN')
  startSession(@CurrentUser() user: AuthenticatedUser, @Body() dto: StartSessionDto) {
    return this.practice.startSession(user.id, dto);
  }

  /** Finish a room session: persist transcript + proctoring flags, score it. */
  @Post('session/:id/complete')
  @Roles('CANDIDATE', 'RECRUITER', 'ORG_ADMIN')
  completeSession(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CompleteSessionDto,
  ) {
    return this.practice.completeSession(user.id, id, dto);
  }

  /**
   * AI interviewer multi-agent panel doc — "the candidate never watches the
   * panel debate live... after the interview, the recruiter gets access to
   * the full deliberation." Recruiter/org-admin only, deliberately never
   * exposed to the CANDIDATE role.
   */
  @Get('session/:id/council')
  @Roles('RECRUITER', 'ORG_ADMIN')
  getCouncilReport(@Param('id') id: string) {
    return this.council.getReport(id);
  }

  /** P4 — a presigned URL the candidate's browser PUTs its recorded session to directly. */
  @Post('session/:id/recording-upload-url')
  @Roles('CANDIDATE', 'RECRUITER', 'ORG_ADMIN')
  recordingUploadUrl(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.practice.getRecordingUploadUrl(id, user.id);
  }

  /** P4 — called once the S3 PUT above actually succeeds. */
  @Post('session/:id/recording-complete')
  @Roles('CANDIDATE', 'RECRUITER', 'ORG_ADMIN')
  recordingComplete(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.practice.markRecordingUploaded(id, user.id);
  }

  /** Conversational AI interviewer — returns the interviewer's next message. */
  @Post('interview/turn')
  @Roles('CANDIDATE', 'RECRUITER', 'ORG_ADMIN')
  interviewTurn(@Body() dto: InterviewTurnDto, @CurrentUser() user: AuthenticatedUser) {
    // Looked up server-side from the real authenticated candidate, not
    // client-supplied — same "verify, don't trust client-sent context"
    // reasoning as everywhere else real evidence feeds a prompt in this repo.
    return this.practice.interviewTurn(dto, user.id);
  }

  /** Generate a real coding problem (stdin/stdout + test cases) via the LLM. */
  @Post('coding/generate')
  @Roles('CANDIDATE', 'RECRUITER', 'ORG_ADMIN')
  generateCoding(@Body() dto: GenerateCodingDto) {
    return this.practice.generateCoding(dto.topic, dto.difficulty, dto.kind ?? 'code');
  }

  /** Compile & run candidate code against test cases in the Piston sandbox. */
  @Post('coding/run')
  @Roles('CANDIDATE', 'RECRUITER', 'ORG_ADMIN')
  runCoding(@Body() dto: RunCodingDto) {
    return this.practice.runCoding(dto.language, dto.code, dto.tests);
  }
}
