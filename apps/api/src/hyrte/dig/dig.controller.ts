import { Body, Controller, Get, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { EvidenceGraphService } from './evidence-graph.service';
import { JobSuccessModelService } from './job-success-model.service';
import { InvestigationPlanService } from './investigation-plan.service';
import { CandidateIntelligenceCardService } from './candidate-intelligence-card.service';
import { CreateEvidenceDto, LinkEvidenceDto } from '../dto/hyrte.dto';
import { getCultureWeights } from './culture-weights';

/**
 * Phase 1 testing surface for the DIG data backbone (build prompt §3). No
 * frontend consumes these yet — "no UI needed" per the phase spec — this
 * exists so the schema/service layer is verifiable end-to-end via API calls
 * before Phase 2+ wires the simulation and interviewer into it.
 */
@ApiTags('hyrte-dig')
@ApiBearerAuth()
@Controller('hyrte/sessions/:id')
@UseGuards(RolesGuard)
@Roles('CANDIDATE')
export class DigController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly evidence: EvidenceGraphService,
    private readonly jobSuccessModel: JobSuccessModelService,
    private readonly investigationPlan: InvestigationPlanService,
    private readonly intelligenceCard: CandidateIntelligenceCardService,
  ) {}

  private async assertOwnership(id: string, user: AuthenticatedUser) {
    const session = await this.prisma.hyrteSession.findFirst({ where: { id, candidateId: user.id }, select: { id: true } });
    if (!session) throw new NotFoundException('Session not found');
  }

  // ── Evidence Graph ──

  @Get('evidence')
  async listEvidence(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    await this.assertOwnership(id, user);
    return this.evidence.getForSession(id);
  }

  @Get('evidence/open-areas')
  async openAreas(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    await this.assertOwnership(id, user);
    return this.evidence.getOpenAreas(id);
  }

  @Get('evidence/by-context')
  async byContext(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    await this.assertOwnership(id, user);
    return this.evidence.getByContext(id);
  }

  @Post('evidence')
  async createEvidence(@Param('id') id: string, @Body() dto: CreateEvidenceDto, @CurrentUser() user: AuthenticatedUser) {
    await this.assertOwnership(id, user);
    return this.evidence.createEvidence({ hyrteSessionId: id, candidateId: user.id, ...dto });
  }

  @Post('evidence/:evidenceId/link')
  async linkEvidence(
    @Param('id') id: string,
    @Param('evidenceId') evidenceId: string,
    @Body() dto: LinkEvidenceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.assertOwnership(id, user);
    return this.evidence.linkEvidence(evidenceId, dto.toId, dto.kind, dto.note);
  }

  // ── Job Success Model ──

  @Get('job-success-model')
  async getJobSuccessModel(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    await this.assertOwnership(id, user);
    return this.jobSuccessModel.getForSession(id);
  }

  @Post('job-success-model/generate')
  async generateJobSuccessModel(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    await this.assertOwnership(id, user);
    return this.jobSuccessModel.generateForSession(id);
  }

  // ── Investigation Plan ──

  @Get('investigation-plan')
  async getInvestigationPlan(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    await this.assertOwnership(id, user);
    return this.investigationPlan.getForSession(id);
  }

  @Post('investigation-plan/generate')
  async generateInvestigationPlan(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    await this.assertOwnership(id, user);
    return this.investigationPlan.generateForSession(id);
  }

  // ── Company Culture scoring weights (§4.19 — data contract, no scorer consumes it yet) ──

  @Get('culture-weights')
  async cultureWeights(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    const session = await this.prisma.hyrteSession.findFirst({ where: { id, candidateId: user.id }, select: { culture: true } });
    if (!session) throw new NotFoundException('Session not found');
    return getCultureWeights(session.culture);
  }

  // ── Candidate Intelligence Card (candidate-scoped, not session-scoped —
  // routed under the session path only for controller/guard convenience) ──

  @Get('intelligence-card')
  async getIntelligenceCard(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    await this.assertOwnership(id, user);
    return this.intelligenceCard.get(user.id);
  }

  @Post('intelligence-card/refresh')
  async refreshIntelligenceCard(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    await this.assertOwnership(id, user);
    return this.intelligenceCard.refresh(user.id);
  }
}
