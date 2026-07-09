import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { QuestionService } from './question.service';
import { AggregatorService } from './aggregator/aggregator.service';
import {
  AggregateDto,
  GenerateQuestionDto,
  ModerateQuestionDto,
  QuestionQueryDto,
  SubmitQuestionDto,
} from './dto/question.dto';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { AuditService } from '../common/audit/audit.service';

@ApiTags('questions')
@ApiBearerAuth()
@Controller('questions')
@UseGuards(RolesGuard)
export class QuestionController {
  constructor(
    private readonly questions: QuestionService,
    private readonly aggregator: AggregatorService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list(@Query() query: QuestionQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.questions.list(query, user.organizationId);
  }

  @Get('moderation/pending')
  @Roles('RECRUITER', 'ORG_ADMIN')
  pending(@CurrentUser() user: AuthenticatedUser) {
    return this.questions.pendingModeration(user.organizationId);
  }

  @Get(':id')
  @Roles('RECRUITER', 'ORG_ADMIN')
  get(@Param('id') id: string) {
    return this.questions.getById(id);
  }

  /** Any authenticated user may submit; goes to moderation. */
  @Post('submit')
  async submit(
    @Body() dto: SubmitQuestionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const q = await this.questions.submit(dto, user.id, user.organizationId);
    await this.audit.record({
      actorId: user.id,
      organizationId: user.organizationId,
      action: 'question.submit',
      targetType: 'Question',
      targetId: q.id,
    });
    return q;
  }

  @Post(':id/moderate')
  @Roles('RECRUITER', 'ORG_ADMIN')
  async moderate(
    @Param('id') id: string,
    @Body() dto: ModerateQuestionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const q = await this.questions.moderate(id, dto.decision);
    await this.audit.record({
      actorId: user.id,
      organizationId: user.organizationId,
      action: `question.${dto.decision.toLowerCase()}`,
      targetType: 'Question',
      targetId: id,
      metadata: { note: dto.note },
    });
    return q;
  }

  @Post('generate')
  @Roles('RECRUITER', 'ORG_ADMIN')
  generate(@Body() dto: GenerateQuestionDto, @CurrentUser() user: AuthenticatedUser) {
    return this.questions.generate(dto, user.organizationId);
  }

  /** Kick off the license-compliant aggregation pipeline. Admin-only. */
  @Post('aggregate')
  @Roles('ORG_ADMIN', 'SUPER_ADMIN')
  async aggregate(@Body() dto: AggregateDto, @CurrentUser() user: AuthenticatedUser) {
    const report = await this.aggregator.run({
      category: dto.category,
      limit: dto.limit,
      generateVariations: dto.generateVariations,
      organizationId: null, // aggregated content is shared across the platform
    });
    await this.audit.record({
      actorId: user.id,
      organizationId: user.organizationId,
      action: 'question.aggregate',
      metadata: { ...report, category: dto.category },
    });
    return report;
  }
}
