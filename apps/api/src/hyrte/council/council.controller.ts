import { Body, Controller, Get, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../prisma/prisma.service';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { DecisionCortexService } from './decision-cortex.service';
import { AuditLogService } from '../dig/audit-log.service';
import { AskDecisionCortexDto } from '../dto/hyrte.dto';

/**
 * §6.3's four recruiter-facing surfaces, as separate endpoints from day one
 * (individual agent reports / discussion transcript / Decision Cortex Q&A /
 * combined report — the last already served by the existing
 * `hyrte/sessions/:id/interview/report` endpoint, reused as-is here).
 *
 * Known scope gap, not something this phase can fix: HYRTE has no
 * recruiter/organization assignment model for its own sessions (unlike the
 * main product's `Interview`/`InterviewSession`, which are org-scoped) — a
 * session here is purely self-serve candidate practice. So this gate is
 * role-only (`RECRUITER`/`ORG_ADMIN`/`SUPER_ADMIN`), not scoped to "the
 * recruiter who owns this candidate," because that relationship doesn't
 * exist yet. Tracked in ARCHITECTURE.md alongside the broader Section 0.1
 * recruiter/institution-side gap.
 */
@ApiTags('hyrte-council')
@ApiBearerAuth()
@Controller('hyrte/sessions/:id/council')
@UseGuards(RolesGuard)
@Roles('RECRUITER', 'ORG_ADMIN', 'SUPER_ADMIN')
export class CouncilController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cortex: DecisionCortexService,
    private readonly auditLog: AuditLogService,
  ) {}

  private async assertConvened(id: string) {
    const session = await this.prisma.hyrteSession.findUnique({ where: { id }, select: { id: true } });
    if (!session) throw new NotFoundException('Session not found');
  }

  @Get('agent-reports')
  async agentReports(@Param('id') id: string) {
    await this.assertConvened(id);
    return this.prisma.hyrteCouncilAgentReport.findMany({ where: { sessionId: id }, orderBy: { agentKey: 'asc' } });
  }

  @Get('discussion')
  async discussion(@Param('id') id: string) {
    await this.assertConvened(id);
    return this.prisma.hyrteCouncilDiscussionEntry.findMany({ where: { sessionId: id }, orderBy: { ordinal: 'asc' } });
  }

  @Get('qa')
  async qaHistory(@Param('id') id: string) {
    await this.assertConvened(id);
    return this.cortex.getQAHistory(id);
  }

  @Post('qa')
  async ask(@Param('id') id: string, @Body() dto: AskDecisionCortexDto, @CurrentUser() user: AuthenticatedUser) {
    await this.assertConvened(id);
    return this.cortex.ask(id, user.id, dto.question);
  }

  /** §8 Hardening — bias-auditor coverage review: did every agent actually run for this session? */
  @Get('audit')
  async audit(@Param('id') id: string) {
    await this.assertConvened(id);
    return this.auditLog.getCoverage(id);
  }
}
