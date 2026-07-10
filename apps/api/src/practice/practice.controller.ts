import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsArray, IsEnum, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, Max, Min } from 'class-validator';
import { Category, Difficulty } from '@prisma/client';
import { PracticeService } from './practice.service';
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

class InterviewTurnDto {
  @IsString() jobRole!: string;
  @IsString() category!: string;
  @IsString() difficulty!: string;
  @IsOptional() @IsString() topic?: string;
  @IsOptional() @IsInt() count?: number;
  @IsOptional() @IsString() candidateName?: string;
  @IsOptional() @IsString() personality?: string;
  @IsOptional() @IsString() behaviorSummary?: string;
  @IsArray() transcript!: TurnMsgDto[];
  @IsOptional() end?: boolean;
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
  constructor(private readonly practice: PracticeService) {}

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

  /** Conversational AI interviewer — returns the interviewer's next message. */
  @Post('interview/turn')
  @Roles('CANDIDATE', 'RECRUITER', 'ORG_ADMIN')
  interviewTurn(@Body() dto: InterviewTurnDto) {
    return this.practice.interviewTurn(dto);
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
